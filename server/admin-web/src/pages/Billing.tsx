import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Statistic,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined, SaveOutlined } from '@ant-design/icons';
import axios from 'axios';

type ProductType = 'balance' | 'subscription';
type PlanType = 'balance' | 'reset_window';
type PaymentOrderStatus = 'PENDING' | 'PAID';

type RechargeProduct = {
  id: string;
  name: string;
  description?: string | null;
  productType: ProductType;
  priceCents: number;
  priceYuan: string;
  amount: number;
  planType: PlanType;
  windowHours?: number | null;
  validDays?: number | null;
  badge?: string | null;
  sortOrder: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

type PaymentConfig = {
  enabled: boolean;
  usable: boolean;
  apiBaseUrl: string;
  merchantId: string;
  merchantKeyConfigured: boolean;
  allowedTypes: string[];
  siteName: string;
  updatedAt?: string | null;
};

type PaymentOrder = {
  id: string;
  orderNo: string;
  userId: string;
  product?: { name?: string } | null;
  paymentType: string;
  amountYuan: string;
  quotaAmount: number;
  planType: PlanType;
  windowHours?: number | null;
  validDays?: number | null;
  status: PaymentOrderStatus;
  providerTradeNo?: string | null;
  paidAt?: string | null;
  createdAt: string;
  user?: {
    username?: string | null;
    email?: string | null;
  };
};

type ProductFormValues = {
  name: string;
  description?: string;
  productType: ProductType;
  priceYuan: number;
  amount: number;
  planType: PlanType;
  windowHours?: number;
  validDays?: number;
  badge?: string;
  sortOrder?: number;
  enabled?: boolean;
};

type PaymentConfigFormValues = {
  enabled?: boolean;
  apiBaseUrl?: string;
  merchantId?: string;
  merchantKey?: string;
  allowedTypes?: string[];
  siteName?: string;
};

const API_BASE = '/api';
const PAYMENT_TYPE_OPTIONS = [
  { label: '支付宝', value: 'alipay' },
  { label: '微信支付', value: 'wxpay' },
  { label: 'QQ 钱包', value: 'qqpay' },
  { label: '网银', value: 'bank' },
];
const PRODUCT_TYPE_OPTIONS = [
  { label: '额度充值', value: 'balance' },
  { label: '套餐订阅', value: 'subscription' },
];
const PLAN_TYPE_OPTIONS = [
  { label: '余额累加', value: 'balance' },
  { label: '周期重置套餐', value: 'reset_window' },
];

function formatDate(value?: string | null) {
  return value ? new Date(value).toLocaleString() : '-';
}

function planLabel(record: Pick<PaymentOrder, 'planType' | 'windowHours' | 'validDays'>) {
  if (record.planType !== 'reset_window') return '余额充值';
  return `${record.windowHours || 4} 小时重置 / ${record.validDays || 30} 天`;
}

export default function Billing() {
  const [products, setProducts] = useState<RechargeProduct[]>([]);
  const [orders, setOrders] = useState<PaymentOrder[]>([]);
  const [paymentConfig, setPaymentConfig] = useState<PaymentConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [savingProduct, setSavingProduct] = useState(false);
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<RechargeProduct | null>(null);
  const [configForm] = Form.useForm<PaymentConfigFormValues>();
  const [productForm] = Form.useForm<ProductFormValues>();
  const planType = Form.useWatch('planType', productForm);

  const paidOrderCount = useMemo(() => orders.filter((order) => order.status === 'PAID').length, [orders]);
  const paidRevenueYuan = useMemo(
    () =>
      orders
        .filter((order) => order.status === 'PAID')
        .reduce((total, order) => total + Number(order.amountYuan || 0), 0)
        .toFixed(2),
    [orders]
  );

  const fetchBillingData = async () => {
    setLoading(true);
    try {
      const [configRes, productRes, orderRes] = await Promise.all([
        axios.get(`${API_BASE}/payment/config`),
        axios.get(`${API_BASE}/recharge/admin/products`),
        axios.get(`${API_BASE}/payment/orders`),
      ]);
      const nextConfig = configRes.data.config as PaymentConfig;
      setPaymentConfig(nextConfig);
      setProducts(productRes.data.products || []);
      setOrders(orderRes.data.orders || []);
      configForm.setFieldsValue({
        enabled: nextConfig.enabled,
        apiBaseUrl: nextConfig.apiBaseUrl,
        merchantId: nextConfig.merchantId,
        merchantKey: '',
        allowedTypes: nextConfig.allowedTypes,
        siteName: nextConfig.siteName,
      });
    } catch (error) {
      message.error('获取充值配置失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchBillingData();
  }, []);

  const savePaymentConfig = async (values: PaymentConfigFormValues) => {
    setSavingConfig(true);
    try {
      const res = await axios.put(`${API_BASE}/payment/config`, values);
      const nextConfig = res.data.config as PaymentConfig;
      setPaymentConfig(nextConfig);
      configForm.setFieldsValue({ ...values, merchantKey: '', allowedTypes: nextConfig.allowedTypes });
      message.success('支付配置已保存');
    } catch (error) {
      message.error('保存支付配置失败');
    } finally {
      setSavingConfig(false);
    }
  };

  const openCreateProduct = () => {
    setEditingProduct(null);
    productForm.resetFields();
    productForm.setFieldsValue({
      productType: 'balance',
      planType: 'balance',
      priceYuan: 10,
      amount: 100,
      windowHours: 4,
      validDays: 30,
      sortOrder: products.length,
      enabled: true,
    });
    setProductModalOpen(true);
  };

  const openEditProduct = (product: RechargeProduct) => {
    setEditingProduct(product);
    productForm.setFieldsValue({
      ...product,
      priceYuan: Number(product.priceYuan),
      description: product.description || undefined,
      badge: product.badge || undefined,
      windowHours: product.windowHours || 4,
      validDays: product.validDays || 30,
    });
    setProductModalOpen(true);
  };

  const saveProduct = async (values: ProductFormValues) => {
    setSavingProduct(true);
    try {
      if (editingProduct) {
        await axios.put(`${API_BASE}/recharge/admin/products/${editingProduct.id}`, values);
        message.success('商品已更新');
      } else {
        await axios.post(`${API_BASE}/recharge/admin/products`, values);
        message.success('商品已创建');
      }
      setProductModalOpen(false);
      productForm.resetFields();
      await fetchBillingData();
    } catch (error) {
      message.error('保存商品失败');
    } finally {
      setSavingProduct(false);
    }
  };

  const deleteProduct = async (product: RechargeProduct) => {
    try {
      await axios.delete(`${API_BASE}/recharge/admin/products/${product.id}`);
      message.success('商品已删除');
      await fetchBillingData();
    } catch (error) {
      message.error('删除商品失败');
    }
  };

  return (
    <div className='animate-fade-in'>
      <div className='page-header' style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 className='page-title'>充值配置</h1>
          <p className='page-subtitle'>配置客户端展示的充值商品、套餐订阅和易支付商户信息。</p>
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => void fetchBillingData()} loading={loading}>
          刷新
        </Button>
      </div>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} md={8}>
          <Card bordered={false}>
            <Statistic
              title='已启用商品'
              value={products.filter((product) => product.enabled).length}
              suffix={`/ ${products.length}`}
            />
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card bordered={false}>
            <Statistic title='已支付订单' value={paidOrderCount} />
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card bordered={false}>
            <Statistic title='已支付金额' value={paidRevenueYuan} prefix='¥' />
          </Card>
        </Col>
      </Row>

      <Card
        title='易支付配置'
        bordered={false}
        style={{ marginBottom: 16 }}
        extra={
          <Tag color={paymentConfig?.usable ? 'success' : 'warning'}>
            {paymentConfig?.usable ? '可用' : '未完整配置'}
          </Tag>
        }
      >
        <Alert
          showIcon
          type='info'
          style={{ marginBottom: 16 }}
          message='支付回调依赖 admin-api 的公网访问地址。生产环境建议配置 PUBLIC_BASE_URL，确保易支付 notify_url 可以访问。'
        />
        <Form form={configForm} layout='vertical' onFinish={savePaymentConfig}>
          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Form.Item name='enabled' label='启用支付' valuePropName='checked'>
                <Switch />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name='siteName' label='站点名称'>
                <Input placeholder='LingAI' />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name='allowedTypes' label='允许支付方式'>
                <Select mode='multiple' options={PAYMENT_TYPE_OPTIONS} placeholder='选择支付方式' />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Form.Item
                name='apiBaseUrl'
                label='易支付接口地址'
                rules={[{ required: true, message: '请输入易支付接口地址' }]}
                extra='例如：https://pay.example.com，不需要填写 submit.php'
              >
                <Input placeholder='https://pay.example.com' />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name='merchantId' label='商户 PID' rules={[{ required: true, message: '请输入商户 PID' }]}>
                <Input placeholder='商户 PID' />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item
                name='merchantKey'
                label='商户密钥'
                extra={
                  paymentConfig?.merchantKeyConfigured ? '已配置密钥；留空则继续使用原密钥。' : '首次启用必须填写。'
                }
              >
                <Input.Password placeholder='留空则不修改' />
              </Form.Item>
            </Col>
          </Row>
          <Button type='primary' icon={<SaveOutlined />} htmlType='submit' loading={savingConfig}>
            保存支付配置
          </Button>
        </Form>
      </Card>

      <Card
        title='充值商品'
        bordered={false}
        style={{ marginBottom: 16 }}
        extra={
          <Button type='primary' icon={<PlusOutlined />} onClick={openCreateProduct}>
            新增商品
          </Button>
        }
      >
        <Table
          dataSource={products}
          rowKey='id'
          loading={loading}
          pagination={{ pageSize: 10 }}
          columns={[
            {
              title: '商品',
              dataIndex: 'name',
              render: (value, record) => (
                <Space direction='vertical' size={2}>
                  <Space>
                    <strong>{value}</strong>
                    {record.badge ? <Tag color='processing'>{record.badge}</Tag> : null}
                  </Space>
                  {record.description ? <Typography.Text type='secondary'>{record.description}</Typography.Text> : null}
                </Space>
              ),
            },
            {
              title: '类型',
              render: (_value, record) => (
                <Space>
                  <Tag>{record.productType === 'subscription' ? '套餐订阅' : '额度充值'}</Tag>
                  <Tag color={record.planType === 'reset_window' ? 'processing' : 'default'}>{planLabel(record)}</Tag>
                </Space>
              ),
            },
            { title: '售价', dataIndex: 'priceYuan', render: (value) => `¥${value}` },
            { title: '额度', dataIndex: 'amount', render: (value) => <strong>{value}</strong> },
            { title: '排序', dataIndex: 'sortOrder', width: 80 },
            {
              title: '状态',
              dataIndex: 'enabled',
              width: 90,
              render: (enabled) => <Tag color={enabled ? 'success' : 'default'}>{enabled ? '启用' : '停用'}</Tag>,
            },
            {
              title: '操作',
              width: 120,
              render: (_value, record) => (
                <Space>
                  <Button size='small' type='text' icon={<EditOutlined />} onClick={() => openEditProduct(record)} />
                  <Popconfirm
                    title='确认删除这个充值商品？'
                    okText='删除'
                    cancelText='取消'
                    onConfirm={() => void deleteProduct(record)}
                  >
                    <Button size='small' type='text' danger icon={<DeleteOutlined />} />
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Card title='最近订单' bordered={false}>
        <Table
          dataSource={orders}
          rowKey='id'
          loading={loading}
          pagination={{ pageSize: 10 }}
          columns={[
            {
              title: '订单号',
              dataIndex: 'orderNo',
              render: (value) => <Typography.Text code>{value}</Typography.Text>,
            },
            {
              title: '用户',
              render: (_value, record) => record.user?.username || record.user?.email || record.userId,
            },
            {
              title: '商品',
              render: (_value, record) => record.product?.name || '-',
            },
            { title: '金额', dataIndex: 'amountYuan', render: (value) => `¥${value}` },
            { title: '额度/套餐', render: (_value, record) => `${record.quotaAmount} · ${planLabel(record)}` },
            {
              title: '支付方式',
              dataIndex: 'paymentType',
              render: (value) => PAYMENT_TYPE_OPTIONS.find((option) => option.value === value)?.label || value,
            },
            {
              title: '状态',
              dataIndex: 'status',
              render: (value) => (
                <Tag color={value === 'PAID' ? 'success' : 'warning'}>{value === 'PAID' ? '已支付' : '待支付'}</Tag>
              ),
            },
            { title: '创建时间', dataIndex: 'createdAt', render: formatDate },
            { title: '支付时间', dataIndex: 'paidAt', render: formatDate },
          ]}
        />
      </Card>

      <Modal
        title={editingProduct ? '编辑充值商品' : '新增充值商品'}
        open={productModalOpen}
        onOk={() => productForm.submit()}
        onCancel={() => {
          setProductModalOpen(false);
          productForm.resetFields();
        }}
        okText='保存'
        cancelText='取消'
        confirmLoading={savingProduct}
        width={760}
      >
        <Form
          form={productForm}
          layout='vertical'
          onFinish={saveProduct}
          onValuesChange={(changed) => {
            if (changed.productType === 'subscription') {
              productForm.setFieldsValue({ planType: 'reset_window' });
            }
          }}
        >
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item name='name' label='商品名称' rules={[{ required: true, message: '请输入商品名称' }]}>
                <Input placeholder='例如：基础额度包' />
              </Form.Item>
            </Col>
            <Col xs={24} md={6}>
              <Form.Item name='productType' label='展示分类' rules={[{ required: true }]}>
                <Select options={PRODUCT_TYPE_OPTIONS} />
              </Form.Item>
            </Col>
            <Col xs={24} md={6}>
              <Form.Item name='planType' label='到账方式' rules={[{ required: true }]}>
                <Select options={PLAN_TYPE_OPTIONS} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Form.Item name='priceYuan' label='售价（元）' rules={[{ required: true, message: '请输入售价' }]}>
                <InputNumber min={0.01} precision={2} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name='amount' label='额度数量' rules={[{ required: true, message: '请输入额度数量' }]}>
                <InputNumber min={1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name='sortOrder' label='排序'>
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          {planType === 'reset_window' ? (
            <Row gutter={16}>
              <Col xs={24} md={12}>
                <Form.Item
                  name='windowHours'
                  label='每隔几小时重置'
                  rules={[{ required: true, message: '请输入重置周期' }]}
                >
                  <InputNumber min={1} max={720} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item name='validDays' label='有效天数' rules={[{ required: true, message: '请输入有效天数' }]}>
                  <InputNumber min={1} max={3650} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </Row>
          ) : null}
          <Form.Item name='description' label='商品说明'>
            <Input.TextArea rows={3} placeholder='展示给客户端用户的商品说明' />
          </Form.Item>
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item name='badge' label='角标'>
                <Input placeholder='例如：推荐 / 限时' />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name='enabled' label='启用商品' valuePropName='checked'>
                <Switch />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </div>
  );
}
