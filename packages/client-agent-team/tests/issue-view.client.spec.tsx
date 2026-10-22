// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor, type RenderResult } from '@testing-library/react'
import type {
  AgentTeamActivity,
  AgentTeamClientMemberStatus,
  AgentTeamIssueComment,
  AgentTeamIssueView,
  AgentTeamMemberId,
  AgentTeamTaskRef,
  AgentTeamThreadRef,
} from '@ddvnguyen/moct-dsh-team-room/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { zh } from '../src/client/locales.ts'
import type { TeamConversationProps } from '../src/client/slots.ts'
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

function renderView(overrides: Partial<React.ComponentProps<typeof IssueView>> = {}): RenderResult {
  const execution = {
    workspaceId,
    threadRef,
    loadThreadSessions: vi.fn(async () => ({ ok: true as const, value: [] })),
    loadMemberActivity: vi.fn(async () => ({ ok: true as const, value: { revision: 0, activities: [] } })),
    threadTurnFailures: vi.fn(async () => ({ ok: true as const, value: [] })),
    openMemberSession: vi.fn(),
    stopSession: vi.fn(async () => ({ ok: true as const, value: { accepted: true as const } })),
    subscribeChanges: vi.fn(() => () => {}),
    members,
    t,
  }
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
      onAnswerDecision={async () => undefined}
      execution={execution}
      pending={false}
      t={t}
      {...overrides}
    />,
  )
}

describe('IssueView', () => {
  it('renders the seven regions from the Host value', () => {
    const view = renderView()
    // 1. Header: the Host-resolved title, the number and the status.
    expect(view.getByRole('button', { name: zh.editTitle }).textContent).toBe('Ship the issue view')
    expect(view.getByText('#12')).toBeTruthy()
    // 2. Description.
    expect(view.getByText('The issue body.')).toBeTruthy()
    // 3. Properties.
    expect(view.getByText(zh.propStatus)).toBeTruthy()
    expect(view.getByText(zh.propPriority)).toBeTruthy()
    expect(view.getByText(zh.propAssignee)).toBeTruthy()
    // 4. Comments: both the comment and its reply.
    expect(view.getByText('First comment.')).toBeTruthy()
    expect(view.getByText('A reply.')).toBeTruthy()
    // 5. Activity.
    expect(view.getByText(zh.issueActivityLabel)).toBeTruthy()
    // 6. Decisions.
    expect(view.getByText(zh.issueDecisionsLabel)).toBeTruthy()
    // 7. Execution log.
    expect(view.getByText(zh.issueExecutionLogLabel)).toBeTruthy()
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
})
