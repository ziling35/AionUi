import { useEffect, useState } from 'react';
import type { TableColumnsType } from 'antd';
import { Button, Card, Descriptions, Empty, Image, Modal, Select, Space, Table, Tag, Typography, message } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import axios from 'axios';

type FeedbackStatus = 'NEW' | 'READ' | 'RESOLVED' | 'IGNORED';
type FeedbackStatusFilter = FeedbackStatus | 'ALL';

type FeedbackAttachment = {
  filename: string;
  contentType: string;
  size: number;
  dataBase64?: string;
};

type FeedbackReport = {
  id: string;
  module: string;
  moduleLabel: string;
  description: string;
  status: FeedbackStatus;
  tags: Record<string, string> | null;
  extra: Record<string, unknown> | null;
  attachments: FeedbackAttachment[];
  attachmentCount: number;
  appVersion: string | null;
  platform: string | null;
  userAgent: string | null;
  createdAt: string;
  updatedAt: string;
};

const STATUS_OPTIONS: Array<{ label: string; value: FeedbackStatusFilter }> = [
  { label: '全部', value: 'ALL' },
  { label: '未读', value: 'NEW' },
  { label: '已读', value: 'READ' },
  { label: '已解决', value: 'RESOLVED' },
  { label: '忽略', value: 'IGNORED' },
];

const STATUS_LABEL: Record<FeedbackStatus, string> = {
  NEW: '未读',
  READ: '已读',
  RESOLVED: '已解决',
  IGNORED: '忽略',
};

const STATUS_COLOR: Record<FeedbackStatus, string> = {
  NEW: 'red',
  READ: 'blue',
  RESOLVED: 'green',
  IGNORED: 'default',
};

type FeedbackListResponse = {
  success: boolean;
  reports?: FeedbackReport[];
};

type FeedbackDetailResponse = {
  success: boolean;
  report?: FeedbackReport;
};

