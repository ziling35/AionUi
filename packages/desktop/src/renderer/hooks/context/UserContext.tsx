import type { ReactNode } from 'react';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { mutate } from 'swr';
import { authApi, type UserInfo } from '@renderer/api/auth';
import { disableCloudProvider, syncCloudProvider } from '@renderer/api/cloud';
import { cloudHistoryApi } from '@renderer/api/cloudHistory';
import { CLOUD_MODELS_SWR_KEY, PROVIDERS_SWR_KEY } from '@/renderer/hooks/agent/useModelProviderList';

const TOKEN_KEY = 'aion_token';
const USER_KEY = 'aion_user';

interface ActivateCardResult {
  success: boolean;
  newQuota?: number;
  error?: string;
}

interface UserContextValue {
  user: UserInfo | null;
  token: string | null;
  isLoading: boolean;
  isLoggedIn: boolean;
  /** Persist session and sync the cloud provider into aioncore. */
  login: (token: string, user: UserInfo) => Promise<void>;
  /** Clear session and disable the cloud provider. */
  logout: () => Promise<void>;
  /** Re-fetch the current user (refreshes quota). */
  refreshUser: () => Promise<UserInfo | null>;
  /**
   * Force re-sync cloud models from the admin server, bypassing the
   * token de-dup guard. Call this after the admin changes model configs
   * so the client picks up the latest model list immediately.
   */
  refreshCloudModels: () => Promise<void>;
  /** True while a cloud model refresh is in progress. */
  isCloudSyncing: boolean;
  /** Whether this account allows chat history to be saved to LingAI Cloud. */
  cloudHistoryEnabled: boolean;
  /** Update cloud history saving preference on the admin server. */
  setCloudHistoryEnabled: (enabled: boolean) => Promise<boolean>;
  /** Activate a card secret to top up quota. Requires a logged-in user. */
  activateCard: (code: string) => Promise<ActivateCardResult>;
  isLoginModalVisible: boolean;
  showLoginModal: () => void;
  hideLoginModal: () => void;
}

const UserContext = createContext<UserContextValue | null>(null);

