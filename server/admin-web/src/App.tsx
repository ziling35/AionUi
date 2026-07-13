import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import { Layout, Menu, ConfigProvider, theme } from 'antd';
import {
  UserOutlined,
  KeyOutlined,
  DashboardOutlined,
  RocketOutlined,
  SettingOutlined,
  MessageOutlined,
  DollarOutlined,
  AppstoreOutlined,
} from '@ant-design/icons';
import Dashboard from './pages/Dashboard';
import CardSecrets from './pages/CardSecrets';
import Users from './pages/Users';
import Models from './pages/Models';
import Releases from './pages/Releases';
import FeedbackReports from './pages/FeedbackReports';
import Billing from './pages/Billing';
import Skills from './pages/Skills';
import './App.css';

const { Header, Content, Sider } = Layout;

const NAV_ITEMS = [
  { key: '1', path: '/', label: '概览大盘', icon: <DashboardOutlined /> },
  { key: '2', path: '/cards', label: '卡密管理', icon: <KeyOutlined /> },
  { key: '3', path: '/users', label: '用户管理', icon: <UserOutlined /> },
  { key: '4', path: '/models', label: '模型配置', icon: <SettingOutlined /> },
  { key: '5', path: '/releases', label: '版本发布', icon: <RocketOutlined /> },
  { key: '6', path: '/feedback', label: '问题反馈', icon: <MessageOutlined /> },
  { key: '7', path: '/billing', label: '充值配置', icon: <DollarOutlined /> },
];

NAV_ITEMS.push({ key: '8', path: '/skills', label: '\u6280\u80fd\u7ba1\u7406', icon: <AppstoreOutlined /> });

function Navigation() {
  const location = useLocation();
  const selectedKey = NAV_ITEMS.find((item) => item.path === location.pathname)?.key ?? '1';

  return (
    <Menu mode='inline' selectedKeys={[selectedKey]}>
      {NAV_ITEMS.map((item) => (
        <Menu.Item key={item.key} icon={item.icon}>
          <Link to={item.path}>{item.label}</Link>
        </Menu.Item>
      ))}
    </Menu>
  );
}

function App() {
  return (
    <ConfigProvider
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: {
          colorPrimary: '#000000',
          fontFamily: 'Inter, sans-serif',
          colorBgContainer: '#ffffff',
          colorBorder: '#e5e7eb',
          borderRadius: 6,
        },
        components: {
          Menu: {
            itemBg: 'transparent',
          },
        },
      }}
    >
      <BrowserRouter basename='/admin'>
        <Layout style={{ minHeight: '100vh', background: 'var(--bg-secondary)' }}>
          <Sider width={240} className='sidebar' style={{ background: 'var(--bg-primary)' }}>
            <div style={{ height: 64, margin: '16px 24px', display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 28, height: 28, background: '#000', borderRadius: 6 }} />
              <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)' }}>LingAI 商业版后台</span>
            </div>
            <Navigation />
          </Sider>
          <Layout style={{ background: 'var(--bg-secondary)' }}>
            <Header
              style={{
                background: 'var(--bg-secondary)',
                padding: '0 32px',
                height: 64,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-end',
                borderBottom: '1px solid var(--border-color)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 16,
                    background: '#f3f4f6',
                    border: '1px solid var(--border-color)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <UserOutlined style={{ color: 'var(--text-secondary)' }} />
                </div>
              </div>
            </Header>
            <Content style={{ padding: '32px' }}>
              <div style={{ maxWidth: 1024, margin: '0 auto' }}>
                <Routes>
                  <Route path='/' element={<Dashboard />} />
                  <Route path='/cards' element={<CardSecrets />} />
                  <Route path='/users' element={<Users />} />
                  <Route path='/models' element={<Models />} />
                  <Route path='/releases' element={<Releases />} />
                  <Route path='/feedback' element={<FeedbackReports />} />
                  <Route path='/billing' element={<Billing />} />
                  <Route path='/skills' element={<Skills />} />
                </Routes>
              </div>
            </Content>
          </Layout>
        </Layout>
      </BrowserRouter>
    </ConfigProvider>
  );
}

export default App;
