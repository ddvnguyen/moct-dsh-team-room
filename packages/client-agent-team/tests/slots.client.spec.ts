import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { apply, inject } from '../src/client/index.ts'
/**
 * The shell's section seat, widened the way the client widens it: a harness
 * that ships no seat (CI's upstream tag) has no `sidebar.sections` in its
 * SlotMap, and this bench declares the seat itself, so the name is portable.
 */
const SECTIONS = 'sidebar.sections' as never
/** The Team's browsing-surface entry: the shell's own section seat. */
const teamSection = (slots: SlotRegistry) => slots.entriesOfSlot(SECTIONS)[0]

function workspaceFeed() {
  return {
    getSnapshot: () => ({ items: [{ workspaceId: 'workspace:one' as never, title: 'One', path: '/one', sessionIds: [], createdAt: '', updatedAt: '' }], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null, baselinesReady: true, recentWorkspaceId: undefined }),
    subscribe: () => () => {},
  }
}

async function bench(persisted: string | null = null, strip?: Record<string, unknown>) {
  vi.stubGlobal('localStorage', {
    getItem: () => persisted,
    setItem: vi.fn(),
    removeItem: vi.fn(),
  })
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime(ctx))
  ctx.provide('remote', { $mount: async () => async () => {} } as never)
  ctx.provide('remote.agentTeam', {})
  // rc.1: the client declares the model-catalog sub-namespace; the bench
  // supplies it so the takeover fiber is not left pending on inject.
  ctx.provide('remote.session', { modelCatalog: vi.fn(async () => ({ ok: true, value: { groups: [], failures: [] } })) })
  ctx.provide('remote.commands', { list: vi.fn(async () => ({ ok: true, value: [] })) })
  ctx.provide('remote.skills', { list: vi.fn(async () => ({ ok: true, value: { skills: [] } })) })
  ctx.provide('conversation', { input: { for: () => ({ submit: vi.fn() }) } } as never)
  // The plugin declares these runtime services; the takeover bench only mounts
  // them, it never drives sessions or the model catalog.
  ctx.provide('sessions', {
    list: { getSnapshot: () => ({ byId: {} }), subscribe: () => () => {} },
    search: vi.fn(async () => ({ items: [], hasMore: false })),
    searchResultLimit: 20,
  } as never)
  const uiWorkspace = { openSession: vi.fn(), startSession: vi.fn(), connectWorkspace: vi.fn(async () => 'workspace:one') }
  ctx.provide('uiWorkspace', uiWorkspace as never)
  // The layout face behind ctx.layout: the plugin injects it to own the shell's
  // main panel, so the bench supplies panel selection plus the store the shipped
  // frame's usePanelInfo hook reads.
  let activePanelId: string | null = null
  const panelListeners = new Set<() => void>()
  const panelInfo = {
    getSnapshot: () => ({ activePanelId }),
    subscribe: (listener: () => void) => { panelListeners.add(listener); return () => { panelListeners.delete(listener) } },
  }
  const selectPanel = vi.fn((panelId: string | null): void => {
    activePanelId = panelId
    for (const listener of panelListeners) listener()
  })
  ctx.provide('layout', { toggleSidebar: vi.fn(), selectPanel, panelInfo } as never)
  ctx.provide('connection', { api: { llm: { models: vi.fn(async () => ({ result: { ok: true, value: { groups: [], failures: [] } } })) } } } as never)
  ctx.provide('workspaces', {
    list: workspaceFeed(),
    pickDirectory: vi.fn(async () => null),
    create: vi.fn(),
  } as never)
  const slots = ctx.get('slots') as SlotRegistry
  const root = () => null
  slots.register({ name: 'root', children: {
    sidebar: { kind: 'single', scope: 'root' },
    main: { kind: 'keyed', scope: 'root' },
  } } as never, root)
  slots.register({ name: 'sidebar', children: {
    'sidebar.workspaces': { kind: 'single', scope: 'root' },
    'sidebar.sections': { kind: 'list', scope: 'root' },
    'sidebar.settings': { kind: 'single', scope: 'root' },
    'sidebar.panellist': { kind: 'list', scope: 'root' },
  } } as never, root)
  // The automation plugin's native tab strip, when present, hangs its registry
  // off the shipped workspace entry's component (see team-tab.ts).
  const shippedWorkspaces = Object.assign(() => null, strip === undefined ? {} : { __dshNativeTabs: strip })
  slots.register({ name: 'sidebar.workspaces', priority: 0 }, shippedWorkspaces)
  slots.register({ name: 'sidebar.settings', priority: 0 }, root)
  // The shipped Conversation occupies the keyed main panel under the reserved
  // 'conversation' key and declares the composer seats below it, mirroring
  // the 0.1.5 ui-layout + ui-conversation tree.
  slots.register({ name: 'main', key: 'conversation', priority: 0, children: {
    'main.conversation': { kind: 'single', scope: 'session-maybe' },
  } } as never, root)
  slots.register({ name: 'main.conversation', priority: 0, children: {
    'conversation.composer.bar': { kind: 'single', scope: 'session-maybe' },
    'conversation.input.dock': { kind: 'list', scope: 'session' },
  } } as never, root)
  return { ctx, slots, uiWorkspace }
}


