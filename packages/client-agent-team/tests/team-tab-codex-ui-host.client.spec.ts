// @vitest-environment jsdom
//
// The Team tab under `@michengai/dsh-codex-ui`.
//
// codex-ui takes over the sidebar (its patch disables the official `ui-sidebar`),
// and `@michengai/dsh-automation` then stands down from wrapping
// `sidebar.workspaces`, so nothing attaches the private `__dshNativeTabs`
// registry and the Team tab never lands: only the rail rows stay. A codex-ui
// build that hosts the registry on its own `sidebar.workspaces` component
// (the same attach site automation uses) needs no change here — this suite pins
// that the existing discovery finds it, inserts once, and stays quiet when a
// host (today's codex-ui 1.1.33) offers none.
//
// The host double mirrors the codex-ui entry shape read out of its bundle: a
// slot entry `{ component, options, inject, locale }` whose `component` function
// carries the registry, registered at priority -1.

import { describe, expect, it, vi } from 'vitest'
import { AGENTS_TAB_ID, AGENTS_TAB_ORDER, insertTeamTab } from '../src/client/team-tab.ts'
import type { NativeTabDescriptor } from '../src/client/team-tab.ts'

/** The registry factory as codex-ui hosts it: Map keyed by id, order-sorted snapshot, idempotent insert. */
function codexRegistry() {
  const tabs = new Map<string, NativeTabDescriptor>()
  const listeners = new Set<() => void>()
  let sorted: readonly NativeTabDescriptor[] = []
  const publish = (): void => {
    sorted = [...tabs.values()].sort((a, b) => a.order - b.order)
    for (const listener of [...listeners]) listener()
  }
  return {
    version: 1,
    getTabs: () => sorted,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    insert: (tab: NativeTabDescriptor) => {
      tabs.set(tab.id, tab)
      publish()
      return () => { if (tabs.get(tab.id) === tab) { tabs.delete(tab.id); publish() } }
    },
  }
}

/** A slot registry with the two reads and the subscription the module uses. */
function slotHost(initial: readonly unknown[] = []) {
  let entries = initial
  const listeners = new Map<string, Set<() => void>>()
  return {
    slots: {
      entriesOfSlot: (name: string) => (name === 'sidebar.workspaces' ? entries : []),
      subscribe: (name: string, listener: () => void) => {
        const set = listeners.get(name) ?? new Set<() => void>()
        set.add(listener)
        listeners.set(name, set)
        return () => { set.delete(listener) }
      },
    },
    publish: (next: readonly unknown[]) => {
      entries = next
      for (const listener of [...(listeners.get('sidebar.workspaces') ?? [])]) listener()
    },
  }
}

/** codex-ui's `sidebar.workspaces` entry: a component function carrying the registry. */
function codexEntry(registry: ReturnType<typeof codexRegistry> | undefined) {
  const component = function CodexWorkspaceBrowser(): null { return null }
  if (registry !== undefined) (component as unknown as Record<string, unknown>).__dshNativeTabs = registry
  return { component, options: { priority: -1 }, locale: 'michengai-codex-ui' }
}

const noSchedule = (): (() => void) => () => {}

describe('Team tab on a codex-ui host', () => {
  it('lands Team and Agents on the registry codex-ui hangs on its workspaces component', () => {
    const registry = codexRegistry()
    const host = slotHost([codexEntry(registry)])
    const ctx = { slots: host.slots } as never
    const onInserted = vi.fn()

    const disposeTeam = insertTeamTab(ctx, { label: 'Team', render: () => null, onInserted })
    const disposeAgents = insertTeamTab(ctx, { id: AGENTS_TAB_ID, order: AGENTS_TAB_ORDER, label: 'Agents', render: () => null })

    expect(registry.getTabs().map(tab => tab.label)).toEqual(['Team', 'Agents'])
    // The rail's fallback Team row stands down once the tab is in.
    expect(onInserted).toHaveBeenCalledTimes(1)

    disposeAgents()
    disposeTeam()
    expect(registry.getTabs()).toEqual([])
  })

  it('inserts once when two hosts both offer a registry (no double-render)', () => {
    const codex = codexRegistry()
    const wrapped = codexRegistry()
    const host = slotHost([codexEntry(codex), codexEntry(wrapped)])

    insertTeamTab({ slots: host.slots } as never, { label: 'Team', render: () => null })

    expect(codex.getTabs()).toHaveLength(1)
    expect(wrapped.getTabs()).toHaveLength(0)
  })

  it('stands down without throwing when the host offers no registry, and keeps the rail row', () => {
    const host = slotHost([codexEntry(undefined)])
    const onInserted = vi.fn()

    const dispose = insertTeamTab({ slots: host.slots } as never, { label: 'Team', render: () => null, onInserted, schedule: noSchedule })

    expect(onInserted).not.toHaveBeenCalled()
    expect(() => dispose()).not.toThrow()
  })

  it('picks the registry up when codex-ui registers after the Team client activated', () => {
    const registry = codexRegistry()
    const host = slotHost([])
    const onInserted = vi.fn()

    insertTeamTab({ slots: host.slots } as never, { label: 'Team', render: () => null, onInserted, schedule: noSchedule })
    expect(registry.getTabs()).toHaveLength(0)

    host.publish([codexEntry(registry)])

    expect(registry.getTabs().map(tab => tab.id)).toEqual(['team'])
    expect(onInserted).toHaveBeenCalledTimes(1)
  })

  it('removes the tab with the plugin so a later generation does not inherit it', () => {
    const registry = codexRegistry()
    const host = slotHost([codexEntry(registry)])

    const dispose = insertTeamTab({ slots: host.slots } as never, { label: 'Team', render: () => null })
    expect(registry.getTabs()).toHaveLength(1)
    dispose()
    expect(registry.getTabs()).toHaveLength(0)
  })
})
