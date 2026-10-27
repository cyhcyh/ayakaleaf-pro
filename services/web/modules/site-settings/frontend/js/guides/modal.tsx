import { useState } from 'react'
import getMeta from '@/utils/meta'
import { useRailContext, type RailModalKey } from '@/features/ide-react/context/rail-context'
import { OLModal, OLModalHeader, OLModalTitle, OLModalBody, OLModalFooter } from '@/shared/components/ol/ol-modal'
import { guides } from '../../../shared/guides.mjs'
import { ui } from '../ui'
import './style.scss'

type GuideId = keyof typeof guides
function GuideModal({ id, show }: { id: GuideId; show: boolean }) {
  const { setActiveModal, openTab } = useRailContext()
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')
  const language = getMeta('ol-i18n').currentLangCode === 'en' ? 1 : 0
  const guide = guides[id]
  const close = () => { setActiveModal(null); setCopied(false); setError('') }
  return <OLModal show={show} onHide={close} size="lg" centered themed scrollable>
    <OLModalHeader closeButton><OLModalTitle>{guide.title[language]}</OLModalTitle></OLModalHeader>
    <OLModalBody className="rogerleaf-guide">
      <p className="rogerleaf-guide-intro">{guide.intro[language]}</p>
      {'steps' in guide && <ol>{guide.steps.map((step, index) => <li key={index}>{step[language]}</li>)}</ol>}
      {'example' in guide && <div className="rogerleaf-guide-example"><strong>{ui('示例提问')}</strong><p>{guide.example[language]}</p><button className="btn btn-secondary btn-sm" onClick={async () => { try { await navigator.clipboard.writeText(guide.example[language]); setCopied(true) } catch { setError(ui('无法复制，请手动复制。')) } }}>{ui(copied ? '已复制' : '复制示例')}</button>{error && <p role="alert">{error}</p>}</div>}
      {'features' in guide && <dl>{guide.features.map(([zh, en, zhText, enText]) => <div key={en}><dt>{language ? en : zh}</dt><dd>{language ? enText : zhText}</dd></div>)}</dl>}
      {'note' in guide && <p className="rogerleaf-guide-note">{guide.note[language]}</p>}
    </OLModalBody>
    <OLModalFooter><button className="btn btn-secondary" onClick={close}>{ui('关闭')}</button>
      {(id === 'review' || id === 'edits') && <button className="btn btn-primary" onClick={() => { close(); openTab('workbench') }}>{ui('打开 AI 助手')}</button>}
      {id === 'edits' && <button className="btn btn-secondary" onClick={() => { close(); openTab('ai-modifications') }}>{ui('打开 AI 修改')}</button>}
    </OLModalFooter>
  </OLModal>
}
export function createGuide(id: GuideId) {
  return { key: `rogerleaf-guide-${id}` as RailModalKey, modalComponentFunction: ({ show }: { show: boolean }) => <GuideModal id={id} show={show} /> }
}
