// @vitest-environment jsdom
//
// The Team tab's label must follow a language switch. The host strip renders
// `children: D.label` as a static string (@michengai/dsh-automation@0.1.61
// `lib/client.js`, byte 662719), so the eager string this client used to pass
// at insert time pinned the label to the boot language while the rail entries
// (same file, `label: () => ctx.locale.bind(NS)('team')`) relabelled. The fix
// passes the thunk in the same shape and re-inserts on a switch; this bench
// mounts the real client, hands it a registry in the owner's own shape, and
// asserts the strip's rendered button text — the surface the reader sees.
//
// The strip half is a double of the owner's tablist: it reads the registry
// through the same useSyncExternalStore pair the owner's shell-rail component
// uses and renders each tab's label straight into a button, which is what
// makes "the label text updates" a DOM measurement rather than a state claim.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import type { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { NativeTabDescriptor } from '../src/client/team-tab.ts'
import { runtimeWithTeam } from './harness.tsx'

usePinnedBrowserLanguages('zh-CN')
afterEach(cleanup)
beforeEach(() => { localStorage.clear() })

/**
 * The owner's registry in its real shape (0.1.61 `pO`): tabs in a Map keyed by
 * id, `insert` replaces in place and notifies, `getTabs` answers from a cache
 * the mutation recomputes — the uSES contract the strip depends on.
 */
function hostRegistry() {
  const tabs = new Map<string, NativeTabDescriptor>()
  const listeners = new Set<() => void>()
  let snapshot: readonly NativeTabDescriptor[] = []
  const publish = (): void => {
    snapshot = [...tabs.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    for (const listener of [...listeners]) listener()
  }
  return {
    getTabs: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    insert: (tab: NativeTabDescriptor) => {
      tabs.set(tab.id, tab)
      publish()
      return () => {
        if (tabs.get(tab.id) === tab) {
          tabs.delete(tab.id)
          publish()
        }
      }
    },
  }
}

/** The owner's tablist read, verbatim in shape: uSES over the registry, label as the button's children. */
function StripDouble({ registry }: { registry: ReturnType<typeof hostRegistry> }) {
  const tabs = useSyncExternalStore(registry.subscribe, registry.getTabs, registry.getTabs)
  return <div role="tablist">
    {tabs.map(tab => <button key={tab.id} type="button" role="tab">{tab.label}</button>)}
  </div>
}

describe('the interim Team tab follows a language switch', () => {
  it('relabels the strip button text when the locale changes', async () => {
    const bench = await runtimeWithTeam({ nativeTabs: false })
    const registry = hostRegistry()
    const locale = bench.runtime.ctx.get('locale') as LocaleRuntime

    // The registry arrives the way the owner's does — attached to the live
    // `sidebar.workspaces` entry (the owner writes the key onto the entry
    // object itself) — and the slot is bumped afterwards so the Team's
    // late-registration subscription re-probes, exactly as the owner's own
    // wrap does when it finishes. The extra entry is shadowed (single slot,
    // lower priority); it exists only to carry the mutation.
    const seat = bench.runtime.slots.entriesOfSlot('sidebar.workspaces')[0]
    expect(seat, 'the shipped workspace seat the owner wraps').toBeDefined()
    ;(seat as unknown as Record<string, unknown>).__dshNativeTabs = registry
    await act(async () => { bench.runtime.slots.register({ name: 'sidebar.workspaces', priority: 5 }, () => null) })
    await waitFor(() => expect(registry.getTabs().map(tab => tab.id)).toContain('team'))

    const strip = render(<StripDouble registry={registry} />)
    // Pinned zh-CN above: the boot language is what the reader first sees.
    expect(strip.getByRole('tab', { name: '团队' })).toBeTruthy()

    await act(async () => { locale.setLocale('en') })
    await waitFor(() => expect(strip.getByRole('tab', { name: 'Teams' })).toBeTruthy())

    // And back: every switch re-resolves, not just the first one.
    await act(async () => { locale.setLocale('zh') })
    await waitFor(() => expect(strip.getByRole('tab', { name: '团队' })).toBeTruthy())
  })
})
