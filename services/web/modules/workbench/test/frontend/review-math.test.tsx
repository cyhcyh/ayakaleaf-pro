import { expect } from 'chai'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import sinon from 'sinon'
import { ReviewMath } from '../../frontend/js/personal-ai/review-math'
import { ExpandableContent } from '@/features/review-panel/components/review-panel-expandable-content'
import { ChangesUsersContext } from '@/shared/context/changes-users-context'
import type { UserId } from '@ol-types/user'
import { UserContext } from '@/shared/context/user-context'
import { PermissionsContext } from '@/features/ide-react/context/permissions-context'
import { ReviewPanelMessage } from '@/features/review-panel/components/review-panel-message'

describe('native review comment formulae', function () {
  afterEach(cleanup)

  it('renders math in the real read-only comment card without exposing editing controls', function () {
    const user = { id: 'aabbccddeeff00112233aabb', email: 'reader@localhost.test' }
    const { container } = render(
      <UserContext.Provider value={user as any}>
        <PermissionsContext.Provider value={{ comment: false, resolveAllComments: false, resolveOwnComments: false } as any}>
          <ReviewPanelMessage message={{ id: 'math-comment', content: 'Please explain $L=D-A$.', timestamp: new Date().toISOString(), user } as any}
            hasReplies={false} isReply={false} isThreadResolved={false} />
        </PermissionsContext.Provider>
      </UserContext.Provider>
    )
    expect(container.querySelectorAll('.katex')).to.have.length(1)
    expect(container.querySelectorAll('button')).to.have.length(0)
    expect(container.textContent).to.include('Please explain')
  })

  it('renders all four formula delimiters with accessible math markup', function () {
    const { container } = render(
      <ReviewMath
        text={
          '中文 $L=D-A$ and \\(x_i\\).\n$$\\sum_i x_i$$\n\\[\\frac{1}{2}\\]'
        }
      />
    )
    expect(container.querySelectorAll('.katex')).to.have.length(4)
    expect(container.querySelectorAll('math')).to.have.length(4)
    expect(
      container.querySelectorAll('.rl-review-math-display')
    ).to.have.length(2)
    expect(container.textContent).to.include('中文')
  })

  it('preserves prose, prices, code and HTML examples as text', function () {
    const text =
      'Cost $5 and $10. `$x$` \\$z\\$ <script>alert(1)</script> **literal**'
    const { container } = render(<ReviewMath text={text} />)
    expect(container.textContent).to.equal(text)
    expect(container.querySelectorAll('script, strong, .katex')).to.have.length(
      0
    )
  })

  it('falls back to the original source for unsupported formulae without breaking nearby math', function () {
    const { container } = render(
      <ReviewMath text={'Bad $\\missingMacro{x}$, valid $x^2$'} />
    )
    expect(container.textContent).to.include('$\\missingMacro{x}$')
    expect(container.querySelectorAll('.katex')).to.have.length(1)
  })

  it('does not create links or HTML elements from untrusted TeX commands', function () {
    const { container } = render(
      <ReviewMath
        text={'$\\href{javascript:alert(1)}{click}$ $\\htmlClass{evil}{x}$'}
      />
    )
    expect(container.querySelectorAll('a, script, .evil')).to.have.length(0)
  })

  it('keeps the complete formula in collapsed text and preserves show-more positioning events', function () {
    const text =
      'Note $\\frac{1}{1+x^2}$ followed by the remaining explanation.'
    const { container } = render(
      <ExpandableContent
        math
        content={text}
        contentLimit={10}
        checkNewLines={false}
      />
    )
    expect(container.querySelectorAll('.katex')).to.have.length(1)
    expect(container.textContent).not.to.include('remaining explanation')
    const reposition = sinon.spy()
    container.addEventListener('review-panel:position', reposition)
    fireEvent.click(screen.getByText(/show more/i))
    expect(container.textContent).to.include('remaining explanation')
    expect(container.querySelectorAll('.katex')).to.have.length(1)
    fireEvent.click(screen.getByText(/show less/i))
    expect(container.textContent).not.to.include('remaining explanation')
    expect(reposition.callCount).to.equal(2)
  })

  it('does not split display math at the native newline collapse boundary', function () {
    const { container } = render(
      <ExpandableContent
        math
        content={'[AI 审阅]\n$$\n\\sum_{i=1}^n x_i\n$$\n解释后文。'}
        contentLimit={100}
        checkNewLines
      />
    )
    expect(
      container.querySelectorAll('.rl-review-math-display .katex')
    ).to.have.length(1)
    expect(container.textContent).not.to.include('解释后文')
    fireEvent.click(screen.getByText(/show more/i))
    expect(container.textContent).to.include('解释后文')
  })

  it('keeps native mention badges next to formulae', function () {
    const id = 'aabbccddeeff00112233aabb' as UserId
    const { container } = render(
      <ChangesUsersContext.Provider
        value={
          new Map([
            [
              id,
              { id, email: 'reviewer@localhost.test', first_name: 'Reviewer' },
            ],
          ])
        }
      >
        <ExpandableContent
          math
          content={`@[${id}] 请核对 $x_i$。`}
          contentLimit={100}
        />
      </ChangesUsersContext.Provider>
    )
    expect(screen.getByText('@Reviewer')).to.exist
    expect(container.querySelectorAll('.katex')).to.have.length(1)
  })

  it('leaves other expandable content literal when math is not enabled', function () {
    const text = 'A plain $x$ example'
    const { container } = render(
      <ExpandableContent content={text} contentLimit={100} />
    )
    expect(container.textContent).to.equal(text)
    expect(container.querySelectorAll('.katex')).to.have.length(0)
  })
})
