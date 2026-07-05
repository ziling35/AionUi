/**
 * @license
 * Copyright 2025 LingAI (lingai.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/config/storage';
import { useUser } from '@renderer/hooks/context/UserContext';
import {
  DEFAULT_CLOUD_HISTORY_SYNC_CONVERSATION_LIMIT,
  syncCloudHistoryConversations,
} from '@renderer/utils/chat/cloudHistorySync';
import React, { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useConversationListSync } from '@/renderer/pages/conversation/GroupedHistory/hooks/useConversationListSync';
import type { GroupedHistoryResult } from '@/renderer/pages/conversation/GroupedHistory/types';
import { buildGroupedHistory } from '@/renderer/pages/conversation/GroupedHistory/utils/groupingHelpers';

export type ConversationHistoryContextValue = ReturnType<typeof useConversationListSync> & {
  groupedHistory: GroupedHistoryResult;
};

const CLOUD_HISTORY_SYNC_DELAY_MS = 1500;

const ConversationHistoryContext = createContext<ConversationHistoryContextValue | null>(null);

function useCloudHistorySync(conversations: TChatConversation[]) {
  const { token, isLoggedIn, cloudHistoryEnabled } = useUser();
  const lastSyncSignatureRef = useRef('');

  useEffect(() => {
    if (!isLoggedIn || !token || !cloudHistoryEnabled || conversations.length === 0) {
      return;
    }

    const candidates = conversations.slice(0, DEFAULT_CLOUD_HISTORY_SYNC_CONVERSATION_LIMIT);
    const signature = candidates
      .map((conversation) => `${conversation.id}:${conversation.modified_at}:${conversation.name}`)
      .join('|');

    if (signature === lastSyncSignatureRef.current) {
      return;
    }
    lastSyncSignatureRef.current = signature;

    const timeout = window.setTimeout(() => {
      void (async () => {
        try {
          await syncCloudHistoryConversations(token, candidates);
        } catch (error) {
          console.warn('[CloudHistory] Failed to sync conversations:', error);
        }
      })();
    }, CLOUD_HISTORY_SYNC_DELAY_MS);

    return () => window.clearTimeout(timeout);
  }, [cloudHistoryEnabled, conversations, isLoggedIn, token]);
}

export const ConversationHistoryProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const { t } = useTranslation();
  const conversationListSync = useConversationListSync();
  useCloudHistorySync(conversationListSync.conversations);

  const groupedHistory = useMemo(() => {
    return buildGroupedHistory(conversationListSync.conversations, t);
  }, [conversationListSync.conversations, t]);

  const value = useMemo<ConversationHistoryContextValue>(() => {
    return {
      ...conversationListSync,
      groupedHistory,
    };
  }, [conversationListSync, groupedHistory]);

  return <ConversationHistoryContext.Provider value={value}>{children}</ConversationHistoryContext.Provider>;
};

export const useConversationHistoryContext = (): ConversationHistoryContextValue => {
  const context = useContext(ConversationHistoryContext);

  if (!context) {
    throw new Error('useConversationHistoryContext must be used within ConversationHistoryProvider');
  }

  return context;
};
