import React, { useState } from 'react';
import { Modal, Form, Input, Button, Tabs, Message } from '@arco-design/web-react';
import { IconUser, IconLock } from '@arco-design/web-react/icon';
import { useTranslation } from 'react-i18next';
import { useUser } from '@renderer/hooks/context/UserContext';
import { authApi } from '@renderer/api/auth';

const TabPane = Tabs.TabPane;
const FormItem = Form.Item;

export const LoginModal: React.FC = () => {
  const { t } = useTranslation();
  const { login, isLoginModalVisible, hideLoginModal } = useUser();
  const [activeTab, setActiveTab] = useState('login');
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();

  const handleSubmit = async (values: { username: string; password: string }) => {
    setLoading(true);
    try {
      const { username, password } = values;
      const res =
        activeTab === 'login' ? await authApi.login(username, password) : await authApi.register(username, password);

      if (res.success && res.token && res.user) {
        Message.success(activeTab === 'login' ? t('login.cloud.successLogin') : t('login.cloud.successRegister'));
        await login(res.token, res.user);
      } else {
        Message.error(res.error || t('login.cloud.failed'));
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      Message.error(msg || t('login.cloud.networkError'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title={t('login.cloud.modalTitle')}
      visible={isLoginModalVisible}
      onCancel={hideLoginModal}
      footer={null}
      closable={true}
      maskClosable={true}
      className='w-[400px]'
    >
      <div className='flex flex-col gap-4'>
        <Tabs activeTab={activeTab} onChange={setActiveTab}>
          <TabPane key='login' title={t('login.cloud.tabLogin')} />
          <TabPane key='register' title={t('login.cloud.tabRegister')} />
        </Tabs>

        <Form form={form} onSubmit={handleSubmit} layout='vertical' className='mt-4'>
          <FormItem
            field='username'
            label={t('login.cloud.usernameLabel')}
            rules={[{ required: true, message: t('login.cloud.usernamePlaceholder') }]}
          >
            <Input prefix={<IconUser />} placeholder={t('login.cloud.usernamePlaceholder')} />
          </FormItem>
          <FormItem
            field='password'
            label={t('login.cloud.passwordLabel')}
            rules={[{ required: true, message: t('login.cloud.passwordPlaceholder') }]}
          >
            <Input.Password prefix={<IconLock />} placeholder={t('login.cloud.passwordPlaceholder')} />
          </FormItem>
          <FormItem className='mb-0 mt-4'>
            <Button type='primary' htmlType='submit' long loading={loading}>
              {activeTab === 'login' ? t('login.cloud.submitLogin') : t('login.cloud.submitRegister')}
            </Button>
          </FormItem>
        </Form>
      </div>
    </Modal>
  );
};
