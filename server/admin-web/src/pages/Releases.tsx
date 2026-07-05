import { Button, Card, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Switch, Table, Tag, message } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import axios from 'axios';
import { useEffect, useState } from 'react';

type AppRelease = {
  id: string;
  version: string;
  channel: string;
  platform: string;
  arch: string;
  fileName: string;
  sha512: string;
  size?: number | null;
  releaseDate: string;
  releaseNotes?: string | null;
  forceUpdate: boolean;
  enabled: boolean;
};

const API_BASE = '/api';
const PLATFORM_OPTIONS = [{ label: 'Windows', value: 'win32' }, { label: 'macOS', value: 'darwin' }, { label: 'Linux', value: 'linux' }];
const ARCH_OPTIONS = [{ label: 'x64', value: 'x64' }, { label: 'arm64', value: 'arm64' }];

export default function Releases() {
  const [releases, setReleases] = useState<AppRelease[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<AppRelease | null>(null);
  const [form] = Form.useForm();

  const fetchReleases = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API_BASE}/releases`);
      if (res.data.success) setReleases(res.data.releases || []);
    } catch (error: any) {
      message.error(error.response?.data?.error || '获取版本列表失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchReleases();
  }, []);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ channel: 'latest', platform: 'win32', arch: 'x64', forceUpdate: false, enabled: true });
    setModalOpen(true);
  };

  const openEdit = (release: AppRelease) => {
    setEditing(release);
    form.setFieldsValue({ ...release, releaseDate: release.releaseDate?.slice(0, 19) });
    setModalOpen(true);
  };

  const submit = async (values: any) => {
    try {
      const payload = { ...values, size: values.size ? Number(values.size) : null };
      if (editing) {
        await axios.put(`${API_BASE}/releases/${editing.id}`, payload);
        message.success('版本已更新');
      } else {
        await axios.post(`${API_BASE}/releases`, payload);
        message.success('版本已创建');
      }
      setModalOpen(false);
      form.resetFields();
      await fetchReleases();
    } catch (error: any) {
      message.error(error.response?.data?.error || '保存失败');
    }
  };

  const remove = async (release: AppRelease) => {
    try {
      await axios.delete(`${API_BASE}/releases/${release.id}`);
      message.success('版本已删除');
      await fetchReleases();
    } catch (error: any) {
      message.error(error.response?.data?.error || '删除失败');
    }
  };

  return (
    <div className='animate-fade-in'>
      <div className='page-header' style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 className='page-title'>版本发布</h1>
          <p className='page-subtitle'>配置客户端自动更新检测版本、安装包文件名和 sha512 校验值。</p>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => void fetchReleases()}>刷新</Button>
          <Button type='primary' icon={<PlusOutlined />} onClick={openCreate}>新增版本</Button>
        </Space>
      </div>

      <Card bordered={false}>
        <Table
          dataSource={releases}
          rowKey='id'
          loading={loading}
          pagination={{ pageSize: 10 }}
          columns={[
            { title: '版本', dataIndex: 'version', render: (value) => <strong>{value}</strong> },
            {
              title: '平台',
              render: (_value, record) => (
                <Space>
                  <Tag>{record.platform}</Tag>
                  <Tag>{record.arch}</Tag>
                  <Tag>{record.channel}</Tag>
                </Space>
              ),
            },
            { title: '文件名', dataIndex: 'fileName', ellipsis: true },
            {
              title: '更新策略',
              dataIndex: 'forceUpdate',
              render: (forceUpdate) => (
                <Tag color={forceUpdate ? 'error' : 'processing'}>{forceUpdate ? '强制' : '可选'}</Tag>
              ),
            },
            { title: '状态', dataIndex: 'enabled', render: (enabled) => <Tag color={enabled ? 'success' : 'default'}>{enabled ? '启用' : '停用'}</Tag> },
            { title: '发布时间', dataIndex: 'releaseDate', render: (value) => new Date(value).toLocaleString() },
            {
              title: '操作',
              width: 120,
              render: (_value, record) => (
                <Space>
                  <Button size='small' type='text' icon={<EditOutlined />} onClick={() => openEdit(record)} />
                  <Popconfirm title='删除版本？' onConfirm={() => void remove(record)} okText='删除' cancelText='取消'>
                    <Button size='small' type='text' danger icon={<DeleteOutlined />} />
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Modal title={editing ? '编辑版本' : '新增版本'} open={modalOpen} onOk={() => form.submit()} onCancel={() => setModalOpen(false)} width={760} okText='保存' cancelText='取消'>
        <Form form={form} layout='vertical' onFinish={submit}>
          <Space style={{ width: '100%' }} size='large'>
            <Form.Item
              name='version'
              label='版本号'
              rules={[
                { required: true, message: '请输入版本号' },
                { pattern: /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/, message: '必须填写完整版本号，例如 2.2.0' },
              ]}
            >
              <Input placeholder='2.2.0' />
            </Form.Item>
            <Form.Item name='channel' label='通道' rules={[{ required: true }]}><Input placeholder='latest' /></Form.Item>
            <Form.Item name='platform' label='平台' rules={[{ required: true }]}><Select options={PLATFORM_OPTIONS} style={{ width: 140 }} /></Form.Item>
            <Form.Item name='arch' label='架构' rules={[{ required: true }]}><Select options={ARCH_OPTIONS} style={{ width: 120 }} /></Form.Item>
          </Space>
          <Form.Item
            name='fileName'
            label='安装包文件名'
            rules={[
              { required: true, message: '请输入安装包文件名' },
              { pattern: /\.(exe|msi|dmg|zip|deb|rpm)$/i, message: '文件名必须是安装包，例如 .exe/.dmg/.deb' },
            ]}
            extra='必须和服务器 releases/<version>/ 目录中的文件名完全一致。'
          >
            <Input placeholder='LingAI-2.2.0-win-x64.exe' />
          </Form.Item>
          <Form.Item
            name='sha512'
            label='sha512'
            rules={[
              { required: true, message: '请输入 latest.yml 中的 sha512' },
              { pattern: /^[A-Za-z0-9+/=]{80,120}$/, message: '请复制构建产物 latest.yml 中完整的 sha512' },
            ]}
          >
            <Input.TextArea rows={2} placeholder='复制 out/latest.yml 中的 sha512，不是随便填 1' />
          </Form.Item>
          <Space style={{ width: '100%' }} size='large'>
            <Form.Item name='size' label='文件大小（字节）'><InputNumber min={0} style={{ width: 180 }} /></Form.Item>
            <Form.Item name='releaseDate' label='发布时间'><Input placeholder='留空则使用当前时间' /></Form.Item>
            <Form.Item name='forceUpdate' label='强制更新' valuePropName='checked'><Switch /></Form.Item>
            <Form.Item name='enabled' label='启用' valuePropName='checked'><Switch /></Form.Item>
          </Space>
          <Form.Item name='releaseNotes' label='更新说明'><Input.TextArea rows={4} placeholder='展示给客户端的更新说明' /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
