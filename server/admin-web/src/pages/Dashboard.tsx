import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Col, Empty, Progress, Row, Space, Spin, Statistic, Table, Tag, message } from 'antd';
import {
  AppstoreOutlined,
  KeyOutlined,
  ReloadOutlined,
  RocketOutlined,
  ThunderboltOutlined,
  UserOutlined,
} from '@ant-design/icons';
import axios from 'axios';

const API_BASE = '/api';

type DashboardOverview = {
  generatedAt: string;
  users: {
    total: number;
    newToday: number;
    paying: number;
  };
  quota: {
    remaining: number;
    used: number;
    allocated: number;
    issuedByCards: number;
    activatedByCards: number;
    burnRate: number;
  };
  cards: {
    total: number;
    unused: number;
    used: number;
    activationRate: number;
  };
  providers: {
    total: number;
    enabled: number;
  };
  models: {
    total: number;
    active: number;
    byType: { type: string; count: number }[];
  };
  releases: {
    total: number;
    enabled: number;
    forceEnabled: number;
  };
  recent: {
    users: RecentUser[];
    cardActivations: CardActivation[];
    releases: RecentRelease[];
  };
};

type RecentUser = {
  id: string;
  username?: string | null;
  email?: string | null;
  quota: number;
  usedQuota: number;
  createdAt: string;
};

type CardActivation = {
  id: string;
  code: string;
  amount: number;
  usedAt?: string | null;
  user?: {
    id: string;
    username?: string | null;
    email?: string | null;
  } | null;
};

type RecentRelease = {
  id: string;
  version: string;
  platform: string;
  arch: string;
  enabled: boolean;
  forceUpdate: boolean;
  releaseDate: string;
};

const emptyOverview: DashboardOverview = {
  generatedAt: '',
  users: { total: 0, newToday: 0, paying: 0 },
  quota: { remaining: 0, used: 0, allocated: 0, issuedByCards: 0, activatedByCards: 0, burnRate: 0 },
  cards: { total: 0, unused: 0, used: 0, activationRate: 0 },
  providers: { total: 0, enabled: 0 },
  models: { total: 0, active: 0, byType: [] },
  releases: { total: 0, enabled: 0, forceEnabled: 0 },
  recent: { users: [], cardActivations: [], releases: [] },
};

const formatNumber = (value: number) => new Intl.NumberFormat('zh-CN').format(value || 0);

const formatPercent = (value: number) => Math.round((value || 0) * 100);

const formatTime = (value?: string | null) => (value ? new Date(value).toLocaleString('zh-CN') : '-');

const displayUser = (user?: { username?: string | null; email?: string | null; id?: string } | null) =>
  user?.username || user?.email || user?.id || '未知用户';

