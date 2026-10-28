import { expect } from 'chai'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import sinon from 'sinon'
import { CopyToClipboard } from '@/shared/components/copy-to-clipboard'
import i18nReady from '@/i18n'

describe('<CopyToClipboard /> compatibility', function () {
  const originalClipboard = Object.getOwnPropertyDescriptor(
    navigator,
    'clipboard'
  )
  const originalExecCommand = Object.getOwnPropertyDescriptor(
    document,
    'execCommand'
  )
  let legacyCopy: sinon.SinonStub

  before(async function () {
    await i18nReady
  })

  beforeEach(function () {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    })
    legacyCopy = sinon.stub().returns(true)
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: legacyCopy,
    })
  })

  afterEach(function () {
    cleanup()
    if (originalClipboard)
      Object.defineProperty(navigator, 'clipboard', originalClipboard)
    else delete (navigator as any).clipboard
    if (originalExecCommand)
      Object.defineProperty(document, 'execCommand', originalExecCommand)
    else delete (document as any).execCommand
  })

  it('keeps the copy button available on HTTP and indicates a successful copy', async function () {
    render(<CopyToClipboard content="original text" tooltipId="copy-test" />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    })
    expect(legacyCopy).to.have.been.calledOnceWithExactly('copy')
    expect(screen.getByText('check')).to.exist
  })

  it('does not indicate success when both interfaces are unavailable or denied', async function () {
    legacyCopy.returns(false)
    render(<CopyToClipboard content="original text" tooltipId="copy-test" />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    })
    expect(screen.queryByText('check')).to.equal(null)
    expect(screen.getByRole('button', { name: 'Copy' })).to.exist
  })

  it('keeps the existing click callback and modern copy behavior', async function () {
    const writeText = sinon.stub().resolves()
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    const onClick = sinon.stub()
    render(
      <CopyToClipboard
        content="original text"
        tooltipId="copy-test"
        onClick={onClick}
      />
    )
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
      expect(onClick).to.have.been.calledOnce
    })
    expect(writeText).to.have.been.calledOnceWithExactly('original text')
    expect(legacyCopy).not.to.have.been.called
    expect(screen.getByText('check')).to.exist
  })
})
