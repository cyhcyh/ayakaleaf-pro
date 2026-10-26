import { StateEffect, StateField, type EditorState } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { locateAnchoredEdit } from '../../../shared/edit-anchor.mjs'
import type { EditRecord } from './edits-store'

export const setPendingEdits = StateEffect.define<EditRecord[]>()
class EditPreview extends WidgetType {
  constructor(readonly edit: EditRecord) { super() }
  eq(other: EditPreview) { return other.edit.id === this.edit.id && other.edit.input.newText === this.edit.input.newText && Boolean(other.edit.operation) === Boolean(this.edit.operation) }
  toDOM() {
    const root = document.createElement('div')
    root.className = 'pa-inline-edit'
    root.contentEditable = 'false'
    const header = document.createElement('div')
    const label = document.createElement('span')
    label.textContent = 'AI 修改预览 · 尚未应用'
    header.append(label)
    for (const [action, text, title] of [['accept', '✓', '接受此处修改'], ['reject', '×', '拒绝此处修改'], ['locate', '查看', '在 AI 修改面板查看']] as const) {
      const button = document.createElement('button')
      button.type = 'button'; button.textContent = text; button.title = title; button.setAttribute('aria-label', title)
      button.disabled = Boolean(this.edit.operation)
      button.onmousedown = event => event.preventDefault()
      button.onclick = () => window.dispatchEvent(new CustomEvent('personal-ai:edit-action', { detail: { id: this.edit.id, action } }))
      header.append(button)
    }
    const code = document.createElement('pre')
    code.textContent = this.edit.input.newText ? this.edit.input.newText.slice(0, 3000) : '（删除此处内容）'
    root.append(header, code)
    return root
  }
  ignoreEvent() { return true }
}

function decorations(state: EditorState, items: EditRecord[]) {
  const ranges = []
  const content = state.doc.toString()
  let occupiedUntil = -1
  const located = items.flatMap(item => {
    try { return [{ item, at: locateAnchoredEdit(content, item.input.oldText, item.input.startLine, item.proposalAnchor) }] } catch { return [] }
  }).sort((a, b) => a.at - b.at)
  for (const { item, at } of located) {
    if (at < occupiedUntil) continue
    const end = at + item.input.oldText.length
    if (end > at) ranges.push(Decoration.mark({ class: 'pa-inline-removed' }).range(at, end))
    const position = state.doc.lineAt(end).to
    ranges.push(Decoration.widget({ widget: new EditPreview(item), block: true, side: 1 }).range(position))
    occupiedUntil = end
  }
  return Decoration.set(ranges, true)
}

export const pendingEditsField = StateField.define<{ items: EditRecord[]; decorations: DecorationSet }>({
  create: () => ({ items: [], decorations: Decoration.none }),
  update(value, transaction) {
    let items = value.items
    let changed = transaction.docChanged
    for (const effect of transaction.effects) if (effect.is(setPendingEdits)) { items = effect.value; changed = true }
    return changed ? { items, decorations: decorations(transaction.state, items) } : value
  },
  provide: field => EditorView.decorations.from(field, value => value.decorations),
})

export const extension = (options: Record<string, any>) => options.showVisual ? [] : pendingEditsField
