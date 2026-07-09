import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import { configService } from '@/common/config/configService';
import { isElectronDesktop } from '@/renderer/utils/platform';
import {
  createNotificationSoundController,
  type NotificationReminderKind,
  type NotificationReminderPayload,
} from './browserNotificationCore';

const SOUND_DURATION_SECONDS = 0.14;
const SOUND_VOLUME = 0.12;
const FREQUENCIES: Record<NotificationReminderKind, number> = {
  confirmation: 880,
  turnCompleted: 660,
};

type AudioContextConstructor = new () => AudioContext;

type AudioWindow = Window & {
  AudioContext?: AudioContextConstructor;
  webkitAudioContext?: AudioContextConstructor;
};

const getAudioContextConstructor = () => {
  if (typeof window === 'undefined') return undefined;
  const audioWindow = window as AudioWindow;
  return audioWindow.AudioContext ?? audioWindow.webkitAudioContext;
};

export const useNotificationSound = (): void => {
  const { t } = useTranslation();
  const audioContextRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    const isDesktop = isElectronDesktop();
    const streamEmitter = ipcBridge.conversation.responseStream;
    const confirmationEmitter = ipcBridge.conversation.confirmation.add;
    const turnCompletedEmitter = ipcBridge.conversation.turnCompleted;
    const AudioContextConstructor = getAudioContextConstructor();
    if (!streamEmitter || !confirmationEmitter || !turnCompletedEmitter) return;
    if (!isDesktop && !AudioContextConstructor) return;

    const ensureAudioContext = () => {
      if (!AudioContextConstructor) {
        throw new Error('AudioContext is unavailable');
      }
      const audioContext = audioContextRef.current ?? new AudioContextConstructor();
      audioContextRef.current = audioContext;
      return audioContext;
    };

    const primeAudioContext = () => {
      if (!AudioContextConstructor) return;
      void ensureAudioContext().resume().catch(() => {});
    };

    window.addEventListener('pointerdown', primeAudioContext, { once: true });
    window.addEventListener('keydown', primeAudioContext, { once: true });

    const playTone = (kind: NotificationReminderKind) => {
      const play = async () => {
        if (isDesktop) {
          await ipcBridge.notification.beep.invoke();
          return;
        }

        const audioContext = ensureAudioContext();

        if (audioContext.state === 'suspended') {
          await audioContext.resume();
        }

        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        const now = audioContext.currentTime;
        const end = now + SOUND_DURATION_SECONDS;

        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(FREQUENCIES[kind], now);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(SOUND_VOLUME, now + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, end);

        oscillator.connect(gain);
        gain.connect(audioContext.destination);
        oscillator.start(now);
        oscillator.stop(end);
      };

      void play().catch((error) => {
        console.warn('[useNotificationSound] Failed to play notification sound:', error);
      });
    };

    const showDesktopNotification = ({ kind, conversationId }: NotificationReminderPayload) => {
      if (!isDesktop) return;
      const body =
        kind === 'confirmation'
          ? t('settings.browserNotification.bodyConfirmation')
          : t('settings.browserNotification.bodyTurnCompleted');
      void ipcBridge.notification.show
        .invoke({
          title: 'LingAI',
          body,
          conversation_id: conversationId,
        })
        .catch((error) => {
          console.warn('[useNotificationSound] Failed to show desktop notification:', error);
        });
    };

    const controller = createNotificationSoundController({
      readGate: () => ({
        notificationEnabled: configService.get('system.notificationEnabled') !== false,
        soundEnabled: configService.get('system.notificationSoundEnabled') !== false,
      }),
      play: playTone,
      notify: showDesktopNotification,
    });

    const disposeStream = streamEmitter.on(controller.onStreamMessage);
    const disposeConfirmation = confirmationEmitter.on((event) => {
      controller.onConfirmationRequested(event.id ?? event.call_id, event.conversation_id);
    });
    const disposeTurnCompleted = turnCompletedEmitter.on((event) => {
      controller.onTurnCompleted(event.turn_id, event.session_id);
    });

    return () => {
      window.removeEventListener('pointerdown', primeAudioContext);
      window.removeEventListener('keydown', primeAudioContext);
      disposeStream();
      disposeConfirmation();
      disposeTurnCompleted();
    };
  }, [t]);
};
