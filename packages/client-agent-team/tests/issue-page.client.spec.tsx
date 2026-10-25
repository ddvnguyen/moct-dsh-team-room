// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type {
  AgentTeamClientMemberStatus,
  AgentTeamDecisionNoticeResult,
  AgentTeamDecisionRef,
  AgentTeamIssueComment,
  AgentTeamIssueView,
  AgentTeamMemberId,
  AgentTeamMessageRef,
  AgentTeamTaskRef,
  AgentTeamTaskResult,
  AgentTeamThreadHistory,
  AgentTeamThreadRef,
  AgentTeamUpdateTaskResult,
  AgentTeamView,
} from '@ddvnguyen/moct-dsh-team-room/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { zh } from '../src/client/locales.ts'
import type { TeamConversationProps } from '../src/client/slots.ts'
import { TeamDraftStore } from '../src/client/drafts.ts'
import { IssuePage } from '../src/client/issue/IssuePage.tsx'

const t = ((key: keyof typeof zh, params?: Record<string, string | number>) => {
  let value: string = zh[key]
  for (const [name, replacement] of Object.entries(params ?? {})) value = value.replace(`{${name}}`, String(replacement))
  return value
}) as TeamConversationProps['t']

afterEach(cleanup)

const workspaceId = 'workspace:alpha' as WorkspaceId
const channelRef = 'channel:room' as never
const threadRef = 'thread:one' as AgentTeamThreadRef
const taskRef = 'task:one' as AgentTeamTaskRef
const human = 'member:human' as AgentTeamMemberId
const ann = 'member:agent-ann' as AgentTeamMemberId

const anchorRef = 'message:1' as AgentTeamMessageRef
const askRef = 'message:50' as AgentTeamMessageRef

function message(ref: string, body: string, sequence: number): AgentTeamIssueComment {
  return {
    kind: 'message',
    sequence,
    message: {
      messageRef: ref as AgentTeamMessageRef,
      channelRef,
      threadRef,
      sender: ann,
      body,
      topLevel: true,
      sequence,
      occurredAt: '2026-10-22T01:00:00.000Z',
    },
    mentions: [],
    occurredAt: '2026-10-22T01:00:00.000Z',
  }
}

function issueView(overrides: Partial<AgentTeamIssueView> = {}): AgentTeamIssueView {
  return {
    task: { taskRef, channelRef, threadRef, status: 'todo', resolution: 'open', position: 0 },
    thread: { threadRef, taskRef, revision: 7 },
    taskNumber: 12,
    title: 'Ship the issue view',
    description: { body: 'The anchor body.', author: human, occurredAt: '2026-10-22T01:00:00.000Z', source: 'anchor', revision: 0 },
    properties: {
      status: 'todo',
      resolution: 'open',
      priority: 'none',
      position: 0,
      channelRef,
      channelName: 'Room',
      taskNumber: 12,
      claimOwners: [],
      planningPhase: true,
      createdAt: '2026-10-22T01:00:00.000Z',
      updatedAt: '2026-10-22T02:00:00.000Z',
    },
    // The newest page: two comments, the oldest of them at sequence 100.
    comments: { items: [message('message:100', 'Newest comment.', 100), message('message:101', 'Newest reply.', 101)], hasMore: true, cursor: 100 },
    activity: { items: [], hasMore: false },
    // The ask card owns its message: the comment region must not repeat it.
    decisions: [{ kind: 'card', card: { decisionRef: 'decision:1' as AgentTeamDecisionRef, channelRef, threadRef, asker: ann, messageRef: askRef, askedAt: '2026-10-22T01:00:00.000Z', status: 'open', questions: [] } }],
    executionLog: { sessions: [], failures: [] },
    docs: [],
    ...overrides,
  }
}

function history(facts: readonly AgentTeamIssueComment[], hasMore: boolean): AgentTeamThreadHistory {
  return {
    thread: { threadRef, taskRef, revision: 7 },
    anchor: { messageRef: anchorRef, channelRef, threadRef, sender: human, body: 'The anchor body.', topLevel: true, sequence: 1, occurredAt: '2026-10-22T00:00:00.000Z' },
    anchorMentions: [],
    claims: [],
    facts,
    cursor: facts[0]?.sequence ?? 0,
    hasMore,
  } as unknown as AgentTeamThreadHistory
}

interface Harness {
  readonly loadThreadHistory: ReturnType<typeof vi.fn>
  readonly view: ReturnType<typeof render>
  readonly showSlice: ReturnType<typeof vi.fn>
  readonly goToThread: ReturnType<typeof vi.fn>
}

