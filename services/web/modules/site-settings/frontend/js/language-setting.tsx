import { useState } from 'react'
import getMeta from '@/utils/meta'
import { postJSON } from '@/infrastructure/fetch-json'
import Setting from '@/features/ide-settings/components/setting'
import { ui } from './ui'

export default function LanguageSetting() {
  const [language, setLanguage] = useState(getMeta('ol-i18n').currentLangCode)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const change = async (value: string) => {
    setBusy(true); setError('')
    try {
      await postJSON('/interface-language', { body: { language: value } })
      setLanguage(value)
      window.location.reload()
    } catch { setError(ui('语言保存失败，请重试。')); setBusy(false) }
  }
  return <Setting controlId="ayaka-interface-language" label={ui('界面语言')} description={ui('切换后重新加载界面，与你的论文语言分别设置。')}>
    <select id="ayaka-interface-language" className="form-control form-select" value={language} disabled={busy} onChange={event => change(event.target.value)}>
      <option value="zh-CN">简体中文</option><option value="en">English</option>
    </select>
    {error && <p role="alert" className="text-danger small mt-2 mb-0">{error}</p>}
  </Setting>
}
