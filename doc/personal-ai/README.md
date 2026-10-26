# Personal AI, translation and review extensions

This fork adds per-user model connections, Codex authorization, selection translation,
and reference/comment tools to the existing AI assistant. The implementation stays
under `services/web/modules/workbench`, with small integration points in settings,
instance features, and the existing error assistant. Source editing, compilation,
project history and collaboration continue to use the upstream implementations.

## Accepted behavior

- Settings → AI 与翻译: independent user connections and feature/model assignments.
- OpenAI-compatible gateways and Codex device authorization; Google Cloud is an
  optional translation connection. API keys/tokens are encrypted on the server.
- PDF text and LaTeX editor selections show a small green dot. Hover opens the
  original/translation popover. Only the original inside the popover is clamped
  to two lines; expanding does not send another translation request.
- Google keyless, MyMemory, optional Google Cloud and configured LLM translation.
- The assistant can discover uploaded PDF/text references, read project files,
  search public references and extract webpage or linked-PDF text.
- A review starts with a consent tool inside the conversation. Its explicit
  approval is scoped to the user, project, chat and files. Specific findings
  become native comments after approval; ordinary source edits still use the
  existing Apply/Reject workflow. Stopping revokes the current review round.

## Storage and deployment

Keep `OVERLEAF_SESSION_SECRET` stable, or set a separate stable
`PERSONAL_AI_ENCRYPTION_KEY`. Changing the encryption key makes previously saved
credentials unreadable. Never commit either secret or a user's Codex tokens.
The extension uses `personalAi*` Mongo collections and stores reference uploads in
`/var/lib/overleaf/data/personal-ai/references`, inside the existing data volume.

Codex authorization follows the device-code workflow used in the reference
Papers-Go project. `PERSONAL_AI_CODEX_CLIENT_ID` can override its client ID.
Availability depends on the account's authorization and model access. A completed
test response verifies the selected model; a model catalog alone does not.

MyMemory anonymous usage has a daily quota and a short per-request segment limit.
Its automatic source selection supports the common Chinese/English reading case;
Google or an LLM is appropriate for other source languages. Google keyless access
is a web-service compatibility option. Google Cloud needs its own credentials.
Reference tools extract text from readable PDFs and static web content; they
report pages without a text layer instead of inventing OCR results.

Public reference requests reject private networks and pin validated DNS results
on each redirect. If a TUN proxy returns only benchmark-range fake IP addresses,
the reader uses Cloudflare's public DNS-over-HTTPS endpoint for the real public IPv4
address, validates it again and pins that address. Other private DNS answers are
rejected without this fallback.
Reference discovery uses Crossref's public scholarly index, with public web
search as a fallback. Search matches are leads; the assistant must open their
URLs before citing their contents.

## Merging upstream

`origin` points to `cyhcyh/ayakaleaf-pro`, `upstream` to
`ayaka-notes/ayakaleaf-pro`, and `overleaf` to `overleaf/overleaf`.
Prefer merging Ayakaleaf's `server-pro` into the feature branch: it already
integrates Overleaf changes. Merge Overleaf directly only after reviewing its
relationship with Ayakaleaf's changes.

The settings-tab module slot is additive. Review the small integration changes
in `settings.defaults.js`, `settings-modal-context.tsx`, the workbench controller,
AI client, router/access hook and error-assistant router when merging upstream.
Rebuild and validate against an official base image compatible with the selected
upstream revision, rather than copying changed files into an old running image.

## Verification

On Windows, build the local image from the repository root:

```powershell
pwsh -File deploy/personal-ai/build.ps1
```

The builder only receives a Git-enumerated source archive. It never mounts the
working directory or receives `.env`. Override `-BaseImage` when upgrading the
upstream runtime. After verification, set `AYAKALEAF_IMAGE=ayakaleaf-pro:personal-ai`
in the ignored `.env`, then run `docker compose -f docker-compose.local.yml up -d`.

Run the focused backend tests with Node's test runner using the workspace PnP
environment, then run the web TypeScript check and production frontend build.
Check user isolation, masked credential responses, scope/stop enforcement,
reference access, native comment anchors, PDF/source selection translation and
an unchanged basic LaTeX compile before replacing the local application container.
