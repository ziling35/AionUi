import { Card, Col, Row, Statistic } from 'antd';
import { UserOutlined, KeyOutlined, ThunderboltOutlined, AppstoreOutlined } from '@ant-design/icons';

export default function Dashboard() {
  return (
    <div className='animate-fade-in'>
      <div className='page-header'>
        <h1 className='page-title'>概览大盘</h1>
        <p className='page-subtitle'>欢迎回到 LingAI 管理后台，今日数据概况如下。</p>
      </div>

      <Row gutter={[24, 24]}>
        <Col span={6}>
          <Card bordered={false} hoverable>
            <Statistic
              title='总用户数'
              value={120}
              prefix={<UserOutlined style={{ color: '#38bdf8', marginRight: 8 }} />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card bordered={false} hoverable>
            <Statistic
              title='发行卡密总数'
              value={1500}
              prefix={<KeyOutlined style={{ color: '#a78bfa', marginRight: 8 }} />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card bordered={false} hoverable>
            <Statistic
              title='活跃算力额度'
              value={85000}
              prefix={<ThunderboltOutlined style={{ color: '#fbbf24', marginRight: 8 }} />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card bordered={false} hoverable>
            <Statistic
              title='可用模型'
              value={5}
              prefix={<AppstoreOutlined style={{ color: '#34d399', marginRight: 8 }} />}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[24, 24]} style={{ marginTop: 24 }}>
        <Col span={16}>
          <Card bordered={false} title='营收与使用趋势' style={{ height: 400 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                color: 'var(--text-muted)',
              }}
            >
              (待接入图表组件如 Recharts)
            </div>
          </Card>
        </Col>
        <Col span={8}>
          <Card bordered={false} title='近期动态' style={{ height: 400 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                color: 'var(--text-muted)',
              }}
            >
              用户行为日志展示区
            </div>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
