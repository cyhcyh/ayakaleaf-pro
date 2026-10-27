// Paired copy keeps the four guides aligned across the supported UI languages.
export const guides = {
  review: {
    title: ['AI 审阅', 'AI review'],
    intro: ['让 AI 根据你的要求检查论文，并把具体意见写入审阅面板。', 'Ask AI to review your paper and add specific findings as comments in the Review panel.'],
    steps: [
      ['打开 AI 助手，说明要检查的章节、重点和要求。', 'Open the AI assistant and describe the sections, focus and requirements.'],
      ['按需上传参考 PDF，提供项目文件名称或网页链接。助手可以查找和阅读这些资料。', 'Upload reference PDFs, name project files or provide web links. The assistant can find and read these sources.'],
      ['核对助手提出的审阅范围，确认后开始。需要时可以停止审阅。', 'Check the proposed scope and approve it to start. You can stop the review when needed.'],
      ['打开审阅面板，点击评论查看对应位置，逐条讨论或解决。', 'Open the Review panel. Select comments to locate the text, reply or resolve them.'],
    ],
    example: ['请审阅引言和主要定理，重点检查定义是否完整、证明是否缺少前提。参考项目中的 reference.pdf。', 'Review the introduction and main theorem. Check for missing definitions and assumptions in the proof. Use reference.pdf in this project.'],
    note: ['审阅意见是评论。需要修改正文时，继续告诉助手具体要求。', 'Review findings are comments. Tell the assistant when you want it to propose changes to the text.'],
  },
  edits: {
    title: ['AI 修改', 'AI edits'],
    intro: ['让 AI 提出修改建议，查看差异后决定是否应用。', 'Ask AI to propose changes, then inspect the differences before applying them.'],
    steps: [
      ['在 AI 助手中说明修改目标，可以先选中需要处理的文字。', 'Describe your editing goal in the AI assistant. You can select the relevant text first.'],
      ['打开左侧 AI 修改面板，查看待确认的建议。', 'Open AI edits in the left rail to see pending suggestions.'],
      ['点击文件和行号定位正文，移到建议上查看对应区域，展开“查看差异”。', 'Select the file and line to locate the text. Hover over a suggestion to highlight its range, and expand View changes.'],
      ['逐条接受或拒绝。接受后可以撤销，也可以重新应用已撤销的建议。', 'Accept or reject each suggestion. Accepted changes can be undone, and undone changes can be reapplied.'],
    ],
    example: ['请润色引言，使表达更清楚简洁，保留所有公式、引用和数学含义。', 'Polish the introduction for clarity and concision. Preserve all formulas, citations and mathematical meaning.'],
    note: ['如果正文后来有变化，先核对位置和差异，再决定是否接受。', 'If the source has changed since the suggestion was made, check its location and differences before accepting it.'],
  },
  translation: {
    title: ['划词翻译', 'Selection translation'],
    intro: ['在 LaTeX 编辑区或 PDF 预览中划选文字，查看原文和译文。', 'Select text in the LaTeX editor or PDF preview to see the original and its translation.'],
    steps: [
      ['选中词语或句子，选区末端会出现绿色小圆点。将鼠标移到圆点上打开译文。', 'Select a word or sentence. Move the pointer over the green dot at the end of the selection to open the translation.'],
      ['气泡中的原文默认显示两行，可以展开。长译文在气泡内滚动查看。', 'The original text shows two lines by default and can be expanded. Scroll inside the bubble for long translations.'],
      ['在气泡顶部切换翻译服务，在译文标题旁选择目标语言。', 'Choose a translation service at the top of the bubble and a target language next to the translation heading.'],
      ['需要保留结果时固定气泡，或使用复制按钮。大模型和 Codex 支持流式译文，公式可直接显示。', 'Pin the bubble or copy the result when needed. AI models and Codex stream translations, with formulas rendered in the text.'],
    ],
    note: ['在设置 → AI 与翻译中启用划词翻译。Google 免 Key 和 MyMemory 可直接选择，大模型需要先配置连接和翻译模型。', 'Enable selection translation in Settings → AI & translation. Google without a key and MyMemory are available as service choices. AI translation requires a connection and translation model.'],
  },
  advanced: {
    title: ['高级功能说明', 'Advanced features'],
    intro: ['这里列出常用功能的入口，以及需要谁完成配置。站点未开启的集成会在集成面板中显示说明。', 'Find feature entry points and see who needs to configure them. Disabled integrations show an explanation in the Integrations panel.'],
    features: [
      ['AI 与翻译', 'AI & translation', 'AI 助手在左侧菜单中。个人模型、Codex、翻译服务、上下文压缩和历史清理在设置 → AI 与翻译中配置。', 'Open AI assistant from the left rail. Configure personal models, Codex, translation, context compression and history cleanup in Settings → AI & translation.'],
      ['会话与错误助手', 'Conversations and error assistant', '助手顶部可管理历史会话。编译日志中的“建议修复”使用个人错误修复模型。', 'Manage conversation history at the top of the assistant. Suggest fix in compile logs uses your error-fixing model.'],
      ['审阅与项目历史', 'Review and project history', '左侧审阅面板管理评论和修订。顶部历史入口可查看、恢复和下载项目历史。', 'Manage comments and tracked changes in the Review panel. Use History at the top to inspect, restore or download past project versions.'],
      ['文献管理与搜索', 'References and search', '插入引用时搜索项目中的 Bib 条目。Zotero、Mendeley 由管理员启用后，在账户设置 → 文献管理器中关联个人账户。', 'Search project Bib entries when inserting citations. After an administrator enables Zotero or Mendeley, link your account in Account settings → Reference managers.'],
      ['项目同步', 'Project synchronization', 'GitHub、GitLab、Gitea、Dropbox 在项目的集成面板中打开，需要管理员先配置站点应用，再由用户关联账户。', 'Open GitHub, GitLab, Gitea or Dropbox from project Integrations. An administrator configures the site application before users link their own accounts.'],
      ['Git 与 MCP', 'Git and MCP', 'Git 可将论文拉取到本地并推送修改。MCP 让外部 AI 编辑、编译和评论。两者当前默认关闭，需管理员部署启用。', 'Git lets you pull project files locally and push changes. MCP lets external AI edit, compile and comment. Both are disabled by default and require administrator deployment.'],
      ['Word 与 Markdown 转换', 'Word and Markdown conversion', 'Pandoc 启用后，可导入 Word、Markdown，并从文件菜单导出其他格式。当前默认关闭，需管理员配置。', 'When Pandoc is enabled, import Word or Markdown and export other formats from the File menu. It is disabled by default and requires administrator configuration.'],
      ['Python 与数学符号', 'Python and math symbols', '打开项目中的 .py 文件可运行浏览器内的 Python。支持的库取决于 Pyodide。编辑器工具栏提供数学符号入口。', 'Open a .py project file to run Python in the browser. Available libraries depend on Pyodide. The editor toolbar also provides a math symbol panel.'],
      ['模板与界面语言', 'Templates and language', '从项目列表进入模板库。设置 → 外观可选择简体中文或 English。', 'Open the template gallery from the project list. Choose Simplified Chinese or English in Settings → Appearance.'],
      ['管理与登录', 'Administration and login', '管理员通过管理菜单管理用户、项目和集成。自助注册及 LDAP、SAML、OIDC 单点登录由站点部署配置决定。', 'Administrators manage users, projects and integrations from the Admin menu. Self-registration and LDAP, SAML or OIDC single sign-on depend on site configuration.'],
      ['编译环境', 'Compilation environment', '推荐使用完整 TeX Live 2026.1 沙箱环境。编译时限由管理员设置，当前默认 180 秒。', 'The full TeX Live 2026.1 sandbox is recommended. Administrators set compilation limits, with a current default of 180 seconds.'],
      ['部署平台', 'Deployment platforms', '本项目使用 Docker。ARM 设备需要对应架构的应用和 TeX 镜像。', 'This project uses Docker. ARM devices need application and TeX images built for that architecture.'],
    ],
  },
}
