import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input, Message, Progress, Spin, Switch } from '@arco-design/web-react';
import { Wallet, Key, Logout, User } from '@icon-park/react';
import {
  rechargeApi,
  type PaymentOrder,
  type PaymentSummary,
  type RechargeProduct,
  type RechargeProductType,
} from '@renderer/api/recharge';
import { useUser } from '@renderer/hooks/context/UserContext';
import { syncLocalCloudHistoryNow } from '@renderer/utils/chat/cloudHistorySync';
import { openExternalUrl } from '@/renderer/utils/platform';
import CloudHistoryRestoreModal from './CloudHistoryRestoreModal';

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const formatDuration = (seconds: number | null | undefined) => {
  if (seconds === null || seconds === undefined) return '-';
  const safeSeconds = Math.max(0, seconds);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
};

const formatDateTime = (value: string | null | undefined) => {
  if (!value) return '-';
  return new Date(value).toLocaleString();
};

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
  const [rechargeProducts, setRechargeProducts] = useState<RechargeProduct[]>([]);
  const [paymentSummary, setPaymentSummary] = useState<PaymentSummary | null>(null);
  const [rechargeLoading, setRechargeLoading] = useState(false);
  const [selectedProductType, setSelectedProductType] = useState<RechargeProductType>('balance');
  const [selectedPaymentType, setSelectedPaymentType] = useState('alipay');
  const [creatingOrderProductId, setCreatingOrderProductId] = useState<string | null>(null);
  const [checkingOrder, setCheckingOrder] = useState(false);
  const [currentOrder, setCurrentOrder] = useState<PaymentOrder | null>(null);
  const [currentPaymentUrl, setCurrentPaymentUrl] = useState<string | null>(null);
  const quotaPlan = user?.quotaPlan;
  const isResetWindowPlan = quotaPlan?.mode === 'reset_window';
  const allowedPaymentTypes = paymentSummary?.allowedTypes ?? [];

  const [showCardInput, setShowCardInput] = useState(false);

  // Refresh user data (quota etc.) every time the panel is opened
  useEffect(() => {
    if (!isLoggedIn) return;
    setRefreshing(true);
    refreshUser().finally(() => setRefreshing(false));
  }, [isLoggedIn, refreshUser]);

  useEffect(() => {
    if (!isLoggedIn) return;
    let cancelled = false;
    setRechargeLoading(true);

    rechargeApi
      .listProducts()
      .then((res) => {
        if (cancelled) return;
        setRechargeProducts(res.products || []);
        setPaymentSummary(res.payment);
        const firstPaymentType = res.payment.allowedTypes[0];
        if (firstPaymentType) {
          setSelectedPaymentType((current) =>
            res.payment.allowedTypes.includes(current) ? current : firstPaymentType
          );
        }
      })
      .catch((error) => {
        console.error('[AccountModalContent] Failed to load recharge products:', error);
        if (!cancelled) Message.error(t('settings.accountPanel.rechargeProductsLoadFailed'));
      })
      .finally(() => {
        if (!cancelled) setRechargeLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isLoggedIn, t]);

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
        setShowCardInput(false);
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

  const getPaymentTypeLabel = (paymentType: string) => {
    switch (paymentType) {
      case 'alipay':
        return t('settings.accountPanel.paymentTypeAlipay');
      case 'wxpay':
        return t('settings.accountPanel.paymentTypeWxpay');
      case 'qqpay':
        return t('settings.accountPanel.paymentTypeQqpay');
      case 'bank':
        return t('settings.accountPanel.paymentTypeBank');
      default:
        return paymentType;
    }
  };

  const getProductPlanLabel = (product: RechargeProduct) => {
    if (product.planType !== 'reset_window') {
      return t('settings.accountPanel.productBalancePlan');
    }
    return t('settings.accountPanel.productResetPlan', {
      hours: product.windowHours || 4,
      days: product.validDays || 30,
    });
  };

  const updateOrderStatus = async (
    orderNo: string,
    options: { showPending?: boolean; showPaid?: boolean } = {}
  ): Promise<boolean> => {
    if (!token) return false;
    try {
      const res = await rechargeApi.getOrder(token, orderNo);
      setCurrentOrder(res.order);
      if (res.order.status === 'PAID') {
        await refreshUser();
        if (options.showPaid !== false) {
          Message.success(t('settings.accountPanel.paymentPaid'));
        }
        return true;
      }
      if (options.showPending) {
        Message.info(t('settings.accountPanel.paymentPending'));
      }
    } catch (error) {
      console.error('[AccountModalContent] Failed to check payment order:', error);
      if (options.showPending) {
        Message.error(t('settings.accountPanel.paymentCheckFailed'));
      }
    }
    return false;
  };

  const pollPaymentOrder = async (orderNo: string) => {
    setCheckingOrder(true);
    try {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        await sleep(attempt === 0 ? 2000 : 3000);
        const paid = await updateOrderStatus(orderNo, { showPaid: true });
        if (paid) return;
      }
    } finally {
      setCheckingOrder(false);
    }
  };

  const handleCheckPayment = async () => {
    if (!currentOrder) return;
    setCheckingOrder(true);
    try {
      await updateOrderStatus(currentOrder.orderNo, { showPending: true, showPaid: true });
    } finally {
      setCheckingOrder(false);
    }
  };

  const handleContinuePayment = async () => {
    if (!currentPaymentUrl) return;
    try {
      await openExternalUrl(currentPaymentUrl);
    } catch (error) {
      console.error('[AccountModalContent] Failed to reopen payment URL:', error);
      Message.error(t('settings.accountPanel.paymentOpenFailed'));
    }
  };

  const handlePurchase = async (product: RechargeProduct) => {
    if (!token) return;
    if (!paymentSummary?.enabled || allowedPaymentTypes.length === 0) {
      Message.warning(t('settings.accountPanel.paymentUnavailable'));
      return;
    }

    const paymentType = allowedPaymentTypes.includes(selectedPaymentType)
      ? selectedPaymentType
      : allowedPaymentTypes[0];
    if (!paymentType) {
      Message.warning(t('settings.accountPanel.paymentUnavailable'));
      return;
    }

    setCreatingOrderProductId(product.id);
    try {
      const res = await rechargeApi.createOrder(token, product.id, paymentType);
      setCurrentOrder(res.order);
      setCurrentPaymentUrl(res.paymentUrl);
      await openExternalUrl(res.paymentUrl);
      Message.success(t('settings.accountPanel.paymentOpened'));
      void pollPaymentOrder(res.order.orderNo);
    } catch (error) {
      console.error('[AccountModalContent] Failed to create recharge order:', error);
      Message.error(t('settings.accountPanel.paymentOpenFailed'));
    } finally {
      setCreatingOrderProductId(null);
    }
  };

  if (!isLoggedIn) {
    return (
      <div className='flex flex-col items-center justify-center gap-16px py-64px px-20px w-full animate-fade-in'>
        <div className='size-64px rounded-full bg-[var(--color-fill-2)] flex items-center justify-center mb-12px border border-[var(--border-2)]'>
          <User theme='outline' size='28' fill='var(--color-text-3)' />
        </div>
        <div className='text-center max-w-320px'>
          <h3 className='text-16px font-600 text-t-primary mb-4px'>{t('settings.accountPanel.notLoggedIn')}</h3>
          <p className='text-12px text-t-tertiary leading-relaxed'>{t('settings.accountPanel.notLoggedInDesc')}</p>
        </div>
        <Button
          type='primary'
          onClick={showLoginModal}
          className='h-38px px-28px rounded-8px font-600 text-12px border-0 shadow-sm mt-8px'
          style={{
            backgroundColor: 'var(--color-text-1)',
            color: 'var(--color-bg-1)'
          }}
        >
          {t('settings.accountPanel.goLogin')}
        </Button>
      </div>
    );
  }

  return (
    <div className='flex flex-col gap-20px pb-24px pr-20px w-full animate-fade-in'>
      {/* Account Info & Balance Panel */}
      <div className='relative overflow-hidden rounded-12px bg-2 border border-[var(--border-2)] p-24px shadow-sm transition-all duration-300'>
        {refreshing && (
          <div className='absolute top-16px right-16px z-10'>
            <Spin size={14} />
          </div>
        )}
        
        <div className='flex flex-col sm:flex-row sm:items-center justify-between gap-16px mb-24px pb-16px border-b border-[var(--border-1)]'>
          <div className='flex items-center gap-12px'>
            <div className='flex items-center justify-center size-40px rounded-full bg-[var(--color-fill-2)] border border-[var(--border-2)] text-t-primary shadow-sm'>
              <User theme='outline' size='18' fill='currentColor' />
            </div>
            <div>
              <div className='text-15px font-600 text-t-primary leading-tight'>{user?.username}</div>
              <div className='text-11px text-emerald-600 dark:text-emerald-400 font-medium mt-3px'>
                {t('settings.accountPanel.signedIn')}
              </div>
            </div>
          </div>
          <Button
            type='text'
            size='small'
            icon={<Logout theme='outline' size='14' />}
            loading={loggingOut}
            onClick={handleLogout}
            className='rounded-6px text-t-secondary hover:text-danger hover:bg-transparent p-0'
          >
            {t('settings.accountPanel.logout')}
          </Button>
        </div>

        <div className='flex flex-col md:flex-row md:items-center justify-between gap-20px'>
          <div className='flex flex-col'>
            <span className='text-11px font-600 text-t-tertiary uppercase tracking-wider mb-4px'>
              {t('settings.accountPanel.quota')}
            </span>
            <div className='flex items-baseline gap-2px'>
              <span className='text-36px font-700 tracking-tight text-t-primary font-mono leading-none'>
                {user?.quota?.toLocaleString() ?? 0}
              </span>
              <span className='text-11px font-600 text-t-tertiary ml-2px'>{t('settings.accountPanel.quotaUnit')}</span>
            </div>
          </div>

          <div className='flex gap-24px text-12px md:border-l border-[var(--border-1)] md:pl-24px h-full py-4px'>
            <div>
              <div className='text-t-tertiary text-11px mb-2px'>{t('settings.accountPanel.usedQuota')}</div>
              <div className='text-15px font-600 text-t-primary font-mono'>{user?.usedQuota?.toLocaleString() ?? 0}</div>
            </div>
            <div>
              <div className='text-t-tertiary text-11px mb-2px'>可用总额度</div>
              <div className='text-15px font-600 text-t-primary font-mono'>{user?.quota?.toLocaleString() ?? 0}</div>
            </div>
          </div>
        </div>

        {isResetWindowPlan && quotaPlan && (
          <div className='mt-20px rounded-10px bg-[var(--color-fill-1)] p-14px border border-[var(--border-2)]'>
            <div className='flex items-center justify-between gap-12px mb-8px'>
              <span className='text-11px font-600 text-t-secondary'>
                {t('settings.accountPanel.resetWindowPlan')}
              </span>
              <span className='text-12px font-600 text-t-secondary font-mono'>
                {quotaPlan.used} / {quotaPlan.total} 次
              </span>
            </div>
            <Progress
              percent={quotaPlan.progress}
              showText={false}
              color='var(--color-text-1)'
              className='h-4px rounded-full overflow-hidden'
            />
            <div className='mt-10px flex flex-wrap gap-x-16px gap-y-6px text-11px text-t-tertiary'>
              <div>
                {t('settings.accountPanel.resetAfter')}: <span className='font-600 text-t-secondary'>{formatDuration(quotaPlan.secondsUntilReset)}</span>
              </div>
              <div>
                {t('settings.accountPanel.validUntil')}: <span className='font-600 text-t-secondary'>{formatDateTime(quotaPlan.expiresAt)}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Cloud history */}
      <div className='rounded-12px bg-2 p-16px border border-[var(--border-2)] flex items-center justify-between gap-16px shadow-sm'>
        <div className='flex-1 min-w-0'>
          <h3 className='text-14px font-600 text-t-primary m-0 mb-4px'>{t('settings.accountPanel.cloudHistory')}</h3>
          <p className='text-12px text-t-tertiary leading-relaxed m-0'>同步会话历史，便于跨设备管理和数据恢复</p>
          <div className='flex flex-wrap gap-8px mt-12px'>
            <Button
              size='small'
              type='secondary'
              loading={syncingCloudHistory}
              disabled={!cloudHistoryEnabled}
              onClick={() => {
                void handleSyncCloudHistoryNow();
              }}
              className='rounded-6px text-12px font-500'
            >
              立即同步
            </Button>
            <Button size='small' type='text' onClick={() => setRestoreModalVisible(true)} className='rounded-6px text-12px font-500 text-t-secondary hover:text-t-primary'>
              从云端恢复会话
            </Button>
          </div>
        </div>
        <div>
          <Switch checked={cloudHistoryEnabled} loading={savingCloudHistory} onChange={handleCloudHistoryChange} size='small' />
        </div>
      </div>

      {/* Recharge Center */}
      <div className='flex flex-col gap-12px'>
        <div className='flex items-center justify-between border-b border-[var(--border-2)] pb-8px'>
          <h3 className='text-14px font-600 text-t-primary m-0'>{t('settings.accountPanel.recharge')}</h3>
          <Button
            type='text'
            size='small'
            icon={<Key theme='outline' size='14' />}
            onClick={() => setShowCardInput(!showCardInput)}
            className='text-12px text-t-secondary hover:text-t-primary p-0 h-auto'
          >
            {showCardInput ? '返回购买' : '使用卡密激活'}
          </Button>
        </div>

        {showCardInput ? (
          /* Card Activation overlay card */
          <div className='rounded-12px bg-2 p-24px border border-[var(--border-2)] shadow-sm animate-fade-in'>
            <div className='max-w-440px mx-auto py-12px'>
              <h4 className='text-14px font-600 text-t-primary mb-6px mt-0'>
                激活卡密 (Redeem Card)
              </h4>
              <p className='text-11px text-t-tertiary mb-16px leading-relaxed'>
                请输入您获取的激活卡密，兑换成功后算力额度将立即累加至您的账户。
              </p>
              <div className='flex gap-10px mb-12px'>
                <Input
                  placeholder='AION-XXXX-XXXX'
                  value={code}
                  onChange={setCode}
                  className='flex-1 h-38px rounded-8px border-[var(--border-2)]'
                />
                <Button
                  type='primary'
                  loading={loading}
                  onClick={handleActivate}
                  className='h-38px px-20px rounded-8px font-600 text-12px border-0'
                  style={{
                    backgroundColor: 'var(--color-text-1)',
                    color: 'var(--color-bg-1)',
                  }}
                >
                  立即兑换
                </Button>
              </div>
              <div className='text-11px text-t-tertiary bg-[var(--color-fill-1)] p-10px rounded-8px border border-[var(--border-1)] flex gap-6px items-start'>
                <span className='inline-flex items-center justify-center size-14px rounded-full bg-fill-3 text-t-secondary font-bold text-9px shrink-0 mt-1px'>i</span>
                <span className='leading-relaxed'>说明：卡密激活为一次性兑换操作，激活后不可退换。如有疑问请联系管理员。</span>
              </div>
            </div>
          </div>
        ) : (
          /* Main pricing packages */
          <div className='rounded-12px bg-2 p-24px border border-[var(--border-2)] shadow-sm'>
            {/* Payment Method Selector at the top */}
            {allowedPaymentTypes.length > 0 && (
              <div className='flex items-center justify-between gap-12px pb-16px mb-20px border-b border-[var(--border-1)] text-12px'>
                <span className='font-600 text-t-primary'>选择支付渠道</span>
                <div className='flex gap-8px'>
                  {allowedPaymentTypes.map((type) => {
                    const isSelected = selectedPaymentType === type;
                    return (
                      <button
                        key={type}
                        type='button'
                        onClick={() => setSelectedPaymentType(type)}
                        className={`inline-flex items-center gap-6px px-16px py-5px rounded-8px text-12px font-600 transition-all duration-200 border ${
                          isSelected
                            ? 'bg-fill-3 border-[var(--color-text-1)] text-t-primary shadow-sm'
                            : 'bg-transparent border-[var(--border-2)] text-t-tertiary hover:text-t-secondary'
                        }`}
                      >
                        {isSelected && <span className='size-5px rounded-full' style={{ backgroundColor: 'var(--color-text-1)' }} />}
                        {getPaymentTypeLabel(type)}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {rechargeLoading ? (
              <div className='py-48px flex items-center justify-center'>
                <Spin size={20} />
              </div>
            ) : rechargeProducts.length === 0 ? (
              <div className='py-48px text-center text-12px text-t-tertiary'>
                暂无充值商品上架
              </div>
            ) : (
              <div className='grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-16px mb-20px'>
                {rechargeProducts.map((product) => {
                  const isPopular = product.badge === '推荐' || product.badge === 'Popular';
                  return (
                    <div
                      key={product.id}
                      className={`relative rounded-12px bg-2 p-20px border transition-all duration-200 flex flex-col justify-between hover:border-[var(--border-3)] hover:shadow-md ${
                        isPopular ? 'border-[var(--color-text-1)]' : 'border-[var(--border-2)]'
                      }`}
                    >
                      {isPopular && (
                        <span className='absolute -top-10px left-16px text-10px px-8px py-2px rounded bg-black text-white dark:bg-white dark:text-black font-bold tracking-wider'>
                          {product.badge || 'RECOMMENDED'}
                        </span>
                      )}

                      <div className='mb-20px'>
                        {/* Package Header Name */}
                        <div className='text-11px font-655 text-t-tertiary mb-16px uppercase tracking-wider'>
                          {product.name}
                        </div>

                        {/* Split Metric Display - Quota Left & Price Right */}
                        <div className='flex items-center justify-between gap-12px mb-16px'>
                          <div className='flex flex-col'>
                            <span className='text-28px font-700 text-t-primary font-mono leading-none'>
                              {product.amount?.toLocaleString()}
                            </span>
                            <span className='text-11px text-t-tertiary mt-6px font-medium'>可用额度</span>
                          </div>
                          <div className='flex flex-col items-end'>
                            <span className='text-20px font-700 text-t-primary font-mono leading-none'>
                              ¥{product.priceYuan}
                            </span>
                            <span className='text-11px text-t-tertiary mt-6px font-medium'>售价</span>
                          </div>
                        </div>

                        {/* Package description & Reload Mode in one line */}
                        <div className='text-11px text-t-tertiary flex items-center justify-between border-t border-[var(--border-1)] pt-10px mb-4px'>
                          <span>{product.description || '充值包'}</span>
                          <span>{getProductPlanLabel(product)}</span>
                        </div>
                      </div>

                      <Button
                        type={isPopular ? 'primary' : 'secondary'}
                        loading={creatingOrderProductId === product.id}
                        onClick={() => void handlePurchase(product)}
                        className='w-full h-34px rounded-8px font-600 text-12px mt-4px'
                        style={{
                          backgroundColor: isPopular ? 'var(--color-text-1)' : undefined,
                          borderColor: isPopular ? 'var(--color-text-1)' : undefined,
                          color: isPopular ? 'var(--color-bg-1)' : undefined,
                        }}
                      >
                        立即购买
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {currentOrder && (
          <div className='mt-14px rounded-10px bg-amber-500/5 p-14px border border-amber-500/20 shadow-sm animate-fade-in'>
            <div className='flex flex-wrap items-center justify-between gap-12px mb-10px'>
              <div>
                <div className='text-13px font-700 text-t-primary flex items-center gap-6px'>
                  <span className='size-6px rounded-full bg-amber-500 animate-pulse' />
                  {t('settings.accountPanel.orderPendingTitle')}
                </div>
                <div className='text-11px text-t-tertiary mt-4px font-mono'>
                  {t('settings.accountPanel.orderNo')}: {currentOrder.orderNo}
                </div>
              </div>
              <span className={`text-10px px-6px py-2px rounded font-700 border ${
                currentOrder.status === 'PAID'
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                  : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'
              }`}>
                {currentOrder.status === 'PAID'
                  ? t('settings.accountPanel.orderStatusPaid')
                  : t('settings.accountPanel.orderStatusPending')}
              </span>
            </div>
            <div className='text-12px text-t-secondary mb-10px font-medium'>
              {t('settings.accountPanel.orderAmount')}: <span className='text-13px font-700 text-t-primary'>¥{currentOrder.amountYuan}</span>
            </div>
            <div className='flex flex-wrap gap-8px'>
              <Button
                size='small'
                loading={checkingOrder}
                onClick={() => {
                  void handleCheckPayment();
                }}
                className='rounded-6px text-11px font-600'
              >
                {checkingOrder ? t('settings.accountPanel.checkingPayment') : t('settings.accountPanel.checkPayment')}
              </Button>
              {currentPaymentUrl && currentOrder.status !== 'PAID' && (
                <Button
                  size='small'
                  type='primary'
                  onClick={() => {
                    void handleContinuePayment();
                  }}
                  className='rounded-6px border-0 text-11px font-600'
                  style={{
                    backgroundColor: 'var(--color-text-1)',
                    color: 'var(--color-bg-1)'
                  }}
                >
                  {t('settings.accountPanel.continuePayment')}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AccountModalContent;
