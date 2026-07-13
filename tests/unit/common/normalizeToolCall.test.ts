import { describe, expect, it } from 'vitest';
import type { IMessageAcpToolCall } from '@/common/chat/chatLib';
import { normalizeAcpToolCall, normalizeToolCall } from '@/common/chat/normalizeToolCall';

describe('normalizeToolCall', () => {
  it('normalizes compact snake_case acp tool calls from history responses', () => {
    const result = normalizeAcpToolCall({
      id: 'message-1',
      conversation_id: 'conversation-1',
      created_at: 12345,
      type: 'acp_tool_call',
      content: {
        _compact: {
          truncated: true,
          original_size: 90000,
          preview_chars: 4096,
        },
        update: {
          session_update: 'tool_call',
          tool_call_id: 'tool-1',
          status: 'completed',
          title: 'rg',
          kind: 'search',
          raw_input: { pattern: 'needle', path: '.' },
          content: [{ type: 'content', content: { type: 'text', text: 'preview' } }],
        },
      },
    } as unknown as IMessageAcpToolCall);

    expect(result).toMatchObject({
      key: 'tool-1',
      name: 'rg',
      status: 'completed',
      description: '"needle" in .',
      output: 'preview',
      truncated: true,
      startedAt: 12345,
      messageId: 'message-1',
      conversationId: 'conversation-1',
    });
  });

  it('falls back to MCP server and tool when ACP title is empty', () => {
    const result = normalizeAcpToolCall({
      id: 'message-2',
      conversation_id: 'conversation-2',
      created_at: 23456,
      type: 'acp_tool_call',
      content: {
        update: {
          sessionUpdate: 'tool_call_update',
          tool_call_id: 'tool-2',
          status: 'in_progress',
          title: '',
          kind: 'execute',
          rawInput: {
            server: 'lingai-image-generation',
            tool: 'lingai_image_generation',
            prompt: 'Image-to-Image: Generate a logo',
          },
        },
      },
    } as unknown as IMessageAcpToolCall);

    expect(result).toMatchObject({
      key: 'tool-2',
      name: 'lingai-image-generation:lingai_image_generation',
      status: 'running',
      description: 'Image-to-Image: Generate a logo',
      startedAt: 23456,
    });
  });

  it('keeps tool call creation time for running elapsed UI', () => {
    const result = normalizeToolCall({
      type: 'tool_call',
      created_at: 67890,
      content: {
        call_id: 'call-1',
        name: 'Shell Command',
        status: 'running',
        args: {},
      },
    } as any);

    expect(result?.startedAt).toBe(67890);
  });

  it('extracts structured tool feedback from tool output', () => {
    const output = `<tool_feedback>
{
  "kind": "timeout",
  "summary": "Grep timed out",
  "retry_hint": "Use a narrower path",
  "stats": {
    "tool": "Grep",
    "timeout_seconds": 20
  },
  "partial_results": ["src/App.tsx"]
}
</tool_feedback>

Summary: Grep timed out
Retry hint: Use a narrower path`;

    const result = normalizeToolCall({
      type: 'tool_call',
      content: {
        call_id: 'call-1',
        name: 'Grep',
        status: 'error',
        output,
      },
    } as any);

    expect(result?.feedback).toEqual({
      kind: 'timeout',
      summary: 'Grep timed out',
      retryHint: 'Use a narrower path',
      stats: {
        tool: 'Grep',
        timeout_seconds: 20,
      },
      partialResults: ['src/App.tsx'],
    });
    expect(result?.output).not.toContain('<tool_feedback>');
  });
});
