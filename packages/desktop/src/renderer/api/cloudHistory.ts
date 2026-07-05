import type { TMessage } from '@/common/chat/chatLib';
import type { TChatConversation } from '@/common/config/storage';
import type { ConversationImportPayload } from '@/common/adapter/ipcBridge';
import { createApiClient } from './client';
import { getCloudApiBase } from './config';

export type CloudHistorySettingsResponse = {
  success: boolean;
  enabled: boolean;
};

export type CloudHistoryMessagePayload = {
  id: string;
  msg_id?: string;
  type: string;
  position?: string;
  status?: string;
  hidden?: boolean;
  created_at?: number;
  content: unknown;
};

export type CloudHistoryConversationPayload = {
  id: string;
  name: string;
  type: string;
  source?: string;
  extra?: unknown;
  created_at: number;
  modified_at: number;
  messages: CloudHistoryMessagePayload[];
};

export type CloudHistorySyncResponse = {
  success: boolean;
  syncedConversations: number;
  syncedMessages: number;
};

export type CloudHistoryConversationItem = {
  id: string;
  localConversationId: string;
  name: string;
  type: string;
  source?: string | null;
  extra?: unknown;
  localCreatedAt?: string | null;
  localUpdatedAt?: string | null;
  syncedAt: string;
  messageCount: number;
};

export type CloudHistoryMessageItem = {
  id: string;
  localMessageId: string;
  msgId?: string | null;
  type: string;
  position?: string | null;
  status?: string | null;
  hidden: boolean;
  content: unknown;
  localCreatedAt?: string | null;
};

type CloudHistoryConversationsResponse = {
  success: boolean;
  conversations: CloudHistoryConversationItem[];
};

type CloudHistoryMessagesResponse = {
  success: boolean;
  messages: CloudHistoryMessageItem[];
};

const MAX_ARRAY_ITEMS = 200;
const MAX_STRING_LENGTH = 20_000;
const MAX_DEPTH = 8;
const SENSITIVE_KEY_PATTERN =
  /(api[_-]?key|authorization|auth[_-]?token|access[_-]?token|refresh[_-]?token|secret|password|cookie|workspace|cli[_-]?path|bearer)/i;

function client() {
  return createApiClient(getCloudApiBase());
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

export function sanitizeCloudHistoryValue(value: unknown, depth = 0): unknown {
  if (value === undefined) {
    return undefined;
  }

  if (depth > MAX_DEPTH) {
    return '[Max depth]';
  }

  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    if (value.length <= MAX_STRING_LENGTH) {
      return value;
    }
    return `${value.slice(0, MAX_STRING_LENGTH)}...[truncated]`;
  }

  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeCloudHistoryValue(item, depth + 1));
  }

  if (typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        output[key] = '[REDACTED]';
        continue;
      }
      output[key] = sanitizeCloudHistoryValue(child, depth + 1);
    }
    return output;
  }

  return String(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

export function buildCloudHistoryConversationPayload(
  conversation: TChatConversation,
  messages: TMessage[]
): CloudHistoryConversationPayload {
  const extra = sanitizeCloudHistoryValue(conversation.extra);
  const model = 'model' in conversation ? sanitizeCloudHistoryValue(conversation.model) : undefined;
  return {
    id: conversation.id,
    name: conversation.name,
    type: conversation.type,
    ...(conversation.source ? { source: conversation.source } : {}),
    extra:
      model && typeof extra === 'object' && extra !== null && !Array.isArray(extra)
        ? { ...extra, model }
        : sanitizeCloudHistoryValue({ extra, ...(model ? { model } : {}) }),
    created_at: conversation.created_at,
    modified_at: conversation.modified_at,
    messages: messages.map((message) => ({
      id: message.id,
      ...(optionalString(message.msg_id) ? { msg_id: message.msg_id } : {}),
      type: message.type,
      ...(optionalString(message.position) ? { position: message.position } : {}),
      ...(optionalString(message.status) ? { status: message.status } : {}),
      ...(message.hidden ? { hidden: true } : {}),
      ...(typeof message.created_at === 'number' ? { created_at: message.created_at } : {}),
      content: sanitizeCloudHistoryValue(message.content),
    })),
  };
}

function parseCloudDate(value: string | null | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : fallback;
}

function toImportedConversation(conversation: CloudHistoryConversationItem): TChatConversation {
  const now = Date.now();
  const extra = typeof conversation.extra === 'object' && conversation.extra !== null ? conversation.extra : {};
  const maybeModel = (extra as { model?: unknown }).model;
  const base = {
    id: conversation.localConversationId,
    name: conversation.name,
    type: conversation.type,
    source: conversation.source ?? 'lingai',
    created_at: parseCloudDate(conversation.localCreatedAt, now),
    modified_at: parseCloudDate(conversation.localUpdatedAt, now),
    status: 'finished',
    extra,
    ...(maybeModel ? { model: maybeModel } : {}),
  };
  return base as TChatConversation;
}

function toImportedMessage(conversationId: string, message: CloudHistoryMessageItem): TMessage {
  return {
    id: message.localMessageId,
    msg_id: message.msgId ?? undefined,
    conversation_id: conversationId,
    type: message.type,
    content: message.content,
    position: message.position ?? undefined,
    status: message.status ?? undefined,
    hidden: message.hidden,
    created_at: parseCloudDate(message.localCreatedAt, Date.now()),
  } as TMessage;
}

export function buildCloudHistoryImportPayload(
  conversation: CloudHistoryConversationItem,
  messages: CloudHistoryMessageItem[]
): ConversationImportPayload {
  return {
    version: 1,
    exportedAt: conversation.syncedAt,
    conversation: toImportedConversation(conversation),
    messages: messages.map((message) => toImportedMessage(conversation.localConversationId, message)),
  };
}

export const cloudHistoryApi = {
  getSettings: async (token: string): Promise<CloudHistorySettingsResponse> => {
    return client().get('/api/cloud-history/settings', {
      headers: authHeaders(token),
    });
  },

  updateSettings: async (token: string, enabled: boolean): Promise<CloudHistorySettingsResponse> => {
    return client().put(
      '/api/cloud-history/settings',
      { enabled },
      {
        headers: authHeaders(token),
      }
    );
  },

  sync: async (token: string, conversations: CloudHistoryConversationPayload[]): Promise<CloudHistorySyncResponse> => {
    return client().post(
      '/api/cloud-history/sync',
      { conversations },
      {
        headers: authHeaders(token),
      }
    );
  },

  listConversations: async (token: string, limit = 100): Promise<CloudHistoryConversationItem[]> => {
    const res = await client().get<CloudHistoryConversationsResponse>(`/api/cloud-history/conversations?limit=${limit}`, {
      headers: authHeaders(token),
    });
    return res.conversations ?? [];
  },

  getMessages: async (token: string, conversationId: string): Promise<CloudHistoryMessageItem[]> => {
    const res = await client().get<CloudHistoryMessagesResponse>(
      `/api/cloud-history/conversations/${encodeURIComponent(conversationId)}/messages`,
      {
        headers: authHeaders(token),
      }
    );
    return res.messages ?? [];
  },
};
