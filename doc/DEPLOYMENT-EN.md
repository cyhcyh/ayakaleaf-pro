# Rogerleaf quick deployment

Install Docker Desktop in Linux-container mode, or Docker Engine with Compose. These steps work on a personal computer or a server.

The default application image is `roger1001/rogerleaf:latest`. The current release supports `linux/amd64`.

## 1. Choose a version

**Recommended: full TeX Live 2026.1 with sandboxed compilation.** It includes more packages and fonts for Chinese papers and complex templates. The first start downloads the TeX image automatically. The unpacked image is about 28.8 GB. Allow additional space for downloading, unpacking and application data.

The basic version uses the application's bundled basic TeX environment for a simple trial. Choose the full version when packages or fonts are missing. Both versions include Rogerleaf's AI and translation features.

## 2. Save one Compose file

Create an empty folder. Choose **one** complete configuration below and save it as `compose.yaml`. Start only one version.

### Recommended: full TeX Live 2026.1 with sandboxed compilation

```yaml
name: rogerleaf
services:
  sharelatex:
    image: roger1001/rogerleaf:latest
    restart: unless-stopped
    depends_on:
      mongo:
        condition: service_healthy
      redis:
        condition: service_healthy
    ports:
      - "8080:80"
    volumes:
      - overleaf-data:/var/lib/overleaf
      - /var/run/docker.sock:/var/run/docker.sock
    environment:
      OVERLEAF_APP_NAME: Rogerleaf
      OVERLEAF_SITE_URL: http://localhost:8080
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

The sandbox version runs compilation in separate containers. The Docker socket mount lets the application create and reclaim these containers. It also grants the application control of that Docker engine.

### Basic version

```yaml
name: rogerleaf
services:
  sharelatex:
    image: roger1001/rogerleaf:latest
    restart: unless-stopped
    depends_on:
      mongo:
        condition: service_healthy
      redis:
        condition: service_healthy
    ports:
      - "8080:80"
    volumes:
      - overleaf-data:/var/lib/overleaf
    environment:
      OVERLEAF_APP_NAME: Rogerleaf
      OVERLEAF_SITE_URL: http://localhost:8080
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

## 3. Check the access settings

The default port mapping is `8080:80`. The left side is the port on your computer, server, or NAS. The right side is the container port. If 8080 is occupied, change the entry in Compose to `18080:80` and update the port in the access address. Keep the container port at 80.

The default listens on all network interfaces. For use on the same computer, keep the default access address. For LAN, server, or NAS access, edit `OVERLEAF_SITE_URL` under the `sharelatex` service directly in Compose. Use the address users will open in their browsers, for example:

```yaml
OVERLEAF_SITE_URL: http://192.168.1.10:8080
```

| Setting | Meaning |
| --- | --- |
| `OVERLEAF_SITE_URL` | The address users open in their browsers. Enter your IP address or domain. With an HTTPS reverse proxy, use the external HTTPS address. |
| `ports` | Defaults to `8080:80`. If you change the port on the left, update the port in `OVERLEAF_SITE_URL` too. |
| Three data volumes | Store application files and keys, the database, and Redis data. Keep these volumes when restarting. |

## 4. Start

Open a terminal in the folder containing the Compose file:

```sh
docker compose up -d
docker compose logs -f sharelatex
```

Initial image downloads can take time. The full version starts the application after the TeX image is ready. TeX Live progress messages mean initialization is still running. Press Ctrl+C to stop following logs without stopping the service.

Check startup status:

```sh
docker compose ps
```

When the application is healthy, open <http://localhost:8080/launchpad> to create the administrator. Replace localhost:8080 if you changed the access address. If an administrator already exists, log in directly.

## 5. Stop and start again

```sh
docker compose stop
docker compose up -d
```

Start Docker before starting Rogerleaf. Closing the browser does not stop the service. Keep the data volumes so your work remains available at the next start.

## 6. Optional: store data in folders you choose

The default configuration uses named volumes created by Docker, so no folders need to be prepared. To store data in specific folders, make the following changes **before the first deployment**. These steps apply to both versions.

1. Create a `rogerleaf` folder on a local disk of your Linux server or NAS. Inside it, create three subfolders: `app`, `mongo`, and `redis`.
2. Find each service's `volumes` section in Compose and replace the mount entries as shown below. The left side is the host path. Keep the container path after the colon unchanged.

| Service | Original mount | Replacement example |
| --- | --- | --- |
| `sharelatex` | `overleaf-data:/var/lib/overleaf` | `/volume1/docker/rogerleaf/app:/var/lib/overleaf` |
| `mongo` | `mongo-data:/data/db` | `/volume1/docker/rogerleaf/mongo:/data/db` |
| `redis` | `redis-data:/data` | `/volume1/docker/rogerleaf/redis:/data` |

`/volume1/docker/rogerleaf` is only an example. Replace it with the **actual absolute path** of the folder you created. UGREEN and QNAP paths may differ, so use the path shown by your NAS and ensure each container can write to its folder. For Docker Desktop on Windows, keep the default named volumes.

3. Remove the following block at the very bottom of the file. Keep each service's `volumes` section and, for the sandbox version, the Docker socket mount.

```yaml
volumes:
  overleaf-data:
  mongo-data:
  redis-data:
```

Then start the application as described in section 4. Sandbox compilation folders are prepared automatically.

**If you already have data, do not switch directly to empty folders.** Accounts, projects, and settings in the original volumes are not moved automatically. Back up and stop the services first, copy the complete contents of all three volumes into their matching folders while preserving file permissions, then change the mounts. Keep the original volumes until you have confirmed that all data is intact.
