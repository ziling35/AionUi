import { initSchema } from '@process/services/database/schema';
import { repairLegacyHandoffSchema } from '@process/services/database/repairLegacyHandoffSchema';
import { resolveLegacyDatabasePath } from '@process/services/database/runLegacyDatabaseMigrations';
import { ensureDirectory, getDataPath } from '@process/utils';
import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';

const DEFAULT_USER_ID = 'system_default_user';
const TEAM_ARCHIVE_VERSION = 1;

type DbRecord = Record<string, unknown>;

type TeamArchivePayload = {
  version: number;
  exportedAt: string;
  team: DbRecord;
  conversations: DbRecord[];
  messages: DbRecord[];
  mailbox: DbRecord[];
  tasks: DbRecord[];
};

export type TeamArchiveExportResult = {
  path: string;
  conversationCount: number;
  messageCount: number;
  taskCount: number;
};

export type TeamArchiveImportResult = {
  teamId: string;
  conversationCount: number;
  messageCount: number;
  taskCount: number;
};

export type TeamArchiveOptions = {
  dataDir?: string;
  dbPath?: string;
  userId?: string;
};

function getTableColumns(db: import('@process/services/database/drivers/ISqliteDriver').ISqliteDriver, table: string) {
  const rows = db.pragma(`table_info(${table})`) as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

function readJsonField<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || !value.trim()) {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function writeJsonField(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function buildInsertSql(table: string, columns: string[]): string {
  return `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`;
}

function rowValues(row: DbRecord, columns: string[]): unknown[] {
  return columns.map((column) => row[column] ?? null);
}

function sanitizeFileName(value: string): string {
  return value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function ensureSystemUser(
  db: import('@process/services/database/drivers/ISqliteDriver').ISqliteDriver,
  userId = DEFAULT_USER_ID
): void {
  const now = Date.now();
  db.prepare(
    `INSERT OR IGNORE INTO users (id, username, email, password_hash, avatar_path, created_at, updated_at, last_login, jwt_secret)
     VALUES (?, ?, NULL, ?, NULL, ?, ?, NULL, NULL)`
  ).run(userId, userId, '', now, now);
}

async function openDb(options: TeamArchiveOptions) {
  const { BetterSqlite3Driver } = await import('@process/services/database/drivers/BetterSqlite3Driver');
  const dataDir = options.dataDir ?? getDataPath();
  const dbPath = options.dbPath ?? resolveLegacyDatabasePath(dataDir);
  ensureDirectory(path.dirname(dbPath));
  const db = new BetterSqlite3Driver(dbPath);
  initSchema(db);
  repairLegacyHandoffSchema(db);
  ensureSystemUser(db, options.userId);
  db.pragma('busy_timeout = 5000');
  return { db, dataDir };
}

function readRowsByTeam(
  db: import('@process/services/database/drivers/ISqliteDriver').ISqliteDriver,
  table: string,
  teamId: string
): DbRecord[] {
  return db.prepare(`SELECT * FROM ${table} WHERE team_id = ?`).all(teamId) as DbRecord[];
}

function collectTeamConversationIds(team: DbRecord): string[] {
  const agents = readJsonField<Array<{ conversation_id?: string }>>(team.agents, []);
  return agents.map((agent) => agent.conversation_id).filter((id): id is string => Boolean(id));
}

function remapJsonIds(value: unknown, idMap: Map<string, string>): unknown {
  if (typeof value === 'string') {
    return idMap.get(value) ?? value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => remapJsonIds(item, idMap));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, remapJsonIds(child, idMap)])
    );
  }
  return value;
}

function normalizeConversationExtra(extraJson: unknown, oldTeamId: string, newTeamId: string, newWorkspace: string) {
  const extra = readJsonField<Record<string, unknown>>(extraJson, {});
  return writeJsonField({
    ...extra,
    team_id: extra.team_id === oldTeamId ? newTeamId : extra.team_id,
    teamId: extra.teamId === oldTeamId ? newTeamId : extra.teamId,
    workspace: newWorkspace,
    custom_workspace: true,
    imported_from: {
      ...(typeof extra.imported_from === 'object' && extra.imported_from ? extra.imported_from : {}),
      team_id: oldTeamId,
      imported_at: Date.now(),
    },
  });
}

