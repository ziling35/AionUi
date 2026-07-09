import { useState, useEffect } from 'react';
import { Table, Button, Space, message, InputNumber, Card, Tag, Select, Modal, Form } from 'antd';
import { PlusOutlined, DownloadOutlined, FilterOutlined } from '@ant-design/icons';
import axios from 'axios';

export default function CardSecrets() {
  const [loading, setLoading] = useState(false);
  const [cards, setCards] = useState<any[]>([]);
  const [filterStatus, setFilterStatus] = useState('ALL');

  const [isModalVisible, setIsModalVisible] = useState(false);
  const [form] = Form.useForm();

  const fetchCards = async () => {
    setLoading(true);
    try {
      const res = await axios.get('/api/cards');
      if (res.data.success) {
        setCards(res.data.cards);
      }
    } catch (e) {
      message.error('无法获取卡密列表');
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchCards();
  }, []);

  const handleGenerate = async (values: any) => {
    setLoading(true);
    try {
      const res = await axios.post('/api/cards/generate', {
        count: values.count,
        amount: values.amount,
        planType: values.planType || 'balance',
        windowHours: values.windowHours,
        validDays: values.validDays,
      });
      if (res.data.success) {
        message.success(`成功生成 ${values.count} 张卡密！`);
        setIsModalVisible(false);
        form.resetFields();
        fetchCards();
      }
    } catch (e) {
      message.error('生成卡密失败');
    }
    setLoading(false);
  };

  const filteredCards = cards.filter((c) => filterStatus === 'ALL' || c.status === filterStatus);

  return (
    <div className='animate-fade-in'>
      <div className='page-header' style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 className='page-title'>卡密管理</h1>
          <p className='page-subtitle'>批量生成卡密供用户兑换算力额度。</p>
        </div>
        <Space>
          <Button icon={<DownloadOutlined />}>导出 CSV</Button>
          <Button type='primary' icon={<PlusOutlined />} onClick={() => setIsModalVisible(true)}>
            生成卡密
          </Button>
        </Space>
      </div>

      <Card bordered={false} bodyStyle={{ padding: 0 }}>
        <div
          style={{
            padding: '20px 24px',
            borderBottom: '1px solid var(--border-color)',
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'center',
          }}
        >
          <Space>
            <FilterOutlined style={{ color: 'var(--text-muted)' }} />
            <Select value={filterStatus} onChange={setFilterStatus} style={{ width: 120 }} bordered={false}>
              <Select.Option value='ALL'>全部状态</Select.Option>
              <Select.Option value='UNUSED'>未使用</Select.Option>
              <Select.Option value='USED'>已使用</Select.Option>
            </Select>
          </Space>
        </div>

        <Table
          dataSource={filteredCards}
          rowKey='id'
          loading={loading}
          pagination={{ pageSize: 10 }}
          style={{ padding: '0 24px 24px' }}
          columns={[
            {
              title: '卡密串码',
              dataIndex: 'code',
              key: 'code',
              render: (text) => (
                <code
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 13,
                    padding: '2px 6px',
                    background: 'var(--bg-secondary)',
                    borderRadius: 4,
                    border: '1px solid var(--border-color)',
                  }}
                >
                  {text}
                </code>
              ),
            },
            {
              title: '包含额度',
              dataIndex: 'amount',
              key: 'amount',
              render: (val) => <span style={{ fontWeight: 600 }}>{val}</span>,
            },
            {
              title: '套餐类型',
              dataIndex: 'planType',
              key: 'planType',
              render: (val, record) =>
                val === 'reset_window' ? (
                  <Tag color='processing'>
                    {record.windowHours || 4} 小时重置 / {record.validDays || 30} 天
                  </Tag>
                ) : (
                  <Tag>余额充值</Tag>
                ),
            },
            {
              title: '状态',
              dataIndex: 'status',
              key: 'status',
              render: (val) => (
                <Tag
                  color={val === 'UNUSED' ? 'success' : 'default'}
                  style={{
                    border: 'none',
                    background: val === 'UNUSED' ? '#dcfce7' : '#f3f4f6',
                    color: val === 'UNUSED' ? '#166534' : '#374151',
                  }}
                >
                  {val === 'UNUSED' ? '未使用' : '已使用'}
                </Tag>
              ),
            },
            {
              title: '创建时间',
              dataIndex: 'createdAt',
              key: 'createdAt',
              render: (val) => <span style={{ color: 'var(--text-secondary)' }}>{new Date(val).toLocaleString()}</span>,
            },
          ]}
        />
      </Card>

      <Modal
        title='批量生成卡密'
        open={isModalVisible}
        onOk={() => form.submit()}
        onCancel={() => {
          setIsModalVisible(false);
          form.resetFields();
        }}
        okText='立即生成'
        cancelText='取消'
        confirmLoading={loading}
      >
        <Form
          form={form}
          layout='vertical'
          onFinish={handleGenerate}
          initialValues={{ count: 10, amount: 100, planType: 'balance', windowHours: 4, validDays: 30 }}
        >
          <Form.Item name='count' label='生成数量' rules={[{ required: true, message: '请输入生成数量' }]}>
            <InputNumber min={1} max={100} style={{ width: '100%' }} placeholder='请输入需要生成的卡密数量 (1-100)' />
          </Form.Item>
          <Form.Item name='amount' label='每张包含算力额度' rules={[{ required: true, message: '请输入额度' }]}>
            <InputNumber min={1} style={{ width: '100%' }} placeholder='请输入每张卡密可兑换的额度' />
          </Form.Item>
          <Form.Item name='planType' label='套餐类型'>
            <Select>
              <Select.Option value='balance'>余额充值</Select.Option>
              <Select.Option value='reset_window'>几小时重置套餐</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name='windowHours' label='每隔几小时重置'>
            <InputNumber min={1} max={168} style={{ width: '100%' }} placeholder='例如：4 表示每 4 小时恢复额度' />
          </Form.Item>
          <Form.Item name='validDays' label='有效天数'>
            <InputNumber min={1} max={3650} style={{ width: '100%' }} placeholder='例如：30 表示有效期 30 天' />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
