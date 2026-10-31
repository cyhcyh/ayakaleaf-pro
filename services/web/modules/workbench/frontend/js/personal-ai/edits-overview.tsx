import { useMemo, type ReactNode } from 'react'
import { ui } from '@modules/site-settings/frontend/js/ui'
import { CollapsibleFileHeader } from '@/shared/components/collapsible-file-header'
import { groupEditsByFile } from '../../../shared/edit-panel-layout.mjs'
import type { EditRecord } from './edits-store'

export default function EditsOverview({ items, collapsed, onToggle, renderCard }: {
  items: EditRecord[]; collapsed: Set<string>; onToggle: (path: string) => void; renderCard: (item: EditRecord) => ReactNode
}) {
  const groups = useMemo(() => groupEditsByFile(items), [items])
  return <div className="pa-edits-overview-items">
    {groups.map(group => <section key={group.path} className="pa-edits-file-group" aria-label={group.path}>
      <CollapsibleFileHeader name={group.path} count={group.items.length} collapsed={collapsed.has(group.path)}
        toggleCollapsed={() => onToggle(group.path)} />
      {!collapsed.has(group.path) && <div className="review-panel-overview-file-entries">{group.items.map(renderCard)}</div>}
    </section>)}
    {!groups.length && <p className="pa-muted p-3">{ui("暂无修改建议。")}</p>}
  </div>
}
