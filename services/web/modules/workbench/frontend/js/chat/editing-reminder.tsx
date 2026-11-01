import { ui } from '@modules/site-settings/frontend/js/ui'
import MaterialIcon from '@/shared/components/material-icon'

export default function EditingReminder({ busy, locating, error, onReturn, onCancel }: {
  busy: boolean; locating: boolean; error: string; onReturn: () => void; onCancel: () => void
}) {
  return <div className="pa-editing-reminder">
    <span className="pa-editing-reminder-label" role="status">
      {locating ? <span className="spinner-border spinner-border-sm" aria-hidden="true" /> : <MaterialIcon type="edit" />}
      {ui('正在编辑较早的消息')}
    </span>
    <span className="pa-editing-reminder-actions">
      <button type="button" className="pa-text-action" disabled={busy || locating} aria-busy={locating} onClick={onReturn}>{ui('返回编辑')}</button>
      <button type="button" className="pa-text-action pa-editing-cancel" disabled={busy} onClick={onCancel}>{ui('取消编辑')}</button>
    </span>
    {error && <p className="pa-editing-return-error" role="alert">{error}</p>}
  </div>
}
