# Publishing Rogerleaf images

This page is for maintainers. End-user startup instructions are in DEPLOYMENT-EN.md and DEPLOYMENT-ZH.md.

The published application repository is `roger1001/rogerleaf`. Deployment files
default to `roger1001/rogerleaf:latest`. The current release also has the fixed
tag `roger1001/rogerleaf:0.1.0` and supports `linux/amd64`.

Build and publish a new fixed application version. Replace `VERSION` with the
new release version:

```powershell
./deploy/personal-ai/build.ps1 -ImageTag roger1001/rogerleaf:VERSION
docker push roger1001/rogerleaf:VERSION
docker tag roger1001/rogerleaf:VERSION roger1001/rogerleaf:latest
docker push roger1001/rogerleaf:latest
```

Deployment files and their copied examples in the two deployment guides retain
the `latest` default. Keep the current fixed-version information above in sync
with each release. End users receive a complete Compose file with the published
image already filled in.

The application build excludes `.env`, `.local`, Git metadata and site data. Keep runtime encryption keys and credentials in the persistent application volume. Publish an ARM application image only after building and testing it with a compatible TeX image on that architecture.

Rogerleaf is based on Ayakaleaf Pro and Overleaf. Keep their license notices and source attribution. Valid upstream URLs and old encryption format identifiers remain unchanged where compatibility requires them.
