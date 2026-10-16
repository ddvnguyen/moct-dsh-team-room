// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { AgentTeamDocRef, AgentTeamDocView, AgentTeamMemberId, AgentTeamThreadRef } from '@ddvnguyen/moct-dsh-team-room/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { zh } from '../src/client/locales.ts'
import type { TeamConversationProps } from '../src/client/slots.ts'
import { TeamDocPage } from '../src/client/TeamDocPage.tsx'

const t = ((key: keyof typeof zh, params?: Record<string, string | number>) => {
  let value: string = zh[key]
  for (const [name, replacement] of Object.entries(params ?? {})) value = value.replace(`{${name}}`, String(replacement))
  return value
}) as TeamConversationProps['t']

afterEach(cleanup)

const workspaceId = 'workspace:alpha' as WorkspaceId
const docRef = 'doc:plan' as AgentTeamDocRef
const threadRef = 'thread:plan' as AgentTeamThreadRef
const human = 'member:human' as AgentTeamMemberId
const ann = 'member:agent-ann' as AgentTeamMemberId

function docView(overrides: Partial<AgentTeamDocView> = {}): AgentTeamDocView {
  return {
    doc: { docRef, channelRef: 'channel:room' as never, threadRef, author: ann, title: '发布计划', createdAtSequence: 10 },
    humanMemberId: human, status: 'in_review', revision: 12, submittedRevision: 12, updatedAt: '',
    sections: [{ sectionId: 's1', heading: '目标', markdown: '周五发布 1.2。', writer: ann, writtenAtSequence: 11 },
      { sectionId: 's2', heading: '步骤', markdown: '', writer: ann, writtenAtSequence: 10 }],
    comments: [], reviews: [],
    ...overrides,
  }
}

function page(views: AgentTeamDocView[], reviewOutcome: Awaited<ReturnType<TeamConversationProps['reviewDoc']>> | undefined = undefined,
  writeOutcome: Awaited<ReturnType<TeamConversationProps['writeDocSection']>> | undefined = undefined) {
  let current = 0
  const loadDoc = vi.fn(async () => ({ ok: true as const, value: views[Math.min(current++, views.length - 1)]! }))
  const commentDoc = vi.fn(async () => ({ ok: true as const, value: { receipt: {} as never, comment: {} as never } }))
  const reviewDoc = vi.fn(async () => reviewOutcome ?? ({ ok: true as const, value: { kind: 'committed' as const, receipt: {} as never, message: {} as never, thread: {} as never, notice: {} as never } }))
  const writeDocSection = vi.fn(async () => writeOutcome ?? ({ ok: true as const, value: { kind: 'committed' as const, receipt: {} as never, docRef, section: {} as never, revision: 20 } }))
  const resolveDocComment = vi.fn(async () => ({ ok: true as const, value: { receipt: {} as never, docRef, commentRef: 'comment:1' as never } }))
  const loadDocSectionHistory = vi.fn(async () => ({ ok: true as const, value: { docRef, sectionId: 's1', versions: [
    { sequence: 11, writer: ann, heading: '目标', markdown: '周五发布 1.2。', occurredAt: '2026-10-15T08:00:00.000Z' },
    { sequence: 10, writer: ann, heading: '目标', markdown: '', occurredAt: '2026-10-15T07:00:00.000Z' },
  ] } }))
  const loadMembers = vi.fn(async () => ({ ok: true as const, value: [{ member: { memberId: ann, handle: 'ann' } }] as never }))
  const backToThread = vi.fn()
  const view = render(<TeamDocPage workspaceId={workspaceId} docRef={docRef} threadRef={threadRef} humanName="Ddv"
    loadDoc={loadDoc} commentDoc={commentDoc} reviewDoc={reviewDoc} writeDocSection={writeDocSection} resolveDocComment={resolveDocComment}
    loadDocSectionHistory={loadDocSectionHistory} loadMembers={loadMembers} subscribeChanges={() => () => {}}
    backToThread={backToThread} sidebarCollapsed={false} openSidebar={() => {}} t={t} />)
  return { view, loadDoc, commentDoc, reviewDoc, writeDocSection, resolveDocComment, loadDocSectionHistory, backToThread }
}

