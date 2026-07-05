import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input, Message, Spin, Switch } from '@arco-design/web-react';
import { Wallet, Key, Logout, User } from '@icon-park/react';
import { useUser } from '@renderer/hooks/context/UserContext';
import { syncLocalCloudHistoryNow } from '@renderer/utils/chat/cloudHistorySync';
import CloudHistoryRestoreModal from './CloudHistoryRestoreModal';

const AccountModalContent: React.FC = () => {
  const { t } = useTranslation();
  const {
    user,
    isLoggedIn,
    isLoading,
    activateCard,
    logout,
    refreshUser,
    showLoginModal,
    token,
    cloudHistoryEnabled,
    setCloudHistoryEnabled,
  } = useUser();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [savingCloudHistory, setSavingCloudHistory] = useState(false);
  const [syncingCloudHistory, setSyncingCloudHistory] = useState(false);
  const [restoreModalVisible, setRestoreModalVisible] = useState(false);

  // Refresh user data (quota etc.) every time the panel is opened
  useEffect(() => {
    if (!isLoggedIn) return;
    setRefreshing(true);
    refreshUser().finally(() => setRefreshing(false));
  }, [isLoggedIn, refreshUser]);

  const handleActivate = async () => {
    if (!code) {
      Message.warning(t('settings.accountPanel.enterCard'));
      return;
    }
    setLoading(true);
    try {
      const res = await activateCard(code);
      if (res.success) {
        Message.success(t('settings.accountPanel.activateSuccess', { quota: res.newQuota ?? 0 }));
        setCode('');
      } else {
        Message.error(res.error || t('settings.accountPanel.activateFailed'));
      }
    } catch {
      Message.error(t('settings.accountPanel.activateFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await logout();
      Message.success(t('login.cloud.logoutSuccess'));
    } finally {
      setLoggingOut(false);
    }
  };

  const handleCloudHistoryChange = async (enabled: boolean) => {
    setSavingCloudHistory(true);
    try {
      const success = await setCloudHistoryEnabled(enabled);
      if (success) {
        Message.success(
          enabled ? t('settings.accountPanel.cloudHistoryEnabled') : t('settings.accountPanel.cloudHistoryDisabled')
        );
      } else {
        Message.error(t('settings.accountPanel.cloudHistoryUpdateFailed'));
      }
    } finally {
      setSavingCloudHistory(false);
    }
  };

  const handleSyncCloudHistoryNow = async () => {
    if (!token || !cloudHistoryEnabled) {
      Message.warning(t('settings.accountPanel.cloudHistorySyncDisabled'));
      return;
    }

    setSyncingCloudHistory(true);
    try {
      const result = await syncLocalCloudHistoryNow(token);
      Message.success(
        t('settings.accountPanel.cloudHistorySyncSuccess', {
          conversations: result.syncedConversations,
          messages: result.syncedMessages,
        })
      );
    } catch (error) {
      console.error('[AccountModalContent] Failed to sync cloud history:', error);
      Message.error(t('settings.accountPanel.cloudHistorySyncFailed'));
    } finally {
      setSyncingCloudHistory(false);
    }
  };

  if (!isLoggedIn) {
    return (
      <div className='flex flex-col items-center justify-center gap-16px py-48px px-20px w-full animate-fade-in'>
        <User theme='outline' size='48' fill='var(--color-text-3)' />
        <div className='text-center'>
          <h3 className='text-16px font-600 text-t-primary mb-4px'>{t('settings.accountPanel.notLoggedIn')}</h3>
          <p className='text-13px text-t-secondary'>{t('settings.accountPanel.notLoggedInDesc')}</p>
        </div>
        <Button type='primary' onClick={showLoginModal} className='h-40px px-32px rounded-8px'>
          {t('settings.accountPanel.goLogin')}
        </Button>
      </div>
    );
  }

  return (
    <div className='flex flex-col gap-24px pb-24px pr-20px w-full animate-fade-in'>
      {/* Account / quota card */}
      <div className='relative overflow-hidden rounded-12px bg-2 border border-[var(--border-base)] p-24px'>
        {refreshing && (
          <div className='absolute top-12px right-12px z-10'>
            <Spin size={16} />
          </div>
        )}
        <div className='flex items-center justify-between mb-16px'>
          <div className='flex items-center gap-8px'>
            <span className='inline-flex items-center justify-center size-32px rounded-8px bg-black text-white'>
              <User theme='outline' size='18' fill='white' />
            </span>
            <div>
              <div className='text-14px font-600 text-t-primary'>{user?.username}</div>
              <div className='text-12px text-t-tertiary'>{t('settings.accountPanel.signedIn')}</div>
            </div>
          </div>
          <Button
            type='text'
            size='small'
            icon={<Logout theme='outline' size='16' />}
            loading={loggingOut}
            onClick={handleLogout}
            className='text-t-secondary'
          >
            {t('settings.accountPanel.logout')}
          </Button>
        </div>

        <h3 className='text-14px font-500 text-t-secondary mb-12px flex items-center gap-8px'>
          <Wallet theme='outline' size='18' /> {t('settings.accountPanel.quota')}
        </h3>
        <div className='text-40px font-700 tracking-tight text-t-primary flex items-baseline gap-8px'>
          {user?.quota ?? 0}{' '}
          <span className='text-14px font-500 text-t-tertiary'>{t('settings.accountPanel.quotaUnit')}</span>
        </div>
        <div className='mt-16px grid grid-cols-2 gap-12px'>
          <div className='rounded-8px bg-fill-1 p-12px border border-[var(--border-base)]'>
            <div className='text-12px text-t-tertiary mb-4px'>{t('settings.accountPanel.usedQuota')}</div>
            <div className='text-20px font-600 text-t-primary'>{user?.usedQuota ?? 0}</div>
          </div>
          <div className='rounded-8px bg-fill-1 p-12px border border-[var(--border-base)]'>
            <div className='text-12px text-t-tertiary mb-4px'>{t('settings.accountPanel.quota')}</div>
            <div className='text-20px font-600 text-t-primary'>{user?.quota ?? 0}</div>
          </div>
        </div>
        <p className='text-13px text-t-tertiary mt-12px leading-relaxed'>{t('settings.accountPanel.quotaDesc')}</p>
      </div>

      {/* Cloud history */}
      <div className='rounded-12px bg-fill-1 p-16px border border-[var(--border-base)] flex items-center justify-between gap-16px'>
        <div className='flex-1'>
          <h3 className='text-14px font-600 text-t-primary mb-6px'>{t('settings.accountPanel.cloudHistory')}</h3>
          <p className='text-12px text-t-secondary leading-relaxed'>
            {t('settings.accountPanel.cloudHistoryDesc')}
          </p>
          <div className='flex flex-wrap gap-8px mt-10px'>
            <Button
              size='small'
              loading={syncingCloudHistory}
              disabled={!cloudHistoryEnabled}
              onClick={() => {
                void handleSyncCloudHistoryNow();
              }}
            >
              {t('settings.accountPanel.cloudHistorySyncNow')}
            </Button>
            <Button size='small' onClick={() => setRestoreModalVisible(true)}>
              {t('settings.accountPanel.cloudHistoryRestoreEntry')}
            </Button>
          </div>
        </div>
        <Switch checked={cloudHistoryEnabled} loading={savingCloudHistory} onChange={handleCloudHistoryChange} />
      </div>

      {/* Recharge */}
      <div>
        <h3 className='text-16px font-600 mb-16px text-t-primary'>{t('settings.accountPanel.recharge')}</h3>
        <div className='flex flex-col gap-8px'>
          <h4 className='text-14px font-500 text-t-primary'>{t('settings.accountPanel.activateCard')}</h4>
          <p className='text-12px text-t-secondary mb-8px'>{t('settings.accountPanel.activateCardDesc')}</p>
          <div className='flex flex-col gap-16px w-full mt-8px'>
            <div className='flex gap-12px w-full'>
              <Input
                placeholder={t('settings.accountPanel.cardPlaceholder')}
                value={code}
                onChange={setCode}
                className='flex-1 h-40px'
                prefix={<Key theme='outline' size='16' className='ml-8px' />}
              />
              <Button type='primary' loading={loading} onClick={handleActivate} className='h-40px px-24px rounded-8px'>
                {t('settings.accountPanel.activateBtn')}
              </Button>
            </div>
            <div className='text-13px text-t-secondary bg-fill-1 p-12px rounded-8px flex gap-8px items-start border border-[var(--border-base)]'>
              <span className='font-bold mt-1px'>i</span>
              <span>{t('settings.accountPanel.cardTip')}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Cloud models hint */}
      <div className='text-13px text-t-secondary bg-fill-1 p-12px rounded-8px border border-[var(--border-base)]'>
        <span className='font-600 text-t-primary'>{t('settings.accountPanel.cloudModels')}: </span>
        {t('settings.accountPanel.cloudModelsDesc')}
      </div>
      <CloudHistoryRestoreModal
        visible={restoreModalVisible}
        token={token}
        onClose={() => setRestoreModalVisible(false)}
      />
    </div>
  );
};

export default AccountModalContent;
