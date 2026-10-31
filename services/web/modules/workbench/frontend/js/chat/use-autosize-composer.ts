import { useCallback, useLayoutEffect, type RefObject } from 'react'

export const MIN_COMPOSER_ROWS = 3
const MAX_COMPOSER_ROWS = 10

export default function useAutosizeComposer(
  inputRef: RefObject<HTMLTextAreaElement | null>,
  text: string
) {
  const resize = useCallback(() => {
    const input = inputRef.current
    if (!input || !input.offsetWidth) return

    const style = getComputedStyle(input)
    const lineHeight =
      parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5
    const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
    const border =
      parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth)
    const panel = input.closest('[data-chat-input]')?.parentElement
    const availableHeight = (panel?.clientHeight || window.innerHeight) * 0.4
    const maxRows = Math.max(
      MIN_COMPOSER_ROWS,
      Math.min(
        MAX_COMPOSER_ROWS,
        Math.floor((availableHeight - padding - border) / lineHeight)
      )
    )
    const minHeight = MIN_COMPOSER_ROWS * lineHeight + padding + border
    const maxHeight = maxRows * lineHeight + padding + border
    const scrollTop = input.scrollTop
    const wasAtBottom = scrollTop > 0 && scrollTop + input.clientHeight >= input.scrollHeight - 1

    // Measure wrapped text without a scrollbar taking away horizontal space.
    input.style.overflowY = 'hidden'
    input.style.height = 'auto'
    let height = Math.min(maxHeight, Math.max(minHeight, input.scrollHeight + border))
    input.style.height = `${Math.ceil(height)}px`

    // Queue editors also need room for their actions inside the queue viewport.
    const queue = input.closest<HTMLElement>('.assistant-queue-list')
    const card = input.parentElement
    if (queue && card) {
      const cardStyle = getComputedStyle(card)
      const margins = parseFloat(cardStyle.marginTop) + parseFloat(cardStyle.marginBottom)
      const chrome = card.offsetHeight - input.offsetHeight
      const queueRows = Math.floor((queue.clientHeight - chrome - margins - padding - border) / lineHeight)
      height = Math.min(height, Math.max(MIN_COMPOSER_ROWS, queueRows) * lineHeight + padding + border)
      input.style.height = `${Math.ceil(height)}px`
    }
    input.style.overflowY = input.scrollHeight > input.clientHeight ? 'auto' : 'hidden'
    input.scrollTop = wasAtBottom ? input.scrollHeight - input.clientHeight : scrollTop
  }, [inputRef])

  useLayoutEffect(resize, [resize, text])

  useLayoutEffect(() => {
    const input = inputRef.current
    if (!input) return
    const panel = input.closest('[data-chat-input]')?.parentElement
    let width = input.offsetWidth
    let panelHeight = panel?.clientHeight || window.innerHeight
    const observer = new ResizeObserver(() => {
      const nextWidth = input.offsetWidth
      const nextHeight = panel?.clientHeight || window.innerHeight
      // Our own height updates must not trigger another measurement loop.
      if (width === nextWidth && panelHeight === nextHeight) return
      width = nextWidth
      panelHeight = nextHeight
      resize()
    })
    observer.observe(input)
    if (panel) observer.observe(panel)
    window.addEventListener('resize', resize)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', resize)
    }
  }, [inputRef, resize])
}
