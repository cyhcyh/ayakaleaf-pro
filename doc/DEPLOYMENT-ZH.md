# 此分支的 Docker 部署

本分支包含个人 AI 设置、划词翻译、会话管理、AI 修改、集成配置和中英文界面。

## 发布者准备

1. 使用 `deploy/personal-ai/build.ps1` 构建应用镜像。
2. 给镜像添加自己的 DockerHub 仓库名和固定版本标签，上传 DockerHub。
3. 将根目录 `compose.yaml` 中 `AYAKALEAF_IMAGE` 的默认值替换为已发布的镜像地址。
4. 把这一份 Compose 文件交给部署者。初始化程序已经包含在应用镜像里。

示例（将 `YOUR_ACCOUNT` 和版本号替换为自己的值）：

```powershell
./deploy/personal-ai/build.ps1 -ImageTag YOUR_ACCOUNT/ayakaleaf-pro:VERSION
docker push YOUR_ACCOUNT/ayakaleaf-pro:VERSION
```

应用镜像不包含站点数据、账户、模型凭据或本地 `.env`。

## 首次启动

安装 Docker Engine 和 Compose，或使用 Linux 容器模式的 Docker Desktop。把发布者提供的 `compose.yaml` 放入一个新目录，然后执行：

```sh
docker compose up -d
docker compose logs -f sharelatex
```

首次启动自动初始化数据库、生成并持久保存站点密钥，并下载 `ghcr.io/ayaka-notes/texlive-full:2026.1`。完整镜像较大，下载期间应用尚未就绪。日志会显示下载状态，下载完成后继续启动。

就绪后打开 <http://localhost:8080/launchpad> 创建管理员，再登录使用。默认端口只绑定本机。

部署到服务器时，设置 `SITE_URL` 为实际访问地址，按需设置 `BIND_ADDRESS=0.0.0.0` 和 `APP_PORT`。可以使用同目录的可选 `.env`，也可以直接修改 Compose。通过反向代理提供 HTTPS 时，将 `SITE_URL` 设置为外部 HTTPS 地址。

```dotenv
AYAKALEAF_IMAGE=YOUR_ACCOUNT/ayakaleaf-pro:VERSION
SITE_URL=https://latex.example.com
BIND_ADDRESS=0.0.0.0
APP_PORT=8080
```

## 沙箱编译

主应用通过挂载的 Docker socket 管理独立编译容器。此挂载赋予主应用管理该 Docker 引擎的权限。部署时请保留这一权限边界，不要将任意用户提供的镜像地址作为编译镜像。

编译文件、输出和缓存目录根据应用的数据卷自动定位。默认只使用 TeX Live 2026.1，用户点击原来的“重新编译”即可。每个项目共享同一个镜像，工作文件各自保存。

升级旧的 Basic 部署时，未指定镜像的项目使用部署默认镜像，不批量修改项目记录。已指定其他版本的项目需要保留对应版本，或由管理员明确安排迁移。

## 配置集成和语言

- 项目列表顶部“管理 → 集成配置”用于填写 GitHub、GitLab、Gitea、Dropbox、Zotero、Mendeley 的站点应用凭据。
- 在第三方平台注册应用，把页面提供的回调地址填入第三方应用设置。
- 保存配置后执行 `docker compose restart sharelatex`，再刷新配置页查看状态。
- 用户各自关联第三方账户。Zotero 和 Mendeley 使用官方授权小窗口。
- Git Bridge 和 MCP 需要配套 Git Bridge 服务，主部署文件不会自动启用这些服务。MCP 保持原来的修改方式。
- “设置 → 外观 → 界面语言”选择简体中文或 English，语言偏好保存在个人账户中。

个人模型连接在“AI 与翻译”中配置。

## 数据、升级和备份

应用数据、站点密钥和集成配置保存在 `overleaf-data` 卷，数据库和 Redis 分别使用自己的持久卷。备份时同时备份应用数据卷和数据库。丢失站点密钥会导致已有加密凭据无法解密。

升级前先备份，然后把 Compose 中的应用镜像改为新的固定版本：

```sh
docker compose pull
docker compose up -d
```

保留数据卷。`docker compose down -v` 会删除持久数据，不用于普通升级。

旧的本地开发部署使用不同的 Compose 项目名。迁移时需要明确复用或复制其数据卷，不能直接在旧目录执行新文件后把空白站点当作原站点。
