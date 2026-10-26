// The catalog is authoritative. Known OpenAI protocol fallbacks follow:
// https://developers.openai.com/api/docs/models/gpt-5.4
// https://developers.openai.com/api/docs/guides/reasoning
const efforts = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']);

export function modelMetadata(entry) {
  const id = entry.id || entry.slug;
  if (typeof id !== 'string' || !id || entry.show_in_picker === false || ['hide', 'none'].includes(entry.visibility)) return null;
  let levels = (entry.supported_reasoning_levels || entry.supported_reasoning_efforts || [])
    .map(item => typeof item === 'string' ? item : item.reasoning_effort || item.reasoningEffort || item.effort)
    .filter(value => efforts.has(value));
  let source = levels.length ? 'api' : 'unknown';
  if (!levels.length) {
    if (/^gpt-5\.4(?:$|-)/.test(id)) levels = ['none', 'low', 'medium', 'high', 'xhigh'];
    else if (/^gpt-5\.1(?:$|-)/.test(id) && !id.includes('codex')) levels = ['none', 'low', 'medium', 'high'];
    else if (/^gpt-5(?:$|-(?:mini|nano)(?:$|-))/.test(id)) levels = ['minimal', 'low', 'medium', 'high'];
    else if (/^(?:o3|o4-mini)(?:$|-)/.test(id) && !id.includes('pro')) levels = ['low', 'medium', 'high'];
    if (levels.length) source = 'known';
  }
  const contextWindow = Number(entry.context_window || entry.max_input_tokens || entry.context_length) || 0;
  return {
    id, name: entry.display_name || entry.displayName || id,
    thinkingModes: ['auto', ...(levels.some(e => e !== 'none') ? ['on'] : []), ...(levels.includes('none') ? ['off'] : [])],
    reasoningEfforts: [...new Set(levels)],
    defaultEffort: entry.default_reasoning_level || entry.default_reasoning_effort || 'auto',
    contextWindow, outputLimit: Number(entry.max_output_tokens || entry.output_limit) || 0, source,
  };
}

export function reasoningOptions(binding, capabilities) {
  const mode = binding.thinking || 'auto';
  let effort = binding.reasoningEffort || 'auto';
  if (!capabilities.thinkingModes.includes(mode)) throw new Error('该模型不支持所选思考模式，请更新模型目录或选择模型默认');
  if (mode === 'off') effort = 'none';
  else if (mode === 'on' && effort === 'auto') {
    effort = capabilities.defaultEffort !== 'auto' && capabilities.defaultEffort !== 'none'
      ? capabilities.defaultEffort
      : capabilities.reasoningEfforts.includes('medium') ? 'medium' : capabilities.reasoningEfforts.find(e => e !== 'none');
  }
  if (mode === 'on' && effort === 'none') throw new Error('开启思考时不能选择无推理');
  if (effort !== 'auto' && !capabilities.reasoningEfforts.includes(effort)) throw new Error('该模型不支持所选推理强度，请更新模型目录或选择模型默认');
  return effort === 'auto' ? undefined : effort;
}
