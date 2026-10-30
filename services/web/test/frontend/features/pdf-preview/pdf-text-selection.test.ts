import { expect } from 'chai'
import sinon from 'sinon'

// Exercise the installed PDF.js listener, with real DOM ranges and a minimal
// text renderer. No PDF worker, canvas or application providers are needed.
class TestTextLayer {
  textDivs: HTMLElement[] = []
  textContentItemsStr: string[] = []
  constructor(
    private options: { container: HTMLElement; textContentSource: string }
  ) {}
  async render() {
    const span = document.createElement('span')
    span.textContent = this.options.textContentSource
    this.options.container.append(span)
    this.textDivs.push(span)
    this.textContentItemsStr.push(span.textContent)
  }
  cancel() {}
}

for (const distribution of ['web', 'legacy/web']) {
  describe(`PDF.js ${distribution} selection scope`, function () {
    let Builder: any
    let currentRanges: Range[]
    let builders: any[]
    let errors: Error[]
    let sandbox: sinon.SinonSandbox
    const originalRange = (globalThis as any).Range
    const originalPdfjs = (globalThis as any).pdfjsLib
    const collectError = (event: ErrorEvent) => {
      errors.push(event.error)
      event.preventDefault()
    }
    before(async function () {
      globalThis.Range = window.Range
      const core = await import('pdfjs-dist/legacy/build/pdf.mjs')
      ;(globalThis as any).pdfjsLib = { ...core, TextLayer: TestTextLayer }
      Builder = (await import(`pdfjs-dist/${distribution}/pdf_viewer.mjs`))
        .TextLayerBuilder
    })
    after(function () {
      if (originalRange) globalThis.Range = originalRange
      else delete (globalThis as any).Range
      if (originalPdfjs) (globalThis as any).pdfjsLib = originalPdfjs
      else delete (globalThis as any).pdfjsLib
    })
    beforeEach(function () {
      currentRanges = []
      builders = []
      errors = []
      sandbox = sinon.createSandbox()
      sandbox.stub(globalThis, 'AbortController').value(window.AbortController)
      sandbox.stub(document, 'getSelection').callsFake(
        () =>
          ({
            rangeCount: currentRanges.length,
            getRangeAt: (index: number) => currentRanges[index],
            toString: () =>
              currentRanges.map(range => range.toString()).join(''),
          }) as Selection
      )
      window.addEventListener('error', collectError)
    })
    afterEach(function () {
      builders.forEach(builder => builder.cancel())
      document.body.replaceChildren()
      window.removeEventListener('error', collectError)
      sandbox.restore()
    })
    async function page(text: string) {
      const builder = new Builder({
        pdfPage: { streamTextContent: () => text },
        onAppend: (div: HTMLElement) => document.body.append(div),
      })
      builders.push(builder)
      await builder.render({ viewport: {} })
      return builder.div as HTMLElement
    }
    function rangeIn(element: HTMLElement) {
      const range = document.createRange()
      range.selectNodeContents(element)
      return range
    }
    function commentRange() {
      const host = document.createElement('div')
      const shadow = host.attachShadow({ mode: 'open' })
      const input = document.createElement('div')
      input.textContent = 'Comment reply text'
      shadow.append(input)
      document.body.append(host)
      return rangeIn(input)
    }
    function select(...ranges: Range[]) {
      currentRanges = ranges
      document.dispatchEvent(new Event('selectionchange'))
    }

    it('ignores a comment ShadowRoot selection after selecting PDF text', async function () {
      const pdf = await page('PDF first page')
      select(rangeIn(pdf.querySelector('span')!))
      expect(pdf.classList.contains('selecting')).to.equal(true)
      select(commentRange())
      expect(
        errors.map(error => `${error.name}: ${error.message}`)
      ).to.deep.equal([])
      expect(pdf.classList.contains('selecting')).to.equal(false)
      expect(pdf.lastElementChild!.className).to.equal('endOfContent')
    })

    it('does not retain a comment selection when returning to the PDF', async function () {
      const pdf = await page('PDF first page')
      select(commentRange())
      select(rangeIn(pdf.querySelector('span')!))
      expect(
        errors.map(error => `${error.name}: ${error.message}`)
      ).to.deep.equal([])
      expect(pdf.classList.contains('selecting')).to.equal(true)
    })

    it('forgets previous PDF boundaries after an empty selection', async function () {
      const pdf = await page('PDF first page')
      select(rangeIn(pdf.querySelector('span')!))
      select()
      const next = rangeIn(pdf.querySelector('span')!)
      const compare = sandbox.spy(next, 'compareBoundaryPoints')
      select(next)
      expect(compare.called).to.equal(false)
      expect(
        errors.map(error => `${error.name}: ${error.message}`)
      ).to.deep.equal([])
    })

    it('keeps multi-page selection and PDF copy handling intact', async function () {
      const first = await page('First page text. ')
      const second = await page('Second page text.')
      const range = document.createRange()
      range.setStart(first.querySelector('span')!.firstChild!, 0)
      range.setEnd(
        second.querySelector('span')!.firstChild!,
        'Second page text.'.length
      )
      select(range)
      expect(first.classList.contains('selecting')).to.equal(true)
      expect(second.classList.contains('selecting')).to.equal(true)
      const setData = sandbox.spy()
      const copy = new Event('copy', { bubbles: true, cancelable: true })
      Object.defineProperty(copy, 'clipboardData', { value: { setData } })
      second.dispatchEvent(copy)
      expect(
        setData.calledWith('text/plain', 'First page text. Second page text.')
      ).to.equal(true)
      expect(copy.defaultPrevented).to.equal(true)
      expect(
        errors.map(error => `${error.name}: ${error.message}`)
      ).to.deep.equal([])
    })

    it('handles repeated switches between separate comment inputs and PDF pages', async function () {
      const pdf = await page('PDF first page')
      for (let index = 0; index < 3; index++) {
        select(rangeIn(pdf.querySelector('span')!))
        select(commentRange())
        select(commentRange())
      }
      select(rangeIn(pdf.querySelector('span')!))
      expect(
        errors.map(error => `${error.name}: ${error.message}`)
      ).to.deep.equal([])
    })
  })
}
