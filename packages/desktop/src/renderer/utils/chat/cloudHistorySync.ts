import type { TChatConversation } from '@/common/config/storage';
import { ipcBridge } from '@/common';
import { buildCloudHistoryConversationPayload, cloudHistoryApi } from '@renderer/api/cloudHistory';
import { loadLatestConversationMessages } from './messagePagination';

export const DEFAULT_CLOUD_HISTORY_SYNC_CONVERSATION_LIMIT = 5;
export const DEFAULT_CLOUD_HISTORY_SYNC_MESSAGE_LIMIT = 200;

type SyncCloudHistoryOptions = {
  conversationLimit?: number;
  messageLimit?: number;
};

export type SyncCloudHistoryResult = {
  syncedConversations: number;
  syncedMessages: number;
};

function isSyncableCloudHistoryConversation(conversation: TChatConversation): boolean {
  const extra = conversation.extra as { is_health_check?: boolean; team_id?: string; teamId?: string } | undefined;
  return extra?.is_health_check !== true && !extra?.team_id && !extra?.teamId;
}

export async function syncCloudHistoryConversations(
  token: string,
  conversations: TChatConversation[],
  options: SyncCloudHistoryOptions = {}
): Promise<SyncCloudHistoryResult> {
  const candidates = conversations
    .filter(isSyncableCloudHistoryConversation)
    .slice(0, options.conversationLimit ?? DEFAULT_CLOUD_HISTORY_SYNC_CONVERSATION_LIMIT);

  if (candidates.length === 0) {
    return { syncedConversations: 0, syncedMessages: 0 };
  }

  const payloads = await Promise.all(
    candidates.map(async (conversation) => {
      const page = await loadLatestConversationMessages(conversation.id, {
        limit: options.messageLimit ?? DEFAULT_CLOUD_HISTORY_SYNC_MESSAGE_LIMIT,
        contentMode: 'full',
      });
      return buildCloudHistoryConversationPayload(conversation, page.items);
    })
  );

  const result = await cloudHistoryApi.sync(token, payloads);
  return {
    syncedConversations: result.syncedConversations,
    syncedMessages: result.syncedMessages,
  };
}

export async function syncLocalCloudHistoryNow(
  token: string,
  options: SyncCloudHistoryOptions = {}
): Promise<SyncCloudHistoryResult> {
  const result = await ipcBridge.database.getUserConversations.invoke({ limit: 10000 });
  return syncCloudHistoryConversations(token, result.items ?? [], options);
}
