/**
 * @license
 * Copyright 2025 LingAI (lingai.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IMessageThinking } from '@/common/chat/chatLib';
import { Brain, Right } from '@icon-park/react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './MessageThinking.module.css';

const MessageThinking: React.FC<{ message: IMessageThinking }> = ({ message }) => {
  const { t } = useTranslation();

  const formatDuration = (ms: number): string => {
    const seconds = Math.floor(ms / 1000);
    const sUnit = t('common.unit.second_short', { defaultValue: 's' });
    const mUnit = t('common.unit.minute_short', { defaultValue: 'm' });

    if (seconds < 60) return `${seconds}${sUnit}`;
    const minutes = Math.floor(seconds / 60);
    const remaining = seconds % 60;
    return `${minutes}${mUnit} ${remaining}${sUnit}`;
  };

  const formatElapsedTime = (seconds: number): string => {
    const sUnit = t('common.unit.second_short', { defaultValue: 's' });
    const mUnit = t('common.unit.minute_short', { defaultValue: 'm' });

    if (seconds < 60) return `${seconds}${sUnit}`;
    const minutes = Math.floor(seconds / 60);
    const remaining = seconds % 60;
    return `${minutes}${mUnit} ${remaining}${sUnit}`;
  };

  const { content: text, status, subject } = message.content;
  const duration = message.content.duration ?? (message.content as { duration_ms?: number }).duration_ms;
  const isDone = status === 'done';
  const [expanded, setExpanded] = useState(!isDone);
  const [elapsedTime, setElapsedTime] = useState(() => {
    const initialStartedAt = message.created_at ?? Date.now();
    return isDone ? 0 : Math.max(0, Math.floor((Date.now() - initialStartedAt) / 1000));
  });
  const startTimeRef = useRef<number>(message.created_at ?? Date.now());
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isDone) {
      setExpanded(false);
    }
  }, [isDone]);

  useEffect(() => {
    if (isDone) return;

    startTimeRef.current = message.created_at ?? Date.now();
    setElapsedTime(Math.max(0, Math.floor((Date.now() - startTimeRef.current) / 1000)));
    const timer = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);

    return () => clearInterval(timer);
  }, [isDone, message.created_at, message.msg_id]);

  useEffect(() => {
    if (!isDone && expanded && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [text, isDone, expanded]);

  const elapsedLabel = isDone ? formatDuration(duration || 0) : formatElapsedTime(elapsedTime);
  const title = isDone
    ? t('conversation.thinking.complete', { defaultValue: '思考完成' })
    : subject || t('conversation.thinking.label', { defaultValue: '正在深度思考' });
  const detail = isDone
    ? `${t('conversation.thinking.complete', { defaultValue: '思考完成' })} · ${elapsedLabel}`
    : `${t('conversation.thinking.streaming', { defaultValue: '正在梳理上下文、推理方案与下一步动作' })} · ${elapsedLabel}`;
  const progress = useMemo(() => {
    if (isDone) return 100;
    return Math.min(92, 18 + ((elapsedTime * 7) % 62));
  }, [elapsedTime, isDone]);

  return (
    <div className={`${styles.container} ${!isDone ? styles.running : ''}`}>
      <div className={styles.hero} onClick={() => setExpanded((v) => !v)}>
        <span className={styles.orb}>
          <Brain theme='outline' size='16' />
        </span>
        <span className={styles.content}>
          <span className={styles.title}>{title}</span>
          <span className={styles.detail}>{detail}</span>
          <span className={styles.progress}>
            <span style={{ width: `${progress}%` }} />
          </span>
        </span>
        <span className={styles.time}>{elapsedLabel}</span>
        <span className={`${styles.arrow} ${expanded ? styles.arrowExpanded : ''}`}>
          <Right theme='outline' size='12' />
        </span>
      </div>
      <div ref={bodyRef} className={`${styles.body} ${!expanded ? styles.collapsed : ''}`}>
        {text || t('conversation.thinking.empty', { defaultValue: '正在生成思考内容...' })}
      </div>
    </div>
  );
};

export default MessageThinking;