function assertTeamArchivePayload(value: unknown): TeamArchivePayload {
  if (!value || typeof value !== 'object') {
    throw new Error('invalid_team_archive');
  }
  const payload = value as TeamArchivePayload;
  if (payload.version !== TEAM_ARCHIVE_VERSION) {
    throw new Error('unsupported_team_archive_version');
  }
  if (!payload.team || typeof payload.team.id !== 'string') {
    throw new Error('invalid_team_archive');
  }
  if (!Array.isArray(payload.conversations) || !Array.isArray(payload.messages)) {
    throw new Error('invalid_team_archive');
  }
  return payload;
}

export async function exportTeamArchiveToFile(
  teamId: string,
  directory: string,
  options: TeamArchiveOptions = {}
): Promise<TeamArchiveExportResult> {
  const { db } = await openDb(options);
  try {
    const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(teamId) as DbRecord | undefined;
    if (!team) {
      throw new Error('team_not_found');
    }

    const conversationIds = collectTeamConversationIds(team);
    const conversations =
      conversationIds.length > 0
        ? (db
            .prepare(`SELECT * FROM conversations WHERE id IN (${conversationIds.map(() => '?').join(', ')})`)
            .all(...conversationIds) as DbRecord[])
        : [];
    const messages =
      conversationIds.length > 0
        ? (db
            .prepare(`SELECT * FROM messages WHERE conversation_id IN (${conversationIds.map(() => '?').join(', ')})`)
            .all(...conversationIds) as DbRecord[])
        : [];
    const mailbox = readRowsByTeam(db, 'mailbox', teamId);
    const tasks = readRowsByTeam(db, 'team_tasks', teamId);
    const payload: TeamArchivePayload = {
      version: TEAM_ARCHIVE_VERSION,
      exportedAt: new Date().toISOString(),
      team,
      conversations,
      messages,
      mailbox,
      tasks,
    };

    await fs.mkdir(directory, { recursive: true });
    const fileName = `${sanitizeFileName(String(team.name || 'team')) || 'team'}-${new Date()
      .toISOString()
      .replace(/[:.]/g, '-')}.lingai-team.json`;
    const filePath = path.join(directory, fileName);
    await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');

    return {
      path: filePath,
      conversationCount: conversations.length,
      messageCount: messages.length,
      taskCount: tasks.length,
    };
  } finally {
    db.close();
  }
}

