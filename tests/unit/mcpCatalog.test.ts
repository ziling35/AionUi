import { describe, expect, it } from 'vitest';
import type { IMcpServer } from '@/common/config/storage';
import { replaceBuiltinMcpServer } from '@/renderer/hooks/mcp/catalog';

const createServer = (overrides: Partial<IMcpServer>): IMcpServer => ({
  id: 'server-id',
  name: 'server-name',
  enabled: true,
  transport: { type: 'stdio', command: 'node', args: [] },
  created_at: 1,
  updated_at: 1,
  original_json: '{}',
  ...overrides,
});

describe('replaceBuiltinMcpServer', () => {
  it('replaces the stored built-in server with its latest transport', () => {
    const previous = createServer({
      id: 'builtin-image-gen',
      name: 'lingai-image-generation',
      builtin: true,
      transport: { type: 'stdio', command: 'node', args: [], env: { LINGAI_IMG_MODEL: 'old-model' } },
    });
    const updated = createServer({
      id: 'builtin-image-gen',
      name: 'lingai-image-generation',
      transport: { type: 'stdio', command: 'node', args: [], env: { LINGAI_IMG_MODEL: 'new-model' } },
    });

    const result = replaceBuiltinMcpServer([previous], updated);

    expect(result).toHaveLength(1);
    expect(result[0]?.transport).toMatchObject({ env: { LINGAI_IMG_MODEL: 'new-model' } });
    expect(result[0]?.builtin).toBe(true);
  });

  it('preserves unrelated servers when no previous built-in entry exists', () => {
    const userServer = createServer({ id: 'user-server', builtin: false });
    const updated = createServer({ id: 'builtin-image-gen', name: 'lingai-image-generation' });

    const result = replaceBuiltinMcpServer([userServer], updated);

    expect(result.map((server) => server.id)).toEqual(['user-server', 'builtin-image-gen']);
  });
});
