import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

type FakeRow = Record<string, unknown>;

type FakeDbState = {
  columns: Record<string, string[]>;
  source: {
    teams: FakeRow[];
    conversations: FakeRow[];
    messages: FakeRow[];
    mailbox: FakeRow[];
    team_tasks: FakeRow[];
  };
  inserted: {
    teams: FakeRow[];
    conversations: FakeRow[];
    messages: FakeRow[];
    mailbox: FakeRow[];
    team_tasks: FakeRow[];
  };
};

const fakeDbState = vi.hoisted<FakeDbState>(() => ({
  columns: {
    teams: ['id', 'user_id', 'name', 'workspace', 'agents', 'created_at', 'updated_at'],
    conversations: ['id', 'user_id', 'name', 'type', 'extra', 'created_at', 'updated_at'],
    messages: ['id', 'conversation_id', 'msg_id', 'type', 'content'],
    mailbox: ['id', 'team_id', 'conversation_id', 'message'],
    team_tasks: ['id', 'team_id', 'title', 'blocked_by', 'blocks', 'metadata', 'updated_at'],
    users: ['id'],
  },
  source: {
    teams: [],
    conversations: [],
    messages: [],
    mailbox: [],
    team_tasks: [],
  },
  inserted: {
    teams: [],
    conversations: [],
    messages: [],
    mailbox: [],
    team_tasks: [],
  },
}));

function rowFromInsert(sql: string, args: unknown[]): { table: keyof FakeDbState['inserted']; row: FakeRow } {
  const match = /^INSERT INTO (\w+) \(([^)]+)\)/.exec(sql);
  if (!match) {
    throw new Error(`Unsupported insert SQL: ${sql}`);
  }
  const table = match[1] as keyof FakeDbState['inserted'];
  const columns = match[2].split(',').map((column) => column.trim());
  return {
    table,
    row: Object.fromEntries(columns.map((column, index) => [column, args[index]])),
  };
}

vi.mock('@process/services/database/drivers/BetterSqlite3Driver', () => {
  class BetterSqlite3Driver {
    prepare(sql: string) {
      return {
        run: (...args: unknown[]) => {
          if (sql.startsWith('INSERT OR IGNORE INTO users')) return { changes: 1, lastInsertRowid: 1 };
          if (sql.startsWith('INSERT INTO')) {
            const { table, row } = rowFromInsert(sql, args);
            fakeDbState.inserted[table].push(row);
            return { changes: 1, lastInsertRowid: 1 };
          }
          return { changes: 0, lastInsertRowid: 0 };
        },
        all: (...args: unknown[]) => {
          if (sql.startsWith('SELECT * FROM conversations WHERE id IN')) {
            return fakeDbState.source.conversations.filter((conversation) => args.includes(conversation.id));
          }
          if (sql.startsWith('SELECT * FROM messages WHERE conversation_id IN')) {
            return fakeDbState.source.messages.filter((message) => args.includes(message.conversation_id));
          }
          if (sql === 'SELECT * FROM mailbox WHERE team_id = ?') {
            return fakeDbState.source.mailbox.filter((item) => item.team_id === args[0]);
          }
          if (sql === 'SELECT * FROM team_tasks WHERE team_id = ?') {
            return fakeDbState.source.team_tasks.filter((task) => task.team_id === args[0]);
          }
          return [];
        },
        get: (...args: unknown[]) => {
          if (sql === 'SELECT * FROM teams WHERE id = ?') {
            return fakeDbState.source.teams.find((team) => team.id === args[0]);
          }
          return undefined;
        },
      };
    }

    exec() {}

    pragma(sql: string, options?: { simple?: boolean }) {
      if (options?.simple) return 26;
      const match = /^table_info\((\w+)\)$/.exec(sql);
      if (match) {
        return (fakeDbState.columns[match[1]] ?? []).map((name) => ({ name }));
      }
      return [];
    }

    transaction<T>(fn: (...args: unknown[]) => T) {
      return fn;
    }

    close() {}
  }

  return { BetterSqlite3Driver };
});

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lingai-team-archive-test-'));
  tempDirs.push(dir);
  return dir;
}

function resetFakeDb(): void {
  Object.values(fakeDbState.source).forEach((rows) => rows.splice(0));
  Object.values(fakeDbState.inserted).forEach((rows) => rows.splice(0));
}

