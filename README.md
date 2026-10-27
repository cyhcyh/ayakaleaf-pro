<p align="center"><img src="doc/rogerleaf-logo.svg" alt="Rogerleaf" width="360"></p>

# Rogerleaf

Rogerleaf is a self-hosted LaTeX editor based on [ayakaleaf-pro](https://github.com/ayaka-notes/ayakaleaf-pro), which builds on [Overleaf](https://github.com/overleaf/overleaf). This fork adds personal AI workflows for reading, reviewing and editing papers.

- **Selection translation:** select text in the editor or PDF preview, then hover over the green dot. View the original and translation together, with formulas, scrolling and streamed AI translations.
- **Custom models and Codex:** save your own model connections and assign models and reasoning settings to each feature. Codex account authorization is also supported.
- **AI review:** discuss the scope and references with the assistant, approve the review, then read its findings as comments in the Review panel.
- **AI edits:** inspect anchored suggestions and differences, accept or reject them, and undo accepted changes.
- **Conversation management:** create, search and manage project conversations, including searching message content and deleting conversations in batches.
- **Context compression:** configure the summarization model and threshold while keeping the full conversation history available.

## Get started

- [Quick deployment](doc/DEPLOYMENT-EN.md) · [快速部署](doc/DEPLOYMENT-ZH.md)
- [Optional advanced configuration](doc/ADVANCED-CONFIGURATION-EN.md) · [高级配置](doc/ADVANCED-CONFIGURATION-ZH.md)
- [简体中文介绍](doc/README-ZH.md)

Use Help in the editor for AI review, AI edits, selection translation and advanced-feature explanations. Full TeX Live 2026.1 with sandboxed compilation is recommended. Git Bridge, MCP and Pandoc remain disabled by default.

## Upstream and maintenance

Rogerleaf preserves upstream attribution, license notices and valid resource URLs. [Upstream documentation](https://ayakaleaf-pro.ayaka.space/) describes the original project. See [extension maintenance](doc/EXTENSIONS.md) and [image release instructions](doc/RELEASING.md) for this fork.

## License

The code in this repository is released under the GNU AFFERO GENERAL PUBLIC LICENSE, version 3. A copy can be found in the [`LICENSE`](LICENSE) file.

- Copyright (c) Overleaf, 2014-2025.
- Copyright (c) [Pro Authors](https://ayakaleaf-pro.ayaka.space/on-premises/readme/features-and-copyright), 2026-now.
