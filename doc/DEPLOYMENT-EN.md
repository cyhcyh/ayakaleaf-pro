# Docker deployment for this fork

This fork adds personal AI connections, selection translation, conversation history, AI edits, integration settings and a Chinese/English interface.

## Prepare a release

1. Build the application image with `deploy/personal-ai/build.ps1`.
2. Tag it with your DockerHub repository and a fixed version, then push it.
3. Replace the default `AYAKALEAF_IMAGE` in the root `compose.yaml` with that published image.
4. Distribute the Compose file. Initialization scripts are included in the image.

```powershell
./deploy/personal-ai/build.ps1 -ImageTag YOUR_ACCOUNT/ayakaleaf-pro:VERSION
docker push YOUR_ACCOUNT/ayakaleaf-pro:VERSION
```

The image contains no site data, accounts, personal credentials or local `.env` file.

## Start a new site

Install Docker Engine and Compose, or Docker Desktop in Linux container mode. Put the release's `compose.yaml` in a new directory and run:

```sh
docker compose up -d
docker compose logs -f sharelatex
```

The first start initializes MongoDB, generates persistent site secrets and downloads `ghcr.io/ayaka-notes/texlive-full:2026.1`. The application starts after the large TeX image is ready. Download status appears in the logs.

Open <http://localhost:8080/launchpad> to create the administrator. The default port binds only to the local machine.

For server deployment, set `SITE_URL` to the public address, and set `BIND_ADDRESS=0.0.0.0` and `APP_PORT` as needed. An optional `.env` next to the Compose file can provide these values. With an HTTPS reverse proxy, use its external HTTPS address for `SITE_URL`.

```dotenv
AYAKALEAF_IMAGE=YOUR_ACCOUNT/ayakaleaf-pro:VERSION
SITE_URL=https://latex.example.com
BIND_ADDRESS=0.0.0.0
APP_PORT=8080
```

## Sandboxed compilation

The application uses the mounted Docker socket to manage separate compile containers. This gives the application management access to that Docker engine. Keep this boundary explicit and do not accept arbitrary user-supplied compile image names.

Compile, output and cache paths are discovered from the application's data volume. The default deployment uses only TeX Live 2026.1. Users press the existing Recompile button. Containers share the image and use separate project working directories.

Legacy Basic projects without a saved image use the deployment default without rewriting their records. Projects with another explicitly selected image require that image to remain available, or a planned migration.

## Integrations and language

- Open Admin → Integration settings from the project list to configure site applications for GitHub, GitLab, Gitea, Dropbox, Zotero and Mendeley.
- Register applications with the providers and enter the displayed callback URLs in their developer settings.
- After saving, run `docker compose restart sharelatex` and reload the settings page.
- Users link their own accounts. Zotero and Mendeley authorization opens in a separate browser window.
- Git and MCP require a separately deployed Git Bridge service. The main Compose file does not enable these services. MCP keeps its existing direct-edit workflow.
- Choose Simplified Chinese or English in Settings → Appearance → Interface language. The preference is saved to the account.

Personal model connections are configured under AI & translation.

## Data and upgrades

Site data, encryption keys and integration settings live in the `overleaf-data` volume. MongoDB and Redis have separate persistent volumes. Back up both application data and MongoDB. Existing encrypted credentials need the original encryption keys.

Back up before upgrading. Change the application image to the new fixed version, then run:

```sh
docker compose pull
docker compose up -d
```

Keep the volumes. `docker compose down -v` deletes persistent data and is not an upgrade command.

The older local development deployment uses a different Compose project name. Reuse or copy its volumes deliberately when migrating. Starting the new Compose project with empty volumes creates a new site.
