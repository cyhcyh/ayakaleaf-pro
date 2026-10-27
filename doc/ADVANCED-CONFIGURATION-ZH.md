# Rogerleaf 可选高级配置

## 配置前先了解

这些功能均为可选。本文是高级配置说明，不影响快速部署。默认 Compose 不启用 Git Bridge、MCP 或 Pandoc。下方片段合并到现有 Compose 的相应位置，不要重复创建第二个 services 节点。修改 Compose 后执行 docker compose up -d。

## GitHub、GitLab、Gitea、Dropbox、Zotero、Mendeley

推荐通过“管理 → 集成配置”注册并填写站点应用。复制页面显示的回调地址到第三方应用，启用并保存，然后执行 docker compose restart sharelatex。用户再到项目的集成面板或账户设置关联自己的账户。

## 通过 Compose 配置集成

也可以在 sharelatex.environment 中设置下列字段。ID 和密钥必须换成自己的真实应用凭据。管理员界面已保存的对应服务配置优先于环境变量。要改用环境变量，先将界面配置中的相同值同步更新，避免被旧配置覆盖。

```yaml
services:
  sharelatex:
    environment:
      GITHUB_SYNC_ENABLED: "true"
      GITHUB_SYNC_CLIENT_ID: "YOUR_GITHUB_CLIENT_ID"
      GITHUB_SYNC_CLIENT_SECRET: "YOUR_GITHUB_CLIENT_SECRET"
      GITHUB_SYNC_URL: https://github.com

      GITLAB_SYNC_ENABLED: "true"
      GITLAB_SYNC_CLIENT_ID: "YOUR_GITLAB_CLIENT_ID"
      GITLAB_SYNC_CLIENT_SECRET: "YOUR_GITLAB_CLIENT_SECRET"
      GITLAB_SYNC_URL: https://gitlab.com

      GITEA_SYNC_ENABLED: "true"
      GITEA_SYNC_CLIENT_ID: "YOUR_GITEA_CLIENT_ID"
      GITEA_SYNC_CLIENT_SECRET: "YOUR_GITEA_CLIENT_SECRET"
      GITEA_SYNC_URL: https://gitea.com

      DROPBOX_ENABLED: "true"
      DROPBOX_APP_KEY: "YOUR_DROPBOX_APP_KEY"
      DROPBOX_APP_SECRET: "YOUR_DROPBOX_APP_SECRET"

      ENABLED_LINKED_FILE_TYPES: project_file,project_output_file,url,zotero,mendeley
      ZOTERO_CLIENT_ID: "YOUR_ZOTERO_APP_KEY"
      ZOTERO_CLIENT_SECRET: "YOUR_ZOTERO_APP_SECRET"
      MENDELEY_CLIENT_ID: "YOUR_MENDELEY_CLIENT_ID"
      MENDELEY_CLIENT_SECRET: "YOUR_MENDELEY_CLIENT_SECRET"
```

只复制需要的服务字段。GitHub Enterprise、自托管 GitLab 或 Gitea 使用对应服务地址。站点 URL 必须与第三方登记的回调地址一致。重建应用后检查集成配置页的启用状态，再验证个人授权、导入或同步。

## Git Bridge 和 MCP

当前保持关闭。需要时，向同一份 Compose 添加独立 Git Bridge 服务及数据卷，并启用主应用开关。MCP 已在主应用内，不需要单独的 MCP 镜像。Git Bridge 只通过站点的 /git/ 路径访问。以下官方镜像地址已核实存在。

```yaml
services:
  sharelatex:
    environment:
      GIT_BRIDGE_ENABLED: "true"
      GIT_BRIDGE_HOST: git-bridge
      GIT_BRIDGE_PORT: "8000"
  git-bridge:
    image: ghcr.io/ayaka-notes/overleaf-pro/git-bridge@sha256:a50ea127d25a6816b9732dea5fc056ca7c28b1c44a7dbb64a0e06ed6e6537836
    restart: unless-stopped
    user: root
    command: ["/server-pro-start.sh"]
    environment:
      GIT_BRIDGE_API_BASE_URL: http://sharelatex:3000/api/v0
      GIT_BRIDGE_OAUTH2_SERVER: http://sharelatex:3000
      GIT_BRIDGE_POSTBACK_BASE_URL: http://git-bridge:8000
      GIT_BRIDGE_ALLOWED_CORS_ORIGINS: http://localhost:8080
      GIT_BRIDGE_ROOT_DIR: /data/git-bridge
    volumes:
      - git-bridge-data:/data/git-bridge
volumes:
  git-bridge-data:
```

使用自定义访问地址时，同步修改 GIT_BRIDGE_ALLOWED_CORS_ORIGINS。启动后在项目集成面板查看 Git 地址、创建个人访问令牌并复制 MCP 客户端配置。验证 clone、pull、push 和 MCP 的读取、编译、评论。外部 AI 的 MCP 编辑保持原有方式，不进入站内 AI 修改面板。

## Pandoc 导入和导出

当前保持关闭。建议在沙箱版上按需启用。转换使用独立 Pandoc 镜像，不改变 TeX Live 2026.1。先拉取转换镜像，再修改开关。

