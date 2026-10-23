// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within, type RenderResult } from '@testing-library/react'
import type {
  AgentTeamActivity,
  AgentTeamClientMemberStatus,
  AgentTeamIssueComment,
  AgentTeamIssueView,
  AgentTeamMemberId,
  AgentTeamSessionRun,
  AgentTeamTaskRef,
  AgentTeamThreadRef,
  AgentTeamThreadSessionRuns,
} from '@ddvnguyen/moct-dsh-team-room/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { zh } from '../src/client/locales.ts'
import type { TeamConversationProps } from '../src/client/slots.ts'
import { TeamDraftStore } from '../src/client/drafts.ts'
import { IssueView } from '../src/client/issue/IssueView.tsx'

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

const members: readonly AgentTeamClientMemberStatus[] = [
  { member: { memberId: human, handle: 'ddvnguyen', description: 'the human' }, workspaceIds: [workspaceId] },
  { member: { memberId: ann, handle: 'ann', description: 'the seat' }, workspaceIds: [workspaceId] },
] as unknown as readonly AgentTeamClientMemberStatus[]

const nameOf = (memberId: AgentTeamMemberId): string => memberId === human ? 'ddvnguyen' : 'ann'

function comment(body: string, sequence: number, replyToMessageRef?: string): AgentTeamIssueComment {
  return {
    kind: 'message',
    sequence,
    message: {
      messageRef: `message:${sequence}` as never,
      channelRef,
      threadRef,
      sender: ann,
      body,
      topLevel: replyToMessageRef === undefined,
      ...(replyToMessageRef === undefined ? {} : { replyToMessageRef: replyToMessageRef as never }),
      sequence,
      occurredAt: '2026-10-22T01:00:00.000Z',
    },
    mentions: [],
    occurredAt: '2026-10-22T01:00:00.000Z',
  }
}

function issueView(overrides: Partial<AgentTeamIssueView> = {}): AgentTeamIssueView {
  const activity: AgentTeamActivity = {
    kind: 'promote',
    actor: human,
    sequence: 1,
    activityRef: 'activity:1' as never,
    taskRef,
    threadRef,
  }
  return {
    task: { taskRef, channelRef, threadRef, status: 'todo', resolution: 'open', position: 0 },
    thread: { threadRef, taskRef, revision: 7 },
    taskNumber: 12,
    title: 'Ship the issue view',
    description: { body: 'The issue body.', author: human, occurredAt: '2026-10-22T01:00:00.000Z', source: 'anchor', revision: 0 },
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
    comments: { items: [comment('First comment.', 2), comment('A reply.', 3, 'message:2')], hasMore: false, cursor: 2 },
    activity: { items: [activity], hasMore: false },
    decisions: [],
    executionLog: { sessions: [], failures: [] },
    docs: [],
    ...overrides,
  }
}

/** One recorded Session run; the token figures are the ones a total sums. */
function run(sessionId: string, overrides: Partial<AgentTeamSessionRun> = {}): AgentTeamSessionRun {
  return {
    sessionId: sessionId as never,
    memberId: ann,
    threadRefs: [threadRef],
    startedAt: '2026-10-22T01:00:00.000Z',
    endedAt: '2026-10-22T01:05:00.000Z',
    turns: 1,
    tokensIn: 1_000,
    unknownInputTurns: 0,
    tokensOut: 200,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    reasoningTokens: null,
    toolCalls: 0,
    runMs: 300_000,
    model: null,
    lastAssistantAt: '2026-10-22T01:05:00.000Z',
    ...overrides,
  }
}

function executionProps(sessions: readonly AgentTeamThreadSessionRuns[] = []): React.ComponentProps<typeof IssueView>['execution'] {
  return {
    workspaceId,
    threadRef,
    loadThreadSessions: vi.fn(async () => ({ ok: true as const, value: sessions })),
    loadMemberActivity: vi.fn(async () => ({ ok: true as const, value: { revision: 0, activities: [] } })),
    threadTurnFailures: vi.fn(async () => ({ ok: true as const, value: [] })),
    openMemberSession: vi.fn(),
    stopSession: vi.fn(async () => ({ ok: true as const, value: { accepted: true as const } })),
    subscribeChanges: vi.fn(() => () => {}),
    members,
    t,
  }
}

function renderView(overrides: Partial<React.ComponentProps<typeof IssueView>> = {}, sessions: readonly AgentTeamThreadSessionRuns[] = []): RenderResult {
  const execution = executionProps(sessions)
  return render(
    <IssueView
      view={issueView()}
      members={members}
      nameOf={nameOf}
      humanMemberId={human}
      humanName="ddvnguyen"
      mentionHandles={new Map([[ann, 'ann']])}
      onRename={async () => undefined}
      onStatus={() => {}}
      onPriority={() => {}}
      onAssignee={() => {}}
      onLoadOlderComments={() => {}}
      loadingOlderComments={false}
      commentWrite={{
        workspaceId,
        taskRef,
        baseRevision: 7,
        reply: vi.fn(async () => ({ ok: true as const, value: { kind: 'committed' } })) as unknown as TeamConversationProps['reply'],
        drafts: new TeamDraftStore(),
        loadTriggerCatalog: vi.fn(async () => []) as unknown as TeamConversationProps['loadTriggerCatalog'],
        draftKey: `issue:${taskRef}`,
      }}
      onAnswerDecision={async () => undefined}
      execution={execution}
      pending={false}
      variant="page"
      t={t}
      {...overrides}
    />,
  )
}

