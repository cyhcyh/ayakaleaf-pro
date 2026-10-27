# Rogerleaf 快速部署

安装 Docker Desktop（使用 Linux 容器）或 Docker Engine 与 Compose。以下步骤适用于个人电脑和服务器。

## 1. 选择部署版本

**推荐完整 TeX Live 2026.1＋沙箱编译版**。它的宏包和字体更齐全，适合中文论文和复杂模板。首次启动会自动下载完整 TeX 镜像，解包后约 28.8 GB，还需为下载解压和应用数据留出空间。

基础版使用应用自带的基础 TeX 环境，适合简单体验。缺少宏包或字体时，建议使用完整版。两版都包含 Rogerleaf 的 AI 和翻译功能。

## 2. 保存一份 Compose 文件

新建一个空文件夹，从下面选择**一份**完整配置，保存为 `compose.yaml`。不要把两份配置同时启动。

### 推荐：完整 TeX Live 2026.1＋沙箱编译

```yaml
name: rogerleaf
services:
  sharelatex:
    image: ${ROGERLEAF_IMAGE:-rogerleaf:personal-ai}
    restart: unless-stopped
    depends_on:
      mongo:
        condition: service_healthy
      redis:
        condition: service_healthy
    ports:
      - "${BIND_ADDRESS:-127.0.0.1}:${APP_PORT:-8080}:80"
    volumes:
      - overleaf-data:/var/lib/overleaf
      - /var/run/docker.sock:/var/run/docker.sock
    environment:
      OVERLEAF_APP_NAME: Rogerleaf
      OVERLEAF_SITE_URL: ${SITE_URL:-http://localhost:8080}
      OVERLEAF_SITE_LANGUAGE: zh-CN
      OVERLEAF_MONGO_URL: mongodb://mongo/sharelatex?replicaSet=overleaf
      OVERLEAF_REDIS_HOST: redis
      REDIS_HOST: redis
      ENABLED_LINKED_FILE_TYPES: project_file,project_output_file,url
      EMAIL_CONFIRMATION_DISABLED: "true"
      OVERLEAF_ALLOW_PUBLIC_REGISTRATION: "true"
      OVERLEAF_TEMPLATE_GALLERY: "true"
      GIT_BRIDGE_ENABLED: "false"
      ENABLE_PANDOC_CONVERSIONS: "false"
      SANDBOXED_COMPILES: "true"
      TEX_LIVE_DOCKER_IMAGE: ghcr.io/ayaka-notes/texlive-full:2026.1
      COMPILE_TIMEOUT: "180"
    stop_grace_period: 60s
    healthcheck:
      test: [CMD, curl, --fail, --silent, --output, /dev/null, http://127.0.0.1/login]
      interval: 15s
      timeout: 10s
      retries: 20
      start_period: 20m
  mongo:
    image: mongo:8.0
    restart: unless-stopped
    command: [mongod, --replSet, overleaf, --bind_ip_all]
    volumes:
      - mongo-data:/data/db
    healthcheck:
      test:
        - CMD
        - mongosh
        - --quiet
        - --eval
        - "try { rs.status() } catch (e) { if (e.code === 94) rs.initiate({_id:'overleaf',members:[{_id:0,host:'mongo:27017'}]}); else throw e; } quit(db.hello().isWritablePrimary ? 0 : 1)"
      interval: 5s
      timeout: 10s
      retries: 30
      start_period: 30s
  redis:
    image: redis:7.4-alpine
    restart: unless-stopped
    command: [redis-server, --appendonly, "yes"]
    volumes:
      - redis-data:/data
    healthcheck:
      test: [CMD, redis-cli, ping]
      interval: 5s
      timeout: 5s
      retries: 10
volumes:
  overleaf-data:
  mongo-data:
  redis-data:
```

沙箱版把编译任务放在独立容器里。Docker socket 挂载用于创建和回收这些容器，也使主应用拥有管理该 Docker 引擎的权限。

### 基础版