export async function importTeamArchiveFromFile(
  filePath: string,
  options: TeamArchiveOptions = {}
): Promise<TeamArchiveImportResult> {
  const payload = assertTeamArchivePayload(JSON.parse(await fs.readFile(filePath, 'utf8')) as unknown);
  const { db, dataDir } = await openDb(options);
  try {
    const now = Date.now();
    const userId = options.userId ?? DEFAULT_USER_ID;
    const oldTeamId = String(payload.team.id);
    const newTeamId = `imported-team-${randomUUID()}`;
    const newWorkspace = path.join(dataDir, 'imported-teams', newTeamId);
    await fs.mkdir(newWorkspace, { recursive: true });

    const conversationIdMap = new Map<string, string>();
    payload.conversations.forEach((conversation) => {
      if (typeof conversation.id === 'string') {
        conversationIdMap.set(conversation.id, `imported-${randomUUID()}`);
      }
    });
    const taskIdMap = new Map<string, string>();
    payload.tasks.forEach((task) => {
      if (typeof task.id === 'string') {
        taskIdMap.set(task.id, `imported-task-${randomUUID()}`);
      }
    });

    const teamColumns = getTableColumns(db, 'teams');
    const conversationColumns = getTableColumns(db, 'conversations');
    const messageColumns = getTableColumns(db, 'messages');
    const mailboxColumns = getTableColumns(db, 'mailbox');
    const taskColumns = getTableColumns(db, 'team_tasks');

    const insertTeam = db.prepare(buildInsertSql('teams', teamColumns));
    const insertConversation = db.prepare(buildInsertSql('conversations', conversationColumns));
    const insertMessage = db.prepare(buildInsertSql('messages', messageColumns));
    const insertMailbox = db.prepare(buildInsertSql('mailbox', mailboxColumns));
    const insertTask = db.prepare(buildInsertSql('team_tasks', taskColumns));

    const importedTeam: DbRecord = {
      ...payload.team,
      id: newTeamId,
      user_id: userId,
      name: `${String(payload.team.name || 'Team')} (Imported)`,
      workspace: newWorkspace,
      agents: writeJsonField(
        readJsonField<Array<Record<string, unknown>>>(payload.team.agents, []).map((agent) => ({
          ...agent,
          conversation_id:
            typeof agent.conversation_id === 'string'
              ? (conversationIdMap.get(agent.conversation_id) ?? agent.conversation_id)
              : agent.conversation_id,
          status: 'idle',
          pending_confirmations: 0,
        }))
      ),
      created_at: typeof payload.team.created_at === 'number' ? payload.team.created_at : now,
      updated_at: now,
    };

    const transaction = db.transaction(() => {
      insertTeam.run(...rowValues(importedTeam, teamColumns));

      for (const conversation of payload.conversations) {
        const oldConversationId = String(conversation.id || '');
        const newConversationId = conversationIdMap.get(oldConversationId);
        if (!newConversationId) continue;
        insertConversation.run(
          ...rowValues(
            {
              ...conversation,
              id: newConversationId,
              user_id: userId,
              name: conversation.name ? `${conversation.name} (Imported)` : 'Imported Team Conversation',
              extra: normalizeConversationExtra(conversation.extra, oldTeamId, newTeamId, newWorkspace),
              created_at: typeof conversation.created_at === 'number' ? conversation.created_at : now,
              updated_at: now,
            },
            conversationColumns
          )
        );
      }

      for (const message of payload.messages) {
        const oldConversationId = String(message.conversation_id || '');
        const newConversationId = conversationIdMap.get(oldConversationId);
        if (!newConversationId) continue;
        insertMessage.run(
          ...rowValues(
            {
              ...message,
              id: randomUUID(),
              conversation_id: newConversationId,
            },
            messageColumns
          )
        );
      }

      for (const item of payload.mailbox) {
        const oldConversationId = typeof item.conversation_id === 'string' ? item.conversation_id : '';
        insertMailbox.run(
          ...rowValues(
            {
              ...item,
              id: randomUUID(),
              team_id: newTeamId,
              conversation_id: conversationIdMap.get(oldConversationId) ?? item.conversation_id,
            },
            mailboxColumns
          )
        );
      }

      for (const task of payload.tasks) {
        const oldTaskId = String(task.id || '');
        const newTaskId = taskIdMap.get(oldTaskId) ?? `imported-task-${randomUUID()}`;
        const idMap = new Map([...conversationIdMap, ...taskIdMap, [oldTeamId, newTeamId]]);
        insertTask.run(
          ...rowValues(
            {
              ...task,
              id: newTaskId,
              team_id: newTeamId,
              blocked_by: writeJsonField(remapJsonIds(readJsonField(task.blocked_by, []), idMap)),
              blocks: writeJsonField(remapJsonIds(readJsonField(task.blocks, []), idMap)),
              metadata: writeJsonField(remapJsonIds(readJsonField(task.metadata, {}), idMap)),
              updated_at: now,
            },
            taskColumns
          )
        );
      }
    });

    transaction();
    return {
      teamId: newTeamId,
      conversationCount: payload.conversations.length,
      messageCount: payload.messages.length,
      taskCount: payload.tasks.length,
    };
  } finally {
    db.close();
  }
}
