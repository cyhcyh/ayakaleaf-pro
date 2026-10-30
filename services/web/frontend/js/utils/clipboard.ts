/** Copy text without requiring a secure context. Never report a failed copy as success. */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  // A tooltip may blur the button while the clipboard permission request runs.
  const active = document.activeElement
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // A browser can expose the API but deny clipboard permission.
    }
  }

  if (typeof document.execCommand !== 'function') return false

  const selection = window.getSelection()
  const anchorNode = selection?.anchorNode
  const anchorOffset = selection?.anchorOffset ?? 0
  const focusNode = selection?.focusNode
  const focusOffset = selection?.focusOffset ?? 0
  const ranges = selection
    ? Array.from({ length: selection.rangeCount }, (_, index) =>
        selection.getRangeAt(index).cloneRange()
      )
    : []
  const input =
    active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement
      ? active
      : null
  const start = input?.selectionStart
  const end = input?.selectionEnd
  const direction = input?.selectionDirection
  const temporary = document.createElement('textarea')
  temporary.value = text
  temporary.readOnly = true
  temporary.tabIndex = -1
  Object.assign(temporary.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    width: '1px',
    height: '1px',
    opacity: '0',
    pointerEvents: 'none',
  })

  try {
    // A modal's focus trap can be nested inside its outer dialog element.
    const container =
      active?.closest('.focus-trap-container, [role="dialog"], dialog') ??
      document.body
    container.appendChild(temporary)
    temporary.focus({ preventScroll: true })
    temporary.select()
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    temporary.remove()
    try {
      if (active instanceof HTMLElement && active.isConnected) {
        active.focus({ preventScroll: true })
      }
      if (selection) {
        selection.removeAllRanges()
        if (
          ranges.length === 1 &&
          anchorNode?.isConnected &&
          focusNode?.isConnected &&
          selection.setBaseAndExtent
        ) {
          selection.setBaseAndExtent(
            anchorNode,
            anchorOffset,
            focusNode,
            focusOffset
          )
        } else {
          for (const range of ranges) selection.addRange(range)
        }
      }
      if (input && typeof start === 'number' && typeof end === 'number') {
        input.setSelectionRange(start, end, direction ?? undefined)
      }
    } catch {
      // A focus handler may have removed the original selection's owner.
    }
  }
}
