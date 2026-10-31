import { useState } from 'react'
import { expect } from 'chai'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import sinon from 'sinon'
import i18n from 'i18next'
import i18nReady from '@/i18n'
import MoreCommentsButton from '@/features/review-panel/components/review-panel-more-comments-button'
import { ui } from '@modules/site-settings/frontend/js/ui'
import EditsOverview from '../../frontend/js/personal-ai/edits-overview'
import type { EditRecord } from '../../frontend/js/personal-ai/edits-store'

describe('shared review and AI edit navigation button', function () {
  before(async function () { await i18nReady })
  afterEach(cleanup)
  it('retains the original comment label and upward placement when no custom label is given', function () {
    const click = sinon.stub()
    const view = render(<MoreCommentsButton direction="upward" onClick={click} />)
    fireEvent.click(screen.getByRole('button', { name: i18n.t('more_comments') }))
    expect(click).to.have.been.calledOnce
    expect(view.container.querySelector('.review-panel-more-comments-button-container.upwards')).to.exist
    expect(view.container.textContent).to.include('arrow_upward_alt')
  })
  it('reuses the same button with a translated AI edit label and downward arrow', function () {
    const click = sinon.stub()
    const view = render(<MoreCommentsButton direction="downward" label={ui('更多修改')} onClick={click} />)
    fireEvent.click(screen.getByRole('button', { name: ui('更多修改') }))
    expect(click).to.have.been.calledOnce
    expect(view.container.querySelector('.review-panel-more-comments-button-container.downwards')).to.exist
    expect(view.container.textContent).to.include('arrow_downward_alt')
  })
  it('groups records by file, collapses each file independently and updates counts after filtering', function () {
    const first = { id: 'one', input: { path: 'chapters/main.tex', startLine: 30 } } as EditRecord
    const second = { id: 'two', input: { path: 'chapters/main.tex', startLine: 3 } } as EditRecord
    const other = { id: 'three', input: { path: 'appendix.tex', startLine: 1 } } as EditRecord
    function Overview({ items }: { items: EditRecord[] }) {
      const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
      return <EditsOverview items={items} collapsed={collapsed} onToggle={path => setCollapsed(current => {
        const next = new Set(current); if (next.has(path)) next.delete(path); else next.add(path); return next
      })} renderCard={item => <article key={item.id}>{item.id}</article>} />
    }
    const view = render(<Overview items={[first, other, second]} />)
    expect(view.container.querySelectorAll('section')).to.have.length(2)
    expect([...view.container.querySelectorAll('article')].map(el => el.textContent)).to.deep.equal(['three', 'two', 'one'])
    fireEvent.click(screen.getByRole('button', { name: /chapters\/main.tex 2/ }))
    expect(screen.queryByText('one')).to.equal(null)
    expect(screen.getByText('three')).to.exist
    view.rerender(<Overview items={[first]} />)
    expect(screen.getByRole('button', { name: /chapters\/main.tex 1/ })).to.exist
    expect(screen.queryByText('one')).to.equal(null)
    expect(screen.queryByText('appendix.tex')).to.equal(null)
    fireEvent.click(screen.getByRole('button', { name: /chapters\/main.tex 1/ }))
    expect(screen.getByText('one')).to.exist
  })
})
