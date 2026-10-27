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
  if (/\[TEST:REVIEW\]|请.*审阅/.test(userText || '')) {
    if (latestText.includes('"added":true')) return { text: '审阅完成，已将一条具体意见添加为原生评论，可在审阅面板回复或解决。' }
    if (reviewId && latestText.includes('"lineCount"')) {
      let quote = '\\section{Introduction}'
      try {
        const parsed = JSON.parse(latestText)
        quote = parsed.lines?.find(line => line.content.includes('\\section'))?.content || parsed.lines?.find(line => line.content.trim())?.content || quote
      } catch {}
      return { tool: 'add_review_comment', input: { reviewId, path: 'main.tex', quote, content: '建议在引言中明确论文的研究问题，并说明主要结论与已有工作的关系。' } }
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
    : '超图的谱性质与其度分布和连通性有关。这是一段用于验证界面的测试译文。' }
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
    calls.push({ model: body.model, streaming: body.stream === true, reasoningEffort: body.reasoning_effort, tools: body.tools?.map(tool => tool.function.name),
      historyMarkers: JSON.stringify(body.messages).match(/\[HISTORY:\d+\]/g) || [] })
    const result = output(body.messages || [])
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
    chunk({ role: 'assistant', content: result.text || '' })
    if (result.tool) chunk({ tool_calls: [{ index: 0, id: `call_${crypto.randomUUID().replaceAll('-', '')}`, type: 'function', function: { name: result.tool, arguments: JSON.stringify(result.input) } }] })
    chunk({}, result.tool ? 'tool_calls' : 'stop')
    res.write('data: [DONE]\n\n'); res.end()
  } catch { res.writeHead(500).end('Invalid fixture request') }
}).listen(39001, '0.0.0.0', () => process.stdout.write('Local AI fixture ready on 39001\n'))
