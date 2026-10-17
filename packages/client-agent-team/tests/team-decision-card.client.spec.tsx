// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { AgentTeamDecisionRef, AgentTeamDecisionView, AgentTeamDocRef, AgentTeamDocSummary, AgentTeamMemberId, AgentTeamThreadRef } from '@ddvnguyen/moct-dsh-team-room/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { zh } from '../src/client/locales.ts'
import type { TeamConversationProps } from '../src/client/slots.ts'
import { TeamDecisionCard } from '../src/client/TeamDecisionCard.tsx'
import { TeamThreadDocs } from '../src/client/TeamThreadDocs.tsx'

const t = ((key: keyof typeof zh, params?: Record<string, string | number>) => {
  let value: string = zh[key]
  for (const [name, replacement] of Object.entries(params ?? {})) value = value.replace(`{${name}}`, String(replacement))
  return value
}) as TeamConversationProps['t']

afterEach(cleanup)

const workspaceId = 'workspace:alpha' as WorkspaceId
const threadRef = 'thread:plan' as AgentTeamThreadRef
const human = 'member:human' as AgentTeamMemberId
const ann = 'member:agent-ann' as AgentTeamMemberId

function decisionView(overrides: Partial<AgentTeamDecisionView> = {}): AgentTeamDecisionView {
  return {
    decisionRef: 'decision:1' as AgentTeamDecisionRef, channelRef: 'channel:room' as never, threadRef, asker: ann, messageRef: 'message:1' as never,
    context: '发布前要定两件事。', askedAt: '2026-10-16T01:00:00.000Z', status: 'open',
    questions: [
      { prompt: '哪天发布？', multiple: false, options: [{ label: '周四', description: '提前一天。' }, { label: '周五' }], recommended: [1] },
      { prompt: '通知谁？', multiple: true, options: [{ label: '客户' }, { label: '运营' }, { label: '销售' }], recommended: [0, 1] },
    ],
    ...overrides,
  }
}

const nameOf = (memberId: AgentTeamMemberId): string => memberId === human ? 'Ddv' : '@ann'

describe('TeamDecisionCard', () => {
  it('sends one answer per question only once each is answered, then shows the Host error without closing', async () => {
    const answer = vi.fn(async () => '卡片已被回答')
    const view = render(<TeamDecisionCard decision={decisionView()} nameOf={nameOf} answer={answer} t={t} />)
    expect(view.getByText('发布前要定两件事。')).toBeTruthy()
    expect(view.getAllByText(zh.decisionRecommended)).toHaveLength(3)
    const send = view.getByRole('button', { name: zh.decisionSend }) as HTMLButtonElement
    expect(send.disabled).toBe(true)
    fireEvent.click(view.getByRole('radio', { name: /周四/ }))
    expect(send.disabled).toBe(true)
    fireEvent.click(view.getByRole('checkbox', { name: /客户/ }))
    fireEvent.click(view.getByRole('checkbox', { name: /销售/ }))
    fireEvent.change(view.getByRole('textbox', { name: '第 2 题的其他回答' }), { target: { value: ' 还有合作方 ' } })
    expect(send.disabled).toBe(false)
    fireEvent.click(send)
    await waitFor(() => { expect(answer).toHaveBeenCalledWith([{ selected: [0] }, { selected: [0, 2], text: '还有合作方' }]) })
    expect((await view.findByRole('alert')).textContent).toBe('卡片已被回答')
    expect((view.getByRole('radio', { name: /周四/ }) as HTMLInputElement).checked).toBe(true)
  })

  it('takes a written answer alone, and Enter sends it', async () => {
    const answer = vi.fn(async () => undefined)
    const single = decisionView({ questions: [decisionView().questions[0]!] })
    const view = render(<TeamDecisionCard decision={single} nameOf={nameOf} answer={answer} t={t} />)
    const other = view.getByRole('textbox', { name: '第 1 题的其他回答' })
    fireEvent.change(other, { target: { value: '下周一' } })
    fireEvent.keyDown(other, { key: 'Enter' })
    await waitFor(() => { expect(answer).toHaveBeenCalledWith([{ selected: [], text: '下周一' }]) })
  })

  it('shows an answered card read-only with the picks and who answered', () => {
    const answered = decisionView({ status: 'answered', answers: [{ selected: [1] }, { selected: [], text: '只通知运营' }], closedBy: human, closedAt: '2026-10-16T01:05:00.000Z' })
    const view = render(<TeamDecisionCard decision={answered} nameOf={nameOf} answer={vi.fn()} t={t} />)
    expect(view.queryByRole('button', { name: zh.decisionSend })).toBeNull()
    expect((view.getByRole('radio', { name: /周五/ }) as HTMLInputElement).checked).toBe(true)
    expect(view.getByText('只通知运营')).toBeTruthy()
    expect(view.getByText(/Ddv 已回答/)).toBeTruthy()
  })

  it('shows a withdrawn card as needing no answer', () => {
    const view = render(<TeamDecisionCard decision={decisionView({ status: 'withdrawn', closedBy: ann, closedAt: '' })} nameOf={nameOf} answer={vi.fn()} t={t} />)
    expect(view.getByText(zh.decisionWithdrawn)).toBeTruthy()
    expect(view.container.querySelector('[data-team-decision]')?.getAttribute('data-status')).toBe('withdrawn')
  })
})

