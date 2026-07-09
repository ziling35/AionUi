import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IResponseMessage } from '@/common/adapter/ipcBridge';
import { useAionrsMessage } from '@/renderer/pages/conversation/platforms/aionrs/useAionrsMessage';
import { getConversationOrNull } from '@/renderer/pages/conversation/utils/conversationCache';

const {
  mergeLiveMessageMock,
  processLocalCronResponseMock,
  responseStreamOnMock,
  responseStreamHandlerRef,
  updateConversationInvokeMock,
} = vi.hoisted(() => ({
  mergeLiveMessageMock: vi.fn(),
  processLocalCronResponseMock: vi.fn(),
  responseStreamOnMock: vi.fn(),
  responseStreamHandlerRef: {
    current: undefined as ((message: IResponseMessage) => void) | undefined,
  },
  updateConversationInvokeMock: vi.fn(),
}));

vi.mock('@/renderer/pages/conversation/Messages/hooks', () => ({
  useMergeLiveMessage: () => mergeLiveMessageMock,
}));

vi.mock('@/renderer/pages/conversation/utils/conversationCache', () => ({
  getConversationOrNull: vi.fn(),
}));

vi.mock('@/renderer/pages/conversation/platforms/aionrs/localCronCommands', () => ({
  processLocalCronResponse: processLocalCronResponseMock,
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      responseStream: {
        on: responseStreamOnMock.mockImplementation((handler: (message: IResponseMessage) => void) => {
          responseStreamHandlerRef.current = handler;
          return vi.fn();
        }),
      },
      update: {
        invoke: updateConversationInvokeMock,
      },
    },
  },
}));

const emit = (message: Partial<IResponseMessage>) => {
  responseStreamHandlerRef.current?.({
    conversation_id: 'conv-1',
    msg_id: 'msg-1',
    data: null,
    ...message,
  } as IResponseMessage);
};

