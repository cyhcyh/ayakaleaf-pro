import { useState } from 'react'
import MaterialIcon from '@/shared/components/material-icon'
import OLIconButton from '@/shared/components/ol/ol-icon-button'
import OLTooltip from '@/shared/components/ol/ol-tooltip'
import { ui } from '@modules/site-settings/frontend/js/ui'
import Composer from './composer'
import type { Draft, QueuedMessage } from './draft'
import { flatGhost, plain } from './themed'
import './queue.scss'

export default function MessageQueue({ items, paused, editing, disabled, canResume, canSteer = true, onResume, onSteer, onRemove, onEdit, onSave, onProblem }: {
  items: QueuedMessage[]; paused: boolean; editing: string | null; disabled: boolean; canResume: boolean; canSteer?: boolean
  onResume: () => void; onSteer: (id: string) => void; onRemove: (id: string) => void
  onEdit: (id: string | null) => void; onSave: (id: string, draft: Draft) => void
  onProblem: (message: string | false) => void
}) {
  const [expanded, setExpanded] = useState<string | null>(null)
  if (!items.length) return null
  return <section className="assistant-queue" aria-label={ui("待发送消息")}>
    {paused && <div className="assistant-queue-status"><span>{ui("队列已暂停")}</span>
      <button type="button" className="pa-text-action" disabled={!canResume || disabled || Boolean(editing)} onClick={onResume}>{ui("继续发送")}</button></div>}
    <ul className="assistant-queue-list">
      {items.map(item => <li key={item.id} className={editing === item.id ? 'is-editing' : undefined}>
        {editing === item.id ? <Composer key={item.id} initial={item} editing working={false} disabled={disabled}
          onSend={draft => onSave(item.id, draft)} onCancel={() => onEdit(null)} onStop={() => {}} onProblem={onProblem} /> : <>
          <MaterialIcon type="subdirectory_arrow_right" className="assistant-queue-mark" />
          <button type="button" className={`assistant-queue-preview ${expanded === item.id ? 'is-expanded' : ''}`}
            aria-expanded={expanded === item.id} onClick={() => setExpanded(expanded === item.id ? null : item.id)}>
            <span>{item.text || ui("附件")}</span>
            {Boolean(item.files.length || item.references?.length) && <small><MaterialIcon type="attach_file" />
              {[...item.files.map(file => file.filename || ui("图片")), ...(item.references || []).map(file => file.name)].join('、')}</small>}
          </button>
          <div className="assistant-queue-actions">
            <button type="button" className="assistant-queue-steer" disabled={disabled || !canSteer || Boolean(editing)} onClick={() => onSteer(item.id)}><MaterialIcon type="turn_right" /><span>{ui("引导")}</span></button>
            {[{ icon: 'delete', label: ui("取消排队"), act: () => onRemove(item.id) }, { icon: 'edit', label: ui("编辑消息"), act: () => onEdit(item.id) }].map(action =>
              <OLTooltip key={action.icon} id={`queue-${item.id}-${action.icon}`} description={action.label}>
                <OLIconButton icon={action.icon} size="sm" variant="ghost" style={{ ...flatGhost, ...plain }} accessibilityLabel={action.label}
                  disabled={disabled || Boolean(editing)} onClick={action.act} />
              </OLTooltip>)}
          </div>
        </>}
      </li>)}
    </ul>
  </section>
}