export const UserProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoginModalVisible, setIsLoginModalVisible] = useState(false);
  const [isCloudSyncing, setIsCloudSyncing] = useState(false);
  const [cloudHistoryEnabled, setCloudHistoryEnabledState] = useState(false);
  // Guard against syncing the cloud provider multiple times for the same token.
  const syncedTokenRef = useRef<string | null>(null);

  // Best-effort cloud provider sync — aioncore may not be ready immediately at
  // startup, so we retry a few times with backoff before giving up.
  const syncCloud = useCallback(async (tkn?: string | null) => {
    const key = tkn || 'guest';
    if (syncedTokenRef.current === key) return;

    const maxRetries = 5;
    const baseDelay = 2000;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await syncCloudProvider(tkn);
        syncedTokenRef.current = key;
        console.log(`[UserContext] Cloud provider synced on attempt ${attempt}`);
        return;
      } catch (err) {
        console.warn(`[UserContext] Cloud provider sync attempt ${attempt}/${maxRetries} failed:`, err);
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, baseDelay * attempt));
        }
      }
    }
    console.error('[UserContext] Cloud provider sync failed after all retries');
  }, []);

  useEffect(() => {
    let cancelled = false;
    const storedToken = localStorage.getItem(TOKEN_KEY);
    const storedUser = localStorage.getItem(USER_KEY);

    if (!storedToken || !storedUser) {
      // Not logged in — still sync cloud models so they're visible in the
      // picker. The proxy gateway will reject actual chat requests (401)
      // until the user logs in.
      void syncCloud(null);
      setIsLoading(false);
      return;
    }

    setToken(storedToken);
    try {
      const parsedUser = JSON.parse(storedUser) as UserInfo;
      setUser(parsedUser);
      setCloudHistoryEnabledState(parsedUser.cloudHistoryEnabled === true);
    } catch {
      localStorage.removeItem(USER_KEY);
    }

    authApi
      .me(storedToken)
      .then((res) => {
        if (cancelled) return;
        if (res.success && res.user) {
          setUser(res.user);
          setCloudHistoryEnabledState(res.user.cloudHistoryEnabled === true);
          localStorage.setItem(USER_KEY, JSON.stringify(res.user));
          // Sync cloud provider after aioncore has had time to boot.
          void syncCloud(storedToken);
        } else {
          setToken(null);
          setUser(null);
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(USER_KEY);
        }
      })
      .catch((err) => {
        console.error('Failed to fetch user data on load', err);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [syncCloud]);

  const login = useCallback(
    async (newToken: string, newUser: UserInfo) => {
      setToken(newToken);
      setUser(newUser);
      setCloudHistoryEnabledState(newUser.cloudHistoryEnabled === true);
      localStorage.setItem(TOKEN_KEY, newToken);
      localStorage.setItem(USER_KEY, JSON.stringify(newUser));
      setIsLoginModalVisible(false);
      // Sync cloud models so they appear in the model picker immediately.
      void syncCloud(newToken);
    },
    [syncCloud]
  );

  const logout = useCallback(async () => {
    try {
      await disableCloudProvider();
    } catch (err) {
      console.warn('Failed to disable cloud provider on logout', err);
    }
    // Reset so the next syncCloud('guest') re-syncs with empty token
    syncedTokenRef.current = 'guest';
    setToken(null);
    setUser(null);
    setCloudHistoryEnabledState(false);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }, []);

  const refreshUser = useCallback(async (): Promise<UserInfo | null> => {
    if (!token) return null;
    try {
      const res = await authApi.me(token);
      if (res.success && res.user) {
        setUser(res.user);
        setCloudHistoryEnabledState(res.user.cloudHistoryEnabled === true);
        localStorage.setItem(USER_KEY, JSON.stringify(res.user));
        void syncCloud(token);
        return res.user;
      }
    } catch (err) {
      console.error('Failed to refresh user', err);
    }
    return null;
  }, [token, syncCloud]);

  const setCloudHistoryEnabled = useCallback(
    async (enabled: boolean): Promise<boolean> => {
      if (!token) {
        return false;
      }

      const previous = cloudHistoryEnabled;
      setCloudHistoryEnabledState(enabled);

      try {
        const res = await cloudHistoryApi.updateSettings(token, enabled);
        setCloudHistoryEnabledState(res.enabled);
        setUser((current) => {
          if (!current) return current;
          const next = { ...current, cloudHistoryEnabled: res.enabled };
          localStorage.setItem(USER_KEY, JSON.stringify(next));
          return next;
        });
        return true;
      } catch (err) {
        console.error('Failed to update cloud history setting', err);
        setCloudHistoryEnabledState(previous);
        return false;
      }
    },
    [cloudHistoryEnabled, token]
  );

  const activateCard = useCallback(
    async (code: string): Promise<ActivateCardResult> => {
      if (!user) {
        return { success: false, error: 'not_logged_in' };
      }
      try {
        const res = await authApi.activateCard(code, user.id);
        if (res.success) {
          await refreshUser();
          return { success: true, newQuota: res.newQuota };
        }
        return { success: false, error: res.error };
      } catch (err: any) {
        return { success: false, error: err?.message || 'network_error' };
      }
    },
    [user, refreshUser]
  );

  const showLoginModal = useCallback(() => setIsLoginModalVisible(true), []);
  const hideLoginModal = useCallback(() => setIsLoginModalVisible(false), []);

  /**
   * Force re-sync cloud models from the admin server, bypassing the
   * token de-dup guard. This is the mechanism that picks up model config
   * changes made in the admin panel without requiring a restart or
   * re-login.
   */
  const refreshCloudModels = useCallback(async () => {
    setIsCloudSyncing(true);
    try {
      await syncCloudProvider(token);
      // Invalidate the SWR providers cache so every component using
      // useProvidersQuery re-fetches the updated model list.
      await Promise.all([mutate(CLOUD_MODELS_SWR_KEY), mutate(PROVIDERS_SWR_KEY)]);
      console.log('[UserContext] Cloud models force-refreshed');
    } catch (err) {
      console.error('[UserContext] Cloud model refresh failed:', err);
    } finally {
      setIsCloudSyncing(false);
    }
  }, [token]);

  // Periodic auto-refresh — re-sync cloud models every 5 minutes so the
  // client picks up admin-side config changes without manual intervention.
  useEffect(() => {
    const interval = setInterval(
      () => {
        void refreshCloudModels();
      },
      5 * 60 * 1000
    );
    return () => clearInterval(interval);
  }, [refreshCloudModels]);

  return (
    <UserContext.Provider
      value={{
        user,
        token,
        isLoading,
        isLoggedIn: Boolean(user && token),
        login,
        logout,
        refreshUser,
        refreshCloudModels,
        isCloudSyncing,
        cloudHistoryEnabled,
        setCloudHistoryEnabled,
        activateCard,
        isLoginModalVisible,
        showLoginModal,
        hideLoginModal,
      }}
    >
      {children}
    </UserContext.Provider>
  );
};

export const useUser = (): UserContextValue => {
  const context = useContext(UserContext);
  if (!context) {
    throw new Error('useUser must be used within a UserProvider');
  }
  return context;
};
