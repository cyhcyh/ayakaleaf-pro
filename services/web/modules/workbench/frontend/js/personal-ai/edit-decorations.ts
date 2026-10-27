import { StateEffect, StateField, type EditorState } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { locateAnchoredEdit } from '../../../shared/edit-anchor.mjs'
import type { EditRecord } from './edits-store'
import { sourceOnly } from '@/features/source-editor/extensions/visual/visual'

export const setPendingEdits = StateEffect.define<EditRecord[]>()
export const setFocusedEdit = StateEffect.define<string | null>()
class EditMarker extends WidgetType {
  constructor(readonly edit: EditRecord) { super() }
  eq(other: EditMarker) { return other.edit.id === this.edit.id }
  toDOM() {
    const root = document.createElement('button')
    root.type = 'button'
    root.className = 'pa-inline-edit-marker'
    root.contentEditable = 'false'
    root.textContent = 'AI'
    root.title = '查看此处 AI 修改'
    root.setAttribute('aria-label', '查看此处 AI 修改')
    root.onmousedown = event => event.preventDefault()
    root.onclick = () => window.dispatchEvent(new CustomEvent('personal-ai:edit-action', { detail: { id: this.edit.id, action: 'focus' } }))
    return root
  }
  ignoreEvent() { return true }
}

function decorations(state: EditorState, items: EditRecord[], focusedId: string | null) {
  const ranges = []
  const content = state.doc.toString()
  let occupiedUntil = -1
  const located = items.flatMap(item => {
    try { return [{ item, at: locateAnchoredEdit(content, item.input.oldText, item.input.startLine, item.proposalAnchor) }] } catch { return [] }
  }).sort((a, b) => a.at - b.at)
  for (const { item, at } of located) {
    if (at < occupiedUntil) continue
    const end = at + item.input.oldText.length
    if (end > at) ranges.push(Decoration.mark({ class: `pa-inline-change ${item.id === focusedId ? 'pa-inline-change-focused' : ''}`, attributes: { 'data-pa-edit-id': item.id, title: '查看此处 AI 修改' } }).range(at, end))
    else ranges.push(Decoration.widget({ widget: new EditMarker(item), side: 1 }).range(at))
    occupiedUntil = end
  }
  return Decoration.set(ranges, true)
}

export const pendingEditsField = StateField.define<{ items: EditRecord[]; decorations: DecorationSet; focusedId: string | null }>({
  create: () => ({ items: [], decorations: Decoration.none, focusedId: null }),
  update(value, transaction) {
    let items = value.items
    let focusedId = value.focusedId
    let changed = transaction.docChanged
    for (const effect of transaction.effects) if (effect.is(setPendingEdits)) { items = effect.value; changed = true }
    for (const effect of transaction.effects) if (effect.is(setFocusedEdit)) { focusedId = effect.value; changed = true }
    return changed ? { items, focusedId, decorations: decorations(transaction.state, items, focusedId) } : value
  },
  provide: field => EditorView.decorations.from(field, value => value.decorations),
})

export const extension = (options: Record<string, any>) => [sourceOnly(options.showVisual, pendingEditsField), EditorView.domEventHandlers({ mouseup(event, view) {
  if (!view.state.selection.main.empty) return false
  const id = event.target instanceof Element ? event.target.closest('[data-pa-edit-id]')?.getAttribute('data-pa-edit-id') : null
  if (id) window.dispatchEvent(new CustomEvent('personal-ai:edit-action', { detail: { id, action: 'focus' } }))
  return false
} })]
