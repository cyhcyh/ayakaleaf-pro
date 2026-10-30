import { Fragment, memo, useMemo } from 'react'
import katex from 'katex'
import { commentMath } from '../../../shared/comment-math.mjs'
import 'katex/dist/katex.min.css'
import './review-math.scss'

// Keep native comment prose and mentions intact. KaTeX is the only HTML
// producer here; unsupported formulae fall back to their original text.
export const ReviewMath = memo(function ReviewMath({ text }: { text: string }) {
  const rendered = useMemo(
    () =>
      commentMath(text).map(token => {
        if (token.type !== 'math') return { ...token, html: null }
        try {
          return {
            ...token,
            html: katex.renderToString(token.value, {
              displayMode: token.display,
              throwOnError: true,
              trust: false,
              strict: 'ignore',
            }),
          }
        } catch {
          return { ...token, html: null }
        }
      }),
    [text]
  )
  return (
    <>
      {rendered.map(token =>
        token.type === 'math' && token.html ? (
          <span
            key={token.start}
            className={`rl-review-math${token.display ? ' rl-review-math-display' : ''}`}
            dangerouslySetInnerHTML={{ __html: token.html }}
          />
        ) : (
          <Fragment key={token.start}>
            {token.type === 'math' ? token.source : token.value}
          </Fragment>
        )
      )}
    </>
  )
})