function formatSize(size: number) {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${size} B`;
}

function downloadAttachment(attachment: FeedbackAttachment) {
  if (!attachment.dataBase64) return;
  const bytes = Uint8Array.from(atob(attachment.dataBase64), (char) => char.charCodeAt(0));
  const blob = new Blob([bytes], { type: attachment.contentType || 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = attachment.filename;
  link.click();
  URL.revokeObjectURL(url);
}

function renderStatus(status: FeedbackStatus) {
  return <Tag color={STATUS_COLOR[status]}>{STATUS_LABEL[status]}</Tag>;
}

export default function FeedbackReports() {
  const [reports, setReports] = useState<FeedbackReport[]>([]);
  const [selectedStatus, setSelectedStatus] = useState<FeedbackStatusFilter>('ALL');
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<FeedbackReport | null>(null);

  const fetchReports = async () => {
    setLoading(true);
    try {
      const res = await axios.get<FeedbackListResponse>('/api/feedback/reports', {
        params: { status: selectedStatus, limit: 200 },
      });
      if (res.data.success) setReports(res.data.reports ?? []);
    } catch {
      message.error('无法获取反馈列表');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchReports();
  }, [selectedStatus]);

  const updateStatus = async (id: string, status: FeedbackStatus, showMessage = true) => {
    try {
      const res = await axios.patch<FeedbackDetailResponse>(`/api/feedback/reports/${id}`, { status });
      if (res.data.success) {
        setReports((current) => current.map((item) => (item.id === id ? { ...item, status } : item)));
        setDetail((current) => (current?.id === id ? { ...current, status } : current));
        if (showMessage) message.success('状态已更新');
      }
    } catch {
      message.error('状态更新失败');
    }
  };

  const openDetail = async (report: FeedbackReport) => {
    setDetailLoading(true);
    try {
      const res = await axios.get<FeedbackDetailResponse>(`/api/feedback/reports/${report.id}`);
      if (res.data.success && res.data.report) {
        setDetail(res.data.report);
        if (report.status === 'NEW') {
          await updateStatus(report.id, 'READ', false);
        }
      }
    } catch {
      message.error('无法获取反馈详情');
    } finally {
      setDetailLoading(false);
    }
  };

  const columns: TableColumnsType<FeedbackReport> = [
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (value: FeedbackStatus) => renderStatus(value),
    },
    {
      title: '模块',
      dataIndex: 'moduleLabel',
      width: 160,
      render: (value: string, record) => value || record.module,
    },
    {
      title: '描述',
      dataIndex: 'description',
      render: (value: string) => (
        <Typography.Text ellipsis style={{ maxWidth: 420 }}>
          {value}
        </Typography.Text>
      ),
    },
    {
      title: '附件',
      dataIndex: 'attachmentCount',
      width: 80,
      render: (value: number) => value || '-',
    },
    {
      title: '提交时间',
      dataIndex: 'createdAt',
      width: 190,
      render: (value: string) => new Date(value).toLocaleString(),
    },
    {
      title: '操作',
      width: 170,
      render: (_, record) => (
        <Space>
          <Button size='small' onClick={() => void openDetail(record)}>
            查看
          </Button>
          <Select<FeedbackStatus>
            size='small'
            value={record.status}
            style={{ width: 96 }}
            onChange={(value) => void updateStatus(record.id, value)}
            options={STATUS_OPTIONS.filter((item) => item.value !== 'ALL') as Array<{
              label: string;
              value: FeedbackStatus;
            }>}
          />
        </Space>
      ),
    },
  ];

  return (
    <div className='animate-fade-in'>
      <div className='page-header' style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 className='page-title'>问题反馈</h1>
          <p className='page-subtitle'>查看客户端提交的问题反馈、截图和诊断日志。</p>
        </div>
        <Space>
          <Select<FeedbackStatusFilter>
            value={selectedStatus}
            onChange={setSelectedStatus}
            options={STATUS_OPTIONS}
            style={{ width: 120 }}
          />
          <Button icon={<ReloadOutlined />} onClick={() => void fetchReports()}>
            刷新
          </Button>
        </Space>
      </div>

      <Card bordered={false} styles={{ body: { padding: 0 } }}>
        <Table
          dataSource={reports}
          rowKey='id'
          loading={loading}
          pagination={{ pageSize: 10 }}
          style={{ padding: '24px' }}
          columns={columns}
        />
      </Card>

      <Modal
        title='反馈详情'
        open={!!detail}
        onCancel={() => setDetail(null)}
        footer={null}
        width={820}
        confirmLoading={detailLoading}
      >
        {detail ? (
          <Space direction='vertical' size='middle' style={{ width: '100%' }}>
            <Descriptions bordered size='small' column={2}>
              <Descriptions.Item label='状态'>{renderStatus(detail.status)}</Descriptions.Item>
              <Descriptions.Item label='模块'>{detail.moduleLabel || detail.module}</Descriptions.Item>
              <Descriptions.Item label='提交时间'>{new Date(detail.createdAt).toLocaleString()}</Descriptions.Item>
              <Descriptions.Item label='平台'>{detail.platform || '-'}</Descriptions.Item>
              <Descriptions.Item label='版本'>{detail.appVersion || '-'}</Descriptions.Item>
              <Descriptions.Item label='附件'>{detail.attachmentCount}</Descriptions.Item>
            </Descriptions>

            <div>
              <Typography.Title level={5}>问题描述</Typography.Title>
              <Typography.Paragraph copyable style={{ whiteSpace: 'pre-wrap' }}>
                {detail.description}
              </Typography.Paragraph>
            </div>

            <div>
              <Typography.Title level={5}>附件</Typography.Title>
              {detail.attachments.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='暂无附件' />
              ) : (
                <Space direction='vertical' style={{ width: '100%' }}>
                  {detail.attachments.map((attachment) => (
                    <Card key={`${attachment.filename}-${attachment.size}`} size='small'>
                      <Space direction='vertical' style={{ width: '100%' }}>
                        <Space style={{ justifyContent: 'space-between', width: '100%' }}>
                          <Typography.Text strong>{attachment.filename}</Typography.Text>
                          <Space>
                            <Typography.Text type='secondary'>{formatSize(attachment.size)}</Typography.Text>
                            {attachment.dataBase64 && (
                              <Button size='small' onClick={() => downloadAttachment(attachment)}>
                                下载
                              </Button>
                            )}
                          </Space>
                        </Space>
                        {attachment.dataBase64 && attachment.contentType.startsWith('image/') && (
                          <Image
                            src={`data:${attachment.contentType};base64,${attachment.dataBase64}`}
                            style={{ maxHeight: 280, objectFit: 'contain' }}
                          />
                        )}
                      </Space>
                    </Card>
                  ))}
                </Space>
              )}
            </div>

            <div>
              <Typography.Title level={5}>上下文</Typography.Title>
              <Typography.Paragraph copyable style={{ whiteSpace: 'pre-wrap' }}>
                {JSON.stringify({ tags: detail.tags, extra: detail.extra, userAgent: detail.userAgent }, null, 2)}
              </Typography.Paragraph>
            </div>
          </Space>
        ) : null}
      </Modal>
    </div>
  );
}