afterEach(async () => {
  resetFakeDb();
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('teamArchiveService', () => {
  it('exports team conversations, messages, mailbox, and tasks to an archive file', async () => {
    const { exportTeamArchiveToFile } = await import('@process/services/teamArchiveService');
    const dataDir = await createTempDir();
    fakeDbState.source.teams.push({
      id: 'team-1',
      name: 'Research Team',
      agents: JSON.stringify([{ id: 'agent-1', conversation_id: 'conversation-1' }]),
    });
    fakeDbState.source.conversations.push({
      id: 'conversation-1',
      name: 'Agent Conversation',
      extra: JSON.stringify({ team_id: 'team-1' }),
    });
    fakeDbState.source.messages.push({
      id: 'message-1',
      conversation_id: 'conversation-1',
      content: JSON.stringify({ content: 'hello' }),
    });
    fakeDbState.source.mailbox.push({ id: 'mail-1', team_id: 'team-1', message: 'done' });
    fakeDbState.source.team_tasks.push({ id: 'task-1', team_id: 'team-1', title: 'Draft' });

    const result = await exportTeamArchiveToFile('team-1', dataDir, { dataDir });
    const archive = JSON.parse(await fs.readFile(result.path, 'utf8')) as {
      team: FakeRow;
      conversations: FakeRow[];
      messages: FakeRow[];
      mailbox: FakeRow[];
      tasks: FakeRow[];
    };

    expect(result.conversationCount).toBe(1);
    expect(result.messageCount).toBe(1);
    expect(result.taskCount).toBe(1);
    expect(archive.team.id).toBe('team-1');
    expect(archive.conversations[0].id).toBe('conversation-1');
    expect(archive.messages[0].conversation_id).toBe('conversation-1');
    expect(archive.mailbox[0].id).toBe('mail-1');
    expect(archive.tasks[0].id).toBe('task-1');
  });

  it('imports an archive as a new team and remaps related records', async () => {
    const { importTeamArchiveFromFile } = await import('@process/services/teamArchiveService');
    const dataDir = await createTempDir();
    const importFile = path.join(dataDir, 'team.lingai-team.json');
    await fs.writeFile(
      importFile,
      JSON.stringify({
        version: 1,
        exportedAt: '2026-07-05T00:00:00.000Z',
        team: {
          id: 'source-team',
          user_id: 'source-user',
          name: 'Source Team',
          workspace: '/source',
          agents: JSON.stringify([{ id: 'agent-1', conversation_id: 'source-conversation', status: 'running' }]),
          created_at: 1000,
          updated_at: 2000,
        },
        conversations: [
          {
            id: 'source-conversation',
            user_id: 'source-user',
            name: 'Source Conversation',
            type: 'team',
            extra: JSON.stringify({ team_id: 'source-team', teamId: 'source-team', workspace: '/source' }),
            created_at: 1100,
            updated_at: 2100,
          },
        ],
        messages: [
          {
            id: 'source-message',
            conversation_id: 'source-conversation',
            msg_id: 'turn-1',
            type: 'text',
            content: JSON.stringify({ content: 'hello' }),
          },
        ],
        mailbox: [{ id: 'source-mail', team_id: 'source-team', conversation_id: 'source-conversation' }],
        tasks: [
          {
            id: 'source-task',
            team_id: 'source-team',
            title: 'Source Task',
            blocked_by: JSON.stringify(['source-task']),
            blocks: JSON.stringify([]),
            metadata: JSON.stringify({
              conversationId: 'source-conversation',
              taskId: 'source-task',
              teamId: 'source-team',
            }),
            updated_at: 2200,
          },
        ],
      }),
      'utf8'
    );

    const result = await importTeamArchiveFromFile(importFile, { dataDir, userId: 'current-user' });

    expect(result.teamId.startsWith('imported-team-')).toBe(true);
    expect(fakeDbState.inserted.teams[0].id).toBe(result.teamId);
    expect(fakeDbState.inserted.teams[0].user_id).toBe('current-user');
    expect(fakeDbState.inserted.teams[0].name).toBe('Source Team (Imported)');
    expect(JSON.parse(fakeDbState.inserted.teams[0].agents as string)[0].conversation_id).toBe(
      fakeDbState.inserted.conversations[0].id
    );
    expect(fakeDbState.inserted.conversations[0].id).not.toBe('source-conversation');
    expect(JSON.parse(fakeDbState.inserted.conversations[0].extra as string).team_id).toBe(result.teamId);
    expect(fakeDbState.inserted.messages[0].conversation_id).toBe(fakeDbState.inserted.conversations[0].id);
    expect(fakeDbState.inserted.mailbox[0].team_id).toBe(result.teamId);
    expect(fakeDbState.inserted.mailbox[0].conversation_id).toBe(fakeDbState.inserted.conversations[0].id);
    expect(JSON.parse(fakeDbState.inserted.team_tasks[0].blocked_by as string)[0]).toBe(
      fakeDbState.inserted.team_tasks[0].id
    );
    const taskMetadata = JSON.parse(fakeDbState.inserted.team_tasks[0].metadata as string) as {
      conversationId: string;
      taskId: string;
      teamId: string;
    };
    expect(taskMetadata.conversationId).toBe(fakeDbState.inserted.conversations[0].id);
    expect(taskMetadata.teamId).toBe(result.teamId);
  });

  it('rejects unsupported archive versions', async () => {
    const { importTeamArchiveFromFile } = await import('@process/services/teamArchiveService');
    const dataDir = await createTempDir();
    const importFile = path.join(dataDir, 'team.lingai-team.json');
    await fs.writeFile(
      importFile,
      JSON.stringify({
        version: 999,
        team: { id: 'team-1' },
        conversations: [],
        messages: [],
      }),
      'utf8'
    );

    await expect(importTeamArchiveFromFile(importFile, { dataDir })).rejects.toThrow(
      'unsupported_team_archive_version'
    );
  });
});