```sh
docker pull quay.io/sharelatex/pandoc:3.9
```

```yaml
services:
  sharelatex:
    environment:
      ENABLE_PANDOC_CONVERSIONS: "true"
      PANDOC_IMAGE: quay.io/sharelatex/pandoc:3.9
```

重建应用后，从项目列表的新建菜单导入 Word 或 Markdown，在编辑器文件菜单导出 Word、Markdown 或 HTML。先用含公式、图片和参考文献的小文档验证。复杂宏、表格和版式转换后可能需要调整。基础版如要使用此处的沙箱转换方式，先切换到沙箱版。

## LDAP 单点登录

需要已有 LDAP 服务及真实目录字段。下面是示例结构，按目录管理员提供的信息填写。

```yaml
services:
  sharelatex:
    environment:
      EXTERNAL_AUTH: ldap
      OVERLEAF_LDAP_URL: ldaps://ldap.example.com:636
      OVERLEAF_LDAP_BIND_DN: cn=reader,dc=example,dc=com
      OVERLEAF_LDAP_BIND_CREDENTIALS: "YOUR_DIRECTORY_PASSWORD"
      OVERLEAF_LDAP_SEARCH_BASE: ou=people,dc=example,dc=com
      OVERLEAF_LDAP_SEARCH_FILTER: "(uid={{username}})"
      OVERLEAF_LDAP_EMAIL_ATT: mail
      OVERLEAF_LDAP_NAME_ATT: cn
      OVERLEAF_LDAP_TLS_OPTS_REJECT_UNAUTH: "true"
```

重建后检查登录入口，并用目录测试账户验证登录及权限。私有 CA 需要挂载其证书并配置 OVERLEAF_LDAP_TLS_OPTS_CA_PATH。

## SAML 单点登录

需要身份提供方的登录地址、实体 ID、签名证书及属性映射。示例中的证书路径必须在容器内可读。

```yaml
services:
  sharelatex:
    environment:
      EXTERNAL_AUTH: saml
      OVERLEAF_SAML_ENTRYPOINT: https://idp.example.com/saml/login
      OVERLEAF_SAML_ISSUER: rogerleaf
      OVERLEAF_SAML_AUDIENCE: rogerleaf
      OVERLEAF_SAML_IDP_CERT: /etc/rogerleaf/idp.crt
      OVERLEAF_SAML_EMAIL_FIELD: email
      OVERLEAF_SAML_WANT_ASSERTIONS_SIGNED: "true"
    volumes:
      - ./idp.crt:/etc/rogerleaf/idp.crt:ro
```

身份提供方的回调地址填写 SITE_URL/saml/login/callback。先用测试账户验证签名、邮件属性和权限。受身份服务策略影响，额外签名、加密或登出配置应由其管理员提供。

## OIDC 单点登录

在身份提供方注册客户端，填写下面的服务地址和客户端凭据。

```yaml
services:
  sharelatex:
    environment:
      EXTERNAL_AUTH: oidc
      OVERLEAF_OIDC_PROVIDER_ID: organization
      OVERLEAF_OIDC_PROVIDER_NAME: Organization
      OVERLEAF_OIDC_ISSUER: https://idp.example.com
      OVERLEAF_OIDC_AUTHORIZATION_URL: https://idp.example.com/authorize
      OVERLEAF_OIDC_TOKEN_URL: https://idp.example.com/token
      OVERLEAF_OIDC_USER_INFO_URL: https://idp.example.com/userinfo
      OVERLEAF_OIDC_CLIENT_ID: "YOUR_CLIENT_ID"
      OVERLEAF_OIDC_CLIENT_SECRET: "YOUR_CLIENT_SECRET"
      OVERLEAF_OIDC_SCOPE: openid profile email
```

回调地址为 SITE_URL/oidc/login/callback。重建后验证登录、账户关联和权限。可按组织需要增加 OVERLEAF_OIDC_ALLOWED_EMAIL_DOMAINS。保留已验证的管理员登录方式，再安排正式切换。

## 站点默认 AI 与网页搜索

个人模型优先在设置 → AI 与翻译中配置。需要给未配置个人连接的用户提供站点默认模型时，可设置以下字段。网页搜索需要自己的搜索服务凭据。

```yaml
services:
  sharelatex:
    environment:
      AI_ENABLED: "true"
      AI_BASE_URL: https://api.example.com/v1
      AI_API_KEY: "YOUR_MODEL_API_KEY"
      AI_MODEL: "YOUR_MODEL_ID"
      TAVILY_API_KEY: "YOUR_SEARCH_API_KEY"
```

只需要默认模型时可省略搜索字段。用户有个人连接时，使用个人功能分配。重建后检查助手能否聊天和搜索。

## 注册、模板与编译时限

自助注册和模板库在默认 Compose 中已开启。按邮箱域名限制注册时，可将 OVERLEAF_ALLOW_PUBLIC_REGISTRATION 改为 @example.com,@example.org。模板库开关为 OVERLEAF_TEMPLATE_GALLERY。编译时限在管理 → 用户管理 → 更新中调整，目前允许 1～600 秒，默认 180 秒。不要将 README 上游的“不限时”理解为当前没有超时限制。
