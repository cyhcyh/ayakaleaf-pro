# Publishing Rogerleaf images

This page is for maintainers. End-user startup instructions are in DEPLOYMENT-EN.md and DEPLOYMENT-ZH.md.

Build and publish a fixed application version:

```powershell
./deploy/personal-ai/build.ps1 -ImageTag YOUR_ACCOUNT/rogerleaf:VERSION
docker push YOUR_ACCOUNT/rogerleaf:VERSION
```

Before distributing a release, replace the default application image in both Compose files and their copied examples in the two deployment guides. End users receive a complete Compose file with the released image already filled in.

The application build excludes `.env`, `.local`, Git metadata and site data. Keep runtime encryption keys and credentials in the persistent application volume. Publish an ARM application image only after building and testing it with a compatible TeX image on that architecture.

Rogerleaf is based on Ayakaleaf Pro and Overleaf. Keep their license notices and source attribution. Valid upstream URLs and old encryption format identifiers remain unchanged where compatibility requires them.
