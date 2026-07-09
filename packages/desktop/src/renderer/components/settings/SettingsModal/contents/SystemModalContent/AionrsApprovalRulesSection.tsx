import {
  deleteAionrsApprovalRule,
  listAionrsApprovalRules,
} from '@/renderer/services/aionrsApprovalRules';
import type { AionrsApprovalRule } from '@/renderer/services/aionrsApprovalRules';
import {
  Alert,
  Button,
  Empty,
  Message,
  Popconfirm,
  Spin,
  Tag,
  Tooltip,
} from '@arco-design/web-react';
import { Delete, Refresh } from '@icon-park/react';
import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

const formatRuleTime = (value: number): string => {
  if (!Number.isFinite(value) || value <= 0) {
    return '-';
  }
  return new Date(value).toLocaleString();
};

const AionrsApprovalRulesSection: React.FC = () => {
  const { t } = useTranslation();
  const [deletingKey, setDeletingKey] = useState<string | null>(null);

  const {
    data: rules,
    error,
    isLoading,
    isValidating,
    mutate,
  } = useSWR<AionrsApprovalRule[]>('aionrs.approvalRules', listAionrsApprovalRules);

  const sortedRules = useMemo(
    () =>
      [...(rules ?? [])].sort(
        (left, right) => right.updated_at - left.updated_at || left.key.localeCompare(right.key),
      ),
    [rules],
  );

  const getScopeLabel = useCallback(
    (scope: string): string => {
      if (scope === 'command_prefix') {
        return t('settings.aionrsApprovalRules.scopeCommandPrefix');
      }
      if (scope === 'category') {
        return t('settings.aionrsApprovalRules.scopeCategory');
      }
      return t('settings.aionrsApprovalRules.scopeUnknown');
    },
    [t],
  );

  const handleRefresh = useCallback(() => {
    void mutate();
  }, [mutate]);

  const handleDelete = useCallback(
    async (key: string) => {
      if (deletingKey) {
        return;
      }

      setDeletingKey(key);
      try {
        const result = await deleteAionrsApprovalRule(key);
        await mutate();
        Message.success(
          t('settings.aionrsApprovalRules.deleteSuccess', {
            count: result.active_revoked,
          }),
        );
      } catch (deleteError) {
        console.error('[AionrsApprovalRulesSection] Failed to delete approval rule:', deleteError);
        Message.error(t('settings.aionrsApprovalRules.deleteFailed'));
      } finally {
        setDeletingKey(null);
      }
    },
    [deletingKey, mutate, t],
  );

  return (
    <div className='px-[12px] md:px-[32px] py-16px bg-2 rd-16px space-y-12px'>
      <div className='flex items-start justify-between gap-16px'>
        <div className='min-w-0'>
          <div className='text-14px font-500 text-t-primary'>
            {t('settings.aionrsApprovalRules.title')}
          </div>
          <div className='text-12px text-t-tertiary mt-4px leading-relaxed'>
            {t('settings.aionrsApprovalRules.description')}
          </div>
        </div>
        <Button
          size='small'
          icon={<Refresh theme='outline' size='14' />}
          loading={isValidating && !isLoading}
          onClick={handleRefresh}
        >
          {t('settings.aionrsApprovalRules.refresh')}
        </Button>
      </div>

      {error ? (
        <Alert type='error' content={t('settings.aionrsApprovalRules.loadFailed')} />
      ) : (
        <Spin loading={isLoading}>
          {sortedRules.length === 0 ? (
            <Empty description={t('settings.aionrsApprovalRules.empty')} />
          ) : (
            <div className='flex flex-col gap-10px'>
              {sortedRules.map((rule) => (
                <div
                  key={rule.key}
                  className='rounded-10px border border-[var(--border-base)] bg-fill-1 p-12px flex items-center gap-12px'
                >
                  <Tag color={rule.scope === 'command_prefix' ? 'arcoblue' : 'green'}>
                    {getScopeLabel(rule.scope)}
                  </Tag>
                  <div className='min-w-0 flex-1'>
                    <Tooltip content={rule.label || rule.key}>
                      <div className='text-14px font-500 text-t-primary truncate'>
                        {rule.label || rule.key}
                      </div>
                    </Tooltip>
                    <div className='text-12px text-t-tertiary mt-3px flex flex-wrap gap-x-12px gap-y-4px'>
                      <span>
                        {t('settings.aionrsApprovalRules.category')}: {rule.category || '-'}
                      </span>
                      <span>
                        {t('settings.aionrsApprovalRules.updatedAt')}:{' '}
                        {formatRuleTime(rule.updated_at)}
                      </span>
                    </div>
                  </div>
                  <Popconfirm
                    title={t('settings.aionrsApprovalRules.deleteConfirm')}
                    onOk={() => {
                      void handleDelete(rule.key);
                    }}
                  >
                    <Button
                      size='small'
                      status='danger'
                      icon={<Delete theme='outline' size='14' />}
                      loading={deletingKey === rule.key}
                      disabled={Boolean(deletingKey && deletingKey !== rule.key)}
                    >
                      {t('settings.aionrsApprovalRules.delete')}
                    </Button>
                  </Popconfirm>
                </div>
              ))}
            </div>
          )}
        </Spin>
      )}
    </div>
  );
};

export default AionrsApprovalRulesSection;
