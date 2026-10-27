import messages from './messages.json' with { type: 'json' }

export function localize(source, language = 'zh-CN', values = []) {
  if (typeof source !== 'string') return source
  const translated = messages[source.trim()]
  const template = language.startsWith('en') && translated !== undefined ? source.replace(source.trim(), translated) : source
  return template.replace(/\{(\d+)\}/g, (match, index) => index < values.length ? String(values[index]) : match)
}
