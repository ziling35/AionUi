import { useState, useEffect, useCallback } from 'react';
import {
  Table,
  Card,
  Button,
  Space,
  Tag,
  Switch,
  message,
  Modal,
  Form,
  Input,
  InputNumber,
  Select,
  Collapse,
  Popconfirm,
  Tooltip,
  Empty,
  Spin,
} from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  EditOutlined,
  CloudServerOutlined,
  ReloadOutlined,
  DownOutlined,
  ApiOutlined,
} from '@ant-design/icons';
import axios from 'axios';

const API_BASE = '/api';

// ─── Platform presets (mirrors LingAI client's MODEL_PLATFORMS) ────────────
// Simplified set for the admin panel — covers the most common providers.
const PLATFORM_PRESETS = [
  { label: '自定义 / Custom', value: 'custom', baseUrl: '' },
  { label: 'New API (中转站)', value: 'new-api', baseUrl: '' },
  { label: 'OpenAI', value: 'openai', baseUrl: 'https://api.openai.com/v1' },
  { label: 'Anthropic', value: 'anthropic', baseUrl: 'https://api.anthropic.com' },
  { label: 'Gemini', value: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com' },
  { label: 'DeepSeek', value: 'deepseek', baseUrl: 'https://api.deepseek.com/v1' },
  { label: 'OpenRouter', value: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1' },
  { label: 'Dashscope (通义千问)', value: 'dashscope', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { label: 'SiliconFlow', value: 'siliconflow', baseUrl: 'https://api.siliconflow.com/v1' },
  { label: 'Moonshot (Kimi)', value: 'moonshot', baseUrl: 'https://api.moonshot.cn/v1' },
  { label: 'Zhipu (智谱)', value: 'zhipu', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
  { label: 'xAI', value: 'xai', baseUrl: 'https://api.x.ai/v1' },
  { label: 'Ark (火山引擎)', value: 'ark', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3' },
  { label: 'Poe', value: 'poe', baseUrl: 'https://api.poe.com/v1' },
];

const getPlatformLabel = (platform: string) => {
  return PLATFORM_PRESETS.find((p) => p.value === platform)?.label || platform;
};

const getPlatformColor = (platform: string): string => {
  const colors: Record<string, string> = {
    openai: 'green',
    anthropic: 'orange',
    gemini: 'blue',
    'new-api': 'purple',
    custom: 'default',
  };
  return colors[platform] || 'default';
};

/** Virtual provider id for orphaned models (providerId = null). */
const ORPHANED_PROVIDER_ID = '__orphaned__';
const isOrphanedProvider = (p: ProviderItem) => p.id === ORPHANED_PROVIDER_ID;

const MODEL_TYPE_OPTIONS = [
  { label: '对话 (chat)', value: 'chat' },
  { label: '图像生成 (image)', value: 'image' },
  { label: '视频生成 (video)', value: 'video' },
  { label: '语音 (audio)', value: 'audio' },
  { label: '向量嵌入 (embedding)', value: 'embedding' },
];

const BILLING_MODE_OPTIONS = [
  { label: '按 Token 计费', value: 'per_token' },
  { label: '按次固定扣费', value: 'per_call' },
  { label: '按输入字符计费', value: 'per_character' },
];

// ─── Types ──────────────────────────────────────────────────
interface ModelItem {
  id: string;
  modelId: string;
  name: string;
  multiplier: number;
  billingMode: string;
  inputTokenPrice: number;
  outputTokenPrice: number;
  fixedCost: number;
  minCost: number;
  reserveCost: number;
  sortOrder: number;
  isActive: boolean;
  type: string;
  unitPrice: number;
  providerId: string | null;
}

interface ProviderItem {
  id: string;
  name: string;
  platform: string;
  baseUrl: string | null;
  apiKey: string | null;
  enabled: boolean;
  models: ModelItem[];
}

// ─── Add / Edit Provider Modal ─────────────────────────────
interface ProviderModalProps {
  open: boolean;
  editingProvider?: ProviderItem | null;
  onCancel: () => void;
  onSuccess: () => void;
}

function ProviderModal({ open, editingProvider, onCancel, onSuccess }: ProviderModalProps) {
  const [form] = Form.useForm();
  const [fetchingRemote, setFetchingRemote] = useState(false);
  const [remoteModels, setRemoteModels] = useState<{ id: string; name: string }[]>([]);

  const isEditing = !!editingProvider;

  // Reset form when modal opens
  useEffect(() => {
    if (open) {
      setRemoteModels([]);
      if (editingProvider) {
        form.setFieldsValue({
          name: editingProvider.name,
          platform: editingProvider.platform,
          baseUrl: editingProvider.baseUrl,
          apiKey: editingProvider.apiKey,
          enabled: editingProvider.enabled,
        });
      } else {
        form.resetFields();
        form.setFieldsValue({ platform: 'custom', enabled: true });
      }
    }
  }, [open, editingProvider, form]);

  const handlePlatformChange = (value: string) => {
    const preset = PLATFORM_PRESETS.find((p) => p.value === value);
    if (preset?.baseUrl && !form.getFieldValue('baseUrl')) {
      form.setFieldValue('baseUrl', preset.baseUrl);
    }
  };

  const handleFetchRemote = async () => {
    const baseUrl = form.getFieldValue('baseUrl');
    const apiKey = form.getFieldValue('apiKey');
    if (!baseUrl) {
      return message.warning('请先填写 API 地址');
    }

    setFetchingRemote(true);
    try {
      const res = await axios.post(`${API_BASE}/providers/fetch-remote`, { baseUrl, apiKey });
      if (res.data.success && res.data.models) {
        setRemoteModels(res.data.models);
        message.success(`成功获取 ${res.data.models.length} 个模型，请在下方选择要添加的模型`);
      } else {
        message.error(res.data.error || '获取失败');
      }
    } catch (e: any) {
      message.error(e.response?.data?.error || '网络请求失败');
    }
    setFetchingRemote(false);
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      const payload = {
        name: values.name,
        platform: values.platform || 'custom',
        baseUrl: values.baseUrl || null,
        apiKey: values.apiKey || null,
        enabled: values.enabled !== false,
      };

      if (isEditing) {
        // Update provider
        await axios.put(`${API_BASE}/providers/${editingProvider!.id}`, payload);
        message.success('供应商更新成功');
      } else {
        // Create provider with selected models
        const models = (values.selectedModels || []).map((id: string) => ({
          modelId: id,
          name: id,
          multiplier: 1.0,
          billingMode: 'per_token',
          inputTokenPrice: 1,
          outputTokenPrice: 1,
          fixedCost: 0,
          minCost: 1,
          reserveCost: 0,
          sortOrder: 0,
          isActive: true,
          type: 'chat',
          unitPrice: 0,
        }));
        await axios.post(`${API_BASE}/providers/add`, { ...payload, models });
        message.success(`供应商创建成功，已添加 ${models.length} 个模型`);
      }
      onSuccess();
    } catch (e: any) {
      if (e.response?.data?.error) {
        message.error(e.response.data.error);
      }
    }
  };

  return (
    <Modal
      title={isEditing ? '编辑供应商' : '添加供应商'}
      open={open}
      onOk={handleSubmit}
      onCancel={onCancel}
      okText={isEditing ? '保存' : '确认创建'}
      cancelText='取消'
      width={560}
      destroyOnHidden
    >
      <Form form={form} layout='vertical'>
        <Form.Item name='name' label='供应商名称' rules={[{ required: true, message: '请输入供应商名称' }]}>
          <Input placeholder='如: OpenAI 官方、我的中转站' />
        </Form.Item>

        <Form.Item name='platform' label='平台类型' tooltip='选择平台后会自动填充默认 API 地址'>
          <Select
            showSearch
            placeholder='选择平台类型'
            onChange={handlePlatformChange}
            options={PLATFORM_PRESETS.map((p) => ({ label: p.label, value: p.value }))}
          />
        </Form.Item>

        <Form.Item name='baseUrl' label='API 地址 (Base URL)' tooltip='如 https://api.openai.com/v1 或中转站地址'>
          <Input placeholder='https://api.openai.com/v1' />
        </Form.Item>

        <Form.Item name='apiKey' label='API Key' tooltip='支持多个 Key，用逗号分隔'>
          <Input.Password placeholder='sk-...' />
        </Form.Item>

        <Form.Item name='enabled' label='启用供应商' valuePropName='checked'>
          <Switch />
        </Form.Item>

        {/* Fetch remote models — only for new providers */}
        {!isEditing && (
          <>
            <Space style={{ marginBottom: 16 }}>
              <Button icon={<CloudServerOutlined />} loading={fetchingRemote} onClick={handleFetchRemote}>
                获取远程可用模型
              </Button>
            </Space>

            {remoteModels.length > 0 && (
              <Form.Item
                name='selectedModels'
                label={`选择模型 (${remoteModels.length} 个可用)`}
                tooltip='可选择多个模型，它们将共享此供应商的 API 地址和密钥'
              >
                <Select
                  mode='multiple'
                  showSearch
                  allowClear
                  placeholder='选择要添加的模型'
                  style={{ width: '100%' }}
                  options={remoteModels.map((m) => ({ label: m.id, value: m.id }))}
                  maxTagCount='responsive'
                />
              </Form.Item>
            )}
          </>
        )}
      </Form>
    </Modal>
  );
}

// ─── Add Model to Provider Modal ────────────────────────────
interface AddModelModalProps {
  open: boolean;
  provider: ProviderItem | null;
  onCancel: () => void;
  onSuccess: () => void;
}

function AddModelModal({ open, provider, onCancel, onSuccess }: AddModelModalProps) {
  const [form] = Form.useForm();
  const [fetchingRemote, setFetchingRemote] = useState(false);
  const [remoteModels, setRemoteModels] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    if (open) {
      form.resetFields();
      form.setFieldsValue({
        multiplier: 1.0,
        billingMode: 'per_token',
        inputTokenPrice: 1,
        outputTokenPrice: 1,
        fixedCost: 0,
        minCost: 1,
        reserveCost: 0,
        sortOrder: 0,
        isActive: true,
        type: 'chat',
        unitPrice: 0,
      });
      setRemoteModels([]);
    }
  }, [open, form]);

  const handleFetchRemote = async () => {
    if (!provider) return;
    const baseUrl = provider.baseUrl;
    const apiKey = provider.apiKey;
    if (!baseUrl) {
      return message.warning('该供应商未配置 API 地址');
    }

    setFetchingRemote(true);
    try {
      const res = await axios.post(`${API_BASE}/providers/fetch-remote`, { baseUrl, apiKey });
      if (res.data.success && res.data.models) {
        // Filter out models that already exist in this provider
        const existingIds = new Set(provider.models.map((m) => m.modelId));
        const available = res.data.models.filter((m: any) => !existingIds.has(m.id));
        setRemoteModels(available);
        if (available.length === 0) {
          message.info('远程所有模型已存在于此供应商中');
        } else {
          message.success(`获取到 ${available.length} 个新模型可用`);
        }
      } else {
        message.error(res.data.error || '获取失败');
      }
    } catch (e: any) {
      message.error(e.response?.data?.error || '网络请求失败');
    }
    setFetchingRemote(false);
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      const models = Array.isArray(values.modelIds) ? values.modelIds : [values.modelIds];

      const modelData = models.map((id: string) => ({
        modelId: id,
        name: id,
        multiplier: values.multiplier || 1.0,
        billingMode: values.billingMode || 'per_token',
        inputTokenPrice: values.inputTokenPrice || 1,
        outputTokenPrice: values.outputTokenPrice || 1,
        fixedCost: values.fixedCost || 0,
        minCost: values.minCost || 1,
        reserveCost: values.reserveCost || 0,
        sortOrder: values.sortOrder || 0,
        isActive: values.isActive !== false,
        type: values.type || 'chat',
        unitPrice: values.unitPrice || 0,
      }));

      await axios.post(`${API_BASE}/providers/${provider!.id}/models/add`, { models: modelData });
      message.success(`成功添加 ${modelData.length} 个模型`);
      onSuccess();
    } catch (e: any) {
      if (e.response?.data?.error) {
        message.error(e.response.data.error);
      }
    }
  };

  return (
    <Modal
      title={`添加模型到「${provider?.name || ''}」`}
      open={open}
      onOk={handleSubmit}
      onCancel={onCancel}
      okText='确认添加'
      cancelText='取消'
      width={760}
      destroyOnHidden
    >
      <Form form={form} layout='vertical'>
        <Space style={{ marginBottom: 16 }}>
          <Button icon={<CloudServerOutlined />} loading={fetchingRemote} onClick={handleFetchRemote}>
            获取远程可用模型
          </Button>
        </Space>

        <Form.Item name='modelIds' label='模型 ID' rules={[{ required: true, message: '请输入或选择模型 ID' }]}>
          {remoteModels.length > 0 ? (
            <Select
              mode='multiple'
              showSearch
              allowClear
              placeholder='选择要添加的模型'
              style={{ width: '100%' }}
              options={remoteModels.map((m) => ({ label: m.id, value: m.id }))}
              maxTagCount='responsive'
            />
          ) : (
            <Select
              mode='tags'
              placeholder='输入模型 ID，如 gpt-4o, claude-3-opus（回车添加）'
              style={{ width: '100%' }}
              tokenSeparators={[',', '\n']}
            />
          )}
        </Form.Item>

        <Form.Item name='multiplier' label='扣费倍率' rules={[{ required: true, message: '请输入扣费倍率' }]}>
          <InputNumber min={0.1} step={0.1} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name='sortOrder' label='显示排序' tooltip='数值越小越靠前；相同数值按创建时间排序。'>
          <InputNumber min={0} step={1} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item
          name='billingMode'
          label='计费模式'
          tooltip='按 Token 适合聊天；按次固定适合图片/语音/视频；按字符适合 TTS。'
        >
          <Select options={BILLING_MODE_OPTIONS} />
        </Form.Item>
        <Space style={{ width: '100%' }} size='middle'>
          <Form.Item name='inputTokenPrice' label='输入千 Token 点数'>
            <InputNumber min={0} step={0.1} style={{ width: 150 }} />
          </Form.Item>
          <Form.Item name='outputTokenPrice' label='输出千 Token 点数'>
            <InputNumber min={0} step={0.1} style={{ width: 150 }} />
          </Form.Item>
        </Space>
        <Space style={{ width: '100%' }} size='middle'>
          <Form.Item name='fixedCost' label='固定扣点'>
            <InputNumber min={0} step={1} style={{ width: 120 }} />
          </Form.Item>
          <Form.Item name='minCost' label='最低扣点'>
            <InputNumber min={1} step={1} style={{ width: 120 }} />
          </Form.Item>
          <Form.Item name='reserveCost' label='预授权点数'>
            <InputNumber min={0} step={1} style={{ width: 120 }} />
          </Form.Item>
        </Space>

        <Form.Item name='type' label='模型类型'>
          <Select options={MODEL_TYPE_OPTIONS} />
        </Form.Item>

        <Form.Item name='isActive' label='是否启用' valuePropName='checked'>
          <Switch />
        </Form.Item>
      </Form>
    </Modal>
  );
}

// ─── Edit Model Modal ──────────────────────────────────────
interface EditModelModalProps {
  open: boolean;
  model: ModelItem | null;
  onCancel: () => void;
  onSuccess: () => void;
}

function EditModelModal({ open, model, onCancel, onSuccess }: EditModelModalProps) {
  const [form] = Form.useForm();

  useEffect(() => {
    if (open && model) {
      form.setFieldsValue({
        name: model.name,
        multiplier: model.multiplier,
        billingMode: model.billingMode || 'per_token',
        inputTokenPrice: model.inputTokenPrice ?? 1,
        outputTokenPrice: model.outputTokenPrice ?? 1,
        fixedCost: model.fixedCost ?? 0,
        minCost: model.minCost ?? 1,
        reserveCost: model.reserveCost ?? 0,
        sortOrder: model.sortOrder ?? 0,
        type: model.type,
        unitPrice: model.unitPrice || 0,
        isActive: model.isActive,
      });
    }
  }, [open, model, form]);

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      const pid = model!.providerId || ORPHANED_PROVIDER_ID;
      await axios.put(`${API_BASE}/providers/${pid}/models/${model!.modelId}`, values);
      message.success('模型更新成功');
      onSuccess();
    } catch (e: any) {
      if (e.response?.data?.error) {
        message.error(e.response.data.error);
      }
    }
  };

  return (
    <Modal
      title={`编辑模型: ${model?.modelId || ''}`}
      open={open}
      onOk={handleSubmit}
      onCancel={onCancel}
      okText='保存'
      cancelText='取消'
      width={760}
      destroyOnHidden
    >
      <Form form={form} layout='vertical'>
        <Form.Item name='name' label='显示名称' rules={[{ required: true, message: '请输入显示名称' }]}>
          <Input />
        </Form.Item>
        <Form.Item name='multiplier' label='扣费倍率' rules={[{ required: true, message: '请输入扣费倍率' }]}>
          <InputNumber min={0.1} step={0.1} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name='sortOrder' label='显示排序' tooltip='数值越小越靠前；相同数值按创建时间排序。'>
          <InputNumber min={0} step={1} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item
          name='billingMode'
          label='计费模式'
          tooltip='按 Token 适合聊天；按次固定适合图片/语音/视频；按字符适合 TTS。'
        >
          <Select options={BILLING_MODE_OPTIONS} />
        </Form.Item>
        <Space style={{ width: '100%' }} size='middle'>
          <Form.Item
            name='inputTokenPrice'
            label='输入千 Token 点数'
            tooltip='per_token 模式下，每 1000 输入 token 扣多少算力点。'
          >
            <InputNumber min={0} step={0.1} style={{ width: 150 }} />
          </Form.Item>
          <Form.Item
            name='outputTokenPrice'
            label='输出千 Token 点数'
            tooltip='per_token 模式下，每 1000 输出 token 扣多少算力点。'
          >
            <InputNumber min={0} step={0.1} style={{ width: 150 }} />
          </Form.Item>
        </Space>
        <Space style={{ width: '100%' }} size='middle'>
          <Form.Item name='fixedCost' label='固定扣点' tooltip='per_call 模式下每次请求扣多少点。'>
            <InputNumber min={0} step={1} style={{ width: 120 }} />
          </Form.Item>
          <Form.Item name='minCost' label='最低扣点' tooltip='每次请求最低扣多少点，建议至少为 1。'>
            <InputNumber min={1} step={1} style={{ width: 120 }} />
          </Form.Item>
          <Form.Item
            name='reserveCost'
            label='预授权点数'
            tooltip='并发防亏损核心字段。为 0 时按模型输出上限估算预扣；高成本模型建议手动设置。'
          >
            <InputNumber min={0} step={1} style={{ width: 120 }} />
          </Form.Item>
        </Space>
        <Form.Item name='type' label='模型类型'>
          <Select options={MODEL_TYPE_OPTIONS} />
        </Form.Item>
        <Form.Item
          name='unitPrice'
          label='固定单价'
          tooltip='type为image/video/audio时，若>0则按次扣费(cost=unitPrice*multiplier)；为0则回退token计费'
        >
          <InputNumber min={0} step={1} style={{ width: '100%' }} placeholder='0 = 按token计费' />
        </Form.Item>

        <Form.Item name='isActive' label='是否启用' valuePropName='checked'>
          <Switch />
        </Form.Item>
      </Form>
    </Modal>
  );
}