/** Select the text of one node the way a pointer drag would, then announce it. */
function selectText(node: Node): void {
  const range = document.createRange()
  range.selectNodeContents(node)
  const selection = document.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
  document.dispatchEvent(new Event('selectionchange'))
}

describe('TeamDocPage', () => {
  it('renders the sections and an empty one, and goes back to the Thread', async () => {
    const { view, backToThread } = page([docView()])
    expect(await view.findByRole('heading', { name: '目标' })).toBeTruthy()
    expect(view.getByText('周五发布 1.2。')).toBeTruthy()
    expect(view.getByText(zh.docEmptySection)).toBeTruthy()
    expect(view.getByText(zh.docStatusInReview)).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: zh.docBack }))
    expect(backToThread).toHaveBeenCalled()
  })

  it('comments on a selected passage, then re-reads the Doc instead of guessing', async () => {
    const pendingComment = { commentRef: 'comment:1' as never, docRef, sectionId: 's1', quote: '周五发布 1.2。', body: '改到周四？', author: human, sequence: 13, occurredAt: '', pending: true, resolved: false }
    const { view, commentDoc, loadDoc } = page([docView(), docView({ comments: [pendingComment] })])
    selectText(await view.findByText('周五发布 1.2。'))
    expect(await view.findByText('针对「周五发布 1.2。」')).toBeTruthy()
    fireEvent.change(view.getByRole('textbox', { name: zh.docCommentLabel }), { target: { value: '改到周四？' } })
    fireEvent.click(view.getByRole('button', { name: zh.docAddComment }))
    await waitFor(() => expect(commentDoc).toHaveBeenCalledWith(expect.objectContaining({ docRef, sectionId: 's1', quote: '周五发布 1.2。', body: '改到周四？' })))
    await waitFor(() => expect(loadDoc).toHaveBeenCalledTimes(2))
    expect(await view.findByText(zh.docPendingBadge)).toBeTruthy()
    expect(view.getByText('Ddv')).toBeTruthy()
  })

  it('keeps Review closed until there is something to send, and fences every verdict by the revision on screen', async () => {
    const { view, reviewDoc } = page([docView()])
    const reviewButton = await view.findByRole('button', { name: zh.docRequestReview }) as HTMLButtonElement
    expect(reviewButton.disabled).toBe(true)
    expect(view.getByText(zh.docReviewNeedsComment)).toBeTruthy()
    fireEvent.change(view.getByRole('textbox', { name: zh.docReviewNoteLabel }), { target: { value: '步骤还没写' } })
    expect(reviewButton.disabled).toBe(false)
    fireEvent.click(reviewButton)
    await waitFor(() => expect(reviewDoc).toHaveBeenCalledWith(expect.objectContaining({ docRef, docRevision: 12, verdict: 'review', note: '步骤还没写' })))
  })

  it('asks twice before cancelling, and reloads with a notice when the Doc moved', async () => {
    const stale = { ok: true as const, value: { kind: 'stale_doc_revision' as const, docRef, expectedRevision: 12, revision: 14 } }
    const { view, reviewDoc, loadDoc } = page([docView(), docView({ revision: 14 })], stale)
    fireEvent.click(await view.findByRole('button', { name: zh.docCancel }))
    expect(reviewDoc).not.toHaveBeenCalled()
    fireEvent.click(view.getByRole('button', { name: zh.docConfirmCancel }))
    await waitFor(() => expect(reviewDoc).toHaveBeenCalledWith(expect.objectContaining({ verdict: 'cancel', docRevision: 12 })))
    expect(await view.findByText(zh.docStale)).toBeTruthy()
    expect(loadDoc).toHaveBeenCalledTimes(2)
  })

  it('shows a final Doc without verdict controls', async () => {
    const { view } = page([docView({ status: 'approved' })])
    expect(await view.findByText(zh.docFinal.replace('{status}', zh.docStatusApproved))).toBeTruthy()
    expect(view.queryByRole('button', { name: zh.docApprove })).toBeNull()
    expect(view.queryByText(zh.docSelectionHint)).toBeNull()
  })

  it('edits a section through the Host, fenced by the revision on screen, and shows the newer text when it moved', async () => {
    const stale = { ok: true as const, value: { kind: 'stale_doc_revision' as const, docRef, expectedRevision: 12, revision: 13 } }
    const moved = docView({ revision: 13, sections: [{ sectionId: 's1', heading: '目标', markdown: '周四发布 1.2。', writer: ann, writtenAtSequence: 13 },
      { sectionId: 's2', heading: '步骤', markdown: '', writer: ann, writtenAtSequence: 10 }] })
    const { view, writeDocSection } = page([docView(), moved], undefined, stale)
    fireEvent.click(await view.findByRole('button', { name: zh.docEditSectionNamed.replace('{heading}', '目标') }))
    const body = view.getByRole('textbox', { name: zh.docEditBody }) as HTMLTextAreaElement
    expect(body.value).toBe('周五发布 1.2。')
    fireEvent.change(body, { target: { value: '下周发布 1.2。' } })
    fireEvent.click(view.getByRole('button', { name: zh.docSaveSection }))
    await waitFor(() => expect(writeDocSection).toHaveBeenCalledWith(expect.objectContaining({ docRef, baseDocRevision: 12, sectionId: 's1', heading: '目标', markdown: '下周发布 1.2。' })))
    // Refused: the editor stays open with the draft, and the newer text sits above it.
    expect(await view.findByText(zh.docEditStale)).toBeTruthy()
    expect(view.getByText('周四发布 1.2。')).toBeTruthy()
    expect((view.getByRole('textbox', { name: zh.docEditBody }) as HTMLTextAreaElement).value).toBe('下周发布 1.2。')
    fireEvent.keyDown(view.getByRole('textbox', { name: zh.docEditBody }), { key: 'Escape' })
    expect(view.queryByRole('textbox', { name: zh.docEditBody })).toBeNull()
  })

  it('shows a section\'s history newest first and restores an older version as a new write', async () => {
    const { view, writeDocSection } = page([docView()])
    fireEvent.click(await view.findByRole('button', { name: zh.docHistoryNamed.replace('{heading}', '目标') }))
    expect(await view.findByText(zh.docHistoryCurrent)).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: zh.docHistoryRestore }))
    await waitFor(() => expect(writeDocSection).toHaveBeenCalledWith(expect.objectContaining({ baseDocRevision: 12, sectionId: 's1', heading: '目标', markdown: '' })))
  })

  it('resolves a thread and folds resolved threads away until asked', async () => {
    const open = { commentRef: 'comment:1' as never, docRef, sectionId: 's1', quote: '周五', body: '改到周四？', author: human, sequence: 13, occurredAt: '', pending: true, resolved: false }
    const done = { ...open, commentRef: 'comment:2' as never, body: '已处理', pending: false, resolved: true }
    const { view, resolveDocComment } = page([docView({ comments: [open, done] })])
    fireEvent.click(await view.findByRole('button', { name: zh.docResolve }))
    await waitFor(() => expect(resolveDocComment).toHaveBeenCalledWith(expect.objectContaining({ docRef, commentRef: 'comment:1' })))
    expect(view.queryByText('已处理')).toBeNull()
    fireEvent.click(view.getByRole('button', { name: zh.docShowResolved.replace('{count}', '1') }))
    expect(view.getByText('已处理')).toBeTruthy()
    expect(view.getByText(zh.docResolvedBadge)).toBeTruthy()
  })
})
