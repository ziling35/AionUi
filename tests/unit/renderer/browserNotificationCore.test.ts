/**
 * @license
 * Copyright 2025 LingAI (lingai.com)
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi } from 'vitest';
import {
  shouldShowNotification,
  shouldPlayNotificationSound,
  createBrowserNotificationController,
  createNotificationSoundController,
  type NotificationGate,
} from '@/renderer/hooks/system/notification/browserNotificationCore';

const openGate: NotificationGate = {
  isElectron: false,
  hasNotificationApi: true,
  isSecureContext: true,
  permission: 'granted',
  settingEnabled: true,
  documentHidden: true,
};

describe('shouldShowNotification', () => {
  it('returns true when all gates pass', () => {
    expect(shouldShowNotification(openGate)).toBe(true);
  });

  it.each([
    ['isElectron', { isElectron: true }],
    ['no api', { hasNotificationApi: false }],
    ['insecure', { isSecureContext: false }],
    ['not granted', { permission: 'default' as const }],
    ['setting off', { settingEnabled: false }],
    ['tab visible', { documentHidden: false }],
  ])('returns false when %s', (_label, override) => {
    expect(shouldShowNotification({ ...openGate, ...override })).toBe(false);
  });
});

describe('shouldPlayNotificationSound', () => {
  it('returns true when notifications and sound are enabled', () => {
    expect(shouldPlayNotificationSound({ notificationEnabled: true, soundEnabled: true })).toBe(true);
  });

  it.each([
    ['notifications off', { notificationEnabled: false, soundEnabled: true }],
    ['sound off', { notificationEnabled: true, soundEnabled: false }],
  ])('returns false when %s', (_label, gate) => {
    expect(shouldPlayNotificationSound(gate)).toBe(false);
  });
});

describe('createBrowserNotificationController.onStreamMessage', () => {
  const makeDeps = (gate: NotificationGate = openGate) => {
    const show = vi.fn();
    const controller = createBrowserNotificationController({
      readGate: () => gate,
      show,
      bodyFor: (kind) => kind,
    });
    return { show, controller };
  };

  it('shows a turn-completed notification on a finish stream message', () => {
    const { show, controller } = makeDeps();
    controller.onStreamMessage({ type: 'finish', conversation_id: 'c1', turn_id: 't1' });
    expect(show).toHaveBeenCalledWith({ body: 'turnCompleted', conversationId: 'c1' });
  });

  it('shows a confirmation notification on an acp_permission stream message', () => {
    const { show, controller } = makeDeps();
    controller.onStreamMessage({ type: 'acp_permission', conversation_id: 'c2' });
    expect(show).toHaveBeenCalledWith({ body: 'confirmation', conversationId: 'c2' });
  });

  it('shows a confirmation notification on a permission stream message (aionrs)', () => {
    const { show, controller } = makeDeps();
    controller.onStreamMessage({ type: 'permission', conversation_id: 'c3' });
    expect(show).toHaveBeenCalledWith({ body: 'confirmation', conversationId: 'c3' });
  });

  it('ignores non-terminal stream message types', () => {
    const { show, controller } = makeDeps();
    controller.onStreamMessage({ type: 'thinking', conversation_id: 'c1', turn_id: 't1' });
    controller.onStreamMessage({ type: 'text', conversation_id: 'c1', turn_id: 't1' });
    controller.onStreamMessage({ type: 'start', conversation_id: 'c1', turn_id: 't1' });
    expect(show).not.toHaveBeenCalled();
  });

  it('does not show when the gate is closed', () => {
    const { show, controller } = makeDeps({ ...openGate, documentHidden: false });
    controller.onStreamMessage({ type: 'finish', conversation_id: 'c1', turn_id: 't1' });
    controller.onStreamMessage({ type: 'acp_permission', conversation_id: 'c1' });
    expect(show).not.toHaveBeenCalled();
  });

  it('dedups repeated finish for the same turn_id', () => {
    const { show, controller } = makeDeps();
    controller.onStreamMessage({ type: 'finish', conversation_id: 'c1', turn_id: 't1' });
    controller.onStreamMessage({ type: 'finish', conversation_id: 'c1', turn_id: 't1' });
    expect(show).toHaveBeenCalledTimes(1);
  });

  it('ignores messages without a type', () => {
    const { show, controller } = makeDeps();
    controller.onStreamMessage({ conversation_id: 'c1' });
    expect(show).not.toHaveBeenCalled();
  });
});

describe('createNotificationSoundController.onStreamMessage', () => {
  const makeDeps = (gate = { notificationEnabled: true, soundEnabled: true }) => {
    const play = vi.fn();
    const notify = vi.fn();
    const controller = createNotificationSoundController({
      readGate: () => gate,
      play,
      notify,
    });
    return { notify, play, controller };
  };

  it('plays when a conversation needs user confirmation', () => {
    const { notify, play, controller } = makeDeps();
    controller.onStreamMessage({ type: 'permission', conversation_id: 'c1' });
    expect(notify).toHaveBeenCalledWith({ kind: 'confirmation', conversationId: 'c1' });
    expect(play).toHaveBeenCalledWith('confirmation');
  });

  it('plays when a confirmation add event arrives', () => {
    const { play, controller } = makeDeps();
    controller.onConfirmationRequested('confirm-1');
    expect(play).toHaveBeenCalledWith('confirmation');
  });

  it('plays when an assistant turn finishes', () => {
    const { notify, play, controller } = makeDeps();
    controller.onStreamMessage({ type: 'finish', conversation_id: 'c1', turn_id: 't1' });
    expect(notify).toHaveBeenCalledWith({ kind: 'turnCompleted', conversationId: 'c1' });
    expect(play).toHaveBeenCalledWith('turnCompleted');
  });

  it('plays when a turn-completed event arrives', () => {
    const { play, controller } = makeDeps();
    controller.onTurnCompleted('t1');
    expect(play).toHaveBeenCalledWith('turnCompleted');
  });

  it('does not play when sound is disabled', () => {
    const { notify, play, controller } = makeDeps({ notificationEnabled: true, soundEnabled: false });
    controller.onStreamMessage({ type: 'finish', conversation_id: 'c1', turn_id: 't1' });
    controller.onStreamMessage({ type: 'acp_permission', conversation_id: 'c1' });
    expect(notify).toHaveBeenCalledTimes(2);
    expect(play).not.toHaveBeenCalled();
  });

  it('does not notify or play when notifications are disabled', () => {
    const { notify, play, controller } = makeDeps({ notificationEnabled: false, soundEnabled: true });
    controller.onStreamMessage({ type: 'finish', conversation_id: 'c1', turn_id: 't1' });
    expect(notify).not.toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
  });

  it('dedups repeated finish for the same turn_id', () => {
    const { play, controller } = makeDeps();
    controller.onStreamMessage({ type: 'finish', conversation_id: 'c1', turn_id: 't1' });
    controller.onTurnCompleted('t1');
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('dedups repeated confirmation events for the same id', () => {
    const { play, controller } = makeDeps();
    controller.onStreamMessage({ type: 'permission', conversation_id: 'c1', content: { id: 'confirm-1' } });
    controller.onConfirmationRequested('confirm-1');
    expect(play).toHaveBeenCalledTimes(1);
  });
});
