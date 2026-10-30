import { expect } from 'chai'
import { cleanup, render, screen } from '@testing-library/react'
import sinon from 'sinon'
import ToolCard from '../../frontend/js/chat/tool-card'
import { api } from '../../frontend/js/personal-ai/api'
import { encodeEditFailure } from '../../shared/edit-recovery.mjs'

describe('edit recovery presentation and API contract', function () {
  afterEach(cleanup)
  it('shows a concise explanation while retaining structured recovery data in tool history', function () {
    const errorText = encodeEditFailure({ code: 'edit_target_not_found', message: 'Find the old suggestion first.', details: { action: 'find_edit_suggestions' } })
    render(<ToolCard name="propose_edit" state="output-error" label="Edit paragraph" errorText={errorText} />)
    expect(screen.getByText('Find the old suggestion first.')).to.exist
    expect(screen.queryByText(/edit_target_not_found/)).to.equal(null)
    expect(screen.getByText('Failed')).to.exist
  })
  it('preserves plain errors from existing conversations', function () {
    render(<ToolCard name="propose_edit" state="output-error" label="Edit paragraph" errorText="Existing error" />)
    expect(screen.getByText('Existing error')).to.exist
  })
  it('preserves stable failure codes and recovery details from the API', async function () {
    const fetch = sinon.stub(globalThis, 'fetch').resolves({ ok: false, status: 409,
      json: async () => ({ error: 'Target missing', code: 'edit_target_not_found', details: { action: 'find_edit_suggestions' } }) } as Response)
    try {
      let failure: any
      try { await api('/edits', {}) } catch (error) { failure = error }
      expect(failure.message).to.equal('Target missing')
      expect(failure.code).to.equal('edit_target_not_found')
      expect(failure.details.action).to.equal('find_edit_suggestions')
    } finally { fetch.restore() }
  })
})