function renderPage(options: {
  readonly pages: readonly AgentTeamThreadHistory[]
  /** The shell column's state, as the conversation reads it: the header offers the reopen control while the column is closed. */
  readonly sidebarCollapsed?: boolean
  readonly openSidebar?: () => void
}): Harness {
  const loadThreadHistory = vi.fn(async () => ({ ok: true as const, value: options.pages[loadThreadHistory.mock.calls.length - 1] ?? options.pages[0]! }))
  const showSlice = vi.fn()
  const goToThread = vi.fn()
  const view = render(
    <IssuePage
      workspaceId={workspaceId}
      taskRef={taskRef}
      loadIssueView={vi.fn(async () => ({ ok: true as const, value: issueView() }))}
      loadMembers={vi.fn(async () => ({ ok: true as const, value: [] as readonly AgentTeamClientMemberStatus[] }))}
      loadChannels={vi.fn(async () => ({ ok: true as const, value: { humanMemberId: human } as unknown as AgentTeamView }))}
      humanName="ddvnguyen"
      loadThreadHistory={loadThreadHistory}
      reply={vi.fn(async () => ({ ok: true as const, value: { kind: 'committed' } })) as unknown as TeamConversationProps['reply']}
      drafts={new TeamDraftStore()}
      loadTriggerCatalog={vi.fn(async () => []) as unknown as TeamConversationProps['loadTriggerCatalog']}
      updateTask={vi.fn(async () => ({ ok: true as const, value: { kind: 'committed' } as unknown as AgentTeamUpdateTaskResult }))}
      changeTask={vi.fn(async () => ({ ok: true as const, value: { kind: 'committed' } as unknown as AgentTeamTaskResult }))}
      answerDecision={vi.fn(async () => ({ ok: true as const, value: {} as unknown as AgentTeamDecisionNoticeResult }))}
      loadThreadSessions={vi.fn(async () => ({ ok: true as const, value: [] }))}
      loadMemberActivity={vi.fn(async () => ({ ok: true as const, value: { revision: 0, activities: [] } }))}
      threadTurnFailures={vi.fn(async () => ({ ok: true as const, value: [] }))}
      openMemberSession={vi.fn()}
      stopSession={vi.fn(async () => ({ ok: true as const, value: { accepted: true as const } }))}
      subscribeChanges={vi.fn(() => () => {})}
      closeIssue={vi.fn()}
      showSlice={showSlice}
      goToThread={goToThread}
      sidebarCollapsed={options.sidebarCollapsed}
      openSidebar={options.openSidebar}
      t={t}
    />,
  )
  return { loadThreadHistory, view, showSlice, goToThread }
}

