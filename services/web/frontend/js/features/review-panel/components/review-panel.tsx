import { FC, memo, useMemo } from 'react'
import ReviewPanelTabs from './review-panel-tabs'
import ReviewPanelCurrentFile from './review-panel-current-file'
import { ReviewPanelOverview } from './review-panel-overview'
import classnames from 'classnames'
import { useReviewPanelStyles } from '@/features/review-panel/hooks/use-review-panel-styles'
import { useReviewPanelViewContext } from '../context/review-panel-view-context'
import importOverleafModules from '../../../../macros/import-overleaf-module.macro'

const [extensionModule] = importOverleafModules('reviewPanelExtensions')
const Extension = extensionModule?.import.default

const ReviewPanel: FC<{ mini?: boolean }> = ({ mini = false }) => {
  const choosenSubView = useReviewPanelViewContext()

  const activeSubView = useMemo(
    () => (mini ? 'cur_file' : choosenSubView),
    [choosenSubView, mini]
  )

  const style = useReviewPanelStyles()

  const className = classnames('review-panel-container', {
    'review-panel-mini': mini,
    'review-panel-subview-overview': activeSubView === 'overview',
  })

  const content = (
      <div id="review-panel-inner" className="review-panel-inner">
        {activeSubView === 'cur_file' && <ReviewPanelCurrentFile />}
        {activeSubView === 'overview' && <ReviewPanelOverview />}

        <div
          className="review-panel-footer"
          id="review-panel-tabs"
          role="tablist"
        >
          <ReviewPanelTabs />
        </div>
      </div>
  )
  return <div className={className} style={style} data-testid="review-panel">
    {!mini && Extension ? <Extension>{content}</Extension> : content}
  </div>
}

export default memo(ReviewPanel)
