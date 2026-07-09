/**
 * @license
 * Copyright 2025 LingAI (lingai.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TConversationRuntimeSummary } from '@/common/config/storage';
import { describe, expect, it } from 'vitest';
import {
  createDefaultConversationRuntimeView,
  getConversationRuntimeViewSnapshot,
  hydrateSucceededConversationRuntimeView,
  hydrateSucceeded,
  localSendAccepted,
  localSendAcceptedConversationRuntimeView,
  localSendStarted,
  localSendFailedConversationRuntimeView,
  localSendStartedConversationRuntimeView,
  localStopAcknowledged,
  localStopAcknowledgedConversationRuntimeView,
  localStopRequested,
  localStopRequestedConversationRuntimeView,
  resetLocalGateConversationRuntimeView,
  resetConversationRuntimeViewStoreForTest,
  streamRuntimeStateObserved,
  streamStateConversationRuntimeView,
  turnCompleted,
  turnCompletedConversationRuntimeView,
} from '@/renderer/pages/conversation/runtime/conversationRuntimeViewStore';

const conversation_id = 'conversation-1';

const runtime = (overrides: Partial<TConversationRuntimeSummary>): TConversationRuntimeSummary => ({
  state: 'idle',
  can_send_message: true,
  has_task: false,
  task_status: 'finished',
  is_processing: false,
  pending_confirmations: 0,
  turn_id: null,
  ...overrides,
});

describe('conversationRuntimeViewStore', () => {
  it('hydrates a running runtime as processing and not sendable', () => {
    const { view } = hydrateSucceededConversationRuntimeView(
      undefined,
      conversation_id,
      runtime({
        state: 'running',
        can_send_message: false,
        has_task: true,
        task_status: 'running',
        is_processing: true,
      })
    );

    expect(view).toMatchObject({
      state: 'running',
      isProcessing: true,
      canSendMessage: false,
      hasBackendRuntime: true,
      hydrated: true,
    });
  });

  it('maps cancelling runtime as processing and not sendable', () => {
    const { view } = hydrateSucceededConversationRuntimeView(
      undefined,
      conversation_id,
      runtime({
        state: 'cancelling',
        can_send_message: true,
        has_task: true,
        task_status: 'running',
        is_processing: false,
        turn_id: 'turn-cancel',
      })
    );

    expect(view.state).toBe('cancelling');
    expect(view.isProcessing).toBe(true);
    expect(view.canSendMessage).toBe(false);
    expect(view.activeTurnId).toBe('turn-cancel');
  });

  it('hydrates an idle runtime as sendable', () => {
    const { view, logs } = hydrateSucceededConversationRuntimeView(undefined, conversation_id, runtime({}));

    expect(view).toMatchObject({
      state: 'idle',
      isProcessing: false,
      canSendMessage: true,
      hasBackendRuntime: true,
      hydrated: true,
    });
    expect(logs.map((log) => log.event)).toContain('runtime_release_confirmed');
  });

  it('marks local send start as busy before backend runtime arrives', () => {
    const { view } = localSendStartedConversationRuntimeView(undefined, conversation_id);

    expect(view).toMatchObject({
      state: 'starting',
      isProcessing: true,
      canSendMessage: false,
      localSubmitting: true,
      hydrated: true,
    });
  });

  it('applies stream runtime state without releasing send gate', () => {
    const started = localSendStartedConversationRuntimeView(undefined, conversation_id).view;
    const { view, logs } = streamStateConversationRuntimeView(
      started,
      conversation_id,
      'turn-1',
      'waiting_tool',
      'tool_call'
    );

    expect(view).toMatchObject({
      activeTurnId: 'turn-1',
      state: 'waiting_tool',
      isProcessing: true,
      canSendMessage: false,
      localSubmitting: false,
      hydrated: true,
    });
    expect(logs[0]?.event).toBe('runtime_stream_state');
  });

  it('dedupes repeated stream runtime state events', () => {
    resetConversationRuntimeViewStoreForTest();

    const firstLogs = streamRuntimeStateObserved(conversation_id, 'turn-1', 'stalled', 'stream_idle_timeout');
    const secondLogs = streamRuntimeStateObserved(conversation_id, 'turn-1', 'stalled', 'stream_idle_timeout');

    expect(firstLogs).toHaveLength(1);
    expect(secondLogs).toHaveLength(0);
    expect(getConversationRuntimeViewSnapshot(conversation_id)).toMatchObject({
      activeTurnId: 'turn-1',
      state: 'stalled',
      isProcessing: true,
      canSendMessage: false,
    });
  });

  it('clears a failed local send gate and restores sendability without backend runtime', () => {
    const started = localSendStartedConversationRuntimeView(undefined, conversation_id).view;
    const { view } = localSendFailedConversationRuntimeView(started, conversation_id, 'network error');

    expect(view).toMatchObject({
      state: 'idle',
      isProcessing: false,
      canSendMessage: true,
      localSubmitting: false,
      hydrated: true,
    });
  });

  it('clears a failed local send gate after an idle backend runtime was hydrated', () => {
    const hydrated = hydrateSucceededConversationRuntimeView(undefined, conversation_id, runtime({})).view;
    const started = localSendStartedConversationRuntimeView(hydrated, conversation_id).view;
    const { view } = localSendFailedConversationRuntimeView(started, conversation_id, 'network error');

    expect(view).toMatchObject({
      state: 'idle',
      isProcessing: false,
      canSendMessage: true,
      localSubmitting: false,
      hasBackendRuntime: true,
      hydrated: true,
    });
  });

  it('low-level hydrate helper follows backend runtime when no metadata is supplied', () => {
    const started = localSendStartedConversationRuntimeView(undefined, conversation_id).view;
    const { view, logs } = hydrateSucceededConversationRuntimeView(started, conversation_id, runtime({}));

    expect(view).toMatchObject({
      state: 'idle',
      isProcessing: false,
      canSendMessage: true,
      localSubmitting: false,
      hasBackendRuntime: true,
      hydrated: true,
    });
    expect(logs.map((log) => log.event)).toContain('runtime_release_confirmed');
  });

  it('keeps an unaccepted local send busy when a stale idle hydrate arrives', () => {
    resetConversationRuntimeViewStoreForTest();

    localSendStarted(conversation_id);
    const logs = hydrateSucceeded(conversation_id, runtime({}));

    expect(getConversationRuntimeViewSnapshot(conversation_id)).toMatchObject({
      state: 'starting',
      isProcessing: true,
      canSendMessage: false,
      localSubmitting: true,
      hasBackendRuntime: true,
      hydrated: true,
    });
    expect(logs.map((log) => log.event)).not.toContain('runtime_release_confirmed');
  });

  it('releases an accepted local send when a later hydrate confirms the backend is idle', () => {
    resetConversationRuntimeViewStoreForTest();

    localSendStarted(conversation_id);
    localSendAccepted(
      conversation_id,
      'turn-1',
      runtime({
        state: 'running',
        can_send_message: false,
        has_task: true,
        task_status: 'running',
        is_processing: true,
        turn_id: 'turn-1',
      }),
      'message-1'
    );
    const logs = hydrateSucceeded(conversation_id, runtime({}));

    expect(getConversationRuntimeViewSnapshot(conversation_id)).toMatchObject({
      state: 'idle',
      isProcessing: false,
      canSendMessage: true,
      localSubmitting: false,
      hasBackendRuntime: true,
      hydrated: true,
    });
    expect(logs.map((log) => log.event)).toContain('runtime_release_confirmed');
  });

  it('uses send accepted runtime as authoritative processing state', () => {
    const started = localSendStartedConversationRuntimeView(undefined, conversation_id).view;
    const accepted = localSendAcceptedConversationRuntimeView(
      started,
      conversation_id,
      'turn-1',
      runtime({
        state: 'running',
        can_send_message: false,
        has_task: true,
        task_status: 'running',
        is_processing: true,
        turn_id: 'turn-1',
      }),
      'message-1'
    ).view;

    expect(accepted).toMatchObject({
      state: 'running',
      isProcessing: true,
      canSendMessage: false,
      localSubmitting: false,
      activeTurnId: 'turn-1',
    });

    const { view } = turnCompletedConversationRuntimeView(accepted, conversation_id, 'turn-1', runtime({}));

    expect(view).toMatchObject({
      state: 'idle',
      isProcessing: false,
      canSendMessage: true,
      localSubmitting: false,
    });
  });

  it('ignores a late running send acceptance after turn completion already released the same turn', () => {
    resetConversationRuntimeViewStoreForTest();

    localSendStarted(conversation_id);
    turnCompleted(conversation_id, 'turn-1', runtime({}));
    const logs = localSendAccepted(
      conversation_id,
      'turn-1',
      runtime({
        state: 'running',
        can_send_message: false,
        has_task: true,
        task_status: 'running',
        is_processing: true,
        turn_id: 'turn-1',
      }),
      'message-1'
    );

    expect(getConversationRuntimeViewSnapshot(conversation_id)).toMatchObject({
      state: 'idle',
      isProcessing: false,
      canSendMessage: true,
      localSubmitting: false,
      hasBackendRuntime: true,
      hydrated: true,
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      event: 'local_send_accepted',
      data: {
        stale_after_completed: true,
        turn_id: 'turn-1',
        runtime_turn_id: 'turn-1',
      },
    });
  });

  it('does not unlock when turn completed has no runtime', () => {
    const started = localSendStartedConversationRuntimeView(undefined, conversation_id).view;
    const { view, logs } = turnCompletedConversationRuntimeView(started, conversation_id, 'turn-1', null);

    expect(view).toMatchObject({
      isProcessing: true,
      canSendMessage: false,
      localSubmitting: true,
      hydrated: true,
    });
    expect(logs.map((log) => log.event)).toEqual(['turn_completed_missing_runtime']);
  });

  it('uses stop acknowledgement runtime as authoritative state', () => {
    const running = runtime({
      state: 'running',
      can_send_message: false,
      has_task: true,
      task_status: 'running',
      is_processing: true,
      turn_id: 'turn-1',
    });
    const hydrated = hydrateSucceededConversationRuntimeView(undefined, conversation_id, running).view;
    const requested = localStopRequestedConversationRuntimeView(hydrated, conversation_id, 'turn-1').view;
    const acknowledged = localStopAcknowledgedConversationRuntimeView(
      requested,
      conversation_id,
      'turn-1',
      runtime({})
    ).view;

    expect(acknowledged).toMatchObject({
      isProcessing: false,
      canSendMessage: true,
      localSubmitting: false,
      localStopping: false,
    });
  });

  it('releases processing after stop request fails', () => {
    const running = hydrateSucceededConversationRuntimeView(
      undefined,
      conversation_id,
      runtime({
        state: 'running',
        can_send_message: false,
        has_task: true,
        task_status: 'running',
        is_processing: true,
        turn_id: 'turn-1',
      })
    ).view;
    const requested = localStopRequestedConversationRuntimeView(running, conversation_id, 'turn-1').view;
    const { view } = resetLocalGateConversationRuntimeView(requested, conversation_id, 'stop_failed');

    expect(view).toMatchObject({
      activeTurnId: null,
      state: 'idle',
      isProcessing: false,
      canSendMessage: true,
      localStopping: false,
    });
  });

  it('does not re-mark stopping after runtime has already released', () => {
    const running = hydrateSucceededConversationRuntimeView(
      undefined,
      conversation_id,
      runtime({
        state: 'running',
        can_send_message: false,
        has_task: true,
        task_status: 'running',
        is_processing: true,
        turn_id: 'turn-1',
      })
    ).view;
    const requested = localStopRequestedConversationRuntimeView(running, conversation_id, 'turn-1').view;
    const completed = turnCompletedConversationRuntimeView(requested, conversation_id, 'turn-1', runtime({})).view;
    const acknowledged = localStopAcknowledgedConversationRuntimeView(
      completed,
      conversation_id,
      'turn-1',
      runtime({})
    ).view;

    expect(acknowledged).toMatchObject({
      state: 'idle',
      isProcessing: false,
      canSendMessage: true,
      localSubmitting: false,
      localStopping: false,
    });
  });

  it('keeps next local send gate when stale stop acknowledgement returns running runtime', () => {
    resetConversationRuntimeViewStoreForTest();

    localSendStarted(conversation_id);
    localSendAccepted(
      conversation_id,
      'turn-1',
      runtime({
        state: 'running',
        can_send_message: false,
        has_task: true,
        task_status: 'running',
        is_processing: true,
        turn_id: 'turn-1',
      }),
      'message-1'
    );
    hydrateSucceeded(
      conversation_id,
      runtime({
        state: 'running',
        can_send_message: false,
        has_task: true,
        task_status: 'running',
        is_processing: true,
        turn_id: 'turn-1',
      })
    );
    localStopRequested(conversation_id, 'turn-1');
    turnCompleted(conversation_id, 'turn-1', runtime({}));
    localSendStarted(conversation_id);
    const logs = localStopAcknowledged(
      conversation_id,
      'turn-1',
      runtime({
        state: 'running',
        can_send_message: false,
        has_task: true,
        task_status: 'running',
        is_processing: true,
        turn_id: 'turn-2',
      })
    );

    expect(getConversationRuntimeViewSnapshot(conversation_id)).toMatchObject({
      state: 'running',
      isProcessing: true,
      canSendMessage: false,
      localSubmitting: false,
      localStopping: false,
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      event: 'local_stop_acknowledged',
      data: {
        turn_id: 'turn-1',
      },
    });
  });

  it('defaults to an idle view before hydration', () => {
    expect(createDefaultConversationRuntimeView(conversation_id)).toMatchObject({
      state: 'idle',
      isProcessing: false,
      canSendMessage: true,
      hasBackendRuntime: false,
      hydrated: false,
    });
  });
});
