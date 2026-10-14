import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { apply, inject } from '../src/client/index.ts'

/**
 * The Team's browsing surface is a SECTION of the shell's own column, not a
 * shadow over the shipped browser (Task 10, ruling: "We should not have
 * separated team side bar UI. We should make team UI as native.").
 *
 * The shell declares an additive `sidebar.sections` list seat above its
 * `sidebar.workspaces` browser, and the Team registers into it while Team mode
 * stands. Two facts this suite pins, each with its own red test:
 *
 * 1. The seat is served, not shadowed: while Team mode stands the shipped
 *    browser entry still exists in its own seat at its own priority, so the
 *    browser's rows, its directory-flow child and its session row actions come
 *    back. Nothing about the shell outside team mode changes.
 * 2. The rail expand path: `sidebar.sections`'s owner share is only
 *    `{ wide }`, so the shell's guarded `expandSidebar` never reaches this
 *    seat. The rail icons call `expandSidebar` and the section must supply one
 *    that actually expands a collapsed column.
 */

/**
 * The shell's section seat, widened the way the client widens it: a harness
 * that ships no seat (CI's upstream tag) has no `sidebar.sections` in its
 * SlotMap, and this bench declares the seat itself, so the name is portable.
 */
const SECTIONS = 'sidebar.sections' as never

function layoutFace() {
  const listeners = new Set<() => void>()
  let sidebar = 0
  return {
    toggleSidebar: (): void => { sidebar = sidebar === 0 ? 280 : 0; for (const listener of listeners) listener() },
    getSnapshot: () => ({ sidebar }),
  }
}

async function bench() {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} })
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime(ctx))
  ctx.provide('remote', { $mount: async () => async () => {} } as never)
  ctx.provide('remote.agentTeam', {})
  ctx.provide('remote.session', { modelCatalog: async () => ({ ok: true, value: { groups: [], failures: [] } }) } as never)
  ctx.provide('remote.commands', { list: async () => ({ ok: true, value: [] }) })
  ctx.provide('remote.skills', { list: async () => ({ ok: true, value: { skills: [] } }) })
  ctx.provide('conversation', { input: { for: () => ({ submit: () => {} }) } } as never)
  ctx.provide('sessions', { list: { getSnapshot: () => ({ byId: {} }), subscribe: () => () => {} } } as never)
  ctx.provide('uiWorkspace', { openSession: () => {}, startSession: () => {}, connectWorkspace: async () => 'workspace:one' } as never)
  const layout = layoutFace()
  ctx.provide('layout', {
    toggleSidebar: layout.toggleSidebar,
    selectPanel: () => {},
    panelInfo: { getSnapshot: () => ({ activePanelId: null }), subscribe: () => () => {} },
  } as never)
  ctx.provide('connection', { api: { llm: { models: async () => ({ result: { ok: true, value: { groups: [], failures: [] } } }) } } } as never)
  ctx.provide('workspaces', {
    list: { getSnapshot: () => ({ items: [{ workspaceId: 'workspace:one', title: 'One', path: '/one', sessionIds: [], createdAt: '', updatedAt: '' }], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null, baselinesReady: true, recentWorkspaceId: undefined }), subscribe: () => () => {} },
    pickDirectory: async () => null,
    create: () => {},
  } as never)
  const slots = ctx.get('slots') as SlotRegistry
  const root = () => null
  slots.register({ name: 'root', children: { sidebar: { kind: 'single', scope: 'root' }, main: { kind: 'keyed', scope: 'root' } } } as never, root)
  slots.register({ name: 'sidebar', children: {
    'sidebar.workspaces': { kind: 'single', scope: 'root' },
    'sidebar.sections': { kind: 'list', scope: 'root' },
    'sidebar.settings': { kind: 'single', scope: 'root' },
    'sidebar.panellist': { kind: 'list', scope: 'root' },
  } } as never, root)
  // The shipped Workspace browser, with the children it declares. Team mode no
  // longer shadows this entry, so every one of its declarations stands.
  const shippedBrowser = () => null
  slots.register({ name: 'sidebar.workspaces', priority: 0, children: {
    'sidebar.workspaces.directoryFlow': { kind: 'single', scope: 'root' },
    'sidebar.workspaces.session.menu.item': { kind: 'list', scope: 'root' },
    'sidebar.workspaces.session.row.action': { kind: 'list', scope: 'root' },
  } } as never, shippedBrowser)
  slots.register({ name: 'sidebar.settings', priority: 0 }, root)
  slots.register({ name: 'main', key: 'conversation', priority: 0 }, root)
  return { ctx, slots, layout }
}

