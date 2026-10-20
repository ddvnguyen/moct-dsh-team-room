import { RemoteStream, RemoteStreamCarrierError } from '@deepseek-ai/dsh-api-gateway/client'
import type { AgentTeamChangesRequest } from '@ddvnguyen/moct-dsh-team-room/types'
import { afterEach, expect, vi } from 'vitest'
import { useState, useSyncExternalStore, type ReactNode } from 'react'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { AgentTeamAddMemberRequest, AgentTeamCreateChannelRequest, AgentTeamDecisionView, AgentTeamMemberDiagnostic, AgentTeamReplyRequest, AgentTeamSendMessageRequest, AgentTeamTask, AgentTeamThreadReplyStat, AgentTeamThreadSessionRuns, AgentTeamThreadTurnFailure } from '@ddvnguyen/moct-dsh-team-room/types'
import { COMMON_NS, LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { en as commonEn, zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/index.ts'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { SlotTestRuntime, stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import type { PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { apply as applySidebar, inject as injectSidebar } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { apply as applyConversation, inject as injectConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { apply, inject } from '../src/client/index.ts'

// jsdom has no ResizeObserver; the shipped ConversationRoot publishes the
// composer seat's height through one on every mount.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub)

// jsdom 30 implements no FontFaceSet at all, so `document.fonts` is absent
// while every real browser has one; the shipped composer control row subscribes
// to its 'loadingdone' event when it measures the two control groups.
if (document.fonts === undefined) {
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { addEventListener: () => {}, removeEventListener: () => {} },
  })
}

// A throwing slot entry is contained by the shipped SlotErrorBoundary and only
// reported through console.error: the surface disappears and the suite stays
// green. An incomplete `conversation` stub produced exactly that — 34 passing
// tests beside 51 `Invalid value used as weak map key` reports from
// 'conversation.composer.bar' — so a passing exit code is not evidence the page
// rendered. Collect those reports and fail the spec file that mounted them.
const slotCrashes: string[] = []
const consoleError = console.error.bind(console)
console.error = (...args: unknown[]): void => {
  const text = args.map(value => value instanceof Error ? `${value.name}: ${value.message}` : String(value)).join(' ')
  if (text.includes('slot entry crashed')) slotCrashes.push(text)
  consoleError(...args)
}
afterEach(() => {
  const crashes = slotCrashes.splice(0)
  expect(crashes, `slot entries crashed:\n${crashes.join('\n')}`).toEqual([])
})

/**
 * The fixture frame's sidebar column state, shared with the layout double so a
 * header control can observe the same collapse the column renders. The shipped
 * AppFrame derives it from the layout store (sidebar === 0, or the narrow
 * auto-collapse override) and publishes it as `data-sidebar-collapsed` on its
 * own element; the Team headers read that attribute, so the fixture publishes
 * the same one instead of a fixture-only prop.
 */
export interface FixtureSidebarState {
  readonly collapsed: boolean
  readonly subscribe: (listener: () => void) => () => void
  readonly setCollapsed: (next: boolean) => void
  /**
   * The bare boolean, not a fresh object: useSyncExternalStore compares with
   * Object.is, so an allocated snapshot reads as a change on every poll and
   * re-renders forever.
   */
  readonly getSnapshot: () => boolean
}

function createFixtureSidebarState(): FixtureSidebarState {
  const listeners = new Set<() => void>()
  let collapsed = false
  return {
    get collapsed() { return collapsed },
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    setCollapsed: (next) => { if (collapsed === next) return; collapsed = next; for (const listener of [...listeners]) listener() },
    getSnapshot: () => collapsed,
  }
}

type FrameProps = PropsRuntime<'root'> & PropsRenderSlots<'sidebar' | 'main'> & { sidebarState: FixtureSidebarState }
function Frame({ renderSlot, usePanelInfo, sidebarState }: FrameProps) {
  // The shipped frame renders the keyed main cell for the selected global panel
  // and falls back to the conversation seat, so the bench follows the same rule
  // instead of pinning that seat.
  const panelId = usePanelInfo(info => info.activePanelId)
  // Subscribed exactly as the shipped frame subscribes to its store, so a
  // toggle from either side re-renders the column and re-publishes the
  // attribute. A plain getter read would not: the Frame holds no subscription
  // of its own.
  const collapsed = useSyncExternalStore(sidebarState.subscribe, sidebarState.getSnapshot, sidebarState.getSnapshot)
  // The window-chrome contract the real frame honours: the attribute is
  // present while the column is closed and absent while it is open.
  return <div {...(collapsed ? { 'data-sidebar-collapsed': true } : {})}>
    <button type="button" data-test-control onClick={() => { sidebarState.setCollapsed(!collapsed) }}>Toggle fixture sidebar</button>
    {renderSlot('sidebar', { collapsed, width: collapsed ? 56 : 280 })}
    {renderSlot('main', {}, { entryKey: panelId ?? 'conversation' })}
  </div>
}

function BaselineWorkspace() { return <div data-baseline-workspaces>普通工作区</div> }
/**
 * The automation plugin's native tab strip, reduced to what the Team tab reads:
 * the private registry hung off the shipped workspace entry, and a body that
 * renders every inserted tab under the baseline list the way the strip shows
 * the active one.
 */
/**
 * The real strip renders one tab body at a time; this renders the Team one and,
 * with `agentsTab`, the Agents one beside it, so specs of either body do not
 * read each other's controls. The Overview tab follows the same rule with
 * `overviewTab`: its body mounts the whole Overview page, which would otherwise
 * stand in every sidebar spec's way.
 */
function nativeTabStrip(showAgents = false, showOverview = false) {
  const tabs: Array<{ readonly id: string; readonly render: (props: never) => unknown }> = []
  const listeners = new Set<() => void>()
  let version = 0
  const notify = (): void => { version += 1; for (const listener of listeners) listener() }
  const registry = {
    version: 1,
    getTabs: () => tabs,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    insert: (tab: (typeof tabs)[number]) => {
      tabs.push(tab)
      notify()
      return () => { tabs.splice(tabs.indexOf(tab), 1); notify() }
    },
  }
  // The strip hands each tab the shipped entry's own props, as the host does.
  function StripWorkspace(props: Record<string, unknown>) {
    useSyncExternalStore(registry.subscribe, () => version)
    return <div data-baseline-workspaces>普通工作区{tabs.filter(tab => (showAgents || tab.id !== 'agents') && (showOverview || tab.id !== 'overview')).map(tab => <div key={tab.id} data-native-tab={tab.id}>{tab.render(props as never) as ReactNode}</div>)}</div>
  }
  return Object.assign(StripWorkspace, { __dshNativeTabs: registry })
}
function BaselineSettings() { return <div data-baseline-settings>设置</div> }
/**
 * The missing seat, served the way a seat-carrying shell serves it. The entry
 * declares `sidebar.sections` as its own child — the ownership rule every
 * outlet obeys — and renders it through the props-face renderSlot, so the
 * Team's occupant mounts with the same outlet machinery, boundaries and all,
 * as it does in a column whose shell carries the seat.
 */
function SectionsFootOutlet({ renderSlot, wide }: { renderSlot: (key: never, owner: object) => ReactNode; wide?: boolean }) {
  // The shell hands its foot seat the same `wide` it hands the real seat, so
  // the section picks the same presentation a column shell would give it.
  return renderSlot('sidebar.sections' as never, { wide })
}
interface HumanProfileSeed {
  readonly name?: string
  readonly avatarRef?: string
  readonly version?: string
  readonly repoUrl?: string
  readonly updateAvailable?: boolean
  readonly latestVersion?: string
}

interface EnvironmentSeed {
  readonly verdict?: 'ok' | 'out-of-range' | 'undetermined'
  readonly reason?: string
  readonly bundleVersion?: string
  readonly dshVersion?: string
  readonly certifiedDshVersion?: string
  readonly supportRange?: { readonly lower: string; readonly upper: string }
}

interface SeededMessage {
  readonly body: string
  readonly occurredAt: string
  readonly sender?: 'human' | 'agent'
  readonly mentions?: readonly string[]
  /** Reply-link parent, by seeded index: `message:seed-<n>`. */
  readonly replyToMessageRef?: string
}

