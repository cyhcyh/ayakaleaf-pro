<p align="center"><img src="rogerleaf-logo.svg" alt="Rogerleaf" width="360"></p>

# Rogerleaf

Rogerleaf 是基于 [ayakaleaf-pro](https://github.com/ayaka-notes/ayakaleaf-pro) 二次开发的自托管 LaTeX 编辑器，上游建立在 [Overleaf](https://github.com/overleaf/overleaf) 之上。本项目主要改进论文阅读、审阅和修改中的个人 AI 工作流程。

- **划词翻译**：在编辑器或 PDF 中选中文字，移到绿色圆点查看原文和译文。支持公式、长内容滚动和大模型流式翻译。
- **自定义模型与 Codex**：每个用户保存自己的模型连接，为各功能分配模型和推理设置，也支持 Codex 账户授权。
- **AI 审阅**：与助手讨论审阅范围和参考资料，确认后将具体意见写入审阅面板的评论。
- **AI 修改**：查看与正文对应的建议和差异，逐条接受或拒绝，接受后可以撤销。
- **会话管理**：创建、搜索和管理项目会话，支持搜索对话内容与批量删除。
- **上下文压缩**：设置摘要模型和压缩阈值，同时保留完整会话历史供查看。

## 开始使用

- [快速部署](DEPLOYMENT-ZH.md) · [Quick deployment](DEPLOYMENT-EN.md)
- [可选高级配置](ADVANCED-CONFIGURATION-ZH.md) · [Advanced configuration](ADVANCED-CONFIGURATION-EN.md)
- [English introduction](../README.md)

编辑器“帮助”中提供 AI 审阅、AI 修改、划词翻译和高级功能说明。推荐使用完整 TeX Live 2026.1＋沙箱编译版。Git Bridge、MCP、Pandoc 默认关闭。

## 上游与维护

本项目保留上游署名、许可证声明和有效资源链接。[上游文档](https://ayakaleaf-pro.ayaka.space/)介绍原项目。维护本分支时可阅读[扩展维护说明](EXTENSIONS.md)和[镜像发布说明](RELEASING.md)。

## License

The code in this repository is released under the GNU AFFERO GENERAL PUBLIC LICENSE, version 3. A copy can be found in the [`LICENSE`](../LICENSE) file.

- Copyright (c) Overleaf, 2014-2025.
- Copyright (c) [Pro Authors](https://ayakaleaf-pro.ayaka.space/on-premises/readme/features-and-copyright), 2026-now.
