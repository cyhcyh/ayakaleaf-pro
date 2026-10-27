# Maintaining this branch

Keep extension logic in `services/web/modules` and reuse the existing editor, compilation and integration flows. Avoid copying upstream components when a small hook or wrapper is enough.

## Integration settings and interface language

`modules/site-settings` owns the administrator page, encrypted settings, language preference, and extension translations. `deploy/runtime/bootstrap.mjs` applies saved settings before Overleaf starts. Credentials remain in the persistent data volume and are excluded from the application image.

The native integration controllers keep their token exchange and storage logic. `tpr-webmodule` adds a popup completion page for Zotero and Mendeley. Ordinary redirect callbacks still work. MCP's editing and authorization behavior is unchanged.

The main upstream merge points are the module list, translation middleware, optional `User.uiLanguage` field, Appearance settings, integration cards and admin navigation. Compilation has a small default-image fallback for older projects without `imageName`. The startup image check still validates explicitly selected images.

## Deployment

`compose.yaml` is the distribution entry point. Publish the custom application image and replace its default image reference before distributing the file. Keep the separate TeX Live image at `ghcr.io/ayaka-notes/texlive-full:2026.1` until a version change is explicitly planned.

Use Overleaf's existing Docker runner for project compilation. The bootstrap discovers persistent paths from Docker's mount metadata. It does not rewrite legacy project image metadata.

## Before merging an upstream update

- Review the merge points above and the upstream Docker runner settings.
- Build with `deploy/personal-ai/build.ps1`. It runs workbench and site-settings tests before compiling the frontend.
- Check TypeScript diagnostics against the upstream baseline. The current source tree has pre-existing diagnostics, so a nonzero exit alone does not identify an extension regression.
- Test fresh Compose startup, upgrade with existing data, Chinese XeLaTeX with bibliography, PDF download and SyncTeX.
- Check both interface languages, administrator permissions, saved configuration after restart, OAuth popup completion and cancellation, translation bubbles, and accepting and undoing AI edits.
- Test OAuth with real application credentials before declaring a provider ready for deployment.

Back up the database and application data volume together before upgrading an existing installation.

Rogerleaf's Help copy and shared administrator styling live in `modules/site-settings`. The original forms, action handlers and permission checks remain in their upstream components.

Administrator pages share `admin-nav`, `admin-page-header` and scoped `admin.scss` styles. The server-rendered site page uses the matching Pug sidebar. User and project filters reuse the native filter components, and the native table actions, dialogs and license tab remain in place. `DefaultNavbar` has an optional `showThemeToggle` prop for administrator React pages; other callers keep the upstream default. Integration accordions keep form state mounted while collapsed and save one provider at a time. The integration page receives the same user-settings metadata and context providers as the native administrator pages.

Run locale preparation and extraction before building frontend assets. `check-locales.mjs` checks the integration keys in both server dictionaries and the extracted frontend key list. Do not overwrite the generated extraction with a checkout copy after this step.

AI edit card positioning is isolated in `modules/workbench/shared/edit-panel-layout.mjs`. Dense card groups are bounded by the filter bar, and their full height contributes to the scroll extent. This keeps every card reachable without changing native review-panel state or edit acceptance handlers.

Sandbox cleanup policy lives in `services/clsi/app/js/RogerleafSandbox.mjs`. The existing Docker runner applies instance labels and rechecks idle state under its container lock. Expiry uses each stopped container's own finish time, independent of other compiles for the same project. Never-started containers use their creation time. Startup scanning begins five seconds after cache initialization, then repeats every ten minutes. Containers without labels are eligible only when their image and `/compile` mount match this instance. The historical integration-encryption AAD remains unchanged so old credentials stay readable.
