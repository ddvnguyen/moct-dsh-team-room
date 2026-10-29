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
import { createIssueClient, type IssueClient } from '../src/client/issue/issue-client.ts'

const t = ((key: keyof typeof zh, params?: Record<string, string | number>) => {
  let value: string = zh[key]
  for (const [name, replacement] of Object.entries(params ?? {})) value = value.replace(`{${name}}`, String(replacement))
  return value
}) as TeamConversationProps['t']

afterEach(cleanup)
// The panel width is a browser-local preference the width tests seed; none of
// the other cases may inherit it.
afterEach(() => { localStorage.removeItem('dsh.agent-team.issue-panel-width') })

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
      subIssues: [],
      pullRequests: [],
      labels: [],
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
function seams(loadIssueView: TeamConversationProps['loadIssueView'], issueClient: IssueClient): Omit<IssueSliceHostProps, 'navigation' | 'humanIdentity' | 'issueContext' | 't'> {
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
    // The walk's own seams (M-69): the same client the issue opens through, so
    // a case that publishes an order walks it and a case that publishes none
    // finds no walk.
    openIssue: issueClient.openIssue,
    peekOrder: issueClient.peekOrder,
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
    const view = render(<IssueSliceHost navigation={navigation} issueContext={issueClient.context} humanIdentity={humanIdentity()} {...seams(loadIssueView, issueClient)} t={t} />)

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
    expect(view.getByTestId('issue-timeline')).toBeTruthy()
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
    render(<IssueSliceHost navigation={navigation} issueContext={issueClient.context} humanIdentity={humanIdentity()} {...seams(loadIssueView, issueClient)} t={t} />)
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
    const view = render(<IssueSliceHost navigation={navigation} issueContext={issueClient.context} humanIdentity={humanIdentity()} {...seams(vi.fn(async () => ({ ok: true as const, value: issueView() })), issueClient)} t={t} />)
    expect(document.querySelector('[data-team-issue-slice]')).toBeNull()
  })

  it('Maximize turns the slice into the page, and Esc closes it', async () => {
    const navigation = new TeamNavigation()
    const issueClient = createIssueClient(navigation)
    navigation.actions().selectWorkspace(workspaceId)
    issueClient.openIssue(taskRef)
    const view = render(<IssueSliceHost navigation={navigation} issueContext={issueClient.context} humanIdentity={humanIdentity()} {...seams(vi.fn(async () => ({ ok: true as const, value: issueView() })), issueClient)} t={t} />)
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
    const host = seams(vi.fn(async () => ({ ok: true as const, value: issueView() })), issueClient)
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
    const view = render(<IssueSliceHost navigation={navigation} issueContext={issueClient.context} humanIdentity={humanIdentity()} {...seams(vi.fn(async () => ({ ok: true as const, value: issueView() })), issueClient)} t={t} />)
    await waitFor(() => expect(document.querySelector('[data-team-issue-slice]')).not.toBeNull())
    // The focus moved into the dialog, and the opener holds the focus the
    // modal layer will give back.
    expect(document.activeElement).not.toBe(opener)

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(navigation.getSnapshot().issueRef).toBeUndefined())
    await waitFor(() => expect(document.activeElement).toBe(opener))
    opener.remove()
  })

  it('walks the order the face behind published, and gives the focus back to the card it lands on', async () => {
    const navigation = new TeamNavigation()
    const issueClient = createIssueClient(navigation)
    navigation.actions().selectWorkspace(workspaceId)
    issueClient.openIssue(taskRef)
    // The face behind publishes its cards — two columns, each card naming the
    // control the focus returns to — and that order is all the panel is given.
    const refs = ['task:one', 'task:two', 'task:three'] as const
    const cards = refs.map(ref => {
      const card = document.createElement('button')
      card.setAttribute('data-task-ref', ref)
      document.body.append(card)
      return card
    })
    const openerOf = (index: number) => (): void => { cards[index]?.focus({ preventScroll: true }) }
    const second = 'task:two' as AgentTeamTaskRef
    const third = 'task:three' as AgentTeamTaskRef
    issueClient.peekOrder.publish({ walk: 'board' }, {
      columns: [
        [
          { taskRef, workspaceId, focusOpener: openerOf(0) },
          { taskRef: second, workspaceId, focusOpener: openerOf(1) },
        ],
        [{ taskRef: third, workspaceId, focusOpener: openerOf(2) }],
      ],
    })
    render(<IssueSliceHost navigation={navigation} issueContext={issueClient.context} humanIdentity={humanIdentity()} {...seams(vi.fn(async () => ({ ok: true as const, value: issueView() })), issueClient)} t={t} />)
    await waitFor(() => expect(document.querySelector('[data-team-issue-slice]')).not.toBeNull())

    // J steps to the next card of the column, and the focus lands on it: the
    // card the reader is standing on is the one Escape will give back.
    fireEvent.keyDown(document, { key: 'j' })
    await waitFor(() => expect(navigation.getSnapshot().issueRef).toBe(second))
    expect(document.activeElement).toBe(cards[1])

    // K steps back the way it came.
    fireEvent.keyDown(document, { key: 'k' })
    await waitFor(() => expect(navigation.getSnapshot().issueRef).toBe(taskRef))
    expect(document.activeElement).toBe(cards[0])

    // L crosses to the next column that holds a card; H would come back.
    fireEvent.keyDown(document, { key: 'l' })
    await waitFor(() => expect(navigation.getSnapshot().issueRef).toBe(third))
    expect(document.activeElement).toBe(cards[2])

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(navigation.getSnapshot().issueRef).toBeUndefined())
    await waitFor(() => expect(document.activeElement).toBe(cards[2]))
    cards.forEach(card => card.remove())
  })

  it('steps on the letters, and leaves the arrows to the pane the reader is inside', async () => {
    const navigation = new TeamNavigation()
    const issueClient = createIssueClient(navigation)
    navigation.actions().selectWorkspace(workspaceId)
    issueClient.openIssue(taskRef)
    const second = 'task:two' as AgentTeamTaskRef
    issueClient.peekOrder.publish({ walk: 'inbox' }, {
      columns: [[{ taskRef, workspaceId }, { taskRef: second, workspaceId }]],
    })
    const view = render(<IssueSliceHost navigation={navigation} issueContext={issueClient.context} humanIdentity={humanIdentity()} {...seams(vi.fn(async () => ({ ok: true as const, value: issueView() })), issueClient)} t={t} />)
    await waitFor(() => expect(document.querySelector('[data-team-issue-slice]')).not.toBeNull())
    const panel = view.getByRole('dialog')

    // The panel holds the focus it took on open: there the arrows belong to
    // the pane, so ArrowDown scrolls it instead of walking to another issue.
    fireEvent.keyDown(panel, { key: 'ArrowDown' })
    expect(navigation.getSnapshot().issueRef).toBe(taskRef)

    // The letters step from wherever they are pressed, and an arrow pressed
    // on the face behind mirrors them.
    fireEvent.keyDown(panel, { key: 'j' })
    await waitFor(() => expect(navigation.getSnapshot().issueRef).toBe(second))
    fireEvent.keyDown(document, { key: 'ArrowUp' })
    await waitFor(() => expect(navigation.getSnapshot().issueRef).toBe(taskRef))

    // A field keeps its keys: the title editor's J is the reader's, not the
    // walk's — the half-written title is not a step.
    fireEvent.click(view.getByTestId('issue-title'))
    expect(view.getByTestId('issue-title-input')).toBeTruthy()
    fireEvent.keyDown(view.getByTestId('issue-title-input'), { key: 'j' })
    expect(navigation.getSnapshot().issueRef).toBe(taskRef)
  })

  it('walks nothing while no face has published an order', async () => {
    const navigation = new TeamNavigation()
    const issueClient = createIssueClient(navigation)
    navigation.actions().selectWorkspace(workspaceId)
    issueClient.openIssue(taskRef)
    render(<IssueSliceHost navigation={navigation} issueContext={issueClient.context} humanIdentity={humanIdentity()} {...seams(vi.fn(async () => ({ ok: true as const, value: issueView() })), issueClient)} t={t} />)
    await waitFor(() => expect(document.querySelector('[data-team-issue-slice]')).not.toBeNull())

    // The Thread cite and the Agent page open issues over faces that publish
    // no order; the keys are theirs to ignore, not the panel's to invent.
    fireEvent.keyDown(document, { key: 'j' })
    fireEvent.keyDown(document, { key: 'ArrowDown' })
    expect(navigation.getSnapshot().issueRef).toBe(taskRef)
  })

  it('names every icon control on the panel, each exactly once', async () => {
    const navigation = new TeamNavigation()
    const issueClient = createIssueClient(navigation)
    navigation.actions().selectWorkspace(workspaceId)
    issueClient.openIssue(taskRef)
    const view = render(<IssueSliceHost navigation={navigation} issueContext={issueClient.context} humanIdentity={humanIdentity()} {...seams(vi.fn(async () => ({ ok: true as const, value: issueView() })), issueClient)} t={t} />)
    await waitFor(() => expect(document.querySelector('[data-team-issue-slice]')).not.toBeNull())

    // A glyph with no name is invisible to a screen reader, and a control that
    // exists in both the panel bar and the header is a control a test (and a
    // reader) cannot tell apart: one named control per action, here.
    const panel = view.getByRole('dialog')
    for (const key of ['issueMaximize', 'issueClose', 'issueOpenLegacyThread'] as const) {
      const controls = [...panel.querySelectorAll('button')].filter(button => button.getAttribute('aria-label') === zh[key])
      expect(controls, key).toHaveLength(1)
      const [control] = controls
      expect(control?.getAttribute('title'), key).toBe(zh[key])
    }
  })

  it('opens at the remembered width, nudges 24px an arrow, and keeps both', async () => {
    localStorage.setItem('dsh.agent-team.issue-panel-width', '700')
    const navigation = new TeamNavigation()
    const issueClient = createIssueClient(navigation)
    navigation.actions().selectWorkspace(workspaceId)
    issueClient.openIssue(taskRef)
    const view = render(<IssueSliceHost navigation={navigation} issueContext={issueClient.context} humanIdentity={humanIdentity()} {...seams(vi.fn(async () => ({ ok: true as const, value: issueView() })), issueClient)} t={t} />)
    await waitFor(() => expect(document.querySelector('[data-team-issue-slice]')).not.toBeNull())

    // The width the reader dragged to is the width the panel opens at.
    const handle = view.getByTestId('issue-panel-resize')
    expect(view.getByRole('dialog').getAttribute('style')).toContain('width: 700px')
    expect(handle.getAttribute('aria-valuenow')).toBe('700')

    // Arrow keys move the edge by the splitter's 24px step, left wider and
    // right narrower, and each press is remembered for the next open.
    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    expect(handle.getAttribute('aria-valuenow')).toBe('724')
    expect(localStorage.getItem('dsh.agent-team.issue-panel-width')).toBe('724')
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(handle.getAttribute('aria-valuenow')).toBe('700')
    expect(localStorage.getItem('dsh.agent-team.issue-panel-width')).toBe('700')
  })

  it('clamps a remembered width that no longer fits the viewport', async () => {
    // jsdom's window is 1024px wide; the panel leaves the face behind its 64px.
    localStorage.setItem('dsh.agent-team.issue-panel-width', '99999')
    const navigation = new TeamNavigation()
    const issueClient = createIssueClient(navigation)
    navigation.actions().selectWorkspace(workspaceId)
    issueClient.openIssue(taskRef)
    const view = render(<IssueSliceHost navigation={navigation} issueContext={issueClient.context} humanIdentity={humanIdentity()} {...seams(vi.fn(async () => ({ ok: true as const, value: issueView() })), issueClient)} t={t} />)
    await waitFor(() => expect(document.querySelector('[data-team-issue-slice]')).not.toBeNull())

    const widest = Math.max(360, window.innerWidth - 64)
    expect(view.getByRole('dialog').getAttribute('style')).toContain(`width: ${widest}px`)
    expect(view.getByTestId('issue-panel-resize').getAttribute('aria-valuemax')).toBe(String(widest))
  })

  it('leaves Escape to the control inside that already handled it', async () => {
    const navigation = new TeamNavigation()
    const issueClient = createIssueClient(navigation)
    navigation.actions().selectWorkspace(workspaceId)
    issueClient.openIssue(taskRef)
    const view = render(<IssueSliceHost navigation={navigation} issueContext={issueClient.context} humanIdentity={humanIdentity()} {...seams(vi.fn(async () => ({ ok: true as const, value: issueView() })), issueClient)} t={t} />)
    await waitFor(() => expect(document.querySelector('[data-team-issue-slice]')).not.toBeNull())

    // Renaming in the slice: Escape cancels the edit. The panel's own listener
    // takes the key only where nothing inside claimed it first, so the reader's
    // half-written title does not cost them the issue.
    fireEvent.click(view.getByTestId('issue-title'))
    expect(view.getByTestId('issue-title-input')).toBeTruthy()
    fireEvent.keyDown(view.getByTestId('issue-title-input'), { key: 'Escape' })
    expect(view.queryByTestId('issue-title-input')).toBeNull()
    expect(navigation.getSnapshot().issueRef).toBe(taskRef)
    expect(document.querySelector('[data-team-issue-slice]')).not.toBeNull()

    // From anywhere else, Escape is still the panel's.
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(navigation.getSnapshot().issueRef).toBeUndefined())
  })
})