export async function runtimeWithTeam(options?: { mode?: 'team'; nativeTabs?: boolean; agentsTab?: boolean; overviewTab?: boolean; mainPanelId?: string; workspaceId?: string; initialChannels?: boolean; remainingUnreadCounts?: readonly number[]; seededMessages?: readonly SeededMessage[]; seedTaskRef?: string; seedThreadRef?: string; seedTaskStatus?: AgentTeamTask['status']; seedFollowers?: readonly string[]; humanProfile?: HumanProfileSeed; humanProfileFailure?: string; environment?: EnvironmentSeed; environmentFailure?: string; seedReplyStats?: readonly AgentTeamThreadReplyStat[]; seedTurnFailures?: readonly AgentTeamThreadTurnFailure[];
  /** Seed the execution log's per-seat Session runs (contract §4 threadSessions); mutable via `setThreadSessions`. */
  seedThreadSessions?: readonly AgentTeamThreadSessionRuns[];
  /** Replace the bench roster wholesale; the Thread roster spec needs archived/inactive states. */
  readonly seedRoster?: readonly { readonly memberId: string; readonly workspaceId: string; readonly handle: string; readonly presence?: 'available' | 'working' | 'error' | 'unavailable'; readonly diagnostic?: AgentTeamMemberDiagnostic; readonly state?: 'enabled' | 'inactive' | 'archived' }[];
  /** Seed Channel membership rows: which Members joined which Channel. */
  readonly seedChannelMembers?: readonly { readonly channelRef: string; readonly memberId: string }[];
  /** Seed board Tasks: rows the `view` catalog carries beside any message-borne Task. */
  readonly seedBoardTasks?: readonly { readonly taskRef: string; readonly threadRef?: string; readonly channelRef?: string; readonly status: AgentTeamTask['status']; readonly title?: string; readonly priority?: 'urgent' | 'high' | 'medium' | 'low' | 'none'; readonly assignee?: string | null; readonly position?: number; readonly taskNumber: number }[] }) {
  if (options?.mode !== undefined) {
    localStorage.setItem('dsh.agent-team.navigation', JSON.stringify({ mode: options.mode, ...(options.workspaceId === undefined ? {} : { workspaceId: options.workspaceId }) }))
  }
  const runtime = await SlotTestRuntime.create()
  const locale = new LocaleRuntime(runtime.ctx)
  // rc.1: shipped sidebar chrome (brand row) reads the common namespace.
  locale.register(COMMON_NS, { zh: commonZh, en: commonEn })
  runtime.ctx.provide('locale', locale)
  runtime.slots.installLocale(locale)
  // The layout face: the shipped frame's panel store is the runtime's own
  // panelInfo source (the same one `usePanelInfo` reads), so a spec selects a
  // global panel exactly the way the shipped sidebar and plugin manager do.
  const selectPanel = vi.fn((panelId: string | null): void => { runtime.panelInfo.set({ activePanelId: panelId as never }) })
  const sidebarState = createFixtureSidebarState()
  const toggleSidebar = vi.fn((): void => { sidebarState.setCollapsed(!sidebarState.collapsed) })
  runtime.ctx.provide('layout', {
    toggleSidebar,
    selectPanel,
    panelInfo: runtime.panelInfo,
    sidebarState,
  } as never)
  // The shipped layout store drops a selection once no live `main` entry owns
  // its key (ui-layout's `retainMainPanels`, subscribed to the main slot): that
  // is what returns ordinary DSH when a plugin unloads while its panel stands.
  // The double mirrors the reconciliation instead of keeping a dangling id.
  const retainMainPanels = (): void => {
    const keys = runtime.slots.entries('main').flatMap(entry => entry.options.key === undefined ? [] : [entry.options.key])
    const active = runtime.panelInfo.getSnapshot().activePanelId
    if (active !== null && !keys.includes(active)) runtime.panelInfo.set({ activePanelId: null })
  }
  runtime.slots.subscribe('main', retainMainPanels)
  // rc.2: the shipped layout and sidebar inject 'shortcuts'. The takeover bench
  // mounts both, so it provides an empty command catalog for the sidebar's
  // keycap reads and a registrer that only reports success — no keyboard
  // adapter exists behind either.
  runtime.ctx.provide('shortcuts', {
    catalog: createSnapshotStore<readonly never[]>([]),
    register: () => () => {},
  } as never)
  // rc.1: the shipped sidebar injects 'uiWorkspace'; the takeover bench
  // provides a minimal navigation double whose openSession mirrors the
  // shipped selection contract — retire the previous `mainView` reference,
  // retain the next — so retention-based reads see one main session.
  let mainReference: { release(): void } | undefined
  const openSession = vi.fn((sessionId: string): void => {
    mainReference?.release()
    mainReference = runtime.sessions.retain(sessionId as never, { source: 'mainView' })
  })
  runtime.ctx.provide('uiWorkspace', { startSession: vi.fn(), connectWorkspace: vi.fn(async () => 'ordinary-session'), openSession })
  // The shipped conversation reads the developer-tools switch and per-domain
  // config scopes through the config-form registry.
  const developerTools = createSnapshotStore(true)
  runtime.ctx.provide('configForms', {
    developerTools: {
      enabled: developerTools,
      setEnabled: async (enabled: boolean) => { developerTools.set(enabled) },
    },
    get: () => stubConfigForm().scope,
  } as never)
  // The shipped Conversation core reads its whole outward face here, and two of
  // those reads are not calls: the composer bar injects `fileUploads` as a live
  // observable hook, which the renderer caches by identity — an absent member
  // therefore crashes the entry instead of failing a call. Mirror the published
  // controller face (verbs, draft attachments, upload states), not just the
  // verbs our own surfaces use.
  runtime.ctx.provide('conversation', {
    input: { for: () => ({ submit: vi.fn() }) },
    send: vi.fn(async () => {}),
    updateQueue: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    loadOlder: vi.fn(async () => {}),
    fileUploads: createSnapshotStore<Record<string, unknown>>({}),
    createDrafts: () => [],
    resolveDraftAttachments: () => [],
    retryFileUpload: () => {},
    releaseDraftAttachment: () => {},
    releaseDraftAttachments: () => {},
    rebindDraftFiles: () => {},
  } as never)
  const status = (memberId: string, workspaceId: string, handle: string, presence: 'available' | 'working' | 'error' | 'unavailable', diagnostic?: AgentTeamMemberDiagnostic, state: 'enabled' | 'inactive' | 'archived' = 'enabled', availability?: 'active' | 'archived' | 'inactive') => ({
    member: {
      memberId, workspaceId, handle, description: `${handle} description`,
      presetId: 'team-member', state, sessionId: `session:${memberId}`,
    },
    workspaceIds: [workspaceId],
    instances: [],
    availability: availability ?? (state === 'archived' ? 'archived' : state === 'inactive' ? 'inactive' : presence === 'unavailable' ? 'unavailable' : 'active'),
    presence,
    ...(diagnostic === undefined ? {} : { diagnostic }),
  })
  let memberRows: Array<ReturnType<typeof status>> = [
    status('member:builder', 'w1', 'builder', 'available'),
    status('member:worker', 'w1', 'worker', 'working'),
    status('member:failed', 'w1', 'failed', 'error', { class: 'runtime', detail: 'model failed' }),
    status('member:offline', 'w1', 'offline', 'unavailable', { class: 'preset-composition', detail: 'preset missing' }),
    status('member:builder-beta', 'w2', 'builder', 'available'),
  ]
  // A spec may replace the bench roster wholesale: the Thread roster spec
  // needs a Thread-only participant, extra Workspace members, and
  // archived/inactive states the default bench does not carry.
  if (options?.seedRoster !== undefined) memberRows = options.seedRoster.map(entry => status(entry.memberId, entry.workspaceId, entry.handle, entry.presence ?? 'available', entry.diagnostic, entry.state))
  // The writing Human is a Workspace seat too: the roster the bench serves carries
  // them alongside the seeded Agents, so a surface that renders the Human by their
  // own id (the Thread member dialog's follow row) has a row to draw. Seats that
  // never select the Human — the mention roster — filter by id, not by presence.
  const humanStatusRow = () => status('member:human', 'w1', 'human', 'available')
  const members = vi.fn(async ({ workspaceId }: { workspaceId?: string }) => ({ ok: true, value: [...memberRows, humanStatusRow()].filter(entry => workspaceId === undefined || entry.workspaceIds.includes(workspaceId)) }))
  const joinWorkspace = vi.fn(async (request: { memberId: string; workspaceId: string }) => {
    const member = memberRows.find(entry => entry.member.memberId === request.memberId)!
    if (!member.workspaceIds.includes(request.workspaceId)) member.workspaceIds.push(request.workspaceId)
    return { ok: true as const, value: {} }
  })
  const leaveWorkspace = vi.fn(async (request: { memberId: string; workspaceId: string }) => {
    const member = memberRows.find(entry => entry.member.memberId === request.memberId)!
    member.workspaceIds = member.workspaceIds.filter(id => id !== request.workspaceId)
    return { ok: true as const, value: {} }
  })
  const addMember = vi.fn(async (request: AgentTeamAddMemberRequest) => ({ ok: true, value: {
    receipt: {},
    status: {
      member: {
        memberId: 'member:new', workspaceId: request.workspaceId, handle: request.handle, description: request.description,
        presetId: request.presetId, state: 'enabled', sessionId: 'session:new',
      },
      availability: 'active', presence: 'available',
    },
    workspaceIds: [request.workspaceId],
  } }))
  let channels: Array<Record<string, unknown>> = options?.initialChannels === true
    ? [{ channelRef: 'channel:engineering', workspaceId: 'w1', name: 'engineering', description: 'Engineering work', createdAtSequence: 1 }]
    : []
  let memberships: Array<Record<string, unknown>> = (options?.seedChannelMembers ?? []).map(entry => ({ channelRef: entry.channelRef, memberId: entry.memberId }))
  const seedTaskRef = options?.seedTaskRef ?? 'task:1'
  const seedThreadRef = options?.seedThreadRef ?? 'thread:1'
  let viewItems: Array<Record<string, unknown>> = (options?.seededMessages ?? []).map((seed, index) => ({
    message: { messageRef: `message:seed-${index}`, channelRef: 'channel:engineering', threadRef: seedThreadRef, taskRef: seedTaskRef, sender: seed.sender === 'agent' ? 'member:builder' : 'member:human', body: seed.body, ...(seed.replyToMessageRef === undefined ? {} : { replyToMessageRef: seed.replyToMessageRef }), topLevel: true, sequence: index + 1, occurredAt: seed.occurredAt },
    mentions: seed.mentions ?? [],
    task: { taskRef: seedTaskRef, channelRef: 'channel:engineering', threadRef: seedThreadRef,
      status: options?.seedTaskStatus ?? 'todo', resolution: 'open' },
    thread: { threadRef: seedThreadRef, taskRef: seedTaskRef, revision: 2 },
    taskNumber: 1,
    // A seed carries no Claims, so the Host would project no owners either.
    claimOwners: [],
    messageCount: 1,
    // A seed is the only fact on its Thread, so the newest fact instant is the
    // Message's own: the feed reads that equality as "no follow-up yet".
    lastActivityAt: seed.occurredAt,
  }))
  let viewClaims: Array<Record<string, unknown>> = []
  // Board Tasks live beside the message-borne one: mutable, so createTask /
  // updateTask / changeTask doubles mutate them the way the Host ledger does,
  // and every `view` read re-derives the catalog from the same rows.
  let boardTasks: Array<Record<string, unknown>> = (options?.seedBoardTasks ?? []).map(entry => ({
    taskRef: entry.taskRef, channelRef: entry.channelRef ?? 'channel:engineering',
    threadRef: entry.threadRef ?? `thread:${entry.taskRef.slice('task:'.length)}`,
    status: entry.status, resolution: entry.status === 'done' ? 'accepted' : entry.status === 'closed' ? 'closed' : 'open',
    ...(entry.title === undefined ? {} : { title: entry.title }),
    ...(entry.priority === undefined ? {} : { priority: entry.priority }),
    ...(entry.assignee === undefined ? {} : { assignee: entry.assignee }),
    ...(entry.position === undefined ? {} : { position: entry.position }),
  }))
  const boardTaskNumbers = new Map<string, number>((options?.seedBoardTasks ?? []).map(entry => [entry.taskRef, entry.taskNumber]))
  let boardThreadRevisions = new Map<string, number>((options?.seedBoardTasks ?? []).map(entry => [entry.threadRef ?? `thread:${entry.taskRef.slice('task:'.length)}`, 2]))
  let boardTaskCounter = (options?.seedBoardTasks ?? []).length
  let viewActivities: Array<Record<string, unknown>> = []
  const viewChannels = vi.fn(async (request: { threadRef?: string; topLevelOnly?: boolean }) => {
  const messageTasks = viewItems.flatMap(item => item.task === undefined ? [] : [item.task])
  const messageThreads = viewItems.length === 0 ? [] : [viewItems[0]!.thread]
  const threads = [...messageThreads, ...boardTasks.flatMap(task => {
    const threadRef = (task as { threadRef: string }).threadRef
    return messageThreads.some(thread => (thread as { threadRef: string }).threadRef === threadRef)
      ? [] : [{ threadRef, revision: boardThreadRevisions.get(threadRef) ?? 2 } as Record<string, unknown>]
  })]
  return { ok: true, value: {
    humanMemberId: 'member:human', channels, members: memberships,
    tasks: [...messageTasks, ...boardTasks], threads,
    taskNumbers: [...viewItems.flatMap(item => item.task === undefined || item.taskNumber === undefined ? [] : [{ taskRef: (item.task as { taskRef: string }).taskRef, taskNumber: item.taskNumber }]),
      ...boardTasks.flatMap(task => {
        const taskRef = (task as { taskRef: string }).taskRef
        const number = boardTaskNumbers.get(taskRef)
        return number === undefined ? [] : [{ taskRef, taskNumber: number }]
      })],
    items: request.threadRef !== undefined || !request.topLevelOnly ? viewItems : viewItems.filter(item => (item.message as { topLevel?: boolean }).topLevel), claims: viewClaims, activities: request.topLevelOnly ? [] : viewActivities, cursor: 0, hasMore: false,
  }
  } })
  const createChannel = vi.fn(async (request: AgentTeamCreateChannelRequest) => {
    const channel = { channelRef: 'channel:new', workspaceId: request.workspaceId, name: request.name,
      description: request.description, createdAtSequence: 1 }
    channels = [...channels, channel]
    memberships = (request.memberIds ?? []).map(memberId => ({ channelRef: channel.channelRef, memberId }))
    return { ok: true, value: { receipt: {}, channel, memberIds: request.memberIds ?? [] } }
  })
  const joinChannel = vi.fn(async (request: { requestId: string; channelRef: string; memberId: string }) => {
    memberships = [...memberships, { channelRef: request.channelRef, memberId: request.memberId }]
    return { ok: true, value: {} }
  })
  const removeChannelMember = vi.fn(async (request: { requestId: string; channelRef: string; memberId: string }) => {
    memberships = memberships.filter(item => item.channelRef !== request.channelRef || item.memberId !== request.memberId)
    return { ok: true, value: {} }
  })
  const updateChannel = vi.fn(async (request: { requestId: string; workspaceId: string; channelRef: string; name: string; description: string }) => {
    channels = channels.map(channel => channel.channelRef === request.channelRef
      ? { ...channel, name: request.name, description: request.description } : channel)
    return { ok: true as const, value: { receipt: {}, channel: channels.find(channel => channel.channelRef === request.channelRef) } }
  })
  const updateMember = vi.fn(async (request: { requestId: string; memberId: string; handle: string; description: string; model?: { provider: string; model: string } }) => {
    memberRows = memberRows.map(entry => entry.member.memberId === request.memberId
      ? { ...entry, member: { ...entry.member, handle: request.handle, description: request.description, ...(request.model === undefined ? {} : { model: request.model }) } }
      : entry)
    const status = memberRows.find(entry => entry.member.memberId === request.memberId)
    return { ok: true as const, value: { receipt: {}, ...(status === undefined ? {} : { status }) } }
  })
  const recoverMember = vi.fn(async (request: { requestId: string; memberId: string }) => ({
    ok: true as const,
    value: { status: memberRows.find(entry => entry.member.memberId === request.memberId) },
  }))
  // The Host moves a renewed Member onto a freshly minted Session id, so the
  // mock transitions the row the way the real renewal does.
  let renewCounter = 0
  const clearMemberContext = vi.fn(async (request: { requestId: string; memberId: string }) => {
    renewCounter += 1
    memberRows = memberRows.map(entry => entry.member.memberId === request.memberId
      ? { ...entry, member: { ...entry.member, sessionId: `${entry.member.sessionId}-renewed-${renewCounter}` } }
      : entry)
    return {
      ok: true as const,
      value: { receipt: {}, status: memberRows.find(entry => entry.member.memberId === request.memberId) },
    }
  })
  // Archival hides the row: the mock transitions the member the way the real
  // archiveMember remote does (state archived, availability archived).
  const archiveMember = vi.fn(async (request: { requestId: string; memberId: string }) => {
    memberRows = memberRows.map(entry => entry.member.memberId === request.memberId
      ? { ...entry, member: { ...entry.member, state: 'archived' }, availability: 'archived', presence: 'unavailable' }
      : entry)
    const archived = memberRows.find(entry => entry.member.memberId === request.memberId)
    return {
      ok: true as const,
      value: { receipt: {}, member: archived?.member, releasedClaims: [], removedAttention: [] },
    }
  })
  // Channel archival hides the row from every view; the mock drops it like
  // the Host's workspace-scoped wake refetch would.
  const archiveChannel = vi.fn(async (request: { requestId: string; workspaceId: string; channelRef: string }) => {
    const archived = channels.find(channel => channel.channelRef === request.channelRef)
    channels = channels.filter(channel => channel.channelRef !== request.channelRef)
    return { ok: true as const, value: { receipt: {}, channel: archived, releasedClaims: [] } }
  })
  const modelCatalog = vi.fn(async () => ({ ok: true as const, value: {
    groups: [{ id: 'deepseek-official', name: 'DeepSeek', models: [
      { id: 'deepseek-chat', name: 'DeepSeek Chat', reasoning: { efforts: [{ id: 'low', name: 'low' }, { id: 'high', name: 'high' }] } },
      { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner' },
    ] }],
    failures: [],
  } }))
  const putAttachment = vi.fn(async (request: { requestId: string; name: string; mediaType?: string; bytesBase64: string }) => ({
    ok: true as const,
    value: { attachmentId: `attachment:${putAttachmentCounter += 1}`, path: `/cache/${request.name}`, name: request.name, byteSize: request.bytesBase64.length, mediaType: request.mediaType ?? 'application/octet-stream' },
  }))
  let putAttachmentCounter = 0
  const getAttachment = vi.fn(async (request: { attachmentId: string }) => {
    if (request.attachmentId === 'attachment:2') return { ok: false as const, error: new Error('no longer cached') }
    return { ok: true as const, value: { name: 'x', mediaType: 'image/png', byteSize: 8, bytesBase64: 'aGVsbG8=' } }
  })
  let sentMessageCount = 0
  const sendMessage = vi.fn(async (request: AgentTeamSendMessageRequest) => {
    sentMessageCount += 1
    const sequence = 1 + sentMessageCount
    const asTask = request.asTask === true
    const task = asTask ? { taskRef: 'task:1', channelRef: request.channelRef, threadRef: 'thread:1', status: 'todo', resolution: 'open' } : undefined
    const thread = { threadRef: 'thread:1', ...(asTask ? { taskRef: 'task:1' } : {}), revision: sequence }
    const attachments = request.attachments === undefined ? [] : request.attachments.map(id => ({ attachmentId: id, name: `file-${id}.png`, byteSize: 8, mediaType: 'image/png' }))
    const message = { messageRef: `message:${sequence}`, channelRef: request.channelRef, threadRef: 'thread:1', ...(asTask ? { taskRef: 'task:1' } : {}), sender: 'member:human', body: request.body, ...(attachments.length === 0 ? {} : { attachments }), topLevel: true, sequence, occurredAt: '2026-08-21T10:00:00.000Z' }
    viewItems = [{ message, mentions: [], ...(task === undefined ? {} : { task, taskNumber: 1 }), thread, claimOwners: [], messageCount: 1, lastActivityAt: message.occurredAt }]
    return { ok: true as const, value: { kind: 'committed' as const, receipt: {}, message, ...(task === undefined ? {} : { task }), thread, attention: [], directMarkers: [] } }
  })
  let changeVersion = 0
  let changeFailure: string | undefined
  const generationListeners = new Set<() => void>()
  const changeWaiters = new Set<{ request: AgentTeamChangesRequest; wake(): void }>()
  const wakeAll = (): void => {
    changeVersion += 1
    for (const waiter of changeWaiters) waiter.wake()
  }
  const publishPresence = (): void => {
    changeVersion += 1
    for (const waiter of changeWaiters) if (waiter.request.scope?.kind === 'presence') waiter.wake()
  }
  // One projection-domain wake shaped like a workspace commit: workspace and
  // scope-less projection waiters wake, presence waiters stay parked (the Host
  // only advances the presence epoch for presence scopes).
  const publishWorkspaceUpdate = (): void => {
    changeVersion += 1
    for (const waiter of changeWaiters) if (waiter.request.scope === undefined || waiter.request.scope.kind === 'workspace') waiter.wake()
  }
  // One projection wake whose narrow scopes match nothing this app subscribed
  // to — a commit in another Workspace: only the scope-less waiters wake.
  // One thread-scope wake: the Host's change for a Turn notice or a Turn attributed to this Thread.
  const publishThreadUpdate = (threadRef: string): void => {
    changeVersion += 1
    for (const waiter of changeWaiters) if (waiter.request.scope === undefined || (waiter.request.scope.kind === 'thread' && waiter.request.scope.threadRef === threadRef)) waiter.wake()
  }
  // L1 item 4: the running-Turn feed double (A13 v2). Mutable, so a spec can
  // start a Turn, advance it, and end it the way the Host folds session events.
  // `revision` mirrors the Host's process-local activity epoch, which is what the
  // client's activity query keys on.
  let activityRowsNow: readonly {
    readonly memberId: string
    readonly handle: string
    readonly threadRef?: string
    readonly turnStartedAt: string
    readonly stepCount: number
    readonly toolCount: number
    readonly current?: { readonly tool: string; readonly label: string }
    readonly updatedAt: string
  }[] = []
  let activityRevisionValue = 0
  const memberActivity = vi.fn(async (request: { workspaceId: string; threadRef?: string }) => ({
    ok: true as const,
    value: {
      revision: activityRevisionValue,
      activities: activityRowsNow
        .filter(row => request.threadRef === undefined || row.threadRef === request.threadRef)
        .map(row => ({ ...row, threadRef: row.threadRef })),
    },
  }))
  /** Start (or replace) a seat's running Turn on one Thread; mirrors the Host's entryFor. */
  const publishActivity = (row: { readonly memberId: string; readonly handle: string; readonly threadRef?: string; readonly stepCount?: number; readonly toolCount?: number; readonly current?: { readonly tool: string; readonly label: string } }): void => {
    const time = new Date().toISOString()
    activityRowsNow = [...activityRowsNow.filter(entry => entry.memberId !== row.memberId), {
      memberId: row.memberId,
      handle: row.handle,
      ...(row.threadRef === undefined ? {} : { threadRef: row.threadRef }),
      turnStartedAt: time,
      stepCount: row.stepCount ?? 1,
      toolCount: row.toolCount ?? 0,
      ...(row.current === undefined ? {} : { current: row.current }),
      updatedAt: time,
    }]
    activityRevisionValue += 1
    for (const waiter of changeWaiters) if (waiter.request.scope?.kind === 'activity') waiter.wake()
  }
  /** End the seat's running Turn, as `agent/status` idle and `agent/error` do on the Host. */
  const endActivity = (memberId: string): void => {
    activityRowsNow = activityRowsNow.filter(entry => entry.memberId !== memberId)
    activityRevisionValue += 1
    for (const waiter of changeWaiters) if (waiter.request.scope?.kind === 'activity') waiter.wake()
  }
  const addTurnFailure = (failure: AgentTeamThreadTurnFailure): void => {
    turnFailureRows = [...turnFailureRows, failure]
    publishThreadUpdate(failure.threadRef)
  }
  const publishGlobalUpdate = (): void => {
    changeVersion += 1
    for (const waiter of changeWaiters) if (waiter.request.scope === undefined) waiter.wake()
  }
  const connection = {
    generation: {
      getSnapshot: () => changeFailure === undefined ? {} as never : undefined,
      subscribe: (listener: () => void) => { generationListeners.add(listener); return () => { generationListeners.delete(listener) } },
    },
  }
  const reply = vi.fn(async (request: AgentTeamReplyRequest) => {
    const top = viewItems[0]!
    const message = { ...(top.message as object), messageRef: 'message:human-reply', sender: 'member:human', body: request.body, topLevel: false, sequence: request.baseRevision + 1 }
    const thread = { ...(top.thread as object), revision: request.baseRevision + 1 }
    viewItems = [{ ...top, thread, mentions: [], messageCount: 2 }, { ...top, message, thread, mentions: [], messageCount: 2 }]
    return { ok: true as const, value: { kind: 'committed', receipt: {}, message, task: top.task, thread, attention: [], directMarkers: [] } }
  })
  const promoteThread = vi.fn(async (request: { requestId: string; workspaceId: string; threadRef: string; baseRevision: number }) => {
    const top = viewItems.find(item => (item.thread as { threadRef: string }).threadRef === request.threadRef) ?? viewItems[0]
    if (top === undefined) return { ok: false as const, error: { message: 'thread missing' } }
    const task = { taskRef: 'task:1', channelRef: 'channel:engineering', threadRef: request.threadRef, status: 'todo', resolution: 'open' }
    const thread = { ...(top.thread as object), taskRef: task.taskRef, revision: request.baseRevision + 1 }
    const activity = { activityRef: 'activity:promoted', kind: 'promote' as const, taskRef: task.taskRef, threadRef: request.threadRef, actor: 'member:human', sequence: request.baseRevision + 1 }
    // A promoted Task is brand-new with no Claims, so the Host projects no owners.
    viewItems = viewItems.map(item => ({ ...item, task, thread, taskNumber: 1, claimOwners: [] }))
    return { ok: true as const, value: { kind: 'committed' as const, receipt: {}, activity, task, thread } }
  })
  // A Task commit wakes the Channel and Thread scopes (and scope-less waiters)
  // exactly as the Host's `changeScopesOf` does for claims, resolutions, creates
  // and field updates: never the Workspace scope. A spec that needs a
  // workspace-shaped wake must say so with `publishWorkspaceUpdate`.
  const publishTaskCommit = (channelRef: string, threadRef: string): void => {
    changeVersion += 1
    for (const waiter of changeWaiters) {
      const scope = waiter.request.scope
      if (scope === undefined || (scope.kind === 'channel' && scope.channelRef === channelRef) || (scope.kind === 'thread' && scope.threadRef === threadRef)) waiter.wake()
    }
  }
  // The next board write answers with a business outcome instead of committing,
  // the way the Host does for a stale revision or an unread Thread.
  let nextBoardWriteOutcome: 'stale_revision' | 'unread_required' | undefined
  const failNextBoardWrite = (kind: 'stale_revision' | 'unread_required'): void => { nextBoardWriteOutcome = kind }
  const takeBoardWriteOutcome = (threadRef: string, revision: number) => {
    const kind = nextBoardWriteOutcome
    nextBoardWriteOutcome = undefined
    if (kind === undefined) return undefined
    return { ok: true as const, value: kind === 'stale_revision'
      ? { kind, threadRef, expectedRevision: revision, revision: revision + 1 }
      : { kind, threadRef, revision, unreadCount: 1, directCount: 0 } }
  }
  /** The next end-of-column position, as the Host assigns it to a new todo Task. */
  const endOfTodoPosition = (): number => boardTasks.reduce((highest, row) => (row as { status: string }).status === 'todo' ? Math.max(highest, (row as { position?: number }).position ?? 0) : highest, 0) + 1
  const changeTask = vi.fn(async (request: { taskRef?: string; action: 'accept' | 'close' | 'reopen' }) => {
    const status = request.action === 'reopen' ? 'todo' : request.action === 'accept' ? 'done' : 'closed'
    const resolution = request.action === 'reopen' ? 'open' : request.action === 'accept' ? 'accepted' : 'closed'
    // The board drives this Remote by taskRef; the Thread page drives it by
    // the open Thread's rows. Either way the double moves the row it names,
    // or the message-borne Task when no row is named.
    const boardRow = request.taskRef !== undefined
      ? boardTasks.find(row => (row as { taskRef: string }).taskRef === request.taskRef)
      : undefined
    if (boardRow !== undefined) {
      const rowThreadRef = (boardRow as { threadRef: string }).threadRef
      const refused = takeBoardWriteOutcome(rowThreadRef, boardThreadRevisions.get(rowThreadRef) ?? 2)
      if (refused !== undefined) return refused
      const revision = (boardThreadRevisions.get(rowThreadRef) ?? 2) + 1
      boardTasks = boardTasks.map(row => row === boardRow ? { ...row, status, resolution } : row)
      boardThreadRevisions.set(rowThreadRef, revision)
      // The map above replaced the row object, so find the updated row by ref.
      const task = boardTasks.find(row => (row as { taskRef: string }).taskRef === request.taskRef)!
      const thread = { threadRef: rowThreadRef, taskRef: (task as { taskRef: string }).taskRef, revision }
      publishTaskCommit((task as { channelRef: string }).channelRef, rowThreadRef)
      return { ok: true as const, value: { kind: 'committed', receipt: {}, activity: { activityRef: `activity:${request.action}`, taskRef: request.taskRef, threadRef: rowThreadRef, actor: 'member:human', kind: request.action, sequence: revision + 10 }, task, thread, claims: viewClaims } }
    }
    const top = viewItems[0]!
    const task = { ...(top.task as object), status, resolution }
    const thread = { ...(top.thread as object), revision: (top.thread as { revision: number }).revision + 1 }
    // Accept, close, and reopen all land outside the live statuses, so the
    // Host projects no owners after any of them.
    viewItems = viewItems.map(item => ({ ...item, task, thread, claimOwners: [] }))
    return { ok: true as const, value: { kind: 'committed', receipt: {}, activity: { activityRef: `activity:${request.action}`, taskRef: 'task:1', threadRef: 'thread:1', actor: 'member:human', kind: request.action, sequence: (thread.revision as number) + 10 }, task, thread, claims: viewClaims } }
  })

  // Board Remotes (Team Board 4/10). createTask mints the next Task ref and
  // appends an unassigned row; updateTask patches board fields the way the
  // ledger projection does; both bump the Thread revision like a commit.
  const createTask = vi.fn(async (request: { requestId?: string; channelRef: string; title?: string; body: string; priority?: string; assignee?: string | null; position?: number }) => {
    boardTaskCounter += 1
    const taskRef = `task:board-${boardTaskCounter}`
    const threadRef = `thread:board-${boardTaskCounter}`
    const task = { taskRef, channelRef: request.channelRef, threadRef, status: 'todo', resolution: 'open',
      ...(request.title === undefined ? {} : { title: request.title }),
      ...(request.priority === undefined ? {} : { priority: request.priority }),
      assignee: request.assignee ?? null, position: request.position ?? endOfTodoPosition() }
    boardTasks = [...boardTasks, task]
    boardTaskNumbers.set(taskRef, boardTaskCounter)
    boardThreadRevisions.set(threadRef, 2)
    publishTaskCommit(request.channelRef, threadRef)
    const message = { messageRef: `message:board-${boardTaskCounter}`, channelRef: request.channelRef, threadRef, sender: 'member:human', body: request.body, topLevel: true, sequence: 100 + boardTaskCounter, occurredAt: '2026-08-21T10:00:00.000Z' }
    const thread = { threadRef, taskRef, revision: 2 }
    return { ok: true as const, value: { kind: 'committed' as const, receipt: {}, message, task, thread, attention: [], directMarkers: [] } }
  })
  const updateTask = vi.fn(async (request: { taskRef?: string; baseRevision?: number; patch: Record<string, unknown> }) => {
    // The Task detail drives this Remote by patch alone: fold it into the open
    // Thread's Task the way the ledger projection does.
    if (request.taskRef === undefined) {
      const top = viewItems[0]!
      const task = { ...(top.task as object), ...request.patch } as Record<string, unknown>
      const thread = { ...(top.thread as object), revision: (top.thread as { revision: number }).revision + 1 }
      viewItems = viewItems.map(item => ({ ...item, task, thread }))
      return { ok: true as const, value: { kind: 'committed' as const, receipt: {}, task, thread } }
    }
    const existing = boardTasks.find(task => (task as { taskRef: string }).taskRef === request.taskRef) ?? (() => {
      const fromMessage = viewItems.map(item => item.task).find(task => task !== undefined && (task as { taskRef?: string }).taskRef === request.taskRef)
      if (fromMessage === undefined) return undefined
      const row = { ...(fromMessage as Record<string, unknown>) }
      boardTasks = [...boardTasks, row]
      return row
    })()
    if (existing === undefined) return { ok: false as const, error: { message: 'task missing' } }
    const existingThreadRef = (existing as { threadRef: string }).threadRef
    const currentRevision = boardThreadRevisions.get(existingThreadRef) ?? 2
    const refused = takeBoardWriteOutcome(existingThreadRef, currentRevision)
    if (refused !== undefined) return refused
    if (request.baseRevision !== undefined && request.baseRevision !== currentRevision) {
      return { ok: true as const, value: { kind: 'stale_revision' as const, threadRef: existingThreadRef, expectedRevision: request.baseRevision, revision: currentRevision } }
    }
    let patched: Record<string, unknown> = existing
    boardTasks = boardTasks.map(task => {
      if (task !== existing) return task
      patched = { ...task, ...request.patch }
      return patched
    })
    // Field-only edits leave the Thread revision alone, like the Host ledger.
    const threadRef = existingThreadRef
    publishTaskCommit((existing as { channelRef: string }).channelRef, threadRef)
    return { ok: true as const, value: { kind: 'committed' as const, receipt: {}, task: patched, thread: { threadRef, taskRef: (patched as { taskRef: string }).taskRef, revision: currentRevision } } }
  })
  /** An Agent's claim commit made elsewhere: the row moves to a live status and only Channel and Thread scopes wake. */
  const claimBoardTask = (taskRef: string, status: 'in_progress' | 'in_review'): void => {
    const row = boardTasks.find(entry => (entry as { taskRef: string }).taskRef === taskRef)
    if (row === undefined) throw new Error(`no board Task ${taskRef}`)
    const threadRef = (row as { threadRef: string }).threadRef
    boardTasks = boardTasks.map(entry => entry === row ? { ...entry, status } : entry)
    boardThreadRevisions.set(threadRef, (boardThreadRevisions.get(threadRef) ?? 2) + 1)
    publishTaskCommit((row as { channelRef: string }).channelRef, threadRef)
  }
  /** Replace the board Task rows and wake every workspace waiter. */
  const seedBoardTasks = (rows: ReadonlyArray<Record<string, unknown>>): void => { boardTasks = [...rows]; wakeAll() }
  // Each read consumes the queue head as its remainingUnreadCount: the page's
  // auto-drain loop keeps issuing fresh-requestId reads until a zero, so the
  // queue supplies every round the way the Host's bounded batches would.
  const remainingUnreadCounts = [...(options?.remainingUnreadCounts ?? [])]
  const readThread = vi.fn(async ({ requestId, taskRef, threadRef }: { requestId?: string; taskRef?: string; threadRef?: string }) => {
    void requestId
    const top = viewItems.find(item => (threadRef !== undefined && (item.thread as { threadRef: string }).threadRef === threadRef)
      || (taskRef !== undefined && (item.task as { taskRef?: string } | undefined)?.taskRef === taskRef)) ?? viewItems[0]
    if (top === undefined) return { ok: false as const, error: { message: 'thread missing' } }
    const remainingUnreadCount = remainingUnreadCounts.length > 0 ? remainingUnreadCounts.shift()! : 0
    // A durable read consumes this reader's mention markers: the direct-only
    // Inbox double drops the read Thread's rows, like the Host's projection.
    const readThreadRef = (top.thread as { threadRef?: string }).threadRef
    inboxRows = inboxRows.filter(row => ((row.item as { thread?: { threadRef?: string } }).thread?.threadRef) !== readThreadRef)
    return { ok: true as const, value: {
      receipt: {}, task: top.task, thread: top.thread, claims: viewClaims,
      anchor: top.message, anchorMentions: [], facts: [...viewItems.map(item => ({ fact: { kind: 'message' as const, sequence: (item.message as { sequence: number }).sequence, message: item.message, mentions: (item as { mentions?: string[] }).mentions ?? [] }, unread: false, direct: false })), ...viewActivities.map(activity => ({ fact: { kind: 'activity' as const, sequence: activity.sequence as number, activity }, unread: false, direct: false }))],
      readThroughSequence: (top.thread as { revision: number }).revision, remainingUnreadCount, consumedDirectMarkers: [],
    } }
  })
  const loadThreadHistory = vi.fn(async ({ taskRef, threadRef }: { taskRef?: string; threadRef?: string }) => {
    const top = viewItems.find(item => (threadRef !== undefined && (item.thread as { threadRef: string }).threadRef === threadRef)
      || (taskRef !== undefined && (item.task as { taskRef?: string } | undefined)?.taskRef === taskRef)) ?? viewItems[0]
    if (threadHistoryFailure !== undefined) return { ok: false as const, error: { message: threadHistoryFailure } }
    if (top === undefined) return { ok: false as const, error: { message: 'thread missing' } }
    return { ok: true as const, value: { task: top.task, thread: top.thread, anchor: top.message, anchorMentions: [], claims: viewClaims, facts: [], cursor: 0, hasMore: false } }
  })
  /** One-shot history-read failure; cleared by the next successful read. */
  let threadHistoryFailure: string | undefined
  // The Human author follows every seeded Thread; tests override the set to
  // drive the mention-candidate ranking. `changeAttention` mutates it like the
  // Host ledger does, so a follow/unfollow round-trip is observable.
  // L1 item 3: the Human's own Thread Attention op double. It mirrors the Host
  // contract exactly — the request carries no memberId and the double asserts the
  // Human as the actor, so a client can never address another seat through it.
  const threadFollowers = [...(options?.seedFollowers ?? ['member:human'])]
  const changeAttention = vi.fn(async (request: { requestId: string; workspaceId: string; threadRef?: string; taskRef?: string; action: 'follow' | 'unfollow' }) => {
    if (request.action === 'follow') {
      if (threadFollowers.includes('member:human')) throw new Error('Member is already following Thread')
      threadFollowers.push('member:human')
      return { ok: true as const, value: { receipt: { operationId: 'op:attention', sequence: 30, occurredAt: '2026-08-21T12:00:00.000Z' }, thread: { threadRef: 'thread:1', revision: 3 }, attention: { memberId: 'member:human', threadRef: 'thread:1', followedAtSequence: 30 } } }
    }
    if (!threadFollowers.includes('member:human')) throw new Error('Member is already unfollowed from Thread')
    const kept = threadFollowers.filter(id => id !== 'member:human')
    threadFollowers.length = 0
    threadFollowers.push(...kept)
    return { ok: true as const, value: { receipt: { operationId: 'op:attention', sequence: 31, occurredAt: '2026-08-21T12:00:00.000Z' }, thread: { threadRef: 'thread:1', revision: 4 } } }
  })
  const threadObservations = vi.fn(async ({ taskRef, threadRef }: { taskRef?: string; threadRef?: string }) => {
    void taskRef
    void threadRef
    return { ok: true as const, value: { items: [], followers: threadFollowers } }
  })
  // Per-reply usage of the Thread; a test seeds the rows it wants to see.
  const threadReplyStats = vi.fn(async (_request: { workspaceId: string; threadRef: string }) => ({ ok: true as const, value: options?.seedReplyStats ?? [] }))
  // Failure notices of the Thread; a test seeds the notices it wants to see.
  // Mutable, so a test can add a notice and wake the open Thread the way the Host's thread-scope change would.
  let turnFailureRows: AgentTeamThreadTurnFailure[] = [...(options?.seedTurnFailures ?? [])]
  const threadTurnFailures = vi.fn(async (_request: { workspaceId: string; threadRef: string }) => ({ ok: true as const, value: turnFailureRows }))
  // Per-seat Session runs of the Thread (contract §4 threadSessions); a test
  // seeds the rows it wants the execution log to show, and `setThreadSessions`
  // replaces them the way a folded Turn record would, waking the open Thread.
  let threadSessionRows: readonly AgentTeamThreadSessionRuns[] = [...(options?.seedThreadSessions ?? [])]
  const threadSessions = vi.fn(async (_request: { workspaceId: string; threadRef: string }) => ({ ok: true as const, value: threadSessionRows }))
  const setThreadSessions = (rows: readonly AgentTeamThreadSessionRuns[]): void => {
    threadSessionRows = rows
    publishThreadUpdate(seedThreadRef)
  }
  // Reply-link quote context, derived from the seeded record like the Host's
  // ledger lookup: author and first line; unknown refs are omitted.
  const docs = vi.fn(async (_request: { workspaceId: string; threadRef?: string }) => ({ ok: true as const, value: { docs: [] as unknown[] } }))
  // Decision cards of one Thread; a test seeds the rows it wants to see, and the
  // double answers with the rows whose Thread matches the request, like the Host.
  let decisionRows: AgentTeamDecisionView[] = []
  const decisions = vi.fn(async (request: { workspaceId: string; threadRef: string }) => ({ ok: true as const, value: { decisions: decisionRows.filter(decision => decision.threadRef === request.threadRef) } }))
  /** Seed the decision cards every decisions read answers with. */
  const seedDecisions = (rows: AgentTeamDecisionView[]): void => { decisionRows = rows; wakeAll() }
  const doc = vi.fn(async (_request: { workspaceId: string; docRef: string }) => ({ ok: false as const, error: { message: 'no Doc in this fixture' } }))
  const commentDoc = vi.fn(async () => ({ ok: false as const, error: { message: 'no Doc in this fixture' } }))
  const reviewDoc = vi.fn(async () => ({ ok: false as const, error: { message: 'no Doc in this fixture' } }))
  const writeDocSection = vi.fn(async () => ({ ok: false as const, error: { message: 'no Doc in this fixture' } }))
  const resolveDocComment = vi.fn(async () => ({ ok: false as const, error: { message: 'no Doc in this fixture' } }))
  const docSectionHistory = vi.fn(async () => ({ ok: false as const, error: { message: 'no Doc in this fixture' } }))
  const answerDecision = vi.fn(async () => ({ ok: false as const, error: { message: 'no decision card in this fixture' } }))
  const resolveMessageRefs = vi.fn(async (request: { workspaceId: string; messageRefs: readonly string[] }) => {
    const messages = viewItems.map(item => item.message as { messageRef: string; threadRef: string; sender: string; body: string })
    const resolved = request.messageRefs.flatMap(ref => {
      const message = messages.find(candidate => candidate.messageRef === ref)
      return message === undefined ? [] : [{ messageRef: message.messageRef, threadRef: message.threadRef, sender: message.sender, excerpt: message.body.split('\n', 1)[0]!.trim() }]
    })
    return { ok: true as const, value: { resolved } }
  })
  /** Session history in the real `{current, runs[]}` shape; no Member has run yet. */
  const memberSessions = vi.fn(async () => ({ ok: true as const, value: { current: null, runs: [] } }))
  const resolveThreadRefs = vi.fn(async () => ({ ok: true as const, value: { resolved: [] } }))
  const resolveTaskRefs = vi.fn(async (request: { workspaceId: string; taskRefs: readonly string[] }) => {
    const numbers = new Map(viewItems.flatMap((item, index) => {
      const taskRef = (item.task as { taskRef?: string } | undefined)?.taskRef
      return taskRef === undefined ? [] : [[taskRef, index + 1] as const]
    }))
    // One Host-known Task lives outside the loaded channel timeline, so the
    // click fallback path has something real to resolve.
    const known = new Map(viewItems.flatMap(item => {
      const taskRef = (item.task as { taskRef?: string } | undefined)?.taskRef
      return taskRef === undefined ? [] : [[taskRef, item] as const]
    }))
    known.set('task:9c1b02aa-5d3e-4f0a-8b7c-1e2d3f4a5b6c', {
      task: { taskRef: 'task:9c1b02aa-5d3e-4f0a-8b7c-1e2d3f4a5b6c', channelRef: 'channel:engineering', threadRef: 'thread:9c1b02aa-5d3e-4f0a-8b7c-1e2d3f4a5b6d', status: 'todo', resolution: 'open' },
    })
    const resolved = request.taskRefs.flatMap(taskRef => {
      const item = known.get(taskRef) ?? [...known.values()].find(candidate => {
        const candidateRef = (candidate.task as { taskRef?: string } | undefined)?.taskRef
        return candidateRef !== undefined && candidateRef.startsWith(taskRef)
      })
      if (item === undefined) return []
      const task = item.task as { taskRef: string; channelRef: string; threadRef: string }
      return [{ taskRef: task.taskRef, channelRef: task.channelRef, threadRef: task.threadRef, taskNumber: numbers.get(task.taskRef) ?? 2 }]
    })
    return { ok: true as const, value: { resolved } }
  })
  // The Human Inbox double: rows are tagged per Workspace, and one call shape
  // serves every surface that reads the Inbox — the sidebar badge, the Inbox
  // page, and the Channel feed's Thread entries. It returns the Host's two
  // slices: `items` is the unread queue (mentions inside it, not alone, so
  // `totalUnreadCount` is the badge number while `directCount` stays the row's
  // own mention count), and a row seeded with no unread stands for the
  // 「最近活跃」 tail the Host admits by participation instead.
  let inboxRows: Array<{ readonly workspaceId: string; readonly item: Record<string, unknown> }> = []
  // The Host's own verdict on the bounded unread queue; specs flip it to prove
  // the page discloses a capped page instead of reading as the whole queue.
  let inboxHasMore = false
  const inbox = vi.fn(async ({ workspaceId }: { workspaceId: string }) => {
    const scoped = inboxRows.filter(row => row.workspaceId === workspaceId)
    const holdsUnread = (row: { readonly item: Record<string, unknown> }): boolean => ((row.item as { unreadCount?: number }).unreadCount ?? 0) > 0
    const items = scoped.filter(holdsUnread).map(row => row.item)
    const recent = scoped.filter(row => !holdsUnread(row)).map(row => row.item)
    const unread = items.reduce((sum, item) => sum + ((item as { unreadCount?: number }).unreadCount ?? 0), 0)
    const direct = items.reduce((sum, item) => sum + ((item as { directCount?: number }).directCount ?? 0), 0)
    return { ok: true as const, value: { humanMemberId: 'member:human', items, recent, hasMore: inboxHasMore, totalUnreadCount: unread, totalDirectCount: direct } }
  })
  const seedInbox = (rows: ReadonlyArray<{ readonly workspaceId: string } & Record<string, unknown>>, options?: { readonly hasMore?: boolean }): void => {
    inboxRows = rows.map(row => ({ workspaceId: row.workspaceId, item: row as Record<string, unknown> }))
    inboxHasMore = options?.hasMore ?? false
    wakeAll()
  }
  const changes = vi.fn(async function* (request: AgentTeamChangesRequest, signal?: AbortSignal) {
    let pending = false
    let resume: (() => void) | undefined
    const waiter = { request, wake: () => { pending = true; resume?.() } }
    const abort = () => resume?.()
    changeWaiters.add(waiter)
    signal?.addEventListener('abort', abort, { once: true })
    try {
      if (changeFailure !== undefined) throw new RemoteStreamCarrierError(changeFailure)
      yield { version: changeVersion }
      while (!signal?.aborted) {
        if (!pending) await new Promise<void>(resolve => { resume = resolve })
        resume = undefined
        if (signal?.aborted) return
        if (changeFailure !== undefined) throw new RemoteStreamCarrierError(changeFailure)
        pending = false
        yield { version: changeVersion }
      }
    } finally {
      changeWaiters.delete(waiter)
      signal?.removeEventListener('abort', abort)
    }
  })
  const failChanges = (message = 'transport down'): void => { changeFailure = message; wakeAll() }
  const recoverChanges = (): void => {
    changeFailure = undefined
    for (const listener of generationListeners) listener()
  }
  const publishAgentReply = () => {
    const top = viewItems[0]!
    // The reply and the Claim it carries are newer facts than the opener, so
    // the Thread's newest instant moves: that difference is what the feed's
    // "last activity" reads.
    const activityAt = '2026-08-21T10:03:00.000Z'
    viewClaims = [{ claimRef: 'claim:1', taskRef: 'task:1', threadRef: 'thread:1', owner: 'member:builder', direction: 'Implement API', normalizedDirection: 'implement api', state: 'active' }]
    // The feed reads owners off the item the way the Host projects them — the
    // active Claim's owner while its Task is still live — so the fake carries
    // the same owners instead of leaving the seeded empty set behind.
    const taskStatus = (top.task as { status?: string } | undefined)?.status
    const claimOwners = taskStatus === 'in_progress' || taskStatus === 'in_review'
      ? [{ memberId: 'member:builder', name: 'builder' }]
      : []
    viewItems = [{ ...top, messageCount: 2, lastActivityAt: activityAt, claimOwners }, { ...top, messageCount: 2, lastActivityAt: activityAt, claimOwners, message: { ...(top.message as object), messageRef: 'message:reply', sender: 'member:builder', body: 'agent reply', topLevel: false, sequence: 3, occurredAt: activityAt } }]
    viewActivities = [{ activityRef: 'activity:claim', taskRef: 'task:1', threadRef: 'thread:1', actor: 'member:builder', kind: 'claim', claimRef: 'claim:1', sequence: 4 }]
    wakeAll()
  }
  /** Simulates an externally driven channel/membership commit reaching every workspace waiter. */
  const seedChannel = (channel: Record<string, unknown>) => { channels = [...channels, channel] }
  const publishChannelUpdate = () => { wakeAll() }
  // The workspace-activity aggregate double (Board 7/10): a test seeds the whole
  // result, or a function of the request so a cursor page can differ from the
  // first page the way the Host's sequence paging does.
  type WorkspaceActivitySeed = Record<string, unknown> | ((request: { workspaceId: string; cursor?: string; limit?: number }) => Record<string, unknown>)
  let workspaceActivitySeed: WorkspaceActivitySeed = { totals: { messages: 0, turns: 0, tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0, toolCalls: 0, runMs: 0, failedTurns: 0, unrecordedTurns: 0 }, perAgent: [], perDay: [], sessions: [], events: [] }
  const workspaceActivity = vi.fn(async (request: { workspaceId: string; cursor?: string; limit?: number }) => ({
    ok: true as const,
    value: typeof workspaceActivitySeed === 'function' ? workspaceActivitySeed(request) : workspaceActivitySeed,
  }))
  /** Seed the aggregate every workspaceActivity read answers with. */
  const seedWorkspaceActivity = (seed: WorkspaceActivitySeed): void => { workspaceActivitySeed = seed; wakeAll() }
  // The Human profile doubles: the profile page and every seat that names or
  // draws the Human read the same Remotes, and the Host writes the page makes
  // land in the same seeded value — so one rename visibly moves the page, the
  // timeline, and the member refs together.
  let humanProfileValue: { name: string; avatarRef?: string; version: string; repoUrl: string; updateAvailable: boolean; latestVersion?: string } = {
    name: 'human',
    version: '0.1.13',
    repoUrl: 'https://github.com/ddvnguyen/moct-dsh-team-room',
    updateAvailable: false,
    ...options?.humanProfile,
  }
  // Both seeded before the Team Client mounts, so the first demand-driven read
  // answers with exactly what the test asked for.
  let humanProfileFailure: string | undefined = options?.humanProfileFailure
  let humanProfileWriteFailure: string | undefined
  const humanProfile = vi.fn(async () => humanProfileFailure === undefined
    ? { ok: true as const, value: { ...humanProfileValue } }
    : { ok: false as const, error: { message: humanProfileFailure } })
  const getHumanAvatar = vi.fn(async (_request: { avatarRef: string }) => ({
    ok: true as const,
    value: { name: 'avatar.png', mediaType: 'image/png', byteSize: 3, bytesBase64: 'AAAA' },
  }))
  const putHumanAvatar = vi.fn(async (_request: { name: string; mediaType?: string; bytesBase64: string }) => ({
    ok: true as const,
    value: { avatarRef: 'avatar:1', path: '/human/v1/avatar:1/avatar.png', name: 'avatar.png', byteSize: 3, mediaType: 'image/png' },
  }))
  const removeHumanAvatar = vi.fn(async (_request: { avatarRef: string }) => ({ ok: true as const, value: { removed: true } }))
  // The Host owns the profile write and answers with the resolved name +
  // avatarRef, so the bench refuses exactly where the Host refuses: before
  // anything is stored.
  const setHumanProfile = vi.fn(async (request: { name?: string; avatarRef?: string | null }) => {
    if (humanProfileWriteFailure !== undefined) return { ok: false as const, error: { message: humanProfileWriteFailure } }
    if (typeof request.name === 'string') humanProfileValue = { ...humanProfileValue, name: request.name }
    if (request.avatarRef === null) {
      const { avatarRef: _avatarRef, ...rest } = humanProfileValue
      humanProfileValue = rest
    } else if (typeof request.avatarRef === 'string') humanProfileValue = { ...humanProfileValue, avatarRef: request.avatarRef }
    const { version: _version, repoUrl: _repoUrl, updateAvailable: _updateAvailable, latestVersion: _latestVersion, ...profile } = humanProfileValue
    return { ok: true as const, value: profile }
  })
  /** Seed the Human profile every identity read answers with. */
  const seedHumanProfile = (next: Partial<typeof humanProfileValue>): void => {
    humanProfileValue = { ...humanProfileValue, ...next }
  }
  /** Make the next profile reads fail, or clear the failure. */
  const failHumanProfile = (message?: string): void => {
    humanProfileFailure = message
  }
  /** Make the next profile writes fail, or clear the failure. */
  const failHumanProfileWrite = (message?: string): void => {
    humanProfileWriteFailure = message
  }
  // The environment check double: one read, no write, seeded before the Team
  // Client mounts because its projection reads on the first subscriber.
  let environmentValue: EnvironmentSeed & { readonly verdict: 'ok' | 'out-of-range' | 'undetermined' } = {
    verdict: 'ok',
    bundleVersion: '0.1.15',
    dshVersion: '0.1.7-rc.1',
    certifiedDshVersion: '0.1.7-rc.1',
    supportRange: { lower: '0.1.7-rc.1', upper: '0.1.8' },
    ...options?.environment,
  }
  let environmentFailure: string | undefined = options?.environmentFailure
  const environment = vi.fn(async () => environmentFailure === undefined
    ? { ok: true as const, value: { ...environmentValue } }
    : { ok: false as const, error: { message: environmentFailure } })
  /** Seed the environment report every check read answers with. */
  const seedEnvironment = (next: Partial<typeof environmentValue>): void => {
    environmentValue = { ...environmentValue, ...next }
  }
  /** Make the next environment reads fail, or clear the failure. */
  const failEnvironment = (message?: string): void => {
    environmentFailure = message
  }

  // The bench Host runs without a MOCT backend, so every Team memory read
  // answers the same BACKEND_UNAVAILABLE outcome the real Host gives then.
  const memoryUnavailable = vi.fn(async () => ({
    ok: true as const,
    value: { ok: false as const, code: 'BACKEND_UNAVAILABLE', message: 'Team memory needs the MOCT Team Room backend.' },
  }))
  const memory = {
    memoryList: memoryUnavailable, memoryRecord: memoryUnavailable, memoryRuleFeed: memoryUnavailable, memoryUsage: memoryUnavailable,
    memorySettings: memoryUnavailable, updateMemorySettings: memoryUnavailable, memoryAct: memoryUnavailable,
  }

  // rc.1: the runtime owns one TestRemote; the bench scripts the namespaces
  // the mounted features reach (remote.<name> injects included) and attaches
  // the change-stream and generated-remote-mount faces the shipped double
  // refuses by contract.
  const commandList = vi.fn(async () => ({ ok: true as const, value: [] as const }))
  const skillList = vi.fn(async () => ({ ok: true as const, value: { skills: [] as const } }))
  // The dsh Session controller's cancel — the Team client's stopSession lands here.
  const sessionCancel = vi.fn(async (request: { sessionId: string }) => ({ ok: true as const, value: { accepted: true as const } }))
  runtime.remote.provideNamespaces({
    session: { modelCatalog, cancel: sessionCancel },
    commands: { list: commandList },
    skills: { list: skillList },
    agentTeam: { members, joinWorkspace, leaveWorkspace, addMember, view: viewChannels, inbox, readThread, threadHistory: loadThreadHistory, threadObservations, threadReplyStats, threadTurnFailures, threadSessions, putAttachment, getAttachment, createChannel, updateChannel, archiveChannel, updateMember, recoverMember, clearMemberContext, archiveMember, joinChannel, removeChannelMember, sendMessage, reply, changeTask, promoteThread, changeAttention, createTask, updateTask, memberActivity, workspaceActivity, resolveTaskRefs, memberSessions, resolveThreadRefs, resolveMessageRefs, docs, doc, commentDoc, reviewDoc, writeDocSection, resolveDocComment, docSectionHistory, decisions, answerDecision, changes, environment, humanProfile, setHumanProfile, putHumanAvatar, getHumanAvatar, removeHumanAvatar, ...memory },
  })
  Object.assign(runtime.remote, {
    $stream: <T,>(options: ConstructorParameters<typeof RemoteStream<T>>[1]) => new RemoteStream(connection, options),
    $mount: async () => async () => {},
  })
  runtime.ctx.provide('connection', { isLoopback: true, generation: { getSnapshot: () => ({}) }, state: { getSnapshot: () => ({}) }, rpc: {}, reconnect: vi.fn(), registerGenerationSource: vi.fn(), start: vi.fn(), stop: vi.fn() })
  await runtime.sessions.add({ id: 'ordinary-session', summary: { title: 'Ordinary', cwd: '/work/alpha' } })
  // The workspace service restores the Human's saved selection at boot; the
  // bench seeds the same `mainView` retention so return-target captures see
  // a live selection.
  mainReference = runtime.sessions.retain('ordinary-session' as never, { source: 'mainView' })
  await runtime.workspaces.update((draft) => {
    draft.items = [
      { workspaceId: 'w1' as WorkspaceId, title: 'Alpha', path: '/work/alpha', sessionIds: [], createdAt: '', updatedAt: '' },
      { workspaceId: 'w2' as WorkspaceId, title: 'Beta', path: '/work/beta', sessionIds: [], createdAt: '', updatedAt: '' },
    ] as never
  })
  const FrameWithSidebar = (props: object): ReactNode => Frame({ ...(props as object), sidebarState } as never)
  await runtime.root.declare({
    sidebar: { kind: 'single', scope: 'root' },
    main: { kind: 'keyed', scope: 'root' },
  } as never, FrameWithSidebar as never)
  // The shipped store keeps a selection only while a live `main` entry owns that
  // key, so a requested panel gets a stand-in entry of its own instead of a
  // dangling id no page backs. The selection itself is set here rather than at
  // runtime creation: it is the state a reload restores — the shipped plugin
  // page was open, and the persisted Team mode comes back with it — so it must
  // stand before the Team mounts and meets the mode's boot restore.
  if (options?.mainPanelId !== undefined) {
    runtime.slots.register({ name: 'main', key: options.mainPanelId }, (() => null) as never)
    runtime.panelInfo.set({ activePanelId: options.mainPanelId as never })
  }
  await runtime.mount({ inject: [...injectSidebar], apply: applySidebar })
  // A shell that ships the additive `sidebar.sections` seat serves it from its
  // own column. CI's upstream tag does not carry the seat, and the Team's
  // section registration is inert without a declared spec — the whole sidebar
  // suite would otherwise exercise a sidebar that cannot mount. Stand in for
  // the missing seat the way production declares it: a foot entry that owns
  // the seat and renders it through the same outlet face, registered before
  // the Team mounts. A seat-carrying shell declares it first, so this never
  // registers there.
  if (runtime.slots.spec('sidebar.sections' as never) === undefined) {
    runtime.slots.register({ name: 'sidebar.footer.action', id: 'bench-sections', priority: 1000, children: { 'sidebar.sections': { kind: 'list', scope: 'root' } } } as never, SectionsFootOutlet as never)
  }
  // The shipped ConversationRoot occupies the conversation seat — the same
  // surface production mounts — so member-session specs assert the
  // session-maybe seat's adoption semantics (remount on no-session) through
  // real element identity of the root's [data-phase] node.
  await runtime.mount({ inject: [...injectConversation], apply: applyConversation })
  const disposeWorkspace = runtime.slots.register({ name: 'sidebar.workspaces', priority: 0 }, (options?.nativeTabs === false ? BaselineWorkspace : nativeTabStrip(options?.agentsTab === true, options?.overviewTab === true)) as never)
  const disposeSettings = runtime.slots.register({ name: 'sidebar.settings', priority: 0 }, BaselineSettings as never)
  const team = await runtime.mount({ inject: [...inject], apply })
  const view = runtime.renderRoot()
  const failThreadHistory = (message?: string): void => { threadHistoryFailure = message }
  return { runtime, team, view, panelInfo: runtime.panelInfo, selectPanel, sidebarState, toggleSidebar, disposeWorkspace, disposeSettings, members, humanProfile, setHumanProfile, getHumanAvatar, putHumanAvatar, removeHumanAvatar, seedHumanProfile, failHumanProfile, failHumanProfileWrite, environment, seedEnvironment, failEnvironment, joinWorkspace, leaveWorkspace, addMember, status, viewChannels, createChannel, updateChannel, archiveChannel, putAttachment, getAttachment, updateMember, recoverMember, clearMemberContext, archiveMember, modelCatalog, joinChannel, removeChannelMember, sendMessage, reply, changeTask, promoteThread, changeAttention, createTask, updateTask, seedBoardTasks, claimBoardTask, failNextBoardWrite, publishTaskCommit, memberActivity, workspaceActivity, seedWorkspaceActivity, decisions, seedDecisions, resolveTaskRefs, resolveMessageRefs, publishAgentReply, publishActivity, endActivity, publishPresence, publishWorkspaceUpdate, publishGlobalUpdate, publishThreadUpdate, addTurnFailure, threadTurnFailures, threadSessions, setThreadSessions, sessionCancel, seedChannel, publishChannelUpdate, failChanges, recoverChanges, readThread, loadThreadHistory, threadObservations, changes, inbox, seedInbox, openSession, failThreadHistory }
}
