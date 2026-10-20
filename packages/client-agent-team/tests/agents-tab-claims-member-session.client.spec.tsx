// @vitest-environment jsdom
//
// A press on an Agent opens its Member Session, and the host strip then
// re-selects a tab for the new main session: @michengai/dsh-automation@0.1.61
// (`lib/client.js`, the effect after `useRef(x)`) sets Tasks for any session
// no tab claims, and switches to the tab whose `matchSession` accepts it. The
// Agents tab used to answer `matchSession: () => false`, so every Agent press
// left the Agents tab for Tasks (human fact 4160). This bench mounts the real
// client against a registry in the owner's shape and applies the owner's rule.
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, waitFor } from '@testing-library/react'
import type { NativeTabDescriptor } from '../src/client/team-tab.ts'
import { runtimeWithTeam } from './harness.tsx'

afterEach(cleanup)

function hostRegistry() {
  const tabs = new Map<string, NativeTabDescriptor>()
  const listeners = new Set<() => void>()
  let snapshot: readonly NativeTabDescriptor[] = []
  const publish = (): void => { snapshot = [...tabs.values()]; for (const listener of [...listeners]) listener() }
  return {
    getTabs: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    insert: (tab: NativeTabDescriptor) => { tabs.set(tab.id, tab); publish(); return () => { if (tabs.get(tab.id) === tab) { tabs.delete(tab.id); publish() } } },
  }
}

/** The owner's rule when the main session changes: Tasks, unless a tab claims the session. */
const selectedTab = (tabs: readonly NativeTabDescriptor[], sessionId: string): string =>
  tabs.find(tab => tab.matchSession?.(sessionId) === true)?.id ?? 'tasks'

describe('the Agents tab claims the open Member Session', () => {
  it('keeps the strip on Agents for a Member Session and drops to Tasks for any other session', async () => {
    const bench = await runtimeWithTeam({ nativeTabs: false })
    const registry = hostRegistry()
    const seat = bench.runtime.slots.entriesOfSlot('sidebar.workspaces')[0]
    ;(seat as unknown as Record<string, unknown>).__dshNativeTabs = registry
    await act(async () => { bench.runtime.slots.register({ name: 'sidebar.workspaces', priority: 5 }, () => null) })
    await waitFor(() => expect(registry.getTabs().map(tab => tab.id)).toContain('agents'))

    const nav = bench.runtime.ctx.teamNavigation
    // Before any press nothing is claimed.
    expect(selectedTab(registry.getTabs(), 'agent-a')).toBe('tasks')
    // A press navigates to the Member Session before the host binds it.
    act(() => { nav.actions().enterMemberSession('agent-a' as never) })
    expect(selectedTab(registry.getTabs(), 'agent-a')).toBe('agents')
    // Member Session to Member Session.
    act(() => { nav.actions().enterMemberSession('agent-b' as never) })
    expect(selectedTab(registry.getTabs(), 'agent-b')).toBe('agents')
    // An ordinary session is never claimed, and neither is the previous Member Session.
    expect(selectedTab(registry.getTabs(), 'ordinary')).toBe('tasks')
    expect(selectedTab(registry.getTabs(), 'agent-a')).toBe('tasks')
    // The Team tab still claims nothing.
    expect(registry.getTabs().find(tab => tab.id === 'team')?.matchSession?.('agent-b')).toBe(false)
  })
})
