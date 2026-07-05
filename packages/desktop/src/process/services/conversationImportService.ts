import type { TMessage } from '@/common/chat/chatLib';
import type { TChatConversation } from '@/common/config/storage';
import { repairLegacyHandoffSchema } from '@process/services/database/repairLegacyHandoffSchema';
import { resolveLegacyDatabasePath } from '@process/services/database/runLegacyDatabaseMigrations';
import { initSchema } from '@process/services/database/schema';
import { ensureDirectory, getDataPath } from '@process/utils';
import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import * as yauzl from 'yauzl';

const DEFAULT_USER_ID = 'system_default_user';
const MAX_IMPORT_JSON_BYTES = 50 * 1024 * 1024;

export type ExportedConversationPayload = {
  version: number;
  exportedAt?: string;
  conversation: TChatConversation;
  messages: TMessage[];
};

type ZipEntryPayload = {
  name: string;
  buffer: Buffer;
};

type WorkspaceFilePayload = {
  relativePath: string;
  buffer: Buffer;
};

type ConversationImportItem = {
  payload: ExportedConversationPayload;
  workspaceFiles: WorkspaceFilePayload[];
};

export type ConversationImportResult = {
  importedCount: number;
  messageCount: number;
  workspaceFileCount: number;
  conversationIds: string[];
};

export type ConversationImportOptions = {
  dataDir?: string;
  dbPath?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertExportedConversationPayload(value: unknown): ExportedConversationPayload {
  if (!isRecord(value)) {
    throw new Error('invalid_import_payload');
  }
  if (value.version !== 1) {
    throw new Error('unsupported_import_version');
  }
  if (!isRecord(value.conversation) || typeof value.conversation.id !== 'string') {
    throw new Error('invalid_import_conversation');
  }
  if (!Array.isArray(value.messages)) {
    throw new Error('invalid_import_messages');
  }
  return value as ExportedConversationPayload;
}

function normalizeZipEntryName(name: string): string {
  return name.replace(/\\/g, '/').replace(/^\/+/, '');
}

function isUnsafeRelativePath(value: string): boolean {
  const normalized = normalizeZipEntryName(value);
  return !normalized || path.isAbsolute(normalized) || normalized.split('/').some((part) => part === '..');
}

function getConversationJsonGroup(entryName: string): string | undefined {
  const normalized = normalizeZipEntryName(entryName);
  const suffix = '/conversation/conversation.json';
  return normalized.endsWith(suffix) ? normalized.slice(0, -suffix.length) : undefined;
}

function getWorkspaceRelativePath(entryName: string, group: string): string | undefined {
  const normalized = normalizeZipEntryName(entryName);
  const prefix = `${group}/workspace/`;
  if (!normalized.startsWith(prefix)) return undefined;
  const relativePath = normalized.slice(prefix.length);
  return isUnsafeRelativePath(relativePath) ? undefined : relativePath;
}

function shouldReadZipEntry(name: string): boolean {
  const normalized = normalizeZipEntryName(name);
  return normalized.endsWith('/conversation/conversation.json') || normalized.includes('/workspace/');
}

async function readZipEntries(zipPath: string): Promise<ZipEntryPayload[]> {
  return await new Promise((resolve, reject) => {
    const entries: ZipEntryPayload[] = [];
    yauzl.open(zipPath, { lazyEntries: true }, (openError, zipFile) => {
      if (openError || !zipFile) {
        reject(openError ?? new Error('failed_to_open_zip'));
        return;
      }

      zipFile.readEntry();
      zipFile.on('entry', (entry) => {
        if (/\/$/.test(entry.fileName) || !shouldReadZipEntry(entry.fileName)) {
          zipFile.readEntry();
          return;
        }
        if (entry.uncompressedSize > MAX_IMPORT_JSON_BYTES) {
          zipFile.close();
          reject(new Error('import_entry_too_large'));
          return;
        }
        zipFile.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) {
            zipFile.close();
            reject(streamError ?? new Error('failed_to_read_zip_entry'));
            return;
          }
          const chunks: Buffer[] = [];
          stream.on('data', (chunk: Buffer) => chunks.push(chunk));
          stream.on('error', (error) => {
            zipFile.close();
            reject(error);
          });
          stream.on('end', () => {
            entries.push({ name: normalizeZipEntryName(entry.fileName), buffer: Buffer.concat(chunks) });
            zipFile.readEntry();
          });
        });
      });
      zipFile.on('end', () => resolve(entries));
      zipFile.on('error', reject);
    });
  });
}