// ─── Main Models Page ──────────────────────────────────────
export default function Models() {
  const [loading, setLoading] = useState(false);
  const [providers, setProviders] = useState<ProviderItem[]>([]);
  const [activeKeys, setActiveKeys] = useState<string[]>([]);

  // Modal states
  const [providerModalOpen, setProviderModalOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<ProviderItem | null>(null);
  const [addModelProvider, setAddModelProvider] = useState<ProviderItem | null>(null);
  const [editingModel, setEditingModel] = useState<ModelItem | null>(null);

  const fetchProviders = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API_BASE}/providers/list`);
      if (res.data.success) {
        setProviders(res.data.providers);
      }
    } catch (e) {
      message.error('无法获取供应商列表');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchProviders();
  }, [fetchProviders]);

  // ─── Provider actions ─────────────────────────────────
  const handleToggleProviderEnabled = async (provider: ProviderItem, enabled: boolean) => {
    try {
      await axios.put(`${API_BASE}/providers/${provider.id}`, { enabled });
      message.success(`${provider.name} 已${enabled ? '启用' : '禁用'}`);
      fetchProviders();
    } catch {
      message.error('操作失败');
    }
  };

  const handleDeleteProvider = async (provider: ProviderItem) => {
    try {
      await axios.delete(`${API_BASE}/providers/${provider.id}`);
      message.success(`供应商「${provider.name}」及其模型已删除`);
      fetchProviders();
    } catch {
      message.error('删除失败');
    }
  };

  // ─── Model actions ────────────────────────────────────
  const handleToggleModelActive = async (model: ModelItem, isActive: boolean) => {
    try {
      const pid = model.providerId || ORPHANED_PROVIDER_ID;
      await axios.put(`${API_BASE}/providers/${pid}/models/${model.modelId}`, { isActive });
      fetchProviders();
    } catch {
      message.error('操作失败');
    }
  };

  const handleDeleteModel = async (model: ModelItem) => {
    try {
      const pid = model.providerId || ORPHANED_PROVIDER_ID;
      await axios.delete(`${API_BASE}/providers/${pid}/models/${model.modelId}`);
      message.success(`模型「${model.modelId}」已删除`);
      fetchProviders();
    } catch {
      message.error('删除失败');
    }
  };

  // ─── Render ────────────────────────────────────────────
  const totalModels = providers.reduce((sum, p) => sum + p.models.length, 0);

  return (
    <div className='animate-fade-in'>
      {/* Header */}
      <div className='page-header' style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 className='page-title'>模型配置</h1>
          <p className='page-subtitle'>
            以供应商为中心管理 AI 模型 — 一个供应商下可配置多个模型，共享同一 API 地址与密钥。
          </p>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={fetchProviders}>
            刷新
          </Button>
          <Button
            type='primary'
            icon={<PlusOutlined />}
            onClick={() => {
              setEditingProvider(null);
              setProviderModalOpen(true);
            }}
          >
            添加供应商
          </Button>
        </Space>
      </div>

      {/* Stats summary */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        <Card size='small' style={{ flex: 1 }}>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>供应商数量</div>
          <div style={{ fontSize: 20, fontWeight: 600 }}>{providers.length}</div>
        </Card>
        <Card size='small' style={{ flex: 1 }}>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>模型总数</div>
          <div style={{ fontSize: 20, fontWeight: 600 }}>{totalModels}</div>
        </Card>
        <Card size='small' style={{ flex: 1 }}>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>已启用供应商</div>
          <div style={{ fontSize: 20, fontWeight: 600 }}>{providers.filter((p) => p.enabled).length}</div>
        </Card>
      </div>

      {/* Provider list */}
      <Card bordered={false} bodyStyle={{ padding: 0 }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 48 }}>
            <Spin />
          </div>
        ) : providers.length === 0 ? (
          <Empty description='暂无供应商配置，请点击「添加供应商」开始配置' style={{ padding: 48 }}>
            <Button
              type='primary'
              icon={<PlusOutlined />}
              onClick={() => {
                setEditingProvider(null);
                setProviderModalOpen(true);
              }}
            >
              添加供应商
            </Button>
          </Empty>
        ) : (
          <Collapse
            activeKey={activeKeys}
            onChange={(keys) => setActiveKeys(keys as string[])}
            style={{ padding: '16px' }}
            expandIcon={({ isActive }) => (
              <DownOutlined style={{ transition: 'transform 0.2s', transform: isActive ? 'rotate(180deg)' : '' }} />
            )}
          >
            {providers.map((provider) => (
              <Collapse.Panel
                key={provider.id}
                header={
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      width: '100%',
                      paddingRight: 8,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <ApiOutlined style={{ color: 'var(--text-secondary)' }} />
                      <span style={{ fontSize: 14, fontWeight: 500 }}>{provider.name}</span>
                      <Tag color={getPlatformColor(provider.platform)} style={{ margin: 0 }}>
                        {getPlatformLabel(provider.platform)}
                      </Tag>
                      {provider.baseUrl && (
                        <Tooltip title={provider.baseUrl}>
                          <span
                            style={{
                              fontSize: 12,
                              color: 'var(--text-muted)',
                              maxWidth: 200,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {provider.baseUrl}
                          </span>
                        </Tooltip>
                      )}
                    </div>
                    <div
                      style={{ display: 'flex', alignItems: 'center', gap: 12 }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Tag style={{ border: '1px solid #e5e7eb', background: '#f9fafb', color: '#4b5563' }}>
                        {provider.models.length} 个模型
                      </Tag>
                      {!isOrphanedProvider(provider) && (
                        <Switch
                          size='small'
                          checked={provider.enabled}
                          onChange={(checked) => handleToggleProviderEnabled(provider, checked)}
                        />
                      )}
                      {!isOrphanedProvider(provider) && (
                        <Button
                          size='small'
                          type='text'
                          icon={<PlusOutlined />}
                          onClick={() => setAddModelProvider(provider)}
                          title='添加模型'
                        />
                      )}
                      {!isOrphanedProvider(provider) && (
                        <Button
                          size='small'
                          type='text'
                          icon={<EditOutlined />}
                          onClick={() => {
                            setEditingProvider(provider);
                            setProviderModalOpen(true);
                          }}
                          title='编辑供应商'
                        />
                      )}
                      {!isOrphanedProvider(provider) && (
                        <Popconfirm
                          title='删除供应商'
                          description='将同时删除该供应商下所有模型，确定删除？'
                          onConfirm={() => handleDeleteProvider(provider)}
                          okText='确认删除'
                          cancelText='取消'
                          okButtonProps={{ danger: true }}
                        >
                          <Button size='small' type='text' danger icon={<DeleteOutlined />} title='删除供应商' />
                        </Popconfirm>
                      )}
                    </div>
                  </div>
                }
              >
                {provider.models.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-muted)' }}>
                    暂无模型，点击 + 添加模型
                  </div>
                ) : (
                  <Table
                    dataSource={provider.models}
                    rowKey='id'
                    size='small'
                    pagination={false}
                    columns={[
                      {
                        title: '模型 ID',
                        dataIndex: 'modelId',
                        key: 'modelId',
                        render: (text) => (
                          <span style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 13, fontWeight: 500 }}>
                            {text}
                          </span>
                        ),
                      },
                      { title: '显示名称', dataIndex: 'name', key: 'name' },
                      {
                        title: '显示排序',
                        dataIndex: 'sortOrder',
                        key: 'sortOrder',
                        width: 90,
                        sorter: (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0),
                        render: (val) => <Tag>{val ?? 0}</Tag>,
                      },
                      {
                        title: '类型',
                        dataIndex: 'type',
                        key: 'type',
                        render: (val) => (
                          <Tag style={{ border: '1px solid #e5e7eb', background: '#f9fafb', color: '#4b5563' }}>
                            {val || 'chat'}
                          </Tag>
                        ),
                      },
                      {
                        title: '扣费倍率',
                        dataIndex: 'multiplier',
                        key: 'multiplier',
                        render: (val) => (
                          <Tag style={{ border: '1px solid #e5e7eb', background: '#f9fafb', color: '#4b5563' }}>
                            x {val}
                          </Tag>
                        ),
                      },
                      {
                        title: '固定单价',
                        dataIndex: 'unitPrice',
                        key: 'unitPrice',
                        render: (val) => (
                          <Tag style={{ border: '1px solid #e5e7eb', background: '#f9fafb', color: '#4b5563' }}>
                            {val && val > 0 ? val : '-'}
                          </Tag>
                        ),
                      },
                      {
                        title: '计费模式',
                        dataIndex: 'billingMode',
                        key: 'billingMode',
                        render: (val, record) => {
                          const modeLabel = BILLING_MODE_OPTIONS.find((item) => item.value === val)?.label || val || '按 Token 计费';
                          const fixedCost = record.fixedCost || record.unitPrice || 0;
                          const priceText =
                            val === 'per_call'
                              ? `${fixedCost} 点/次`
                              : `${record.inputTokenPrice ?? 1}/${record.outputTokenPrice ?? 1} 点/千Token`;
                          return (
                            <Tooltip title={`最低 ${record.minCost ?? 1} 点，预授权 ${record.reserveCost || '自动估算'} 点`}>
                              <Tag color={val === 'per_call' ? 'orange' : 'blue'}>
                                {modeLabel} · {priceText}
                              </Tag>
                            </Tooltip>
                          );
                        },
                      },
                      {
                        title: '启用',
                        dataIndex: 'isActive',
                        key: 'isActive',
                        render: (val, record) => (
                          <Switch
                            size='small'
                            checked={val}
                            onChange={(checked) => handleToggleModelActive(record, checked)}
                          />
                        ),
                      },
                      {
                        title: '操作',
                        key: 'actions',
                        width: 80,
                        render: (_, record) => (
                          <Space>
                            <Button
                              size='small'
                              type='text'
                              icon={<EditOutlined />}
                              onClick={() => setEditingModel(record)}
                              title='编辑模型'
                            />
                            <Popconfirm
                              title='删除模型'
                              description={`确定删除「${record.modelId}」？`}
                              onConfirm={() => handleDeleteModel(record)}
                              okText='删除'
                              cancelText='取消'
                              okButtonProps={{ danger: true }}
                            >
                              <Button size='small' type='text' danger icon={<DeleteOutlined />} title='删除模型' />
                            </Popconfirm>
                          </Space>
                        ),
                      },
                    ]}
                  />
                )}
              </Collapse.Panel>
            ))}
          </Collapse>
        )}
      </Card>

      {/* Modals */}
      <ProviderModal
        open={providerModalOpen}
        editingProvider={editingProvider}
        onCancel={() => setProviderModalOpen(false)}
        onSuccess={() => {
          setProviderModalOpen(false);
          fetchProviders();
        }}
      />

      <AddModelModal
        open={!!addModelProvider}
        provider={addModelProvider}
        onCancel={() => setAddModelProvider(null)}
        onSuccess={() => {
          setAddModelProvider(null);
          fetchProviders();
        }}
      />

      <EditModelModal
        open={!!editingModel}
        model={editingModel}
        onCancel={() => setEditingModel(null)}
        onSuccess={() => {
          setEditingModel(null);
          fetchProviders();
        }}
      />
    </div>
  );
}