function nativeStrip() {
  const inserted: string[] = []
  const renders: Array<(props: unknown) => unknown> = []
  return {
    inserted,
    renders,
    registry: {
      version: 1,
      getTabs: () => inserted.map(id => ({ id })),
      subscribe: () => () => {},
      insert: (tab: { id: string; render: (props: unknown) => unknown }) => {
        inserted.push(tab.id)
        renders.push(tab.render)
        return () => { inserted.splice(inserted.indexOf(tab.id), 1) }
      },
    },
  }
}

/**
 * The seat the Team tab's body is built from: the strip calls the tab's render,
 * the element it returns is the slot boundary, and the body inside carries the
 * share the Channel list picks and opens Member views through.
 */
function tabSeat(strip: ReturnType<typeof nativeStrip>): Record<string, (...args: never[]) => unknown> & { channelsOnly: boolean } {
  const guarded = strip.renders[0]!({}) as { props: { slot: string; children: { props: Record<string, unknown> } } }
  expect(guarded.props.slot).toBe('native-tab')
  return guarded.props.children.props as never
}

describe('Team Client slot takeover', () => {
  it('enters and leaves Team mode by shadowing only the conversation, with the sidebar left alone', async () => {
    const { ctx, slots } = await bench()
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    expect(slots.entriesOfSlot('sidebar.workspaces')).toHaveLength(1)
    // The shell keeps one sidebar: the Team adds nothing to its section seat,
    // in or out of the mode.
    expect(slots.entries(SECTIONS)).toHaveLength(0)
    // The Team page and Team Settings main seats are registered for the life of
    // the client, beside the shipped conversation seat the mode shadows when it
    // opens. With no native tab strip, the rail keeps the fallback Team row
    // beside the Team Settings row.
    expect(slots.entriesOfSlot('main')).toHaveLength(3)
    expect(slots.entriesOfSlot('sidebar.settings')).toHaveLength(1)
    expect(slots.entries('sidebar.panellist')).toHaveLength(2)

    ctx.teamNavigation.actions().enterTeam()
    // Entering the mode swaps nothing in the sidebar: no Team section, no
    // shadow of the shipped browser, no shadow of its footer.
    expect(slots.entries(SECTIONS)).toHaveLength(0)
    expect(slots.entries('sidebar.workspaces')).toHaveLength(1)
    expect(slots.entries('sidebar.workspaces.session.row.action')).toHaveLength(0)
    expect(slots.entriesOfSlot('sidebar.workspaces')[0]!.options.priority).toBe(0)
    expect(slots.entries('main')).toHaveLength(4)
    expect(slots.entries('sidebar.settings')).toHaveLength(1)

    ctx.teamNavigation.actions().leaveTeam()
    expect(slots.entries(SECTIONS)).toHaveLength(0)
    expect(slots.entries('sidebar.workspaces')).toHaveLength(1)
    expect(slots.entries('main')).toHaveLength(3)
    expect(slots.entries('sidebar.settings')).toHaveLength(1)

    await fiber.dispose()
    expect(slots.entries(SECTIONS)).toHaveLength(0)
    expect(slots.spec('sidebar.workspaces.directoryFlow')).toBeUndefined()
  })

  it('fails loudly when another takeover claims a Team primary seat at the same priority', async () => {
    const { ctx, slots } = await bench()
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    ctx.teamNavigation.actions().enterTeam()
    expect(() => slots.register({ name: 'main', key: 'conversation', priority: -100 }, () => null))
      .toThrow(/already has an (?:registration|entry).*priority -100/i)
  })

  it('repeats enter and leave without leaking shadows, then restores every shipped seat on unload', async () => {
    const { ctx, slots } = await bench()
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    for (let index = 0; index < 3; index += 1) {
      ctx.teamNavigation.actions().enterTeam()
      expect(slots.entriesOfSlot('main')[0]!.options.priority).toBe(-100)
      ctx.teamNavigation.actions().leaveTeam()
      expect(slots.entries('sidebar.workspaces')).toHaveLength(1)
      expect(slots.entries('main')).toHaveLength(3)
      expect(slots.entries('sidebar.settings')).toHaveLength(1)
    }
    ctx.teamNavigation.actions().enterTeam()
    await fiber.dispose()
    expect(slots.entries('sidebar.workspaces')).toHaveLength(1)
    expect(slots.entries('main')).toHaveLength(1)
    expect(slots.entries('sidebar.settings')).toHaveLength(1)
    expect(slots.entries('sidebar.panellist')).toHaveLength(0)
  })

  it('mounts Team shadows immediately when persisted mode is Team', async () => {
    const { ctx, slots } = await bench(JSON.stringify({ mode: 'team', workspaceId: 'workspace:one' }))
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(ctx.teamNavigation.getSnapshot().mode).toBe('team')
    expect(slots.entries('main')).toHaveLength(4)
    await fiber.dispose()
    expect(slots.entries('main')).toHaveLength(1)
  })

  it('keeps Team chrome mounted for a Member Session view and restores the return session on leave', async () => {
    const strip = nativeStrip()
    const { ctx, slots, uiWorkspace } = await bench(null, strip.registry)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const sessions = ctx.get('sessions') as unknown as {
      list: { getSnapshot: () => { byId?: Record<string, unknown> } }
    }
    // The root restore owner reads the list snapshot's `mainView` retention
    // (the 0.1.7 selection projection) before rebinding, so the bench's list
    // double carries the selected row.
    sessions.list.getSnapshot = () => ({ byId: { 'session:human-origin': { id: 'session:human-origin', retainedBy: { mainView: 1 } } } })

    ctx.teamNavigation.actions().selectWorkspace('workspace:one' as never)
    ctx.teamNavigation.actions().enterTeam()

    // Drive the real wiring through the Team tab's seat — the share the Agent
    // card button consumed when the Agents panel was mounted.
    const injected = tabSeat(strip)
    ;(injected.openMemberSession as (sessionId: string) => void)('session:builder')

    expect(uiWorkspace.openSession).toHaveBeenCalledWith('session:builder')
    expect(ctx.teamNavigation.getSnapshot()).toMatchObject({ mode: 'team', memberSessionId: 'session:builder', returnToSessionId: 'session:human-origin' })
    // The conversation shadow yields to the shipped root while both sidebars
    // stay; the panels' own seats are not the shadow and keep their registration.
    expect(slots.entries('main')).toHaveLength(3)
    // The Member view registers no composer surface at all: the shipped
    // InputBar owns the bar, its trigger overlay, and the dock — the Team
    // chrome is sidebar-only around the embedded session.
    expect(slots.entries('conversation.composer.bar')).toHaveLength(0)
    expect(slots.entries('conversation.input.dock')).toHaveLength(0)
    // Direct Member-to-Member navigation keeps the zero-surface invariant.
    sessions.list.getSnapshot = () => ({ byId: { 'session:reviewer': { id: 'session:reviewer', retainedBy: { mainView: 1 } }, 'session:human-origin': {} } })
    ctx.teamNavigation.actions().enterMemberSession('session:reviewer' as never)
    expect(slots.entries('conversation.input.dock')).toHaveLength(0)
    expect(slots.entries('sidebar.workspaces')).toHaveLength(1)
    expect(slots.entries(SECTIONS)).toHaveLength(0)
    expect(slots.entries('sidebar.settings')).toHaveLength(1)

    // The tab's wrapped leave closes the Member view, clears the panel, and
    // restores the Human's original session before deregistering the chrome.
    ;(injected.leaveTeam as () => void)()

    expect(uiWorkspace.openSession).toHaveBeenLastCalledWith('session:human-origin')
    expect(ctx.teamNavigation.getSnapshot()).toEqual({ mode: 'conversation', workspaceId: 'workspace:one' })
    expect(slots.entries('conversation.input.dock')).toHaveLength(0)
    expect(slots.entriesOfSlot('main')).toHaveLength(3)
    expect(slots.entries('sidebar.workspaces')).toHaveLength(1)

    await fiber.dispose()
  })

  it('never captures a Member Session as the return target when the main view still retains one', async () => {
    const strip = nativeStrip()
    const { ctx, uiWorkspace } = await bench(null, strip.registry)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const sessions = ctx.get('sessions') as unknown as {
      list: { getSnapshot: () => { byId?: Record<string, unknown> } }
    }
    ctx.teamNavigation.actions().selectWorkspace('workspace:one' as never)
    ctx.teamNavigation.actions().enterTeam()
    const injected = tabSeat(strip)
    // Nothing is retained yet, so this first entry has no return target at all.
    ;(injected.openMemberSession as (sessionId: string) => void)('session:builder')
    expect(uiWorkspace.openSession).toHaveBeenCalledWith('session:builder')
    expect(ctx.teamNavigation.getSnapshot()).toMatchObject({ mode: 'team', memberSessionId: 'session:builder' })
    expect(ctx.teamNavigation.getSnapshot().returnToSessionId).toBeUndefined()

    // The workspace service retains the Member's session, and leaving the view
    // restores nothing (there was no return target), so the retention stays on
    // the departed Member — the state the next entry must not read as the
    // Human's own conversation.
    sessions.list.getSnapshot = () => ({ byId: { 'session:builder': { id: 'session:builder', retainedBy: { mainView: 1 } } } })
    ctx.teamNavigation.actions().exitMemberSession()
    expect(uiWorkspace.openSession).toHaveBeenCalledTimes(1)

    // A second Member entry therefore captures no return target: returning into
    // another Member's session would strand the Human one view deeper instead
    // of back at their own conversation.
    ;(injected.openMemberSession as (sessionId: string) => void)('session:reviewer')
    expect(ctx.teamNavigation.getSnapshot()).toMatchObject({ mode: 'team', memberSessionId: 'session:reviewer' })
    expect(ctx.teamNavigation.getSnapshot().returnToSessionId).toBeUndefined()
    expect(uiWorkspace.openSession).toHaveBeenLastCalledWith('session:reviewer')

    await fiber.dispose()
  })

  it('exits an embedded Member Session view when explicit Team navigation arrives', async () => {
    const { ctx, slots } = await bench()
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    ctx.teamNavigation.actions().enterTeam()
    ctx.teamNavigation.actions().enterMemberSession('session:builder' as never, 'session:return' as never)
    expect(slots.entries('main')).toHaveLength(3)

    ctx.teamNavigation.actions().selectChannel('channel:engineering' as never)
    expect(ctx.teamNavigation.getSnapshot().memberSessionId).toBeUndefined()
    expect(slots.entries('main')).toHaveLength(4)

    await fiber.dispose()
  })
})