export default function Dashboard() {
  const [overview, setOverview] = useState<DashboardOverview>(emptyOverview);
  const [loading, setLoading] = useState(false);

  const fetchOverview = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API_BASE}/dashboard/overview`);
      if (res.data.success && res.data.overview) {
        setOverview(res.data.overview);
      } else {
        message.error(res.data.error || '获取概览数据失败');
      }
    } catch (error: any) {
      message.error(error.response?.data?.error || '获取概览数据失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchOverview();
  }, []);

  const quotaUsagePercent = useMemo(() => formatPercent(overview.quota.burnRate), [overview.quota.burnRate]);
  const cardActivationPercent = useMemo(
    () => formatPercent(overview.cards.activationRate),
    [overview.cards.activationRate]
  );
  const enabledProviderPercent = useMemo(
    () => (overview.providers.total > 0 ? Math.round((overview.providers.enabled / overview.providers.total) * 100) : 0),
    [overview.providers.enabled, overview.providers.total]
  );
  const activeModelPercent = useMemo(
    () => (overview.models.total > 0 ? Math.round((overview.models.active / overview.models.total) * 100) : 0),
    [overview.models.active, overview.models.total]
  );

  return (
    <div className='animate-fade-in'>
      <div className='page-header' style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 className='page-title'>概览大盘</h1>
          <p className='page-subtitle'>
            当前数据全部来自 admin-api 数据库聚合，更新时间：{overview.generatedAt ? formatTime(overview.generatedAt) : '-'}
          </p>
        </div>
        <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void fetchOverview()}>
          刷新
        </Button>
      </div>

      <Alert
        type='info'
        showIcon
        style={{ marginBottom: 16 }}
        message='说明：当前系统还没有请求日志表，额度消耗按用户累计 usedQuota 统计；按日调用量、模型调用排行需要后续增加请求流水表。'
      />

      <Spin spinning={loading}>
        <Row gutter={[16, 16]}>
          <Col xs={24} sm={12} xl={6}>
            <Card bordered={false}>
              <Statistic
                title='总用户数'
                value={overview.users.total}
                prefix={<UserOutlined style={{ color: '#1677ff', marginRight: 8 }} />}
              />
              <div style={{ marginTop: 8, color: 'var(--text-secondary)' }}>
                今日新增 {formatNumber(overview.users.newToday)}，付费用户 {formatNumber(overview.users.paying)}
              </div>
            </Card>
          </Col>
          <Col xs={24} sm={12} xl={6}>
            <Card bordered={false}>
              <Statistic
                title='卡密总数'
                value={overview.cards.total}
                prefix={<KeyOutlined style={{ color: '#722ed1', marginRight: 8 }} />}
              />
              <div style={{ marginTop: 8, color: 'var(--text-secondary)' }}>
                已激活 {formatNumber(overview.cards.used)}，未使用 {formatNumber(overview.cards.unused)}
              </div>
            </Card>
          </Col>
          <Col xs={24} sm={12} xl={6}>
            <Card bordered={false}>
              <Statistic
                title='剩余额度'
                value={overview.quota.remaining}
                prefix={<ThunderboltOutlined style={{ color: '#faad14', marginRight: 8 }} />}
              />
              <div style={{ marginTop: 8, color: 'var(--text-secondary)' }}>
                已消耗 {formatNumber(overview.quota.used)}，已激活 {formatNumber(overview.quota.activatedByCards)}
              </div>
            </Card>
          </Col>
          <Col xs={24} sm={12} xl={6}>
            <Card bordered={false}>
              <Statistic
                title='可用模型'
                value={overview.models.active}
                prefix={<AppstoreOutlined style={{ color: '#52c41a', marginRight: 8 }} />}
              />
              <div style={{ marginTop: 8, color: 'var(--text-secondary)' }}>
                总模型 {formatNumber(overview.models.total)}，启用供应商 {formatNumber(overview.providers.enabled)}
              </div>
            </Card>
          </Col>
        </Row>

        <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
          <Col xs={24} lg={8}>
            <Card bordered={false} title='额度消耗'>
              <Progress percent={quotaUsagePercent} status={quotaUsagePercent >= 90 ? 'exception' : 'active'} />
              <Space direction='vertical' size={8} style={{ width: '100%', marginTop: 16 }}>
                <MetricLine label='累计分配额度' value={overview.quota.allocated} />
                <MetricLine label='卡密发行额度' value={overview.quota.issuedByCards} />
                <MetricLine label='卡密激活额度' value={overview.quota.activatedByCards} />
              </Space>
            </Card>
          </Col>
          <Col xs={24} lg={8}>
            <Card bordered={false} title='商业转化'>
              <Progress percent={cardActivationPercent} strokeColor='#722ed1' />
              <Space direction='vertical' size={8} style={{ width: '100%', marginTop: 16 }}>
                <MetricLine label='卡密激活率' value={`${cardActivationPercent}%`} />
                <MetricLine label='付费用户数' value={overview.users.paying} />
                <MetricLine label='已激活卡密数' value={overview.cards.used} />
              </Space>
            </Card>
          </Col>
          <Col xs={24} lg={8}>
            <Card bordered={false} title='系统配置'>
              <Space direction='vertical' size={12} style={{ width: '100%' }}>
                <MetricProgress label='供应商启用率' percent={enabledProviderPercent} />
                <MetricProgress label='模型启用率' percent={activeModelPercent} color='#52c41a' />
                <MetricLine label='启用版本' value={`${overview.releases.enabled} / ${overview.releases.total}`} />
                <MetricLine label='强制更新版本' value={overview.releases.forceEnabled} />
              </Space>
            </Card>
          </Col>
        </Row>

        <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
          <Col xs={24} lg={10}>
            <Card bordered={false} title='模型类型分布'>
              {overview.models.byType.length > 0 ? (
                <Space direction='vertical' size={12} style={{ width: '100%' }}>
                  {overview.models.byType.map((item) => {
                    const percent =
                      overview.models.total > 0 ? Math.round((item.count / overview.models.total) * 100) : 0;
                    return (
                      <div key={item.type}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                          <Tag>{item.type}</Tag>
                          <span>{formatNumber(item.count)} 个</span>
                        </div>
                        <Progress percent={percent} showInfo={false} />
                      </div>
                    );
                  })}
                </Space>
              ) : (
                <Empty description='暂无模型数据' />
              )}
            </Card>
          </Col>
          <Col xs={24} lg={14}>
            <Card bordered={false} title='最近注册用户'>
              <Table
                size='small'
                rowKey='id'
                pagination={false}
                dataSource={overview.recent.users}
                columns={[
                  { title: '用户', render: (_, record) => displayUser(record) },
                  { title: '剩余额度', dataIndex: 'quota', render: (value) => formatNumber(value) },
                  { title: '已用额度', dataIndex: 'usedQuota', render: (value) => formatNumber(value) },
                  { title: '注册时间', dataIndex: 'createdAt', render: formatTime },
                ]}
              />
            </Card>
          </Col>
        </Row>

        <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
          <Col xs={24} lg={14}>
            <Card bordered={false} title='最近卡密激活'>
              <Table
                size='small'
                rowKey='id'
                pagination={false}
                dataSource={overview.recent.cardActivations}
                columns={[
                  { title: '卡密', dataIndex: 'code', ellipsis: true },
                  { title: '额度', dataIndex: 'amount', render: (value) => formatNumber(value) },
                  { title: '用户', render: (_, record) => displayUser(record.user) },
                  { title: '激活时间', dataIndex: 'usedAt', render: formatTime },
                ]}
              />
            </Card>
          </Col>
          <Col xs={24} lg={10}>
            <Card bordered={false} title='最近版本发布' extra={<RocketOutlined />}>
              <Table
                size='small'
                rowKey='id'
                pagination={false}
                dataSource={overview.recent.releases}
                columns={[
                  { title: '版本', dataIndex: 'version', render: (value) => <strong>{value}</strong> },
                  {
                    title: '平台',
                    render: (_, record) => (
                      <Space size={4}>
                        <Tag>{record.platform}</Tag>
                        <Tag>{record.arch}</Tag>
                      </Space>
                    ),
                  },
                  {
                    title: '策略',
                    render: (_, record) => (
                      <Tag color={record.forceUpdate ? 'error' : record.enabled ? 'success' : 'default'}>
                        {record.forceUpdate ? '强制' : record.enabled ? '启用' : '停用'}
                      </Tag>
                    ),
                  },
                ]}
              />
            </Card>
          </Col>
        </Row>
      </Spin>
    </div>
  );
}

function MetricLine({ label, value }: { label: string; value: number | string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <strong>{typeof value === 'number' ? formatNumber(value) : value}</strong>
    </div>
  );
}

function MetricProgress({ label, percent, color }: { label: string; percent: number; color?: string }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
        <strong>{percent}%</strong>
      </div>
      <Progress percent={percent} showInfo={false} strokeColor={color} />
    </div>
  );
}
