# LingAI Admin Docker 部署

此目录用于部署 `server/admin-api` 和 `server/admin-web`。

## 数据映射

- SQLite 数据库映射到宿主机：`server/deploy/data/admin-api/dev.db`
- 安装包发布目录：`server/deploy/data/admin-api/releases/<version>/`
- 备份时只需要备份：`server/deploy/data/` 和 `server/deploy/.env`
- 容器内数据库路径：`/data/dev.db`

## 首次部署

```bash
cd server/deploy
cp .env.example .env
docker compose up -d --build
```

访问：

```text
http://服务器IP:8080
```

如果要改端口，编辑 `.env`：

```env
ADMIN_WEB_PORT=8080
PUBLIC_BASE_URL=https://lingai.ziling.site
```

`PUBLIC_BASE_URL` 会传给 `admin-api`，用于生成客户端更新地址和易支付回调地址。充值商品、易支付 PID/Key 等支付配置不写入 `.env`，在管理后台“充值配置”页面保存到数据库。

## 发布安装包

客户端不需要配置更新源。更新源在桌面端打包时内置，正式商用包需要用你的后台域名构建：

```powershell
$env:LINGAI_UPDATE_BASE_URL='https://lingai.ziling.site/api/updates/feed'
bun run dist:win
```

构建产物中的客户端会默认访问：

```text
https://lingai.ziling.site/api/updates/feed/latest.yml
https://lingai.ziling.site/api/updates/latest?platform=win32&arch=x64
```

1. 把安装包复制到宿主机目录：

```bash
mkdir -p data/admin-api/releases/2.1.30
cp LingAI-2.1.30-win-x64.exe data/admin-api/releases/2.1.30/
```

2. 在管理后台“版本发布”页面新增记录：

```text
version: 2.1.30
platform: win32
arch: x64
channel: latest
fileName: LingAI-2.1.30-win-x64.exe
sha512: 使用构建生成 latest.yml 里的 sha512
size: 安装包字节数，可选
```

3. 客户端更新 feed 地址：

```text
https://lingai.ziling.site/api/updates/feed/latest.yml
```

## 更新部署

```bash
cd server/deploy
docker compose up -d --build
```

## 查看日志

```bash
docker compose logs -f admin-api
docker compose logs -f admin-web
```

## 备份与恢复

备份：

```bash
tar -czf lingai-admin-data-$(date +%F).tar.gz data .env
```

恢复：

```bash
cd server/deploy
docker compose down
tar -xzf lingai-admin-data-YYYY-MM-DD.tar.gz
docker compose up -d
```

## 反向代理建议

如使用域名和 HTTPS，建议外层 Nginx/Caddy 只代理到 `127.0.0.1:8080`。不要直接暴露 `admin-api`，前端容器已经通过内部 Docker 网络代理 `/api`。

生图请求通常需要数分钟。外层反向代理、CDN 和面板生成的 Nginx 配置也必须放宽超时；只修改容器内的 Nginx 不够。Nginx 可参考：

```nginx
location /api/ {
  proxy_pass http://127.0.0.1:8080/api/;
  proxy_http_version 1.1;
  proxy_buffering off;
  proxy_connect_timeout 60s;
  proxy_read_timeout 600s;
  proxy_send_timeout 600s;
  send_timeout 600s;
}
```

如果客户端收到带有 `nginx` 标识的 HTML `504 Gateway Time-out`，但上游日志稍后显示生图成功，说明超时发生在某一层反向代理，而不是生图响应解析阶段。请逐层检查公网 CDN、宝塔/1Panel、宿主机 Nginx 和容器 Nginx。
