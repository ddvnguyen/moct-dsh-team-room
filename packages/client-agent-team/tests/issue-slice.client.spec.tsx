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
import { createIssueClient } from '../src/client/issue/issue-client.ts'

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
function seams(loadIssueView: TeamConversationProps['loadIssueView']): Omit<IssueSliceHostProps, 'navigation' | 'humanIdentity' | 'issueContext' | 't'> {
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
    resolveTaskRefs: vi.fn(async () => ({ ok: true as const, value: { resolved: [{ threadRef: 'thread:one', channelRef: 'channel:room', taskRef: 'task:one' }] } })),
    subscribeChanges: vi.fn(() => () => {}),
  } as unknown as Omit<IssueSliceHostProps, 'navigation' | 'humanIdentity' | 'issueContext' | 't'>
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
    const issueClient = createIssueClient(navigation)
    navigation.actions().selectWorkspace(workspaceId)
    issueClient.openIssue(taskRef)
    const loadIssueView = vi.fn(async () => ({ ok: true as const, value: issueView() }))
    const view = render(<IssueSliceHost navigation={navigation} issueContext={issueClient.context} humanIdentity={humanIdentity()} {...seams(loadIssueView)} t={t} />)

    // The dialog is the slice's own surface, over the face behind it.
    await waitFor(() => expect(document.querySelector('[data-team-issue-slice]')).not.toBeNull())
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    // The journey (M-42) finds the presentation by hook, not by the dialog's
    // translated label: the same `issue-slice` name the page's `issue-page`
    // pairs with.
    expect(view.getByTestId('issue-slice')).toBeTruthy()
    // The slice's two controls carry hooks too: the journey maximizes and
    // closes by name, not by the translated label on the button.
    expect(view.getByTestId('issue-maximize')).toBeTruthy()
    expect(view.getByTestId('issue-close')).toBeTruthy()
    // The regions are M-35's shared tree, drawn in the dialog.
    await waitFor(() => expect(view.getByText('Ship the issue view')).toBeTruthy())
    expect(view.getByRole('heading', { name: zh.issueCommentsLabel })).toBeTruthy()
    // One read serves the slice: the Host's issue read, once.
    expect(loadIssueView).toHaveBeenCalledTimes(1)
  })

  it('reads the issue in the Workspace it was opened from', async () => {
    const navigation = new TeamNavigation()
    const issueClient = createIssueClient(navigation)
    navigation.actions().selectWorkspace('workspace:beta' as WorkspaceId)
    // The Inbox row names another Workspace: the issue is read there, and the
    // face behind it never moves.
    issueClient.openIssue(taskRef, { workspaceId })
    const loadIssueView = vi.fn(async () => ({ ok: true as const, value: issueView() }))
    render(<IssueSliceHost navigation={navigation} issueContext={issueClient.context} humanIdentity={humanIdentity()} {...seams(loadIssueView)} t={t} />)
    await waitFor(() => expect(document.querySelector('[data-team-issue-slice]')).not.toBeNull())
    expect(loadIssueView).toHaveBeenCalledWith({ workspaceId, taskRef }, undefined)
    // The navigation's own Workspace did not move.
    expect(navigation.getSnapshot().workspaceId).toBe('workspace:beta')
  })

  it('is not on screen while the slot names the page', () => {
    const navigation = new TeamNavigation()
    const issueClient = createIssueClient(navigation)
    navigation.actions().selectWorkspace(workspaceId)
    navigation.actions().openIssue(taskRef, 'page')
    const view = render(<IssueSliceHost navigation={navigation} issueContext={issueClient.context} humanIdentity={humanIdentity()} {...seams(vi.fn(async () => ({ ok: true as const, value: issueView() })))} t={t} />)
    expect(document.querySelector('[data-team-issue-slice]')).toBeNull()
  })

  it('Maximize turns the slice into the page, and Esc closes it', async () => {
    const navigation = new TeamNavigation()
    const issueClient = createIssueClient(navigation)
    navigation.actions().selectWorkspace(workspaceId)
    issueClient.openIssue(taskRef)
    const view = render(<IssueSliceHost navigation={navigation} issueContext={issueClient.context} humanIdentity={humanIdentity()} {...seams(vi.fn(async () => ({ ok: true as const, value: issueView() })))} t={t} />)
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

  it('opens the Task\'s Thread from the slice, and closes the slice on the way', async () => {
    const navigation = new TeamNavigation()
    const issueClient = createIssueClient(navigation)
    navigation.actions().selectWorkspace(workspaceId)
    issueClient.openIssue(taskRef)
    const host = seams(vi.fn(async () => ({ ok: true as const, value: issueView() })))
    const view = render(<IssueSliceHost navigation={navigation} issueContext={issueClient.context} humanIdentity={humanIdentity()} {...host} t={t} />)
    await waitFor(() => expect(document.querySelector('[data-team-issue-slice]')).not.toBeNull())
    const resolveTaskRefs = host.resolveTaskRefs as unknown as ReturnType<typeof vi.fn>

    // The Thread is the face the card used to open; the slice's header keeps
    // the way into it, and closes the slice on the way — a dialog over the
    // Thread would be a dialog nobody asked for.
    fireEvent.click(view.getByRole('button', { name: zh.issueOpenLegacyThread }))
    await waitFor(() => expect(navigation.getSnapshot().issueRef).toBeUndefined())
    await waitFor(() => expect(resolveTaskRefs).toHaveBeenCalled())
  })

  it('Escape returns the focus to the control the issue was opened from', async () => {
    const navigation = new TeamNavigation()
    const issueClient = createIssueClient(navigation)
    navigation.actions().selectWorkspace(workspaceId)
    // The opener is a button on the face behind the slice — a card's title.
    const opener = document.createElement('button')
    opener.textContent = 'Alpha task'
    document.body.append(opener)
    issueClient.openIssue(taskRef, { workspaceId, focusOpener: () => { opener.focus({ preventScroll: true }) } })
    const view = render(<IssueSliceHost navigation={navigation} issueContext={issueClient.context} humanIdentity={humanIdentity()} {...seams(vi.fn(async () => ({ ok: true as const, value: issueView() })))} t={t} />)
    await waitFor(() => expect(document.querySelector('[data-team-issue-slice]')).not.toBeNull())
    // The focus moved into the dialog, and the opener holds the focus the
    // modal layer will give back.
    expect(document.activeElement).not.toBe(opener)

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(navigation.getSnapshot().issueRef).toBeUndefined())
    await waitFor(() => expect(document.activeElement).toBe(opener))
    opener.remove()
  })
})