describe('Team section seat (native sidebar, no shadow)', () => {
  it('serves the browser beside it instead of shadowing it', async () => {
    const { ctx, slots } = await bench()
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    // Team mode down: the section seat is empty and the shipped browser is alone.
    expect(slots.entries(SECTIONS)).toHaveLength(0)
    expect(slots.entriesOfSlot('sidebar.workspaces')).toHaveLength(1)
    expect(slots.entriesOfSlot('sidebar.workspaces')[0]!.options.priority).toBe(0)
    // The browser's own children exist before Team mode too.
    expect(slots.spec('sidebar.workspaces.directoryFlow')).toEqual({ kind: 'single', scope: 'root' })

    ctx.teamNavigation.actions().enterTeam()

    // Team mode up: the Team section is ADDED, and the shipped browser is still
    // there at its own priority — no shadow replaces it.
    expect(slots.entries(SECTIONS)).toHaveLength(1)
    expect(slots.entriesOfSlot(SECTIONS)[0]!.options.id).toBe('team')
    expect(slots.entriesOfSlot(SECTIONS)[0]!.options.priority).toBe(-100)
    expect(slots.entries('sidebar.workspaces')).toHaveLength(1)
    expect(slots.entriesOfSlot('sidebar.workspaces')[0]!.options.priority).toBe(0)
    // The browser's declarations were never displaced, so its rows keep standing.
    expect(slots.spec('sidebar.workspaces.directoryFlow')).toEqual({ kind: 'single', scope: 'root' })
    expect(slots.spec('sidebar.workspaces.session.row.action')).toEqual({ kind: 'list', scope: 'root' })

    ctx.teamNavigation.actions().leaveTeam()
    expect(slots.entries(SECTIONS)).toHaveLength(0)
    expect(slots.entries('sidebar.workspaces')).toHaveLength(1)

    await fiber.dispose()
    expect(slots.entries(SECTIONS)).toHaveLength(0)
    expect(slots.entries('sidebar.workspaces')).toHaveLength(1)
  })

  it('supplies a working expandSidebar for the collapsed rail', async () => {
    const { ctx, slots, layout } = await bench()
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    ctx.teamNavigation.actions().enterTeam()

    // The collapsed rail's Inbox icon asks for expansion. The section seat's
    // owner share is only { wide } — the shell passes its guarded expandSidebar
    // to the browser, never here — so the section must carry its own.
    const section = slots.entriesOfSlot(SECTIONS)[0]
    expect(section).toBeDefined()
    const injected = (section!.inject as () => Record<string, unknown>)()
    expect(typeof injected.expandSidebar).toBe('function')

    expect(layout.getSnapshot().sidebar).toBe(0)
    ;(injected.expandSidebar as () => void)()
    expect(layout.getSnapshot().sidebar).toBe(280)

    await fiber.dispose()
  })

  it('keeps the section mounted across a Member Session view and drops it on unload', async () => {
    const { ctx, slots } = await bench()
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    ctx.teamNavigation.actions().enterTeam()
    ctx.teamNavigation.actions().enterMemberSession('session:builder' as never)
    expect(slots.entries(SECTIONS)).toHaveLength(1)
    expect(slots.entries('sidebar.workspaces')).toHaveLength(1)

    await fiber.dispose()
    expect(slots.entries(SECTIONS)).toHaveLength(0)
  })
})