describe('IssueView', () => {
  it('renders the seven regions from the Host value', async () => {
    const view = renderView({}, [{ memberId: ann, active: run('session:live'), history: [run('session:live')] }])
    // 1. Header: the Host-resolved title, the number and the status.
    expect(view.getByRole('button', { name: zh.editTitle }).textContent).toBe('Ship the issue view')
    expect(view.getByText('#12')).toBeTruthy()
    // 2. Description.
    expect(view.getByText('The issue body.')).toBeTruthy()
    // 3. Properties.
    expect(view.getByText(zh.propStatus)).toBeTruthy()
    expect(view.getByText(zh.propPriority)).toBeTruthy()
    expect(view.getByText(zh.propAssignee)).toBeTruthy()
    // 4. Comments: both the comment and its reply. A reply quotes the message
    //    it answers, so the parent's body appears twice on screen — once as
    //    the card body, once as the quote — and the assertion names the
    //    bodies, not the whole page.
    const bodies = [...view.container.querySelectorAll('[data-comment-body]')].map(node => node.textContent)
    expect(bodies).toEqual(['First comment.', 'A reply.'])
    expect(view.container.querySelector('[data-comment-quote]')?.textContent).toContain('First comment.')
    // 5. Activity.
    expect(view.getByText(zh.issueActivityLabel)).toBeTruthy()
    // 6. Decisions.
    expect(view.getByText(zh.issueDecisionsLabel)).toBeTruthy()
    // 7. Execution log, once its read lands: the page sidebar's own region.
    const side = view.container.querySelector('[data-team-issue-side]')
    await waitFor(() => { expect(side?.querySelector('[data-team-issue-execution-log]')).toBeTruthy() })
  })

  it('commits a new title through the callback and keeps the draft when the write is refused', async () => {
    const onRename = vi.fn(async (title: string) => title === 'refused' ? '写入被拒绝' : undefined)
    const view = renderView({ onRename })
    const title = view.getByRole('button', { name: zh.editTitle })
    fireEvent.click(title)
    const input = view.getByRole('textbox', { name: zh.editTitle }) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'refused' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => { expect(onRename).toHaveBeenCalledWith('refused') })
    // The refused write does not move the title: the Host's value stands, the
    // draft stays for another attempt, and the reason is shown.
    expect((await view.findByRole('alert')).textContent).toBe('写入被拒绝')
    expect((view.getByRole('textbox', { name: zh.editTitle }) as HTMLInputElement).value).toBe('refused')
  })

  it('shows the tail indicator when the Host says the activity region has more', () => {
    const view = renderView({ view: issueView({ activity: { items: [], hasMore: true } }) })
    expect(view.getByText(zh.issueActivityMore)).toBeTruthy()
  })

  it('reads the next page of comments through the callback', () => {
    const onLoadOlderComments = vi.fn()
    const view = renderView({ onLoadOlderComments, view: issueView({ comments: { items: [], hasMore: true, cursor: 4 } }) })
    fireEvent.click(view.getByRole('button', { name: zh.issueCommentsMore }))
    expect(onLoadOlderComments).toHaveBeenCalledTimes(1)
  })

  it('reads the crumb as channel / #n and sends the channel crumb back to the channel', () => {
    const onOpenChannel = vi.fn()
    const view = renderView({ onOpenChannel })
    expect(view.getByText('#12')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Room' }))
    expect(onOpenChannel).toHaveBeenCalledWith(channelRef)
  })

  it('offers one actions menu whose status panel writes through the status seam', () => {
    const onStatus = vi.fn()
    const view = renderView({ onStatus })
    fireEvent.click(view.getByRole('button', { name: zh.issueActionsLabel }))
    // The one menu carries the five items — the field rows show their current value.
    const menu = screen.getByRole('menu')
    for (const label of [zh.propStatus, zh.propPriority, zh.propAssignee, zh.issueCopyLink, zh.issueClose]) {
      expect(within(menu).getByText(label)).toBeTruthy()
    }
    // The status panel lists the ledger's five statuses; choosing Done writes
    // through the seam the sidebar's picker writes through.
    fireEvent.click(within(menu).getByText(zh.propStatus))
    fireEvent.click(within(screen.getByRole('menu')).getByText(zh.statusDone))
    expect(onStatus).toHaveBeenCalledWith('done')
  })

  it('writes priority and assignee through their seams', () => {
    const onPriority = vi.fn()
    const onAssignee = vi.fn()
    const view = renderView({ onPriority, onAssignee })
    fireEvent.click(view.getByRole('button', { name: zh.issueActionsLabel }))
    fireEvent.click(within(screen.getByRole('menu')).getByText(zh.propPriority))
    fireEvent.click(within(screen.getByRole('menu')).getByText(zh.priorityHigh))
    expect(onPriority).toHaveBeenCalledWith('high')
    fireEvent.click(view.getByRole('button', { name: zh.issueActionsLabel }))
    fireEvent.click(within(screen.getByRole('menu')).getByText(zh.propAssignee))
    fireEvent.click(within(screen.getByRole('menu')).getByText('ann'))
    expect(onAssignee).toHaveBeenCalledWith(ann)
  })

  it('asks before closing and writes only once the close is confirmed', async () => {
    const onStatus = vi.fn()
    const view = renderView({ onStatus })
    fireEvent.click(view.getByRole('button', { name: zh.issueActionsLabel }))
    fireEvent.click(within(screen.getByRole('menu')).getByText(zh.issueClose))
    // The menu's Close asks first: nothing has been written yet.
    expect(onStatus).not.toHaveBeenCalled()
    const dialog = await screen.findByRole('dialog', { name: zh.issueCloseConfirmTitle })
    fireEvent.click(within(dialog).getByRole('button', { name: zh.issueClose }))
    expect(onStatus).toHaveBeenCalledWith('closed')
  })

  it('copies the URL the history module builds and says so', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const view = renderView()
    fireEvent.click(view.getByRole('button', { name: zh.issueActionsLabel }))
    fireEvent.click(within(screen.getByRole('menu')).getByText(zh.issueCopyLink))
    // The same string the history stack writes for this issue position —
    // `?issue=task:<id>&variant=page` over the current query.
    await waitFor(() => { expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/?issue=${encodeURIComponent(taskRef)}&variant=page`) })
    expect(screen.getByRole('status').textContent).toBe(zh.issueLinkCopied)
  })

  it('closes the menu on Escape', () => {
    const view = renderView()
    fireEvent.click(view.getByRole('button', { name: zh.issueActionsLabel }))
    expect(within(screen.getByRole('menu')).getByText(zh.issueCopyLink)).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByText(zh.issueCopyLink)).toBeNull()
  })

  it('carries the execution log in the page sidebar and its drawer, and not in the slice', async () => {
    const sessions: readonly AgentTeamThreadSessionRuns[] = [{ memberId: ann, active: run('session:live'), history: [run('session:live'), run('session:done')] }]
    const page = renderView({}, sessions)
    const side = page.container.querySelector('[data-team-issue-side]')
    await waitFor(() => { expect(side?.querySelector('[data-team-issue-execution-log]')).toBeTruthy() })
    // The narrow-width drawer carries the same section below the properties.
    fireEvent.click(page.getByRole('button', { name: zh.issuePropertiesOpen }))
    const drawer = await page.findByRole('dialog', { name: zh.propertiesLabel })
    expect(drawer.querySelector('[data-team-issue-execution-log]')).toBeTruthy()
    cleanup()
    // The slice has no sidebar: the same runs render no section there.
    const slice = renderView({ variant: 'slice' }, sessions)
    await act(async () => {})
    expect(slice.container.querySelector('[data-team-issue-execution-log]')).toBeNull()
  })

  it('shows the token total, and a floor when a run recorded no figure', async () => {
    // A null figure is a Turn that reported no usage: the total sums what was
    // recorded and reads as a floor, never as an exact figure (M-70 A1).
    const sessions: readonly AgentTeamThreadSessionRuns[] = [{
      memberId: ann,
      active: null,
      history: [run('session:a'), run('session:b', { tokensIn: null as unknown as number, tokensOut: 30 })],
    }]
    const view = renderView({}, sessions)
    const total = await waitFor(() => {
      const node = view.container.querySelector('[data-team-issue-side] [data-team-issue-log-total]')
      expect(node).toBeTruthy()
      return node as HTMLElement
    })
    // 1000 + 200 + the known 30 is 1230 — formatted, and floored by the ≥.
    expect(total.textContent).toBe('≥ 1.2k 令牌')
    expect(total.getAttribute('data-partial')).toBe('')
  })

  it('shows no total when no run recorded any figure', async () => {
    const sessions: readonly AgentTeamThreadSessionRuns[] = [{
      memberId: ann,
      active: null,
      history: [run('session:a', { tokensIn: null as unknown as number, tokensOut: null as unknown as number })],
    }]
    const view = renderView({}, sessions)
    const section = await waitFor(() => {
      const node = view.container.querySelector('[data-team-issue-side] [data-team-issue-execution-log]')
      expect(node).toBeTruthy()
      return node as HTMLElement
    })
    // An all-unrecorded set shows no total at all — not 0, not NaN.
    expect(section.querySelector('[data-team-issue-log-total]')).toBeNull()
  })
})
