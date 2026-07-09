import type { TMessage } from '@/common/chat/chatLib';
import type { TChatConversation } from '@/common/config/storage';
import { httpRequest } from '@/common/adapter/httpBridge';
import { getDataPath } from '@process/utils';
import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import * as yauzl from 'yauzl';

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
};

type BackendImportConversation = {
  id: string;
  name: string;
  type: string;
  extra: unknown;
  model?: unknown;
  source?: string;
  channel_chat_id?: string;
  created_at?: number;
  modified_at?: number;
};

type BackendImportMessage = {
  msg_id?: string;
  type: string;
  content: unknown;
  position?: string;
  status?: string;
  hidden?: boolean;
  created_at?: number;
};

type BackendImportRequest = {
  conversations: Array<{
    conversation: BackendImportConversation;
    messages: BackendImportMessage[];
  }>;
};

type BackendImportResult = {
  imported_count: number;
  message_count: number;
  conversation_ids: string[];
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

function toBackendImportConversation(conversation: TChatConversation): BackendImportConversation {
  const model = (conversation as TChatConversation & { model?: unknown }).model;
  return {
    id: conversation.id,
    name: conversation.name,
    type: conversation.type,
    extra: conversation.extra ?? {},
    ...(model !== undefined ? { model } : {}),
    source: conversation.source,
    channel_chat_id: conversation.channel_chat_id,
    created_at: conversation.created_at,
    modified_at: conversation.modified_at,
  };
}

function toBackendImportMessage(message: TMessage): BackendImportMessage {
  return {
    msg_id: message.msg_id ?? message.id,
    type: message.type,
    content: message.content,
    position: message.position,
    status: message.status,
    hidden: Boolean((message as TMessage & { hidden?: boolean }).hidden),
    created_at: message.created_at,
  };
}

function buildBackendImportRequest(restoredItems: Array<ConversationImportItem & { conversation: TChatConversation }>) {
  return {
    conversations: restoredItems.map((item) => ({
      conversation: toBackendImportConversation(item.conversation),
      messages: item.payload.messages.map(toBackendImportMessage),
    })),
  } satisfies BackendImportRequest;
}

async function importConversationItems(
  items: ConversationImportItem[],
  options: ConversationImportOptions = {}
): Promise<ConversationImportResult> {
  if (items.length === 0) {
    throw new Error('no_importable_conversations');
  }

  const dataDir = options.dataDir ?? getDataPath();
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

  const result = await httpRequest<BackendImportResult>(
    'POST',
    '/api/conversations/import',
    buildBackendImportRequest(restoredItems)
  );

  return {
    importedCount: result.imported_count,
    messageCount: result.message_count,
    workspaceFileCount: restoredItems.reduce((count, item) => count + item.workspaceFiles.length, 0),
    conversationIds: result.conversation_ids,
  };
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