describe('TeamThreadDocs plan card', () => {
  const summary = (status: AgentTeamDocSummary['status']): AgentTeamDocSummary => ({ docRef: 'doc:plan' as AgentTeamDocRef, channelRef: 'channel:room' as never, threadRef,
    title: '发布计划', author: ann, status, revision: 12, sectionCount: 2, pendingCommentCount: 0, updatedAt: '' })

  it('approves a Doc in review at the revision on the card, and Revise opens the Doc', async () => {
    const docs = [[summary('in_review')], [summary('approved')]]
    let read = 0
    const loadDocs = vi.fn(async () => ({ ok: true as const, value: { docs: docs[Math.min(read++, 1)]! } }))
    const reviewDoc = vi.fn(async () => ({ ok: true as const, value: { kind: 'committed' as const, receipt: {} as never, message: {} as never, thread: {} as never, notice: {} as never } }))
    const openDoc = vi.fn()
    const view = render(<TeamThreadDocs workspaceId={workspaceId} home={{ threadRef }} loadDocs={loadDocs} reviewDoc={reviewDoc} changeVersion={0} openDoc={openDoc} t={t} />)
    fireEvent.click(await view.findByRole('button', { name: '打开「发布计划」并留下修改意见' }))
    expect(openDoc).toHaveBeenCalledWith(summary('in_review'))
    fireEvent.click(view.getByRole('button', { name: '批准「发布计划」' }))
    await waitFor(() => { expect(reviewDoc).toHaveBeenCalledWith(expect.objectContaining({ workspaceId, docRef: 'doc:plan', docRevision: 12, verdict: 'approve' })) })
    await waitFor(() => { expect(view.queryByRole('button', { name: '批准「发布计划」' })).toBeNull() })
    expect(view.container.querySelector('[data-team-doc-card]')?.textContent).toContain(zh.docStatusApproved)
  })

  it('keeps a Doc open-only when it is not in review', async () => {
    const loadDocs = vi.fn(async () => ({ ok: true as const, value: { docs: [summary('draft')] } }))
    const view = render(<TeamThreadDocs workspaceId={workspaceId} home={{ threadRef }} loadDocs={loadDocs} reviewDoc={vi.fn()} changeVersion={0} openDoc={vi.fn()} t={t} />)
    expect(await view.findByRole('button', { name: zh.docOpen.replace('{title}', '发布计划') })).toBeTruthy()
    expect(view.queryByRole('button', { name: zh.docApprove })).toBeNull()
  })
})
