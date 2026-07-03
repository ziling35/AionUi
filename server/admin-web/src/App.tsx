import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import { Layout, Menu, ConfigProvider, theme } from 'antd';
import { UserOutlined, KeyOutlined, DashboardOutlined, SettingOutlined } from '@ant-design/icons';
import Dashboard from './pages/Dashboard';
import CardSecrets from './pages/CardSecrets';
import Users from './pages/Users';
import Models from './pages/Models';
import './App.css';

const { Header, Content, Sider } = Layout;

function Navigation() {
  const location = useLocation();
  const selectedKey =
    location.pathname === '/' ? '1' : location.pathname === '/cards' ? '2' : location.pathname === '/users' ? '3' : '4';

  return (
    <Menu mode='inline' selectedKeys={[selectedKey]}>
      <Menu.Item key='1' icon={<DashboardOutlined />}>
        <Link to='/'>概览大盘</Link>
      </Menu.Item>
      <Menu.Item key='2' icon={<KeyOutlined />}>
        <Link to='/cards'>卡密管理</Link>
      </Menu.Item>
      <Menu.Item key='3' icon={<UserOutlined />}>
        <Link to='/users'>用户管理</Link>
      </Menu.Item>
      <Menu.Item key='4' icon={<SettingOutlined />}>
        <Link to='/models'>模型配置</Link>
      </Menu.Item>
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
      <BrowserRouter>
        <Layout style={{ minHeight: '100vh', background: 'var(--bg-secondary)' }}>
          <Sider width={240} className='sidebar' style={{ background: 'var(--bg-primary)' }}>
            <div style={{ height: 64, margin: '16px 24px', display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 28, height: 28, background: '#000', borderRadius: 6 }}></div>
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
