import { expect } from 'chai'
import sinon from 'sinon'
import { copyTextToClipboard } from '../../../frontend/js/utils/clipboard'

describe('copyTextToClipboard', function () {
  const originalClipboard = Object.getOwnPropertyDescriptor(
    navigator,
    'clipboard'
  )
  const originalExecCommand = Object.getOwnPropertyDescriptor(
    document,
    'execCommand'
  )
  let container: HTMLDivElement
  let legacyCopy: sinon.SinonStub

  const setClipboard = (value: unknown) =>
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value,
    })

  beforeEach(function () {
    container = document.createElement('div')
    document.body.appendChild(container)
    legacyCopy = sinon.stub().returns(true)
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: legacyCopy,
    })
    setClipboard(undefined)
  })

  afterEach(function () {
    container.remove()
    window.getSelection()?.removeAllRanges()
    if (originalClipboard)
      Object.defineProperty(navigator, 'clipboard', originalClipboard)
    else delete (navigator as any).clipboard
    if (originalExecCommand)
      Object.defineProperty(document, 'execCommand', originalExecCommand)
    else delete (document as any).execCommand
  })

  it('keeps the modern clipboard path when it succeeds', async function () {
    const writeText = sinon.stub().resolves()
    setClipboard({ writeText })
    expect(await copyTextToClipboard('中文\n\\alpha + β')).to.equal(true)
    expect(writeText).to.have.been.calledOnceWithExactly('中文\n\\alpha + β')
    expect(legacyCopy).not.to.have.been.called
  })

  it('copies the exact text on HTTP without the modern API and removes the temporary field', async function () {
    const text = '中文\n\\alpha + β\n'
    legacyCopy.callsFake(() => {
      const input = document.activeElement as HTMLTextAreaElement
      expect(input.value).to.equal(text)
      expect(input.selectionStart).to.equal(0)
      expect(input.selectionEnd).to.equal(text.length)
      return true
    })
    expect(await copyTextToClipboard(text)).to.equal(true)
    expect(legacyCopy).to.have.been.calledOnceWithExactly('copy')
    expect(document.querySelector('textarea')).to.equal(null)
  })

  it('tries the compatibility path when permission is rejected', async function () {
    setClipboard({
      writeText: sinon
        .stub()
        .rejects(new DOMException('denied', 'NotAllowedError')),
    })
    expect(await copyTextToClipboard('text')).to.equal(true)
    expect(legacyCopy).to.have.been.calledOnce
  })

  it('handles a synchronous API error without rejecting', async function () {
    setClipboard({ writeText: sinon.stub().throws(new Error('unavailable')) })
    expect(await copyTextToClipboard('text')).to.equal(true)
  })

  it('returns failure when the compatibility command fails', async function () {
    legacyCopy.returns(false)
    expect(await copyTextToClipboard('text')).to.equal(false)
    expect(document.querySelector('textarea')).to.equal(null)
  })

  it('returns failure and cleans up when the compatibility command throws', async function () {
    legacyCopy.throws(new Error('denied'))
    expect(await copyTextToClipboard('text')).to.equal(false)
    expect(document.querySelector('textarea')).to.equal(null)
  })

  it('returns failure when neither copy interface is available', async function () {
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: undefined,
    })
    expect(await copyTextToClipboard('text')).to.equal(false)
  })

  it('restores focus and a backwards input selection inside a modal', async function () {
    container.setAttribute('role', 'dialog')
    const input = document.createElement('input')
    input.value = 'original text'
    container.appendChild(input)
    input.focus()
    input.setSelectionRange(2, 7, 'backward')
    legacyCopy.callsFake(() => {
      expect(document.activeElement?.parentElement).to.equal(container)
      return true
    })
    await copyTextToClipboard('copied text')
    expect(document.activeElement).to.equal(input)
    expect(input.value).to.equal('original text')
    expect(input.selectionStart).to.equal(2)
    expect(input.selectionEnd).to.equal(7)
    expect(input.selectionDirection).to.equal('backward')
    expect(container.querySelector('textarea')).to.equal(null)
  })

  it('preserves the original document selection and its direction', async function () {
    const editor = document.createElement('div')
    editor.contentEditable = 'true'
    editor.tabIndex = 0
    editor.textContent = 'original selection'
    container.appendChild(editor)
    editor.focus()
    const selection = window.getSelection()!
    selection.setBaseAndExtent(editor.firstChild!, 8, editor.firstChild!, 1)
    await copyTextToClipboard('different text')
    expect(document.activeElement).to.equal(editor)
    expect(selection.toString()).to.equal('riginal')
    expect(selection.anchorOffset).to.equal(8)
    expect(selection.focusOffset).to.equal(1)
    expect(editor.textContent).to.equal('original selection')
  })
})