describe('Team Settings rail row', () => {
  type PanelRow = { options: { id: string; label: () => string } }
  const panelRows = (slots: SlotRegistry) => slots.entries('sidebar.panellist') as unknown as PanelRow[]
  const panel = (ctx: Context) => ctx.get('layout') as unknown as {
    selectPanel: (id: string | null) => void
    panelInfo: { getSnapshot: () => { activePanelId: string | null } }
  }
  it('registers the rail row as Team Settings with a locale thunk, and its page as a main seat', async () => {
    const { registry } = nativeStrip()
    const { ctx, slots } = await bench(null, registry)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    const rows = panelRows(slots)
    expect(rows.map(row => row.options.id)).toEqual(['agent-team-settings'])
    // A thunk, not a captured string: a language switch relabels the row.
    expect(typeof rows[0]!.options.label).toBe('function')
    const locale = ctx.get('locale') as LocaleRuntime
    expect(rows[0]!.options.label()).toBe(locale.bind('team' as never)('teamSettingsGroup' as never))
    expect(slots.entriesOfSlot('main').map(entry => (entry.options as { key?: string }).key))
      .toEqual(expect.arrayContaining(['agent-team', 'agent-team-settings', 'conversation']))

    await fiber.dispose()
    expect(slots.entries('sidebar.panellist')).toHaveLength(0)
  })

  it('keeps the fallback Team row while no native tab strip is there, and drops it once the tab is inserted', async () => {
    const without = await bench()
    const plain = without.ctx.plugin({ inject: [...inject], apply })
    await plain.await()
    expect(panelRows(without.slots).map(row => row.options.id).sort()).toEqual(['agent-team', 'agent-team-settings'])
    await plain.dispose()

    const strip = nativeStrip()
    const withStrip = await bench(null, strip.registry)
    const fiber = withStrip.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(strip.inserted).toHaveLength(1)
    expect(panelRows(withStrip.slots).map(row => row.options.id)).toEqual(['agent-team-settings'])
    await fiber.dispose()
  })

  it('opens Team Settings without leaving Team mode, and a Channel pick from the tab hands the column back to the Team page', async () => {
    const strip = nativeStrip()
    const { ctx, slots } = await bench(null, strip.registry)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const layout = panel(ctx)
    const seat = tabSeat(strip)

    ctx.teamNavigation.actions().enterTeam()
    layout.selectPanel('agent-team-settings')
    expect(ctx.teamNavigation.getSnapshot().mode).toBe('team')

    ;(seat.selectChannel as (ref: string) => void)('channel:engineering')
    // The Team page is the Team main seat standing in for the conversation: the
    // settings panel lets go of the column, and no Team panel is selected.
    expect(layout.panelInfo.getSnapshot().activePanelId).toBeNull()
    expect(ctx.teamNavigation.getSnapshot()).toMatchObject({ mode: 'team', channelRef: 'channel:engineering' })
    expect(slots.entries(SECTIONS)).toHaveLength(0)

    // Re-picking the Channel already open still brings the page back.
    layout.selectPanel('agent-team-settings')
    ;(seat.selectChannel as (ref: string) => void)('channel:engineering')
    expect(layout.panelInfo.getSnapshot().activePanelId).toBeNull()

    await fiber.dispose()
  })

  it('enters Team mode from a plain conversation when the tab picks a Channel, without selecting the Team panel or mounting a Team section', async () => {
    const strip = nativeStrip()
    const { ctx, slots } = await bench(null, strip.registry)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(ctx.teamNavigation.getSnapshot().mode).toBe('conversation')

    const element = tabSeat(strip)
    expect(element.channelsOnly).toBe(true)
    ;(element.selectChannel as (ref: string) => void)('channel:engineering')

    // The one-sidebar contract: the pick opens the Channel in the main column and
    // nothing else changes around it.
    expect(panel(ctx).panelInfo.getSnapshot().activePanelId).toBeNull()
    expect(panel(ctx).selectPanel).not.toHaveBeenCalledWith('agent-team')
    expect(ctx.teamNavigation.getSnapshot()).toMatchObject({ mode: 'team', channelRef: 'channel:engineering' })
    expect(slots.entries(SECTIONS)).toHaveLength(0)
    expect(slots.entries('sidebar.settings')).toHaveLength(1)
    expect(slots.entries('main')).toHaveLength(4)

    // A Workspace switch from a plain conversation only rescopes the list.
    ;(element.leaveTeam as () => void)()
    expect(ctx.teamNavigation.getSnapshot().mode).toBe('conversation')
    ;(element.selectWorkspace as (id: string) => void)('workspace:one')
    expect(ctx.teamNavigation.getSnapshot().mode).toBe('conversation')
    await fiber.dispose()
  })

  it('ends Team mode when the Human opens a plain Session, and re-enters on the next Channel pick', async () => {
    const strip = nativeStrip()
    const { ctx } = await bench(null, strip.registry)
    const sessions = ctx.get('sessions') as unknown as {
      list: { getSnapshot: () => { byId?: Record<string, unknown> }; subscribe: (listener: () => void) => () => void }
    }
    const listeners = new Set<() => void>()
    let byId: Record<string, unknown> = {}
    sessions.list.getSnapshot = () => ({ byId })
    sessions.list.subscribe = listener => { listeners.add(listener); return () => { listeners.delete(listener) } }
    const select = (id: string | undefined): void => {
      byId = id === undefined ? {} : { [id]: { id, retainedBy: { mainView: 1 } } }
      for (const listener of [...listeners]) listener()
    }
    // The client subscribes when it mounts, so the list double is wired first.
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const seat = tabSeat(strip)

    ;(seat.selectChannel as (ref: string) => void)('channel:engineering')
    expect(ctx.teamNavigation.getSnapshot().mode).toBe('team')

    // The shell's own list opens a Session: the shell retains it as the main view.
    select('session:plain')
    expect(ctx.teamNavigation.getSnapshot().mode).toBe('conversation')

    ;(seat.selectChannel as (ref: string) => void)('channel:engineering')
    expect(ctx.teamNavigation.getSnapshot()).toMatchObject({ mode: 'team', channelRef: 'channel:engineering' })

    // Re-selecting the same Session is not a change, and clearing the selection
    // never ends the mode: only a Session the Human opened does.
    select('session:plain')
    expect(ctx.teamNavigation.getSnapshot().mode).toBe('team')
    select(undefined)
    expect(ctx.teamNavigation.getSnapshot().mode).toBe('team')

    // A Member view is the client's own session change and keeps the mode.
    ctx.teamNavigation.actions().enterMemberSession('session:builder' as never)
    select('session:builder')
    expect(ctx.teamNavigation.getSnapshot()).toMatchObject({ mode: 'team', memberSessionId: 'session:builder' })

    await fiber.dispose()
  })
})

