/**
 * @license
 * Copyright 2025 LingAI (lingai.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { isErrorTipMessage, transformMessage } from '@/common/chat/chatLib';
import type { IResponseMessage } from '@/common/adapter/ipcBridge';
import type { TChatConversation, TokenUsageData } from '@/common/config/storage';
import { uuid } from '@/common/utils';
import type { ThoughtData } from '@/renderer/components/chat/ThoughtDisplay';
import { useMergeLiveMessage } from '@/renderer/pages/conversation/Messages/hooks';
import { logStreamTerminalObserved } from '@/renderer/pages/conversation/runtime/useConversationRuntimeView';
import { getConversationOrNull } from '@/renderer/pages/conversation/utils/conversationCache';
import { isConversationProcessing } from '@/renderer/pages/conversation/utils/conversationRuntime';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { updateAionrsToolProgress, type AionrsToolCallData } from './aionrsToolProgress';
import { processLocalCronResponse } from './localCronCommands';

type TokenUsage = {
  input_tokens?: number;
  output_tokens?: number;
};

const textMessageTypes = new Set(['content', 'text']);
const DUPLICATE_FULL_TEXT_MIN_LENGTH = 8;
const REPLAY_PREFIX_MIN_BUFFER_LENGTH = 32;

type TextReplayState = {
  offset: number;
  suppressed: string;
};

type TextChunkRenderState =
  | {
      buffer: string;
      message?: undefined;
    }
  | {
      buffer: string;
      message: IResponseMessage;
    };

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const hasExplicitReplace = (message: IResponseMessage): boolean =>
  message.replace === true || (isObjectRecord(message.data) && message.data.replace === true);

const shouldReplaceTextChunk = (message: IResponseMessage, previous: string, chunk: string): boolean => {
  if (!previous || !chunk) {
    return false;
  }

  if (hasExplicitReplace(message)) {
    return true;
  }

  if (chunk.length > previous.length && chunk.startsWith(previous)) {
    return true;
  }

  return chunk === previous && chunk.length >= DUPLICATE_FULL_TEXT_MIN_LENGTH;
};

const withTextChunkReplace = (message: IResponseMessage): IResponseMessage => ({
  ...message,
  replace: true,
});

const withTextChunkContent = (message: IResponseMessage, chunk: string): IResponseMessage => ({
  ...message,
  data: isObjectRecord(message.data) ? { ...message.data, content: chunk } : chunk,
});

const applyTextReplayGuard = (
  message: IResponseMessage,
  previous: string,
  chunk: string,
  replayStates: Map<string, TextReplayState>
): TextChunkRenderState => {
  const existingReplay = replayStates.get(message.msg_id);

  if (existingReplay) {
    const remainingReplay = previous.slice(existingReplay.offset);

    if (remainingReplay.startsWith(chunk)) {
      const nextOffset = existingReplay.offset + chunk.length;
      if (nextOffset >= previous.length) {
        replayStates.delete(message.msg_id);
      } else {
        replayStates.set(message.msg_id, {
          offset: nextOffset,
          suppressed: existingReplay.suppressed + chunk,
        });
      }
      return { buffer: previous };
    }

    if (chunk.startsWith(remainingReplay)) {
      replayStates.delete(message.msg_id);
      const suffix = chunk.slice(remainingReplay.length);
      if (!suffix) {
        return { buffer: previous };
      }
      return {
        buffer: previous + suffix,
        message: withTextChunkContent(message, suffix),
      };
    }

    replayStates.delete(message.msg_id);
    const restoredChunk = existingReplay.suppressed + chunk;
    return {
      buffer: previous + restoredChunk,
      message: withTextChunkContent(message, restoredChunk),
    };
  }

  if (previous.length >= REPLAY_PREFIX_MIN_BUFFER_LENGTH && previous.startsWith(chunk)) {
    replayStates.set(message.msg_id, {
      offset: chunk.length,
      suppressed: chunk,
    });
    return { buffer: previous };
  }

  return {
    buffer: previous + chunk,
    message,
  };
};

const getTextChunkAndPhase = (message: IResponseMessage): { chunk: string; phase?: 'commentary' | 'final_answer' } => {
  const payload = message.data;
  const phase =
    typeof payload === 'object' &&
    payload !== null &&
    'phase' in payload &&
    ((payload as { phase?: unknown }).phase === 'commentary' ||
      (payload as { phase?: unknown }).phase === 'final_answer')
      ? (payload as { phase: 'commentary' | 'final_answer' }).phase
      : message.phase;

  const chunk =
    typeof payload === 'string'
      ? payload
      : typeof payload === 'object' &&
          payload !== null &&
          'content' in payload &&
          typeof (payload as { content?: unknown }).content === 'string'
        ? ((payload as { content: string }).content ?? '')
        : '';

  return { chunk, phase };
};

export const useAionrsMessage = (
  conversation_id: string,
  options?: {
    onError?: (message: IResponseMessage) => void;
    onConfigChanged?: (capabilities: Record<string, unknown>) => void;
  }
) => {
  const onError = options?.onError;
  const onConfigChanged = options?.onConfigChanged;
  const onConfigChangedRef = useRef(onConfigChanged);
  const mergeLiveMessage = useMergeLiveMessage();
  const [streamRunning, setStreamRunning] = useState(false);
  const [hasActiveTools, setHasActiveTools] = useState(false);
  const [waitingResponse, setWaitingResponse] = useState(false);
  const [hasHydratedRunningState, setHasHydratedRunningState] = useState(false);
  const [thought, setThought] = useState<ThoughtData>({
    description: '',
    subject: '',
  });
  const [tokenUsage, setTokenUsage] = useState<TokenUsageData | null>(null);
  // Current active message ID to filter out events from old requests (prevents aborted request events from interfering with new ones)
  const activeMsgIdRef = useRef<string | null>(null);
  const messageBufferRef = useRef(new Map<string, string>());
  const textReplayStateRef = useRef(new Map<string, TextReplayState>());
  const finalTextMsgIdsRef = useRef(new Set<string>());
  const processedCronMsgIdsRef = useRef(new Set<string>());

  // Use refs to avoid useEffect re-subscription when these states change
  const hasActiveToolsRef = useRef(hasActiveTools);
  const streamRunningRef = useRef(streamRunning);
  const waitingResponseRef = useRef(waitingResponse);
  const activeToolCallIdsRef = useRef(new Set<string>());

  // Track whether current turn has content output
  // Only reset waitingResponse when finish arrives after content (not after tool calls)
  const hasContentInTurnRef = useRef(false);

  useEffect(() => {
    onConfigChangedRef.current = onConfigChanged;
  }, [onConfigChanged]);
  useEffect(() => {
    hasActiveToolsRef.current = hasActiveTools;
  }, [hasActiveTools]);
  useEffect(() => {
    streamRunningRef.current = streamRunning;
  }, [streamRunning]);

  // Throttle thought updates to reduce render frequency
  const thoughtThrottleRef = useRef<{
    lastUpdate: number;
    pending: ThoughtData | null;
    timer: ReturnType<typeof setTimeout> | null;
  }>({ lastUpdate: 0, pending: null, timer: null });

  const throttledSetThought = useMemo(() => {
    const THROTTLE_MS = 50; // 50ms throttle interval
    return (data: ThoughtData) => {
      const now = Date.now();
      const ref = thoughtThrottleRef.current;

      if (now - ref.lastUpdate >= THROTTLE_MS) {
        ref.lastUpdate = now;
        ref.pending = null;
        if (ref.timer) {
          clearTimeout(ref.timer);
          ref.timer = null;
        }
        setThought(data);
      } else {
        ref.pending = data;
        if (!ref.timer) {
          ref.timer = setTimeout(
            () => {
              ref.lastUpdate = Date.now();
              ref.timer = null;
              if (ref.pending) {
                setThought(ref.pending);
                ref.pending = null;
              }
            },
            THROTTLE_MS - (now - ref.lastUpdate)
          );
        }
      }
    };
  }, []);

  const clearThought = useCallback(() => {
    const ref = thoughtThrottleRef.current;
    if (ref.timer) {
      clearTimeout(ref.timer);
      ref.timer = null;
    }
    ref.pending = null;
    setThought({ subject: '', description: '' });
  }, []);

  // Cleanup throttle timer
  useEffect(() => {
    return () => {
      if (thoughtThrottleRef.current.timer) {
        clearTimeout(thoughtThrottleRef.current.timer);
      }
    };
  }, []);

  // Combined running state: waiting for response OR stream is running OR tools are active
  const running = waitingResponse || streamRunning || hasActiveTools;

  // Set current active message ID
  const setActiveMsgId = useCallback((msgId: string | null) => {
    activeMsgIdRef.current = msgId;
  }, []);

  const processCompletedAssistantMessage = useCallback(
    async (msgId: string) => {
      if (!msgId || processedCronMsgIdsRef.current.has(msgId)) {
        return;
      }

      const rawContent = messageBufferRef.current.get(msgId) ?? '';
      if (!rawContent.trim()) {
        return;
      }

      processedCronMsgIdsRef.current.add(msgId);

      try {
        const result = await processLocalCronResponse(conversation_id, rawContent);
        if (result.displayContent !== undefined && result.displayContent !== rawContent) {
          mergeLiveMessage({
            id: uuid(),
            msg_id: msgId,
            type: 'text',
            position: 'left',
            conversation_id,
            created_at: Date.now(),
            content: {
              content: result.displayContent,
              replace: true,
              phase: 'final_answer',
            },
          });
        }

        for (const response of result.systemResponses) {
          mergeLiveMessage(
            {
              id: uuid(),
              msg_id: `cron-local-${uuid()}`,
              type: 'tips',
              position: 'center',
              conversation_id,
              created_at: Date.now(),
              content: {
                content: response,
                type: response.startsWith('❌') ? 'error' : 'success',
              },
            },
            true
          );
        }
      } catch {
        processedCronMsgIdsRef.current.delete(msgId);
      }
    },
    [mergeLiveMessage, conversation_id]
  );

  useEffect(() => {
    return ipcBridge.conversation.responseStream.on((message) => {
      if (conversation_id !== message.conversation_id) {
        return;
      }

      if (isErrorTipMessage(message)) {
        setStreamRunning(false);
        streamRunningRef.current = false;
        setWaitingResponse(false);
        waitingResponseRef.current = false;
        setHasActiveTools(false);
        hasActiveToolsRef.current = false;
        activeToolCallIdsRef.current.clear();
        textReplayStateRef.current.clear();
        finalTextMsgIdsRef.current.clear();
        clearThought();
        hasContentInTurnRef.current = false;
        const transformedMessage = transformMessage(message);
        if (transformedMessage) {
          mergeLiveMessage(transformedMessage);
        }
        return;
      }

      // Filter out events not belonging to current active request (prevents aborted events from interfering)
      // Note: only filter out thought and start messages, other messages must be rendered
      if (activeMsgIdRef.current && message.msg_id && message.msg_id !== activeMsgIdRef.current) {
        if (message.type === 'thought') {
          return;
        }
      }

      let renderMessage: IResponseMessage | undefined = message;

      if (textMessageTypes.has(message.type) && message.msg_id) {
        const { chunk, phase } = getTextChunkAndPhase(message);

        if (chunk && phase !== 'commentary') {
          const previous = messageBufferRef.current.get(message.msg_id) ?? '';
          if (shouldReplaceTextChunk(message, previous, chunk)) {
            messageBufferRef.current.set(message.msg_id, chunk);
            textReplayStateRef.current.delete(message.msg_id);
            renderMessage = withTextChunkReplace(message);
          } else {
            const nextTextState = applyTextReplayGuard(
              message,
              previous,
              chunk,
              textReplayStateRef.current
            );
            messageBufferRef.current.set(message.msg_id, nextTextState.buffer);
            renderMessage = nextTextState.message;
          }
          finalTextMsgIdsRef.current.add(message.msg_id);
        }
      }

      switch (message.type) {
        case 'thought':
          // Auto-recover streamRunning if thought arrives after finish
          if (!streamRunningRef.current) {
            setStreamRunning(true);
            streamRunningRef.current = true;
          }
          throttledSetThought(message.data as ThoughtData);
          break;
        case 'start':
          setStreamRunning(true);
          streamRunningRef.current = true;
          finalTextMsgIdsRef.current.clear();
          textReplayStateRef.current.clear();
          // Don't reset waitingResponse here - let tool completion flow handle it
          break;
        case 'finish':
          {
            logStreamTerminalObserved(conversation_id, message.turn_id, 'aionrs', message.type);
            // aionrs stream_end carries usage in data field
            const usageData = message.data as TokenUsage | undefined;
            if (usageData && typeof usageData === 'object' && 'input_tokens' in usageData) {
              const newTokenUsage: TokenUsageData = {
                total_tokens: (usageData.input_tokens || 0) + (usageData.output_tokens || 0),
              };
              setTokenUsage(newTokenUsage);
              void ipcBridge.conversation.update.invoke({
                id: conversation_id,
                updates: {
                  extra: { last_token_usage: newTokenUsage } as TChatConversation['extra'],
                },
                merge_extra: true,
              });
            }
            setStreamRunning(false);
            streamRunningRef.current = false;
            setWaitingResponse(false);
            waitingResponseRef.current = false;
            setHasActiveTools(false);
            hasActiveToolsRef.current = false;
            activeToolCallIdsRef.current.clear();
            textReplayStateRef.current.clear();
            clearThought();
            const completedTextMsgIds = new Set(finalTextMsgIdsRef.current);
            if (message.msg_id) {
              completedTextMsgIds.add(message.msg_id);
            }
            finalTextMsgIdsRef.current.clear();
            for (const msgId of completedTextMsgIds) {
              void processCompletedAssistantMessage(msgId);
            }
          }
          break;
        case 'tool_group':
          {
            // Mark that current turn has content output
            hasContentInTurnRef.current = true;

            // Auto-recover streamRunning if tool_group arrives after finish
            if (!streamRunningRef.current) {
              setStreamRunning(true);
              streamRunningRef.current = true;
            }

            // Check if any tools are executing or awaiting confirmation
            const tools = message.data as Array<{ status: string; name?: string }>;
            const activeStatuses = new Set(['Executing', 'Confirming', 'Pending']);
            const hasActive = tools.some((tool) => activeStatuses.has(tool.status));
            const wasActive = hasActiveToolsRef.current;

            setHasActiveTools(hasActive);
            hasActiveToolsRef.current = hasActive; // Sync update ref immediately

            // When tools transition from active to inactive, set waitingResponse=true
            // because backend needs to continue sending requests to model
            if (wasActive && !hasActive && tools.length > 0) {
              setWaitingResponse(true);
              waitingResponseRef.current = true;
            }

            // If tools are awaiting confirmation, update thought hint
            const confirmingTool = tools.find((tool) => tool.status === 'Confirming');
            if (confirmingTool) {
              setThought({
                subject: 'Awaiting Confirmation',
                description: confirmingTool.name || 'Tool execution',
              });
            } else if (hasActive) {
              const executingTool = tools.find((tool) => tool.status === 'Executing');
              if (executingTool) {
                setThought({
                  subject: 'Executing',
                  description: executingTool.name || 'Tool',
                });
              }
            } else if (!streamRunningRef.current) {
              // All tools completed and stream stopped, clear thought
              setThought({ subject: '', description: '' });
            }

            // Continue passing message to message list update
            if (renderMessage) {
              mergeLiveMessage(transformMessage(renderMessage));
            }
          }
          break;
        case 'tool_call':
          {
            hasContentInTurnRef.current = true;

            if (!streamRunningRef.current) {
              setStreamRunning(true);
              streamRunningRef.current = true;
            }

            const progress = updateAionrsToolProgress(activeToolCallIdsRef.current, message.data as AionrsToolCallData);

            setHasActiveTools(progress.hasActiveTools);
            hasActiveToolsRef.current = progress.hasActiveTools;

            if (progress.hasActiveTools) {
              setWaitingResponse(false);
              waitingResponseRef.current = false;
            } else if (progress.transitionedToWaiting) {
              setWaitingResponse(true);
              waitingResponseRef.current = true;
            }

            if (progress.thought) {
              throttledSetThought(progress.thought);
            }

            if (renderMessage) {
              mergeLiveMessage(transformMessage(renderMessage));
            }
          }
          break;
        case 'permission':
        case 'acp_permission':
          if (!streamRunningRef.current) {
            setStreamRunning(true);
            streamRunningRef.current = true;
          }
          // Backend aionrs emits wire type 'acp_permission' but the payload is
          // Confirmation-shaped (legacy), which matches MessagePermission, not
          // MessageAcpPermission. Re-tag so transformMessage routes it correctly.
          if (renderMessage) {
            mergeLiveMessage(transformMessage({ ...renderMessage, type: 'permission' }));
          }
          break;
        case 'config_changed':
          onConfigChangedRef.current?.(message.data as Record<string, unknown>);
          break;
        default: {
          if (message.type === 'error') {
            logStreamTerminalObserved(conversation_id, message.turn_id, 'aionrs', message.type);
            setStreamRunning(false);
            streamRunningRef.current = false;
            setWaitingResponse(false);
            waitingResponseRef.current = false;
            setHasActiveTools(false);
            hasActiveToolsRef.current = false;
            activeToolCallIdsRef.current.clear();
            textReplayStateRef.current.clear();
            finalTextMsgIdsRef.current.clear();
            clearThought();
            onError?.(message as IResponseMessage);
          } else {
            // Mark that current turn has content output (exclude error type)
            hasContentInTurnRef.current = true;
            // Reset waitingResponse when actual content arrives
            if (message.type === 'content') {
              setWaitingResponse(false);
              waitingResponseRef.current = false;
            }
            // Auto-recover streamRunning if content arrives after finish
            if (!streamRunningRef.current) {
              setStreamRunning(true);
              streamRunningRef.current = true;
            }
          }
          // Backend handles persistence, Frontend only updates UI
          if (renderMessage) {
            mergeLiveMessage(transformMessage(renderMessage));
          }
          break;
        }
      }
    });
    // Note: hasActiveTools and streamRunning are accessed via refs to avoid re-subscription
  }, [conversation_id, mergeLiveMessage, onError, processCompletedAssistantMessage, clearThought, throttledSetThought]);

  useEffect(() => {
    let cancelled = false;

    clearThought();
    setTokenUsage(null);
    hasContentInTurnRef.current = false;
    setHasHydratedRunningState(false);

    // Check actual conversation status from backend before resetting all running states
    // to avoid flicker when switching to a running conversation
    void getConversationOrNull(conversation_id).then((res) => {
      if (cancelled) {
        return;
      }

      if (!res) {
        setStreamRunning(false);
        streamRunningRef.current = false;
        setHasActiveTools(false);
        hasActiveToolsRef.current = false;
        activeToolCallIdsRef.current.clear();
        textReplayStateRef.current.clear();
        finalTextMsgIdsRef.current.clear();
        setWaitingResponse(false);
        waitingResponseRef.current = false;
        setHasHydratedRunningState(true);
        return;
      }
      const isRunning = isConversationProcessing(res);
      setStreamRunning(isRunning);
      streamRunningRef.current = isRunning;
      // Reset tool states - they will be restored by incoming messages if still active
      setHasActiveTools(false);
      hasActiveToolsRef.current = false;
      activeToolCallIdsRef.current.clear();
      textReplayStateRef.current.clear();
      finalTextMsgIdsRef.current.clear();
      setWaitingResponse(isRunning);
      waitingResponseRef.current = isRunning;
      // Load persisted token usage stats
      if (res.type === 'aionrs' && res.extra?.last_token_usage) {
        const { last_token_usage } = res.extra;
        if (last_token_usage.total_tokens > 0) {
          setTokenUsage(last_token_usage);
        }
      }
      setHasHydratedRunningState(true);
    });

    return () => {
      cancelled = true;
    };
  }, [conversation_id, clearThought]);

  const resetState = useCallback(() => {
    setWaitingResponse(false);
    waitingResponseRef.current = false;
    setStreamRunning(false);
    streamRunningRef.current = false;
    setHasActiveTools(false);
    hasActiveToolsRef.current = false;
    activeToolCallIdsRef.current.clear();
    textReplayStateRef.current.clear();
    finalTextMsgIdsRef.current.clear();
    clearThought();
    hasContentInTurnRef.current = false;
    // Clear active message ID to prevent filtering events from new messages after stop
    activeMsgIdRef.current = null;
  }, [clearThought]);

  return {
    thought,
    setThought,
    running,
    hasHydratedRunningState,
    tokenUsage,
    setActiveMsgId,
    setWaitingResponse,
    resetState,
  };
};
