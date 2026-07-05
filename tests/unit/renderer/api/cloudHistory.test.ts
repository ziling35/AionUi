import { describe, expect, it } from 'vitest';
import { buildCloudHistoryImportPayload, sanitizeCloudHistoryValue } from '@renderer/api/cloudHistory';

describe('cloud history sanitization', () => {
  it('redacts sensitive fields before history is uploaded', () => {
    const result = sanitizeCloudHistoryValue({
      content: 'hello',
      api_key: 'sk-secret',
      nested: {
        Authorization: 'Bearer token',
        workspace: 'C:\\Users\\demo\\project',
      },
    });

    expect(result).toEqual({
      content: 'hello',
      api_key: '[REDACTED]',
      nested: {
        Authorization: '[REDACTED]',
        workspace: '[REDACTED]',
      },
    });
  });

  it('bounds large arrays and long strings', () => {
    const result = sanitizeCloudHistoryValue({
      items: Array.from({ length: 250 }, (_, index) => index),
      text: 'x'.repeat(20_010),
    }) as { items: number[]; text: string };

    expect(result.items).toHaveLength(200);
    expect(result.text.endsWith('...[truncated]')).toBe(true);
  });
});

describe('cloud history restore payload', () => {
  it('converts cloud history records into local import payload', () => {
    const payload = buildCloudHistoryImportPayload(
      {
        id: 'cloud-1',
        localConversationId: 'local-1',
        name: 'Cloud topic',
        type: 'aionrs',
        source: 'lingai',
        extra: { model: { use_model: 'gpt-test' } },
        localCreatedAt: '2026-07-05T00:00:00.000Z',
        localUpdatedAt: '2026-07-05T00:01:00.000Z',
        syncedAt: '2026-07-05T00:02:00.000Z',
        messageCount: 1,
      },
      [
        {
          id: 'cloud-message-1',
          localMessageId: 'message-1',
          msgId: 'turn-1',
          type: 'text',
          position: 'right',
          status: 'finish',
          hidden: false,
          content: { content: 'hello' },
          localCreatedAt: '2026-07-05T00:00:10.000Z',
        },
      ]
    );

    expect(payload.version).toBe(1);
    expect(payload.conversation.id).toBe('local-1');
    expect(payload.messages[0]?.conversation_id).toBe('local-1');
    expect(payload.messages[0]?.content).toEqual({ content: 'hello' });
  });
});
