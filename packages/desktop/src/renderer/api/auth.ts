import { createApiClient } from './client';
import { getCloudApiBase } from './config';

export interface UserInfo {
  id: string;
  username: string;
  quota: number;
  usedQuota?: number;
  cloudHistoryEnabled?: boolean;
}

export interface AuthResponse {
  success: boolean;
  user?: UserInfo;
  token?: string;
  error?: string;
}

export interface ActivateCardResponse {
  success: boolean;
  newQuota?: number;
  error?: string;
}

function client() {
  return createApiClient(getCloudApiBase());
}

export const authApi = {
  login: async (username: string, password: string): Promise<AuthResponse> => {
    return client().post('/api/auth/login', { username, password });
  },

  register: async (username: string, password: string): Promise<AuthResponse> => {
    return client().post('/api/auth/register', { username, password });
  },

  me: async (token: string): Promise<AuthResponse> => {
    return client().get('/api/auth/me', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  },

  /** Activate a card secret to top up the quota for the given user. */
  activateCard: async (code: string, userId: string): Promise<ActivateCardResponse> => {
    return client().post('/api/cards/activate', { code, userId });
  },
};
