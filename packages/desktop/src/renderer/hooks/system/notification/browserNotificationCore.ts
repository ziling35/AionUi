/**
 * @license
 * Copyright 2025 LingAI (lingai.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Framework-free core for WebUI browser notifications: pure gating and a
 * controller that turns conversation events into notification payloads.
 * Kept free of React / DOM globals so it is unit-testable in the node project.
 */

export type NotificationPermissionState = 'default' | 'granted' | 'denied';

export type NotificationGate = {
  isElectron: boolean;
  hasNotificationApi: boolean;
  isSecureContext: boolean;
  permission: NotificationPermissionState;
  settingEnabled: boolean;
  documentHidden: boolean;
};

export const shouldShowNotification = (gate: NotificationGate): boolean =>
  !gate.isElectron &&
  gate.hasNotificationApi &&
  gate.isSecureContext &&
  gate.permission === 'granted' &&
  gate.settingEnabled &&
  gate.documentHidden;

export type NotificationPayload = {
  body: string;
  conversationId?: string;
};

export type BrowserNotificationDeps = {
  readGate: () => NotificationGate;
  show: (payload: NotificationPayload) => void;
  bodyFor: (kind: 'confirmation' | 'turnCompleted') => string;
};

/**
 * Shape of a conversation response-stream message (`message.stream`). Both the
 * turn-finish and permission-request signals ride this single channel, keyed
 * by `type` — there is no separate `confirmation.add` / `turn.completed`
 * channel in a real conversation.
 */
export type StreamMessage = {
  type?: string;
  conversation_id?: string;
  turn_id?: string;
  content?: {
    id?: string;
    call_id?: string;
  };
};

// Stream `type` values that represent an agent asking the user to confirm a
// permission. ACP emits `acp_permission`; aionrs emits both `acp_permission`
// and `permission`.
export const PERMISSION_TYPES = new Set(['acp_permission', 'permission']);

export type NotificationSoundGate = {
  notificationEnabled: boolean;
  soundEnabled: boolean;
};

export const shouldPlayNotificationSound = (gate: NotificationSoundGate): boolean =>
  gate.notificationEnabled && gate.soundEnabled;

export type NotificationReminderKind = 'confirmation' | 'turnCompleted';

export type NotificationReminderPayload = {
  kind: NotificationReminderKind;
  conversationId?: string;
};

export type NotificationSoundDeps = {
  readGate: () => NotificationSoundGate;
  play: (kind: NotificationReminderKind) => void;
  notify?: (payload: NotificationReminderPayload) => void;
};

export const createNotificationSoundController = (deps: NotificationSoundDeps) => {
  let lastPlayedTurnId: string | null = null;
  let lastPlayedConfirmationId: string | null = null;

  const remind = (payload: NotificationReminderPayload): void => {
    const gate = deps.readGate();
    if (!gate.notificationEnabled) return;
    deps.notify?.(payload);
    if (gate.soundEnabled) {
      deps.play(payload.kind);
    }
  };

  const onConfirmationRequested = (confirmationId?: string, conversationId?: string): void => {
    if (confirmationId && confirmationId === lastPlayedConfirmationId) return;
    lastPlayedConfirmationId = confirmationId ?? null;
    remind({ kind: 'confirmation', conversationId });
  };

  const onTurnCompleted = (turnId?: string, conversationId?: string): void => {
    if (turnId && turnId === lastPlayedTurnId) return;
    lastPlayedTurnId = turnId ?? null;
    remind({ kind: 'turnCompleted', conversationId });
  };

  const onStreamMessage = (message: StreamMessage): void => {
    if (!message?.type) return;

    if (PERMISSION_TYPES.has(message.type)) {
      onConfirmationRequested(message.content?.id ?? message.content?.call_id, message.conversation_id);
      return;
    }

    if (message.type === 'finish') {
      onTurnCompleted(message.turn_id, message.conversation_id);
    }
  };

  return { onConfirmationRequested, onStreamMessage, onTurnCompleted };
};

export const createBrowserNotificationController = (deps: BrowserNotificationDeps) => {
  // Track the last turn we actually notified for, so repeated finish events
  // for the same turn don't fire duplicate notifications.
  let lastNotifiedTurnId: string | null = null;

  const onStreamMessage = (message: StreamMessage): void => {
    if (!message?.type) return;

    if (PERMISSION_TYPES.has(message.type)) {
      if (!shouldShowNotification(deps.readGate())) return;
      deps.show({ body: deps.bodyFor('confirmation'), conversationId: message.conversation_id });
      return;
    }

    if (message.type === 'finish') {
      if (message.turn_id && message.turn_id === lastNotifiedTurnId) return;
      if (!shouldShowNotification(deps.readGate())) return;
      lastNotifiedTurnId = message.turn_id ?? null;
      deps.show({ body: deps.bodyFor('turnCompleted'), conversationId: message.conversation_id });
    }
  };

  return { onStreamMessage };
};