async function readImportItems(filePath: string): Promise<ConversationImportItem[]> {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.json') {
    const raw = await fs.readFile(filePath, 'utf8');
    return [{ payload: assertExportedConversationPayload(JSON.parse(raw) as unknown), workspaceFiles: [] }];
  }

  if (ext !== '.zip') {
    throw new Error('unsupported_import_file');
  }

  const entries = await readZipEntries(filePath);
  const groups = new Map<string, ConversationImportItem>();
  for (const entry of entries) {
    const group = getConversationJsonGroup(entry.name);
    if (!group) continue;
    const payload = assertExportedConversationPayload(JSON.parse(entry.buffer.toString('utf8')) as unknown);
    groups.set(group, { payload, workspaceFiles: [] });
  }

  for (const entry of entries) {
    for (const [group, item] of groups) {
      const relativePath = getWorkspaceRelativePath(entry.name, group);
      if (relativePath) {
        item.workspaceFiles.push({ relativePath, buffer: entry.buffer });
      }
    }
  }

  return [...groups.values()];
}

function serializeJsonField(value: unknown, fallback: string): string {
  if (value === undefined || value === null) return fallback;
  return JSON.stringify(value);
}

function serializeMessageContent(value: unknown): string {
  if (typeof value === 'string') return value;
  return serializeJsonField(value, '');
}

function getTableColumns(db: import('@process/services/database/drivers/ISqliteDriver').ISqliteDriver, table: string) {
  const rows = db.pragma(`table_info(${table})`) as Array<{ name: string }>;
  return new Set(rows.map((row) => row.name));
}

function ensureSystemUser(db: import('@process/services/database/drivers/ISqliteDriver').ISqliteDriver): void {
  const now = Date.now();
  db.prepare(
    `INSERT OR IGNORE INTO users (id, username, email, password_hash, avatar_path, created_at, updated_at, last_login, jwt_secret)
     VALUES (?, ?, NULL, ?, NULL, ?, ?, NULL, NULL)`
  ).run(DEFAULT_USER_ID, DEFAULT_USER_ID, '', now, now);
}

function createImportedConversation(
  source: TChatConversation,
  workspacePath: string | undefined,
  exportedAt: string | undefined
): TChatConversation {
  const now = Date.now();
  const extra = isRecord(source.extra) ? source.extra : {};
  return ({
    ...source,
    id: `imported-${randomUUID()}`,
    name: source.name ? `${source.name} (Imported)` : 'Imported Conversation',
    status: 'finished',
    created_at: typeof source.created_at === 'number' ? source.created_at : now,
    modified_at: now,
    extra: {
      ...extra,
      ...(workspacePath ? { workspace: workspacePath, custom_workspace: true } : {}),
      imported_from: {
        conversation_id: source.id,
        exported_at: exportedAt,
        imported_at: now,
      },
      pinned: false,
      pinned_at: undefined,
    },
  } as unknown) as TChatConversation;
}

async function restoreWorkspaceFiles(
  conversationId: string,
  files: WorkspaceFilePayload[],
  dataDir = getDataPath()
): Promise<string | undefined> {
  if (files.length === 0) return undefined;

  const workspaceRoot = path.join(dataDir, 'imported-conversations', conversationId);
  for (const file of files) {
    const target = path.resolve(workspaceRoot, file.relativePath);
    if (!target.startsWith(path.resolve(workspaceRoot) + path.sep)) {
      continue;
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, file.buffer);
  }
  return workspaceRoot;
}