describe('useAionrsMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getConversationOrNull).mockResolvedValue(null);
    responseStreamHandlerRef.current = undefined;
    updateConversationInvokeMock.mockResolvedValue(undefined);
    processLocalCronResponseMock.mockResolvedValue({ systemResponses: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows tool progress for aionrs tool_call events', async () => {
    const { result } = renderHook(() => useAionrsMessage('conv-1'));

    await waitFor(() => {
      expect(result.current.hasHydratedRunningState).toBe(true);
    });

    act(() => {
      emit({
        type: 'tool_call',
        data: {
          call_id: 'call-1',
          name: 'Grep',
          status: 'running',
          input: {
            pattern: 'tool_call',
            glob: 'packages/**/*.ts',
          },
        },
      });
    });

    expect(result.current.running).toBe(true);
    expect(result.current.thought).toEqual({
      subject: 'Searching code',
      description: '"tool_call" in packages/**/*.ts',
    });
  });

  it('clears pending tool thought and active state on finish', async () => {
    const { result } = renderHook(() => useAionrsMessage('conv-1'));

    await waitFor(() => {
      expect(result.current.hasHydratedRunningState).toBe(true);
    });

    vi.useFakeTimers();

    act(() => {
      emit({
        type: 'tool_call',
        data: {
          call_id: 'call-1',
          name: 'Read',
          status: 'running',
          input: {
            path: 'src/main.ts',
          },
        },
      });
      emit({
        type: 'tool_call',
        data: {
          call_id: 'call-1',
          name: 'Read',
          status: 'completed',
          input: {
            path: 'src/main.ts',
          },
        },
      });
      emit({
        type: 'finish',
        data: null,
      });
      vi.runOnlyPendingTimers();
    });

    expect(result.current.running).toBe(false);
    expect(result.current.thought).toEqual({ subject: '', description: '' });
  });

  it('excludes commentary text from completed assistant response processing', async () => {
    renderHook(() => useAionrsMessage('conv-1'));

    await waitFor(() => {
      expect(responseStreamHandlerRef.current).toBeDefined();
    });

    act(() => {
      emit({
        type: 'start',
        data: null,
      });
      emit({
        type: 'content',
        msg_id: 'msg-commentary',
        data: {
          content: 'I will inspect the relevant files first.\n\n',
          phase: 'commentary',
        },
      });
      emit({
        type: 'content',
        msg_id: 'msg-final',
        data: {
          content: 'The final answer.',
          phase: 'final_answer',
        },
      });
      emit({
        type: 'finish',
        msg_id: 'msg-commentary',
        data: null,
      });
    });

    await waitFor(() => {
      expect(processLocalCronResponseMock).toHaveBeenCalledTimes(1);
    });
    expect(processLocalCronResponseMock).toHaveBeenCalledWith('conv-1', 'The final answer.');
  });

  it('replaces repeated full text chunks for the same msg_id instead of appending duplicates', async () => {
    const repeatedReply = '我是由 MiniMaxAI/MiniMax-M2.7 驱动的AI助手。';

    renderHook(() => useAionrsMessage('conv-1'));

    await waitFor(() => {
      expect(responseStreamHandlerRef.current).toBeDefined();
    });

    act(() => {
      emit({
        type: 'start',
        data: null,
      });
      emit({
        type: 'content',
        msg_id: 'msg-short-reply',
        data: {
          content: repeatedReply,
          phase: 'final_answer',
        },
      });
      emit({
        type: 'content',
        msg_id: 'msg-short-reply',
        data: {
          content: repeatedReply,
          phase: 'final_answer',
        },
      });
      emit({
        type: 'finish',
        msg_id: 'msg-short-reply',
        data: null,
      });
    });

    const textMessages = mergeLiveMessageMock.mock.calls
      .map(([message]) => message)
      .filter((message) => message?.type === 'text');

    expect(textMessages).toHaveLength(2);
    expect(textMessages[1]?.content).toMatchObject({
      content: repeatedReply,
      phase: 'final_answer',
      replace: true,
    });

    await waitFor(() => {
      expect(processLocalCronResponseMock).toHaveBeenCalledWith('conv-1', repeatedReply);
    });
  });

  it('drops replayed prefix chunks for the same msg_id instead of rendering the answer twice', async () => {
    const answerChunks = [
      'Hello! I am powered by MiniMaxAI/MiniMax-M2.2.\n\n',
      'I can help you complete tasks, including:\n\n',
      '- Answer questions\n- Work with files\n- Run commands\n\n',
      'What can I help you with?',
    ];
    const answer = answerChunks.join('');
    const replayedPrefixChunks = [
      'Hello! ',
      'I am powered by MiniMaxAI/MiniMax-M2.2.\n\n',
      'I can help you complete tasks, including:\n\n',
      '- Answer questions\n',
    ];

    renderHook(() => useAionrsMessage('conv-1'));

    await waitFor(() => {
      expect(responseStreamHandlerRef.current).toBeDefined();
    });

    act(() => {
      emit({
        type: 'start',
        data: null,
      });

      for (const content of answerChunks) {
        emit({
          type: 'content',
          msg_id: 'msg-prefix-replay',
          data: {
            content,
            phase: 'final_answer',
          },
        });
      }

      for (const content of replayedPrefixChunks) {
        emit({
          type: 'content',
          msg_id: 'msg-prefix-replay',
          data: {
            content,
            phase: 'final_answer',
          },
        });
      }

      emit({
        type: 'finish',
        msg_id: 'msg-prefix-replay',
        data: null,
      });
    });

    const textChunks = mergeLiveMessageMock.mock.calls
      .map(([message]) => message)
      .filter((message) => message?.type === 'text')
      .map((message) => message?.content.content);

    expect(textChunks).toEqual(answerChunks);

    await waitFor(() => {
      expect(processLocalCronResponseMock).toHaveBeenCalledWith('conv-1', answer);
    });
  });

  it('restores a suspected prefix replay when the following chunk diverges', async () => {
    const initialAnswer =
      'Hello! I can help with files, commands, searches, Office documents, images, and more.';

    renderHook(() => useAionrsMessage('conv-1'));

    await waitFor(() => {
      expect(responseStreamHandlerRef.current).toBeDefined();
    });

    act(() => {
      emit({
        type: 'start',
        data: null,
      });
      emit({
        type: 'content',
        msg_id: 'msg-prefix-legit',
        data: {
          content: initialAnswer,
          phase: 'final_answer',
        },
      });
      emit({
        type: 'content',
        msg_id: 'msg-prefix-legit',
        data: {
          content: 'Hello',
          phase: 'final_answer',
        },
      });
      emit({
        type: 'content',
        msg_id: 'msg-prefix-legit',
        data: {
          content: ', one more thing.',
          phase: 'final_answer',
        },
      });
      emit({
        type: 'finish',
        msg_id: 'msg-prefix-legit',
        data: null,
      });
    });

    const textChunks = mergeLiveMessageMock.mock.calls
      .map(([message]) => message)
      .filter((message) => message?.type === 'text')
      .map((message) => message?.content.content);

    expect(textChunks).toEqual([initialAnswer, 'Hello, one more thing.']);

    await waitFor(() => {
      expect(processLocalCronResponseMock).toHaveBeenCalledWith(
        'conv-1',
        `${initialAnswer}Hello, one more thing.`
      );
    });
  });
});
