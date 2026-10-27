# Rogerleaf optional advanced configuration

## Before configuring

These features are optional. The default Compose does not enable Git Bridge, MCP or Pandoc. Merge snippets into the matching sections of your existing Compose file. Do not create a second services key. Apply Compose changes with docker compose up -d.

## GitHub, GitLab, Gitea, Dropbox, Zotero and Mendeley

Use Admin → Integration settings to configure site applications. Register an application with the provider and copy the callback URL from the page into its settings. Enable and save, then run docker compose restart sharelatex. Users link their own accounts from project Integrations or Account settings.

## Configure integrations through Compose

Alternatively, add the following fields under sharelatex.environment. Replace IDs and secrets with your real application credentials. Saved administrator-page configuration for a provider takes precedence over environment variables. Keep the saved provider values in sync when switching to environment-based configuration.

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

Copy only the providers you need. Use your service address for GitHub Enterprise or self-hosted GitLab/Gitea. The site URL must match registered callbacks. After recreating the application, inspect provider status and verify personal authorization, import or synchronization.

## Git Bridge and MCP

Disabled by default. To use them, add a Git Bridge service and data volume to the same Compose file, and enable the application setting. MCP is part of the application and needs no separate MCP image. Access Git Bridge through the site /git/ path. The upstream image reference below has been verified.

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

Update GIT_BRIDGE_ALLOWED_CORS_ORIGINS for your access address. Open project Integrations for Git URLs, personal access tokens and MCP client configuration. Verify clone, pull, push, and MCP read, compile and comment operations. External MCP edits retain their existing behavior and do not enter the in-app AI edits panel.

## Pandoc import and export

Disabled by default. Enable it on the sandbox deployment when needed. Conversion uses a separate Pandoc image and does not change TeX Live 2026.1. Pull the conversion image before enabling it.

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

After recreating the application, import Word or Markdown from the project-list creation menu and export Word, Markdown or HTML from the editor File menu. Verify with a small document containing formulas, images and references. Complex macros, tables and formatting may need adjustment. Switch the basic deployment to the sandbox version before using this sandbox conversion setup.

## LDAP single sign-on

Requires an existing LDAP server and its directory attributes. Replace the example values with those supplied by your directory administrator.

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

After recreation, check the login entry and verify login and permissions with a directory test account. For a private CA, mount its certificate and set OVERLEAF_LDAP_TLS_OPTS_CA_PATH.

## SAML single sign-on

Requires the identity provider login URL, entity ID, signing certificate and attribute mapping. The certificate path in this example must be readable inside the container.

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

Register SITE_URL/saml/login/callback with the identity provider. Verify signatures, email mapping and permissions with a test account. Obtain any additional signing, encryption or logout settings from the identity administrator.

## OIDC single sign-on

Register a client with your identity provider and enter its endpoints and credentials.

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

The callback is SITE_URL/oidc/login/callback. After recreation, verify login, account linking and permissions. Set OVERLEAF_OIDC_ALLOWED_EMAIL_DOMAINS when needed. Keep a verified administrator login method available before switching production authentication.

## Site-default AI and web search

Configure personal models in Settings → AI & translation. Use these fields when providing a site-default model for users without a personal connection. Web search requires credentials for your search service.

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

Omit the search field if you only need a default model. Personal feature assignments take precedence when configured. Recreate the application and verify chat and search.

## Registration, templates and compilation limits

Self-registration and templates are enabled in the default Compose. To restrict registration by email domain, set OVERLEAF_ALLOW_PUBLIC_REGISTRATION to @example.com,@example.org. OVERLEAF_TEMPLATE_GALLERY controls the gallery. Change compilation limits under Admin → Users → Update. The current allowed range is 1–600 seconds, with a 180-second default. The current application still enforces a timeout.
