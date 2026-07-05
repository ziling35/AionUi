import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

type FakeConversationRow = {
  id: string;
  name: string;
  type: string;
  extra: string;
};

type FakeMessageRow = {
  conversation_id: string;
  msg_id: string | null;
  content: string;
};

const fakeDbState = vi.hoisted(() => ({
  conversations: [] as FakeConversationRow[],
  messages: [] as FakeMessageRow[],
}));

vi.mock('@process/services/database/drivers/BetterSqlite3Driver', () => {
  class BetterSqlite3Driver {
    prepare(sql: string) {
      return {
        run: (...args: unknown[]) => {
          if (sql.startsWith('INSERT OR IGNORE INTO users')) return { changes: 1, lastInsertRowid: 1 };
          if (sql.startsWith('INSERT INTO conversations')) {
            fakeDbState.conversations.push({
              id: args[0] as string,
              name: args[2] as string,
              type: args[3] as string,
              extra: args[4] as string,
            });
            return { changes: 1, lastInsertRowid: 1 };
          }
          if (sql.startsWith('INSERT INTO messages')) {
            fakeDbState.messages.push({
              conversation_id: args[1] as string,
              msg_id: args[2] as string | null,
              content: args[4] as string,
            });
            return { changes: 1, lastInsertRowid: 1 };
          }
          return { changes: 0, lastInsertRowid: 0 };
        },
        all: () => [],
        get: () => undefined,
      };
    }

    exec() {}

    pragma(sql: string, options?: { simple?: boolean }) {
      if (options?.simple) return 26;
      if (sql === 'table_info(conversations)') {
        return [
          { name: 'id' },
          { name: 'user_id' },
          { name: 'name' },
          { name: 'type' },
          { name: 'extra' },
          { name: 'model' },
          { name: 'status' },
          { name: 'source' },
          { name: 'channel_chat_id' },
          { name: 'pinned' },
          { name: 'pinned_at' },
          { name: 'created_at' },
          { name: 'updated_at' },
        ];
      }
      if (sql === 'table_info(messages)') {
        return [
          { name: 'id' },
          { name: 'conversation_id' },
          { name: 'msg_id' },
          { name: 'type' },
          { name: 'content' },
          { name: 'position' },
          { name: 'status' },
          { name: 'created_at' },
          { name: 'hidden' },
        ];
      }
      if (sql === 'table_info(users)') return [{ name: 'id' }];
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
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lingai-import-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  fakeDbState.conversations.length = 0;
  fakeDbState.messages.length = 0;
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('importConversationsFromFile', () => {
  it('imports conversation metadata and messages without invoking an agent', async () => {
    const { importConversationsFromFile } = await import('@process/services/conversationImportService');
    const dataDir = await createTempDir();
    const importFile = path.join(dataDir, 'conversation.json');
    await fs.writeFile(
      importFile,
      JSON.stringify({
        version: 1,
        exportedAt: '2026-07-05T00:00:00.000Z',
        conversation: {
          id: 'source-conversation',
          name: 'Source Conversation',
          type: 'aionrs',
          created_at: 1000,
          modified_at: 2000,
          status: 'finished',
          source: 'lingai',
          extra: { workspace: dataDir },
          model: {
            id: 'provider-1',
            platform: 'openai',
            name: 'OpenAI',
            base_url: '',
            api_key: '',
            use_model: 'gpt-4o',
          },
        },
        messages: [
          {
            id: 'message-1',
            msg_id: 'turn-1',
            conversation_id: 'source-conversation',
            type: 'text',
            position: 'right',
            status: 'finish',
            created_at: 1100,
            content: { content: 'hello' },
          },
        ],
      }),
      'utf8'
    );

    const result = await importConversationsFromFile(importFile, { dataDir });

    expect(result.importedCount).toBe(1);
    expect(result.messageCount).toBe(1);
    expect(fakeDbState.conversations[0].id).toBe(result.conversationIds[0]);
    expect(fakeDbState.conversations[0].name).toBe('Source Conversation (Imported)');
    expect(fakeDbState.conversations[0].type).toBe('aionrs');
    expect(JSON.parse(fakeDbState.conversations[0].extra).imported_from.conversation_id).toBe('source-conversation');
    expect(fakeDbState.messages[0].conversation_id).toBe(fakeDbState.conversations[0].id);
    expect(fakeDbState.messages[0].msg_id).toBe('turn-1');
    expect(JSON.parse(fakeDbState.messages[0].content).content).toBe('hello');
  });

  it('rejects unsupported export versions', async () => {
    const { importConversationsFromFile } = await import('@process/services/conversationImportService');
    const dataDir = await createTempDir();
    const importFile = path.join(dataDir, 'conversation.json');
    await fs.writeFile(
      importFile,
      JSON.stringify({
        version: 999,
        conversation: { id: 'source-conversation' },
        messages: [],
      }),
      'utf8'
    );

    await expect(importConversationsFromFile(importFile, { dataDir })).rejects.toThrow('unsupported_import_version');
  });
});
