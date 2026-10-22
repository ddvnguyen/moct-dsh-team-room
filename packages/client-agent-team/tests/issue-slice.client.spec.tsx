// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type {
  AgentTeamClientMemberStatus,
  AgentTeamIssueComment,
  AgentTeamIssueView,
  AgentTeamMemberId,
  AgentTeamMessageRef,
  AgentTeamTaskRef,
  AgentTeamThreadRef,
} from '@ddvnguyen/moct-dsh-team-room/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { zh } from '../src/client/locales.ts'
import type { TeamConversationProps } from '../src/client/slots.ts'
import { TeamDraftStore } from '../src/client/drafts.ts'
import { TeamNavigation } from '../src/client/navigation.ts'
import { TeamHumanIdentity } from '../src/client/human-identity.ts'
import { IssueSliceHost, type IssueSliceHostProps } from '../src/client/issue/IssueSliceHost.tsx'

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
    comments: { items: [] as readonly AgentTeamIssueComment[], hasMore: false, cursor: 0 },
    activity: { items: [], hasMore: false },
    decisions: [],
    executionLog: { sessions: [], failures: [] },
    docs: [],
    ...overrides,
  }
}

/** The host's seams: the issue read is the only one that matters here. */
function seams(loadIssueView: TeamConversationProps['loadIssueView']): Omit<IssueSliceHostProps, 'navigation' | 'humanIdentity' | 't'> {
  return {
    loadIssueView,
    loadMembers: vi.fn(async () => ({ ok: true as const, value: [] as readonly AgentTeamClientMemberStatus[] })),
    loadChannels: vi.fn(async () => ({ ok: true as const, value: { humanMemberId: human } })),
    loadThreadHistory: vi.fn(async () => ({ ok: true as const, value: { facts: [] } })),
    reply: vi.fn(async () => ({ ok: true as const, value: { kind: 'committed' } })),
    putAttachment: vi.fn(),
    getAttachment: vi.fn(),
    resolveMessageRefs: vi.fn(),
    drafts: new TeamDraftStore(),
    loadTriggerCatalog: vi.fn(async () => []),
    updateTask: vi.fn(async () => ({ ok: true as const, value: { kind: 'committed' } })),
    changeTask: vi.fn(async () => ({ ok: true as const, value: { kind: 'committed' } })),
    answerDecision: vi.fn(async () => ({ ok: true as const, value: {} })),
    loadThreadSessions: vi.fn(async () => ({ ok: true as const, value: [] })),
    loadMemberActivity: vi.fn(async () => ({ ok: true as const, value: { revision: 0, activities: [] } })),
    threadTurnFailures: vi.fn(async () => ({ ok: true as const, value: [] })),
    openMemberSession: vi.fn(),
    stopSession: vi.fn(),
    subscribeChanges: vi.fn(() => () => {}),
  } as unknown as Omit<IssueSliceHostProps, 'navigation' | 'humanIdentity' | 't'>
}

function humanIdentity(): TeamHumanIdentity {
  return new TeamHumanIdentity({
    loadProfile: async () => ({ ok: true as const, value: { name: 'Ddv' } }) as never,
    loadAvatarUrl: async () => null,
  })
}

describe('the issue slice', () => {
  it('renders the issue as a dialog over whatever the reader is on', async () => {
    const navigation = new TeamNavigation()
    navigation.actions().selectWorkspace(workspaceId)
    navigation.actions().openIssue(taskRef, 'slice')
    const loadIssueView = vi.fn(async () => ({ ok: true as const, value: issueView() }))
    const view = render(<IssueSliceHost navigation={navigation} humanIdentity={humanIdentity()} {...seams(loadIssueView)} t={t} />)

    // The dialog is the slice's own surface, over the face behind it.
    await waitFor(() => expect(document.querySelector('[data-team-issue-slice]')).not.toBeNull())
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    // The regions are M-35's shared tree, drawn in the dialog.
    await waitFor(() => expect(view.getByText('Ship the issue view')).toBeTruthy())
    expect(view.getByRole('heading', { name: zh.issueCommentsLabel })).toBeTruthy()
    // One read serves the slice: the Host's issue read, once.
    expect(loadIssueView).toHaveBeenCalledTimes(1)
  })

  it('is not on screen while the slot names the page', () => {
    const navigation = new TeamNavigation()
    navigation.actions().selectWorkspace(workspaceId)
    navigation.actions().openIssue(taskRef, 'page')
    const view = render(<IssueSliceHost navigation={navigation} humanIdentity={humanIdentity()} {...seams(vi.fn(async () => ({ ok: true as const, value: issueView() })))} t={t} />)
    expect(document.querySelector('[data-team-issue-slice]')).toBeNull()
  })

  it('Maximize turns the slice into the page, and Esc closes it', async () => {
    const navigation = new TeamNavigation()
    navigation.actions().selectWorkspace(workspaceId)
    navigation.actions().openIssue(taskRef, 'slice')
    const view = render(<IssueSliceHost navigation={navigation} humanIdentity={humanIdentity()} {...seams(vi.fn(async () => ({ ok: true as const, value: issueView() })))} t={t} />)
    await waitFor(() => expect(document.querySelector('[data-team-issue-slice]')).not.toBeNull())

    // Maximize is the variant switch: the same slot, the page's presentation.
    fireEvent.click(view.getByRole('button', { name: zh.issueMaximize }))
    await waitFor(() => expect(navigation.getSnapshot().issueVariant).toBe('page'))
    expect(document.querySelector('[data-team-issue-slice]')).toBeNull()

    // The slice is back, and Escape closes it: the slot goes, the face stays.
    navigation.actions().setIssueVariant('slice')
    await waitFor(() => expect(document.querySelector('[data-team-issue-slice]')).not.toBeNull())
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(navigation.getSnapshot().issueRef).toBeUndefined())
    expect(navigation.getSnapshot().workspaceId).toBe(workspaceId)
  })
})
