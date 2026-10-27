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
  become native comments after approval. Stopping revokes the current review round.
- Model catalogs persist per connection. Search/select or enter a model ID; fetch
  and test actions share one row. Feature assignments are full-width list cards.
  Thinking mode and effort are checked against provider metadata or known model
  capabilities, rather than sending unsupported parameters to every model.
- The flat Context Compression subtab selects its own connection/model and
  policy. Compression retains whole initial/recent turns and incremental summaries;
  original messages stay available in history. Unknown capacities can be entered
  in advanced settings. Token budgeting is an estimate, not a provider tokenizer.
- History lives per user/project. The header button before the settings gear opens
  search, switching, rename and batch deletion. Restoring never replays interrupted
  tools or restores review authorization.
- Source suggestions are queued in the independent AI 修改 rail panel with editor diff previews.
  Accept/reject each suggestion; accepted changes support persisted undo/reapply.
  Native minimal editor transactions preserve collaboration and project history.
  Conflicting source changes stop the operation for manual rechecking. The edit
  ledger is separate from chats and survives chat deletion.
- Translation renders math with the existing sanitized Markdown/KaTeX renderer.
  Recognized TeX formulas are protected during translation and copied verbatim.

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

The settings-tab and rail-entry module slots are additive. Source editor preview
decorations/components register through the existing extension slots. Review the small integration changes
in `settings.defaults.js`, `settings-modal-context.tsx`, the workbench controller,
AI client, router/access hook and error-assistant router when merging upstream.
The native review panel is restored without a wrapper. The rail key union and
default width include the independent AI edit pane. Keep these small seams when
merging. Project data cleanup attaches to the existing `projectExpired` hook,
without changing upstream trash/restore or retention behavior.

History search matches titles and user/assistant text, with a bounded snippet.
Data Management clears only the signed-in user's history, for the current project
or all their projects. Empty current drafts are not history entries. Deleted
session markers prevent stale autosaves from resurrecting messages.
Permanent project expiry deletes AI collections and both legacy and new reference
files. New attachments live under `references/projects/<projectId>/<userId>/`.
A content-free project marker serializes writes with expiry and rejects late
requests. Failed file removal keeps the reference metadata for retry.
Unknown model capacities use 256,000 tokens; unknown summary output limits use
8,192 tokens, still bounded by the configured target and actual model limits.
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
