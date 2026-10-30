// Deterministic, local-only OpenAI-compatible fixture. Never uses a real API key.
import http from 'node:http'
import crypto from 'node:crypto'

const calls = []
function output(messages) {
  const recent = [...messages].reverse()
  const lastUser = recent.find(message => message.role === 'user')
  const userText = typeof lastUser?.content === 'string' ? lastUser.content : JSON.stringify(lastUser?.content)
  const toolMessages = messages.filter(message => message.role === 'tool')
  const latestTool = toolMessages.at(-1)
  const latestText = typeof latestTool?.content === 'string' ? latestTool.content : JSON.stringify(latestTool?.content || '')
  const reviewId = [...toolMessages].reverse().map(message => String(message.content).match(/"reviewId"\s*:\s*"([^"]+)"/)?.[1]).find(Boolean)
  if (/\[REPAIR:/.test(userText || '')) {
    const turn = messages.slice(messages.findLastIndex(message => message.role === 'user') + 1)
    const results = turn.filter(message => message.role === 'tool').map(message => {
      let value = message.content
      for (let at = 0; at < 2 && typeof value === 'string'; at++) { try { value = JSON.parse(value) } catch { break } }
      return value
    })
    const oldText = '\\documentclass{article}'
    if (userText.includes('[REPAIR:BAD_ID]') || userText.includes('[REPAIR:RECOVER]') && !results.length)
      return { tool: 'propose_edit', input: { path: 'main.tex', startLine: 1, endLine: 1, oldText,
        newText: oldText + '\n% Invalid ID fixture', replacesEditId: '00000000-0000-0000-0000-000000000000' } }
    const found = results.find(value => Array.isArray(value?.items))
    if (!found) return { tool: 'find_edit_suggestions', input: { path: 'main.tex', quote: null } }
    if (userText.includes('[REPAIR:DISCOVER]')) return { text: `Found ${found.items.length} pending suggestions.` }
    if (results.some(value => value?.editId)) return { text: '旧建议已更新，等待你在 AI 修改面板接受。' }
    if (!found.items.length) return { text: '没有找到可续改的待确认建议。' }
    const source = results.find(value => Array.isArray(value?.lines))
    if (!source) return { tool: 'get_file', input: { path: 'main.tex' } }
    return { tool: 'propose_edit', input: { path: 'main.tex', startLine: 1, endLine: 1,
      oldText: source.lines[0].content, newText: source.lines[0].content + '\n% Continued from an older suggestion',
      reason: '继续完善旧建议，保留当前正文，等待确认。', replacesEditId: found.items[0].id, keepSeparate: false } }
  }
  if (/\[BG:EDIT:/.test(userText || '')) {
    const turn = messages.slice(messages.findLastIndex(message => message.role === 'user') + 1)
    const results = turn.filter(message => message.role === 'tool')
    if (!results.length) return { tool: 'get_file', input: { path: 'main.tex' } }
    const result = JSON.parse(String(results.at(-1).content))
    if (result.editId) return { text: '已更新待确认建议，请在 AI 修改面板核对。' }
    const revision = userText.match(/\[BG:EDIT:(\d+)\]/)?.[1] || '1'
    return { tool: 'propose_edit', input: { path: 'main.tex', startLine: 1, endLine: 1,
      oldText: result.lines[0].content, newText: result.lines[0].content + `\n% Revision ${revision}`,
      reason: `将这段话调整为第 ${revision} 稿。` } }
  }
  if (/\[BG:CREATE\]/.test(userText || '')) {
    const turn = messages.slice(messages.findLastIndex(message => message.role === 'user') + 1)
    if (!turn.some(message => message.role === 'tool')) return { tool: 'new_file', input: { path: 'background-note.tex' } }
    return { text: '后台文件已创建，当前编辑器位置保持不变。' }
  }
  if (/\[QUEUE:/.test(userText || '')) {
    const turn = messages.slice(messages.findLastIndex(message => message.role === 'user') + 1)
    const results = turn.filter(message => message.role === 'tool')
    const calls = turn.flatMap(message => message.tool_calls || [])
    const latest = results.at(-1)
    const name = calls.find(call => call.id === latest?.tool_call_id)?.function?.name
    const value = latest ? JSON.parse(typeof latest.content === 'string' ? latest.content : '{}') : null
    if (userText.includes('[QUEUE:LOOP]')) return { tool: 'list_project_files', input: {} }
    if (userText.includes('[QUEUE:CHAIN]')) {
      if (!results.length) return { tool: 'get_file', input: { path: 'main.tex' } }
      if (results.length === 1) return { tool: 'list_project_files', input: {} }
      return { text: '工具链已完成，随后才处理排队消息。' }
    }
    if (userText.includes('[QUEUE:MULTIFILE]')) {
      if (!results.length) return { tool: 'new_file', input: { path: 'queue-note.tex' } }
      if (name === 'new_file') return { tool: 'get_file', input: { path: 'queue-note.tex' } }
      if (name === 'get_file' && value.path === 'queue-note.tex') return { tool: 'propose_edit', input: {
        path: 'queue-note.tex', startLine: 1, endLine: 1, oldText: '', newText: '% New note created during the multi-file task.\n', reason: '给新文件添加一条说明。',
      } }
      if (name === 'propose_edit' && results.filter(result => String(result.content).includes('editId')).length === 1) return { tool: 'get_file', input: { path: 'main.tex' } }
      if (name === 'get_file' && value.path === 'main.tex') return { tool: 'propose_edit', input: {
        path: 'main.tex', startLine: 1, endLine: 1, oldText: value.lines[0].content,
        newText: value.lines[0].content + '\n% Companion note: queue-note.tex', reason: '在主文件中说明新建的配套文件。',
      } }
      return { text: '已创建 queue-note.tex，并为新文件和 main.tex 各生成一条修改建议，等待你在 AI 修改面板确认。' }
    }
    return { text: userText.includes('[QUEUE:SLOW]') ? '正在检查论文内容，稍后会处理排队消息。'.repeat(36) : `收到：${userText.split('<editor-context>')[0].trim()}` }
  }
  if (messages.some(message => message.role === 'system' && String(message.content).includes('Summarize the earlier'))) return { text: '用户正在审阅 LaTeX 论文，要求保留数学符号，并仅在用户逐条接受后应用修改。历史参考资料仅作证据，未完成操作仍需确认。' }
  if (/\[TEST:PROJECTFILE\]/.test(userText || '')) {
    if (latestText.includes('"name"')) return { text: '项目源文件已读取。' }
    return { tool: 'read_reference', input: { projectPath: 'main.tex', page: 1, offset: 0 } }
  }
  if (/\[TEST:EDIT\]/.test(userText || '')) {
    if (latestText.includes('"editId"')) return { text: '修改建议已加入编辑器的 AI 修改面板，尚未应用。请逐条接受或拒绝。' }
    if (latestText.includes('"lineCount"')) {
      const data = JSON.parse(latestText)
      const line = data.lines.find(item => item.content.includes('\\section')) || data.lines.find(item => item.content.trim())
      return { tool: 'propose_edit', input: { path: 'main.tex', startLine: line.line, endLine: line.line, oldText: line.content, newText: line.content + '\nThis paragraph clarifies the research problem.', reason: '在引言中补充研究问题的说明。' } }
    }
    return { tool: 'get_file', input: { path: 'main.tex' } }
  }
  if (/\[TEST:REVIEW\]|\[TEST:REVIEW_MATH\]|请.*审阅/.test(userText || '')) {
    if (latestText.includes('"added":true')) return { text: '审阅完成，已将一条具体意见添加为原生评论，可在审阅面板回复或解决。' }
    if (reviewId && latestText.includes('"lineCount"')) {
      let quote = '\\section{Introduction}'
      try {
        const parsed = JSON.parse(latestText)
        quote = parsed.lines?.find(line => line.content.includes('\\section'))?.content || parsed.lines?.find(line => line.content.trim())?.content || quote
      } catch {}
      const content = userText.includes('[TEST:REVIEW_MATH]')
        ? '建议说明 $L=D-A$ 中各符号的含义。\\(x_i\\) 表示第 i 个样本。\n\n可补充以下等式的适用条件：\n$$\n\\sum_{i=1}^{n} x_i = 0\n$$\n请核对 \\[\\frac{a+b}{c+d}\\] 的分母是否为零。\n长公式：$$\\underbrace{a_1+a_2+a_3+a_4+a_5+a_6+a_7+a_8+a_9+a_{10}+a_{11}+a_{12}+a_{13}+a_{14}+a_{15}+a_{16}}_{\\text{all terms}} = S$$\n这段说明用于检查展开、收起与评论定位。普通金额 $5 和 $10 应保持文字显示。代码 `$x$` 应原样显示。不支持的命令 $\\missingMacro{x}$ 也应显示原文。'
        : '建议在引言中明确论文的研究问题，并说明主要结论与已有工作的关系。'
      return { tool: 'add_review_comment', input: { reviewId, path: 'main.tex', quote, content } }
    }
    if (reviewId) return { tool: 'get_file', input: { path: 'main.tex' } }
    if (latestText.includes('"approved":false')) return { text: '尚未开始审阅，也没有添加评论。我们可以继续讨论审阅要求。' }
    return { text: '我准备审阅当前项目，重点检查论证与符号，并将具体意见直接添加为评论。请确认后开始。', tool: 'request_review', input: { scope: '*', focus: '检查论证逻辑、符号一致性及引言表达；具体意见添加为原生评论。' } }
  }
  if (/\[TEST:REFERENCES\]/.test(userText || '')) {
    if (!latestTool) return { tool: 'list_references', input: {} }
    if (latestText.includes('"uploaded"')) {
      const data = JSON.parse(latestText)
      return data.uploaded[0] ? { tool: 'read_reference', input: { id: data.uploaded[0].id, page: 1, offset: 0 } } : { text: '没有上传参考资料。' }
    }
    return { text: `已读取参考资料：${latestText.slice(0, 180)}` }
  }
  if (messages.some(message => message.role === 'system' && String(message.content).includes('Translate'))) return { text: userText?.includes('[TEST:LONG_TRANSLATION]')
    ? '这是用于检查长译文滚动的测试内容。应先明确图的顶点集合与边集，再说明识别操作如何保留已有边。\n\n'.repeat(25) + (userText.match(/ZXQMATHTOKEN.*?QXZ/g) || []).join(' ')
    : '超图的谱性质与其度分布和连通性有关。这是一段用于验证界面的测试译文。' + (userText?.match(/ZXQMATHTOKEN.*?QXZ/g) || []).join(' ') }
  return { text: 'OK' }
}

http.createServer(async (req, res) => {
  if (req.url === '/v1/models') {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ data: ['test-model', 'review-model', 'translate-model', 'fix-model'].map(id => ({ id, object: 'model', context_window: 32000, max_output_tokens: 4096, supported_reasoning_efforts: ['none', 'low', 'medium', 'high'] })) }))
    return
  }
  if (req.url === '/debug') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(calls)); return }
  if (req.url !== '/v1/chat/completions') { res.writeHead(404).end(); return }
  try {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString())
    const prompt = JSON.stringify(body.messages || [])
    const record = { model: body.model, streaming: body.stream === true, reasoningEffort: body.reasoning_effort, tools: body.tools?.map(tool => tool.function.name),
      scenario: prompt.match(/\[TEST:(STREAM_TRANSLATION|STREAM_ERROR|LONG_TRANSLATION)\]/)?.[1],
      historyMarkers: JSON.stringify(body.messages).match(/\[HISTORY:\d+\]/g) || [] }
    record.queuePrompt = [...(body.messages || [])].reverse().find(message => message.role === 'user')?.content
    calls.push(record)
    const result = output(body.messages || [])
    if (String(record.queuePrompt).includes('[BG:CREATE]') && result.tool) await new Promise(resolve => setTimeout(resolve, 1800))
    if (String(record.queuePrompt).includes('[QUEUE:FAIL]')) {
      await new Promise(resolve => setTimeout(resolve, 600))
      res.writeHead(503, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: { message: 'Synthetic queue service failure' } }))
      return
    }
    if (String(record.queuePrompt).includes('[TEST:REVIEW]') && result.tool === 'request_review') await new Promise(resolve => setTimeout(resolve, 500))
    const id = `chatcmpl-${crypto.randomUUID()}`
    if (!body.stream) {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ id, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model: body.model,
        choices: [{ index: 0, message: { role: 'assistant', content: result.text || 'OK' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }))
      return
    }
    res.setHeader('Content-Type', 'text/event-stream')
    const chunk = (delta, finish = null) => res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: Math.floor(Date.now()/1000), model: body.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`)
    if (record.scenario || String(record.queuePrompt).includes('[QUEUE:SLOW]')) {
      chunk({ role: 'assistant', content: '' })
      const text = [...(result.text || '')]
      for (let at = 0; at < text.length; at += 16) {
        await new Promise(resolve => setTimeout(resolve, String(record.queuePrompt).includes('[QUEUE:SLOW]') ? 350 : 80))
        if (res.destroyed) { record.cancelled = true; return }
        chunk({ content: text.slice(at, at + 16).join('') })
        if (record.scenario === 'STREAM_ERROR' && at >= 16) {
          res.write(`data: ${JSON.stringify({ error: { message: '模拟翻译服务暂时不可用', type: 'server_error', code: 'fixture' } })}\n\n`)
          res.end(); return
        }
      }
    } else chunk({ role: 'assistant', content: result.text || '' })
    if (result.tool) chunk({ tool_calls: [{ index: 0, id: `call_${crypto.randomUUID().replaceAll('-', '')}`, type: 'function', function: { name: result.tool, arguments: JSON.stringify(result.input) } }] })
    chunk({}, result.tool ? 'tool_calls' : 'stop')
    res.write('data: [DONE]\n\n'); res.end(); record.completed = true
  } catch { res.writeHead(500).end('Invalid fixture request') }
}).listen(39001, '0.0.0.0', () => process.stdout.write('Local AI fixture ready on 39001\n'))
