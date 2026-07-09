import { describe, expect, it } from 'vitest';
import { normalizeToolCall } from './normalizeToolCall';

describe('normalizeToolCall', () => {
  it('ignores tool_call messages without call_id', () => {
    const result = normalizeToolCall({
      type: 'tool_call',
      content: {
        call_id: '',
        name: 'Glob',
        status: 'running',
        args: { pattern: '*.rs' },
      },
    } as any);

    expect(result).toBeUndefined();
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