describe('IssuePage', () => {
  it('offers the way back to the slice, so the variant switch runs both ways', async () => {
    const harness = renderPage({ pages: [] })
    await waitFor(() => { expect(harness.view.container.querySelector('[data-team-issue-page]')).not.toBeNull() })
    // The page is the slice's Maximize target; the reader goes back the same
    // way they came, over the same slot.
    fireEvent.click(harness.view.getByRole('button', { name: zh.issueBackToSlice }))
    expect(harness.showSlice).toHaveBeenCalled()
  })

  it('keeps the legacy Thread one control away, in the issue\'s own header', async () => {
    const harness = renderPage({ pages: [] })
    await waitFor(() => { expect(harness.view.container.querySelector('[data-team-issue-page]')).not.toBeNull() })
    // D10: the issue is what the reader lands on, and the Thread is what they
    // ask for — the same header control the slice carries.
    fireEvent.click(harness.view.getByRole('button', { name: zh.issueOpenLegacyThread }))
    expect(harness.goToThread).toHaveBeenCalledTimes(1)
  })

  it('carries the slim header, with the sidebar reopen control only while the column is closed', async () => {
    const openSidebar = vi.fn()
    const expanded = renderPage({ pages: [], sidebarCollapsed: false, openSidebar })
    await waitFor(() => { expect(expanded.view.container.querySelector('[data-team-issue-page]')).not.toBeNull() })
    // The header is the shell's slim-header family, so the reopen control is
    // the same control the Channel and Thread pages offer.
    const header = expanded.view.getByTestId('issue-header')
    expect(header.getAttribute('data-team-slim-header')).toBe('issue')
    expect(expanded.view.queryByTestId('issue-open-sidebar')).toBeNull()

    const collapsed = renderPage({ pages: [], sidebarCollapsed: true, openSidebar })
    await waitFor(() => { expect(collapsed.view.container.querySelector('[data-team-issue-page]')).not.toBeNull() })
    fireEvent.click(collapsed.view.getByTestId('issue-open-sidebar'))
    expect(openSidebar).toHaveBeenCalledTimes(1)
  })

  it('gives every icon control in the header an accessible name', async () => {
    const harness = renderPage({ pages: [] })
    await waitFor(() => { expect(harness.view.container.querySelector('[data-team-issue-page]')).not.toBeNull() })
    // Icons alone are an a11y regression: a glyph with no name is silent to a
    // screen reader and unnameable to a tooltip. Every icon button here carries
    // both an accessible name and the hover text that says the same thing.
    const header = harness.view.getByTestId('issue-header')
    const icons = [...header.querySelectorAll('button')].filter(button => (button.textContent ?? '').trim() === '')
    expect(icons.length).toBeGreaterThan(0)
    for (const icon of icons) {
      const shown = icon.outerHTML.slice(0, 160)
      expect(icon.getAttribute('aria-label') ?? '', shown).not.toBe('')
      expect(icon.getAttribute('title') ?? '', shown).not.toBe('')
    }
  })

  /**
   * The browser journey (M-42) drives this surface by hook, not by copy: a
   * heading is a translated string and a region's name changes with the
   * language, so a test that matches on it breaks on a wording change that is
   * not a behaviour change. Every region and every control the journey names
   * carries a `data-testid` here, and this spec is what keeps the names honest
   * — a hook that disappears fails the unit suite, not the browser run.
   */
  it('names each region and the header controls with a stable hook', async () => {
    const harness = renderPage({ pages: [] })
    await waitFor(() => { expect(harness.view.getByTestId('issue-page')).toBeTruthy() })
    for (const id of [
      'issue-header', 'issue-title', 'issue-status', 'issue-open-legacy-thread',
      'issue-description', 'issue-description-body',
      'issue-properties', 'issue-prop-status', 'issue-prop-priority', 'issue-prop-assignee',
      'issue-timeline', 'issue-decisions', 'issue-execution-log',
      'issue-back-to-slice', 'issue-close',
    ]) {
      expect(harness.view.getByTestId(id), id).toBeTruthy()
    }
    // The title editor is the second half of the title hook: the button opens
    // it and the input is what the journey types into.
    fireEvent.click(harness.view.getByTestId('issue-title'))
    await waitFor(() => { expect(harness.view.getByTestId('issue-title-input')).toBeTruthy() })
  })

  it('pages the older comments with the merged cursor, and never repeats a page', async () => {
    // The first older page carries the Thread's anchor, the ask of a decision
    // card, and one real comment.
    const first = history([message(anchorRef, 'The anchor body.', 1), message(askRef, 'The ask body.', 50), message('message:51', 'Older comment.', 51)], true)
    const second = history([message('message:10', 'Oldest comment.', 10)], false)
    const harness = renderPage({ pages: [first, second] })
    await waitFor(() => { expect(harness.view.getByText('Newest comment.')).toBeTruthy() })

    const more = harness.view.getByRole('button', { name: zh.issueCommentsMore })
    fireEvent.click(more)
    await waitFor(() => { expect(harness.loadThreadHistory).toHaveBeenCalledTimes(1) })
    // The first page is read from the newest page's cursor.
    expect(harness.loadThreadHistory.mock.calls[0]![0]).toMatchObject({ beforeSequence: 100 })
    // The anchor and the ask never enter the comment list: the description and
    // the decisions own them. The anchor's body is the description's body, so
    // it appears once — as the description — and never as a comment.
    await waitFor(() => { expect(harness.view.getByText('Older comment.')).toBeTruthy() })
    expect(harness.view.getAllByText('The anchor body.')).toHaveLength(1)
    expect(harness.view.queryByText('The ask body.')).toBeNull()

    // The second page is read from the first older page's oldest comment, not
    // from the newest page's cursor — the newest page never moves.
    fireEvent.click(harness.view.getByRole('button', { name: zh.issueCommentsMore }))
    await waitFor(() => { expect(harness.loadThreadHistory).toHaveBeenCalledTimes(2) })
    expect(harness.loadThreadHistory.mock.calls[1]![0]).toMatchObject({ beforeSequence: 51 })
    await waitFor(() => { expect(harness.view.getByText('Oldest comment.')).toBeTruthy() })
    // No comment is listed twice.
    expect(harness.view.getAllByText('Older comment.')).toHaveLength(1)
    expect(harness.view.getAllByText('Newest comment.')).toHaveLength(1)
  })
})