```yaml
name: rogerleaf
services:
  sharelatex:
    image: ${ROGERLEAF_IMAGE:-rogerleaf:personal-ai}
    restart: unless-stopped
    depends_on:
      mongo:
        condition: service_healthy
      redis:
        condition: service_healthy
    ports:
      - "${BIND_ADDRESS:-127.0.0.1}:${APP_PORT:-8080}:80"
    volumes:
      - overleaf-data:/var/lib/overleaf
    environment:
      OVERLEAF_APP_NAME: Rogerleaf
      OVERLEAF_SITE_URL: ${SITE_URL:-http://localhost:8080}
      OVERLEAF_SITE_LANGUAGE: zh-CN
      OVERLEAF_MONGO_URL: mongodb://mongo/sharelatex?replicaSet=overleaf
      OVERLEAF_REDIS_HOST: redis
      REDIS_HOST: redis
      ENABLED_LINKED_FILE_TYPES: project_file,project_output_file,url
      EMAIL_CONFIRMATION_DISABLED: "true"
      OVERLEAF_ALLOW_PUBLIC_REGISTRATION: "true"
      OVERLEAF_TEMPLATE_GALLERY: "true"
      GIT_BRIDGE_ENABLED: "false"
      ENABLE_PANDOC_CONVERSIONS: "false"
      SANDBOXED_COMPILES: "false"
      SANDBOXED_COMPILES_SIBLING_CONTAINERS: "false"
      DOCKER_RUNNER: "false"
      COMPILE_TIMEOUT: "180"
    stop_grace_period: 60s
    healthcheck:
      test: [CMD, curl, --fail, --silent, --output, /dev/null, http://127.0.0.1/login]
      interval: 15s
      timeout: 10s
      retries: 20
      start_period: 120s
  mongo:
    image: mongo:8.0
    restart: unless-stopped
    command: [mongod, --replSet, overleaf, --bind_ip_all]
    volumes:
      - mongo-data:/data/db
    healthcheck:
      test:
        - CMD
        - mongosh
        - --quiet
        - --eval
        - "try { rs.status() } catch (e) { if (e.code === 94) rs.initiate({_id:'overleaf',members:[{_id:0,host:'mongo:27017'}]}); else throw e; } quit(db.hello().isWritablePrimary ? 0 : 1)"
      interval: 5s
      timeout: 10s
      retries: 30
      start_period: 30s
  redis:
    image: redis:7.4-alpine
    restart: unless-stopped
    command: [redis-server, --appendonly, "yes"]
    volumes:
      - redis-data:/data
    healthcheck:
      test: [CMD, redis-cli, ping]
      interval: 5s
      timeout: 5s
      retries: 10
volumes:
  overleaf-data:
  mongo-data:
  redis-data:
```

## 3. 按访问方式检查设置

个人电脑本机使用时，保持默认值即可。需要局域网或服务器访问时，在同一文件夹新建可选的 `.env`：

```dotenv
SITE_URL=http://192.168.1.10:8080
BIND_ADDRESS=0.0.0.0
APP_PORT=8080
```

| 设置 | 含义 |
| --- | --- |
| `SITE_URL` | 浏览器实际访问地址，填写自己的 IP 或域名。使用 HTTPS 反向代理时填写外部 HTTPS 地址。 |
| `BIND_ADDRESS` | 默认 `127.0.0.1` 只允许本机访问。局域网或服务器按需改为 `0.0.0.0`。 |
| `APP_PORT` | 对外端口。默认 8080，端口被占用时修改，并同步修改访问地址中的端口。 |
| 三个数据卷 | 分别保存应用文件与密钥、数据库、Redis 数据。再次启动时保留这些卷。 |

## 4. 启动

在 Compose 文件所在目录打开终端，执行：

```sh
docker compose up -d
docker compose logs -f sharelatex
```

首次下载镜像可能较慢。完整版下载结束后才继续启动应用。日志里的 TeX Live 下载进度表示初始化仍在进行。按 Ctrl+C 退出日志查看不会停止服务。

查看启动状态：

```sh
docker compose ps
```

应用显示 healthy 后，打开 <http://localhost:8080/launchpad> 创建管理员。使用自定义地址时，将 localhost:8080 替换为实际地址。已有管理员时直接登录。

## 5. 停止与再次启动

```sh
docker compose stop
docker compose up -d
```

先启动 Docker，再启动 Rogerleaf。关闭网页不会停止后台服务。停止服务时保留数据卷，下一次启动即可继续使用。
