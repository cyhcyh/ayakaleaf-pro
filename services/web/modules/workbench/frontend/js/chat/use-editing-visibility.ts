import { useLayoutEffect, type RefObject } from 'react'

// Observe just the edit form. Scrolling and resize do not scan message history
// or add work to each streamed text update.
export default function useEditingVisibility(root: RefObject<HTMLDivElement>, id: string | undefined, mounted: boolean,
  onVisible?: (visible: boolean) => void) {
  useLayoutEffect(() => {
    const box = root.current
    const editor = id && mounted ? box?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(id)}"] .assistant-message-editor`) : null
    if (!box || !editor) { onVisible?.(false); return }
    const bounds = box.getBoundingClientRect(), rect = editor.getBoundingClientRect()
    onVisible?.(rect.bottom > bounds.top && rect.top < bounds.bottom)
    const observer = new IntersectionObserver(([entry]) => onVisible?.(entry.isIntersecting), { root: box })
    observer.observe(editor)
    return () => observer.disconnect()
  }, [root, id, mounted, onVisible])
}
