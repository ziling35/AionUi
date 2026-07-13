import { Button, Form, Input, InputNumber, Modal, Popconfirm, Space, Switch, Table, Tag, message } from 'antd';
import { useEffect, useState } from 'react';

type SkillPackage = {
  id: string;
  slug: string;
  name: string;
  description: string;
  version: string;
  content: string;
  isActive: boolean;
  sortOrder: number;
};

const text = {
  saveFailed: '\u4fdd\u5b58\u5931\u8d25',
  saved: '\u6280\u80fd\u5df2\u4fdd\u5b58',
  removed: '\u6280\u80fd\u5df2\u5220\u9664',
  title: '\u6280\u80fd\u7ba1\u7406',
  subtitle: '\u7f16\u8f91\u5e76\u53d1\u5e03\u5ba2\u6237\u7aef\u53ef\u5b89\u88c5\u7684 SKILL.md \u6280\u80fd',
  create: '\u65b0\u589e\u6280\u80fd',
  name: '\u540d\u79f0',
  slug: '\u6807\u8bc6',
  version: '\u7248\u672c',
  status: '\u72b6\u6001',
  published: '\u5df2\u53d1\u5e03',
  draft: '\u8349\u7a3f',
  order: '\u6392\u5e8f',
  actions: '\u64cd\u4f5c',
  edit: '\u7f16\u8f91',
  delete: '\u5220\u9664',
  deleteConfirm: '\u786e\u5b9a\u5220\u9664\u8be5\u6280\u80fd\uff1f',
  editTitle: '\u7f16\u8f91\u6280\u80fd',
  slugLabel: '\u6280\u80fd\u6807\u8bc6',
  slugHelp: '\u5c0f\u5199\u5b57\u6bcd\u3001\u6570\u5b57\u548c\u77ed\u6a2a\u7ebf\uff0c\u4f8b\u5982 code-review',
  description: '\u63cf\u8ff0',
  publish: '\u53d1\u5e03',
  content: 'SKILL.md \u5185\u5bb9',
};

export default function Skills() {
  const [items, setItems] = useState<SkillPackage[]>([]);
  const [editing, setEditing] = useState<SkillPackage>();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const load = async () => {
    const response = await fetch('/api/admin/skills');
    const payload = await response.json();
    if (payload.success) setItems(payload.data || []);
  };
  useEffect(() => {
    void load();
  }, []);
  const showEditor = (skill?: SkillPackage) => {
    setEditing(skill);
    form.setFieldsValue(skill || { version: '1.0.0', sortOrder: 0, isActive: false });
    setOpen(true);
  };
  const save = async () => {
    const values = await form.validateFields();
    const response = await fetch(editing ? `/api/admin/skills/${editing.id}` : '/api/admin/skills', {
      method: editing ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    const payload = await response.json();
    if (!payload.success) return message.error(payload.message || text.saveFailed);
    message.success(text.saved);
    setOpen(false);
    await load();
  };
  const remove = async (id: string) => {
    await fetch(`/api/admin/skills/${id}`, { method: 'DELETE' });
    message.success(text.removed);
    await load();
  };
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0 }}>{text.title}</h2>
          <div style={{ color: '#6b7280', marginTop: 4 }}>{text.subtitle}</div>
        </div>
        <Button type='primary' onClick={() => showEditor()}>
          {text.create}
        </Button>
      </div>
      <Table
        rowKey='id'
        dataSource={items}
        columns={[
          { title: text.name, dataIndex: 'name' },
          { title: text.slug, dataIndex: 'slug' },
          { title: text.version, dataIndex: 'version' },
          {
            title: text.status,
            render: (_, item) => (item.isActive ? <Tag color='green'>{text.published}</Tag> : <Tag>{text.draft}</Tag>),
          },
          { title: text.order, dataIndex: 'sortOrder' },
          {
            title: text.actions,
            render: (_, item) => (
              <Space>
                <Button type='link' onClick={() => showEditor(item)}>
                  {text.edit}
                </Button>
                <Popconfirm title={text.deleteConfirm} onConfirm={() => void remove(item.id)}>
                  <Button type='link' danger>
                    {text.delete}
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />
      <Modal
        title={editing ? text.editTitle : text.create}
        open={open}
        width={820}
        onCancel={() => setOpen(false)}
        onOk={() => void save()}
        destroyOnHidden
      >
        <Form form={form} layout='vertical'>
          <Form.Item name='name' label={text.name} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name='slug' label={text.slugLabel} rules={[{ required: true }]} extra={text.slugHelp}>
            <Input />
          </Form.Item>
          <Form.Item name='description' label={text.description} rules={[{ required: true }]}>
            <Input.TextArea rows={2} />
          </Form.Item>
          <Space size='large'>
            <Form.Item name='version' label={text.version} rules={[{ required: true }]}>
              <Input />
            </Form.Item>
            <Form.Item name='sortOrder' label={text.order}>
              <InputNumber />
            </Form.Item>
            <Form.Item name='isActive' label={text.publish} valuePropName='checked'>
              <Switch />
            </Form.Item>
          </Space>
          <Form.Item name='content' label={text.content} rules={[{ required: true }]}>
            <Input.TextArea rows={18} style={{ fontFamily: 'monospace' }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
