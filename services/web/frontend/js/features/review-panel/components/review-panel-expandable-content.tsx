import { memo, useCallback, useMemo, useRef, useState } from 'react'
import OLButton from '@/shared/components/ol/ol-button'
import { useTranslation } from 'react-i18next'
import classNames from 'classnames'
import { PreventSelectingEntry } from './review-panel-prevent-selecting'
import { MentionBadge } from '@/shared/components/mention-badge'
import {
  MentionSegment,
  parseMentions,
  sliceMentionSegments,
} from '@/shared/utils/parse-mentions'
import { ReviewMath } from '@modules/workbench/frontend/js/personal-ai/review-math'
import { commentMathLimit } from '@modules/workbench/shared/comment-math.mjs'

export const ExpandableContent = memo<{
  className?: string
  content: string
  contentLimit?: number
  newLineCharsLimit?: number
  checkNewLines?: boolean
  inline?: boolean
  translate?: 'yes' | 'no'
  math?: boolean
}>(function ExpandableContent({
  content,
  className,
  contentLimit = 50,
  newLineCharsLimit = 3,
  checkNewLines = true,
  inline = false,
  translate,
  math = false,
}) {
  const { t } = useTranslation()
  const contentRef = useRef<HTMLDivElement>(null)
  const [isExpanded, setIsExpanded] = useState(false)
  const textLimit = checkNewLines
    ? Math.min(
        contentLimit,
        indexOfNthLine(content, newLineCharsLimit) ?? Infinity
      )
    : contentLimit
  const limit = useMemo(
    () => (math ? commentMathLimit(content, textLimit) : textLimit),
    [math, content, textLimit]
  )

  const isOverflowing = content.length > limit

  const segments = useMemo(() => parseMentions(content), [content])

  const renderedContent = segments ? (
    renderSegments(
      isExpanded ? segments : sliceMentionSegments(segments, limit),
      math
    )
  ) : isExpanded ? (
    math ? (
      <ReviewMath text={content} />
    ) : (
      content
    )
  ) : math ? (
    <ReviewMath text={content.slice(0, limit)} />
  ) : (
    content.slice(0, limit)
  )

  const handleShowMore = useCallback(() => {
    setIsExpanded(true)
    contentRef.current?.dispatchEvent(
      new CustomEvent('review-panel:position', { bubbles: true })
    )
  }, [])

  const handleShowLess = useCallback(() => {
    setIsExpanded(false)
    contentRef.current?.dispatchEvent(
      new CustomEvent('review-panel:position', { bubbles: true })
    )
  }, [])

  return (
    <>
      <div
        ref={contentRef}
        className={classNames('review-panel-expandable-content', className)}
        translate={translate}
      >
        {renderedContent}
        {isOverflowing && !isExpanded && '...'}
      </div>
      <div
        className={classNames('review-panel-expandable-links', {
          'review-panel-expandable-inline': inline,
        })}
      >
        <PreventSelectingEntry>
          {isExpanded ? (
            <OLButton
              variant="link"
              className="btn-inline-link"
              onClick={handleShowLess}
            >
              {t('show_less')}
            </OLButton>
          ) : (
            isOverflowing && (
              <OLButton
                variant="link"
                className="btn-inline-link"
                onClick={handleShowMore}
              >
                {t('show_more')}
              </OLButton>
            )
          )}
        </PreventSelectingEntry>
      </div>
    </>
  )
})

function renderSegments(segments: MentionSegment[], math: boolean) {
  return segments.map((segment, i) => {
    if (segment.type === 'mention') {
      return (
        <MentionBadge key={`${i}-${segment.userId}`} userId={segment.userId} />
      )
    }
    return math ? <ReviewMath key={i} text={segment.value} /> : segment.value
  })
}

function indexOfNthLine(content: string, n: number) {
  if (n < 1) return null

  let line = 0
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n') {
      line++
      if (line === n) {
        return i
      }
    }
  }
  return null
}
