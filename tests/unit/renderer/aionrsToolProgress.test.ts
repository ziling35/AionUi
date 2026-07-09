import { describe, expect, it } from 'vitest';
import {
  getAionrsToolThought,
  updateAionrsToolProgress,
} from '@/renderer/pages/conversation/platforms/aionrs/aionrsToolProgress';

describe('aionrsToolProgress', () => {
  it('marks running grep calls active and explains the current action', () => {
    const activeToolCallIds = new Set<string>();

    const progress = updateAionrsToolProgress(activeToolCallIds, {
      call_id: 'call-1',
      name: 'Grep',
      status: 'running',
      input: {
        pattern: 'useAionrsMessage',
        glob: 'packages/**/*.ts',
      },
    });

    expect(progress.hasActiveTools).toBe(true);
    expect(progress.transitionedToWaiting).toBe(false);
    expect(activeToolCallIds.has('call-1')).toBe(true);
    expect(progress.thought).toEqual({
      subject: 'Searching code',
      description: '"useAionrsMessage" in packages/**/*.ts',
    });
  });

  it('moves to waiting when the last tracked tool completes', () => {
    const activeToolCallIds = new Set(['call-1']);

    const progress = updateAionrsToolProgress(activeToolCallIds, {
      call_id: 'call-1',
      name: 'Read',
      status: 'completed',
      input: {
        path: 'src/main.ts',
      },
    });

    expect(progress.hasActiveTools).toBe(false);
    expect(progress.transitionedToWaiting).toBe(true);
    expect(activeToolCallIds.size).toBe(0);
    expect(progress.thought).toEqual({
      subject: 'Reviewing tool results',
      description: 'src/main.ts',
    });
  });

  it('keeps active state while another tracked tool is still running', () => {
    const activeToolCallIds = new Set(['call-1', 'call-2']);

    const progress = updateAionrsToolProgress(activeToolCallIds, {
      call_id: 'call-1',
      name: 'Glob',
      status: 'completed',
      input: {
        pattern: '**/*.tsx',
      },
    });

    expect(progress.hasActiveTools).toBe(true);
    expect(progress.transitionedToWaiting).toBe(false);
    expect(activeToolCallIds.has('call-1')).toBe(false);
    expect(activeToolCallIds.has('call-2')).toBe(true);
  });

  it('treats failed status as an error result', () => {
    const activeToolCallIds = new Set(['call-1']);

    const progress = updateAionrsToolProgress(activeToolCallIds, {
      call_id: 'call-1',
      name: 'Bash',
      status: 'failed',
      args: {
        command: 'cargo test -p aionui-ai-agent',
      },
    });

    expect(progress.hasActiveTools).toBe(false);
    expect(progress.transitionedToWaiting).toBe(true);
    expect(progress.thought).toEqual({
      subject: 'Handling tool result',
      description: 'Bash returned an error',
    });
  });

  it('summarizes command tool input without requiring backend descriptions', () => {
    expect(
      getAionrsToolThought({
        name: 'ExecCommand',
        status: 'running',
        args: {
          command: 'bun run test tests/unit/renderer/aionrsToolProgress.test.ts',
        },
      })
    ).toEqual({
      subject: 'Running command',
      description: 'bun run test tests/unit/renderer/aionrsToolProgress.test.ts',
    });
  });
});
