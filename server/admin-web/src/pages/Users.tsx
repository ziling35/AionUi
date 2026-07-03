import { Table, Card, Input, Button, Space, Tag, Dropdown, Menu, Modal, Form, message } from 'antd';
import { SearchOutlined, UserAddOutlined, MoreOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';

export default function Users() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [form] = Form.useForm();

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const res = await fetch('http://localhost:3000/api/users');
      const data = await res.json();
      if (data.success) {
        setUsers(data.users);
      }
    } catch (e) {
      message.error('无法获取用户列表，请检查网关服务');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleAddUser = async (values: any) => {
    try {
      const res = await fetch('http://localhost:3000/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: values.username, password: values.password }),
      });
      const data = await res.json();
      if (data.success) {
        message.success('用户添加成功');
        setIsModalVisible(false);
        form.resetFields();
        fetchUsers();
      } else {
        message.error(data.error || '添加失败');
      }
    } catch (e) {
      message.error('网络错误');
    }
  };

  return (
    <div className='animate-fade-in'>
      <div className='page-header' style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 className='page-title'>用户管理</h1>
          <p className='page-subtitle'>管理客户账号并监控算力额度使用情况。</p>
        </div>
        <Space>
          <Input
            placeholder='通过 ID 或 用户名 搜索...'
            prefix={<SearchOutlined style={{ color: 'var(--text-muted)' }} />}
            style={{ width: 280 }}
          />
          <Button type='primary' icon={<UserAddOutlined />} onClick={() => setIsModalVisible(true)}>
            添加用户
          </Button>
        </Space>
      </div>

      <Card bordered={false} bodyStyle={{ padding: 0 }}>
        <Table
          dataSource={users}
          rowKey='id'
          loading={loading}
          style={{ padding: '24px' }}
          pagination={{ pageSize: 10 }}
          columns={[
            {
              title: '设备 ID (Token)',
              dataIndex: 'deviceId',
              key: 'deviceId',
              render: (text) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>{text}</span>,
            },
            { title: '用户名', dataIndex: 'username', key: 'username' },
            {
              title: '状态',
              key: 'status',
              render: () => (
                <Tag color='success' style={{ border: 'none', background: '#dcfce7', color: '#166534' }}>
                  正常
                </Tag>
              ),
            },
            {
              title: '剩余额度',
              dataIndex: 'quota',
              key: 'quota',
              render: (val) => <strong style={{ color: 'var(--text-primary)' }}>{val}</strong>,
            },
            {
              title: '注册时间',
              dataIndex: 'createdAt',
              key: 'createdAt',
              render: (val) => <span style={{ color: 'var(--text-secondary)' }}>{new Date(val).toLocaleString()}</span>,
            },
            {
              title: '操作',
              key: 'actions',
              width: 64,
              render: () => (
                <Dropdown
                  menu={{
                    items: [
                      { key: '1', label: '查看详情' },
                      { key: '2', label: '调整额度' },
                      { type: 'divider' },
                      { key: '3', label: '封禁账号', danger: true },
                    ],
                    onClick: ({ key }) => {
                      if (key === '1') message.info('查看详情：功能开发中...');
                      else if (key === '2') message.info('调整额度：功能开发中...');
                      else if (key === '3') message.warning('封禁账号：功能开发中...');
                    },
                  }}
                  trigger={['click']}
                  placement='bottomRight'
                >
                  <Button type='text' icon={<MoreOutlined />} />
                </Dropdown>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        title='添加新用户'
        open={isModalVisible}
        onOk={() => form.submit()}
        onCancel={() => {
          setIsModalVisible(false);
          form.resetFields();
        }}
        okText='确认添加'
        cancelText='取消'
      >
        <Form form={form} layout='vertical' onFinish={handleAddUser}>
          <Form.Item name='username' label='用户名' rules={[{ required: true, message: '请输入用户名' }]}>
            <Input placeholder='请输入字母或数字组合的用户名' />
          </Form.Item>
          <Form.Item name='password' label='密码' rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password placeholder='请输入初始密码' />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