async function importConversationItems(
  items: ConversationImportItem[],
  options: ConversationImportOptions = {}
): Promise<ConversationImportResult> {
  if (items.length === 0) {
    throw new Error('no_importable_conversations');
  }

  const { BetterSqlite3Driver } = await import('@process/services/database/drivers/BetterSqlite3Driver');
  const dataDir = options.dataDir ?? getDataPath();
  const dbPath = options.dbPath ?? resolveLegacyDatabasePath(dataDir);
  ensureDirectory(path.dirname(dbPath));
  const db = new BetterSqlite3Driver(dbPath);

  try {
    initSchema(db);
    repairLegacyHandoffSchema(db);
    ensureSystemUser(db);
    db.pragma('busy_timeout = 5000');
    const conversationColumns = getTableColumns(db, 'conversations');
    const messageColumns = getTableColumns(db, 'messages');
    const hasMessageHidden = messageColumns.has('hidden');

    const insertConversation = db.prepare(
      `INSERT INTO conversations (${[
        'id',
        'user_id',
        'name',
        'type',
        'extra',
        'model',
        'status',
        'source',
        'channel_chat_id',
        ...(conversationColumns.has('pinned') ? ['pinned'] : []),
        ...(conversationColumns.has('pinned_at') ? ['pinned_at'] : []),
        'created_at',
        'updated_at',
      ].join(', ')}) VALUES (${[
        '?',
        '?',
        '?',
        '?',
        '?',
        '?',
        '?',
        '?',
        '?',
        ...(conversationColumns.has('pinned') ? ['?'] : []),
        ...(conversationColumns.has('pinned_at') ? ['?'] : []),
        '?',
        '?',
      ].join(', ')})`
    );
    const insertMessage = db.prepare(
      `INSERT INTO messages (${[
        'id',
        'conversation_id',
        'msg_id',
        'type',
        'content',
        'position',
        'status',
        'created_at',
        ...(hasMessageHidden ? ['hidden'] : []),
      ].join(', ')}) VALUES (${['?', '?', '?', '?', '?', '?', '?', '?', ...(hasMessageHidden ? ['?'] : [])].join(', ')})`
    );

    const restoredItems = await Promise.all(
      items.map(async (item) => {
        const previewConversation = createImportedConversation(item.payload.conversation, undefined, item.payload.exportedAt);
        const workspacePath = await restoreWorkspaceFiles(previewConversation.id, item.workspaceFiles, dataDir);
        return {
          ...item,
          conversation: workspacePath
            ? createImportedConversation(item.payload.conversation, workspacePath, item.payload.exportedAt)
            : previewConversation,
        };
      })
    );

    const conversationIds: string[] = [];
    let messageCount = 0;
    const transaction = db.transaction(() => {
      for (const item of restoredItems) {
        const conversation = item.conversation;
        conversationIds.push(conversation.id);
        insertConversation.run(
          ...[
            conversation.id,
            DEFAULT_USER_ID,
            conversation.name,
            conversation.type,
            serializeJsonField(conversation.extra, '{}'),
            serializeJsonField('model' in conversation ? conversation.model : undefined, '{}'),
            conversation.status ?? 'finished',
            conversation.source ?? 'lingai',
            conversation.channel_chat_id ?? null,
            ...(conversationColumns.has('pinned') ? [0] : []),
            ...(conversationColumns.has('pinned_at') ? [null] : []),
            conversation.created_at,
            conversation.modified_at,
          ]
        );

        item.payload.messages.forEach((message, index) => {
          insertMessage.run(
            ...[
              randomUUID(),
              conversation.id,
              message.msg_id ?? message.id ?? null,
              message.type,
              serializeMessageContent(message.content),
              message.position ?? null,
              message.status ?? null,
              typeof message.created_at === 'number' ? message.created_at : conversation.created_at + index,
              ...(hasMessageHidden ? [(message as { hidden?: boolean }).hidden ? 1 : 0] : []),
            ]
          );
          messageCount += 1;
        });
      }
    });

    transaction();

    return {
      importedCount: restoredItems.length,
      messageCount,
      workspaceFileCount: restoredItems.reduce((count, item) => count + item.workspaceFiles.length, 0),
      conversationIds,
    };
  } finally {
    db.close();
  }
}

export async function importConversationsFromFile(
  filePath: string,
  options: ConversationImportOptions = {}
): Promise<ConversationImportResult> {
  return importConversationItems(await readImportItems(filePath), options);
}

export async function importConversationFromPayload(
  payload: ExportedConversationPayload,
  options: ConversationImportOptions = {}
): Promise<ConversationImportResult> {
  return importConversationItems([{ payload: assertExportedConversationPayload(payload), workspaceFiles: [] }], options);
}
