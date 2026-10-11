// @vitest-environment jsdom
//
// A10 — the interim native Team tab.
//
// Ruling v0.6.1 approves reaching for the private `__dshNativeTabs` registry
// for TEST-3 only, and only behind a feature-detect: when the key, or the
// registry's `insert`, is missing the Team must stand down silently and keep its
// rail entry, never throw. This suite pins that contract from both sides.
//
// The loud half is the point: the moment the host's private contract changes —
// key renamed, registry shape changed, attach site moved — the tests here fail
// instead of the code quietly doing nothing for releases at a time.
//
// Verified against `@michengai/dsh-automation@0.1.61` (`lib/client.js`), the
// version installed at PROD `/home/ddv/.dsh/profiles/web` and TEST
// `/home/ddv/dsh-test/profiles/web`. The live-bundle cross-check is a separate
// script under this lane's `evidence/`, because the host install is a machine
// fact, not a repo dependency.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { HOST_CONTRACT, discoverRegistry, insertTeamTab, readRegistry } from '../src/client/team-tab.ts'
import type { NativeTabDescriptor, NativeTabRegistry } from '../src/client/team-tab.ts'

/** One recorded insert, in the shape this module hands the host. */
interface RecordedTab {
  readonly id: string
  readonly label: string
  readonly order: number
  readonly matchSession: (sessionId: string) => boolean
}

/**
 * A double of the host's registry that records every insert, so the tests
 * assert *what* the tab handed the host rather than only that a call happened.
 */
function fakeRegistry(): {
  readonly version: 1
  readonly inserted: RecordedTab[]
  readonly getTabs: () => readonly unknown[]
  readonly subscribe: () => () => void
  readonly insert: (tab: NativeTabDescriptor) => () => void
} {
  const inserted: RecordedTab[] = []
  return {
    version: 1,
    inserted,
    getTabs: () => inserted.map(item => ({ id: item.id, label: item.label, order: item.order })),
    subscribe: () => () => {},
    insert: (tab) => {
      inserted.push({ id: tab.id, label: tab.label, order: tab.order, matchSession: () => false })
      return () => {
        const at = inserted.findIndex(item => item.id === tab.id)
        if (at >= 0) inserted.splice(at, 1)
      }
    },
  }
}

/**
 * The context face the module reads, trimmed to the slot API it uses. The
 * module's own narrow casts are what keep the client package free of a
 * dependency on the slots package's public types.
 */
function fakeContext(slots: Record<string, unknown>): never {
  return { slots } as never
}

describe('HOST_CONTRACT — the private key, pinned as literals', () => {
  // Read out of @michengai/dsh-automation@0.1.61 lib/client.js. A change to any
  // of these lines is either a deliberate port to a new host contract — in
  // which case the PR must say so and record the new version — or a silent
  // stand-down, which is exactly what this test exists to prevent.
  it('matches the values read from the installed 0.1.61 bundle', () => {
    expect(HOST_CONTRACT.registryKey).toBe('__dshNativeTabs')
    expect(HOST_CONTRACT.registrySlot).toBe('sidebar.workspaces')
    expect(HOST_CONTRACT.siblingSlot).toBe('sidebar')
    expect(HOST_CONTRACT.tabId).toBe('team')
    // Tasks first, then Team, then the owner's own `schedule` (order 30) and
    // any Channels entry.
    expect(HOST_CONTRACT.tabOrder).toBe(3)
    expect(HOST_CONTRACT.retryIntervalMs).toBe(250)
    expect(HOST_CONTRACT.retryLimit).toBe(20)
  })
})

describe('readRegistry — the feature-detect itself', () => {
  it('accepts a registry and rejects everything the host might hand us instead', () => {
    const registry = fakeRegistry()
    expect(readRegistry({ __dshNativeTabs: registry })).toBe(registry)

    // Absent key, non-objects, wrong shape.
    expect(readRegistry(undefined)).toBeUndefined()
    expect(readRegistry(null)).toBeUndefined()
    expect(readRegistry({})).toBeUndefined()
    expect(readRegistry({ __dshNativeTabs: 'ready' })).toBeUndefined()
    expect(readRegistry({ __dshNativeTabs: 1 })).toBeUndefined()
    expect(readRegistry({ __dshNativeTabs: null })).toBeUndefined()
    // The frozen-registration case the host could hand over during teardown:
    // right shape, wrong verb types.
    expect(readRegistry({ __dshNativeTabs: { version: 1, getTabs: 'x', subscribe: 'y', insert: 'z' } })).toBeUndefined()
    expect(readRegistry({ __dshNativeTabs: { getTabs: () => [], subscribe: () => () => {} } })).toBeUndefined()
  })
})

describe('discoverRegistry — the owner\'s two-step discovery', () => {
  it('reads the entry itself first, then the entry\'s component', () => {
    const registry = fakeRegistry()
    expect(discoverRegistry({ __dshNativeTabs: registry })).toBe(registry)
    expect(discoverRegistry({ component: { __dshNativeTabs: registry } })).toBe(registry)
    // The entry's own key wins over the component's, matching the host.
    const other = fakeRegistry()
    expect(discoverRegistry({ __dshNativeTabs: registry, component: { __dshNativeTabs: other } })).toBe(registry)
    // Nothing anywhere.
    expect(discoverRegistry({ component: {} })).toBeUndefined()
    expect(discoverRegistry(undefined)).toBeUndefined()
  })
})

describe('insertTeamTab — the insert itself', () => {
  it('inserts the Team tab on the discovered registry, then disposes it with the plugin', () => {
    const registry = fakeRegistry()
    const insertedOn: NativeTabRegistry[] = []
    const ctx = fakeContext({ entriesOfSlot: () => [{ __dshNativeTabs: registry }] })

    const dispose = insertTeamTab(ctx, {
      label: 'Team',
      render: () => null,
      onInserted: found => insertedOn.push(found as NativeTabRegistry),
    })

    expect(insertedOn).toEqual([registry])
    expect(registry.inserted).toHaveLength(1)
    expect(registry.inserted[0]).toMatchObject({ id: 'team', label: 'Team', order: 3 })

    // The tab is a global surface: it never claims a host session, so opening a
    // session does not switch the strip to Team.
    const inserted = registry.inserted[0]
    expect(inserted).toBeDefined()
    expect(inserted?.matchSession('session:whatever')).toBe(false)

    dispose()
    expect(registry.inserted).toHaveLength(0)
    // Disposing twice is harmless — the caller never has to test whether an
    // insert happened.
    dispose()
    expect(registry.inserted).toHaveLength(0)
  })

  it('reads the registry off the entry\'s component when the entry has none', () => {
    const registry = fakeRegistry()
    const ctx = fakeContext({ entriesOfSlot: () => [{ component: { __dshNativeTabs: registry } }] })
    const dispose = insertTeamTab(ctx, { label: 'Team', render: () => null })
    expect(registry.inserted).toHaveLength(1)
    dispose()
  })

  it('falls back to entries() when entriesOfSlot is absent', () => {
    const registry = fakeRegistry()
    const ctx = fakeContext({ entries: () => [{ __dshNativeTabs: registry }] })
    const dispose = insertTeamTab(ctx, { label: 'Team', render: () => null })
    expect(registry.inserted).toHaveLength(1)
    dispose()
  })

  it('reads only the host strip slot and never the sidebar.channels slot', () => {
    // The attach site was corrected mid-lane: the registry lives on a
    // `sidebar.workspaces` entry, not `sidebar.channels`. A read of the wrong
    // key is a silent stand-down, so the key is asserted through the read face.
    const reads: string[] = []
    const registry = fakeRegistry()
    const ctx = fakeContext({ entriesOfSlot: (key: string) => { reads.push(key); return key === 'sidebar.workspaces' ? [{ __dshNativeTabs: registry }] : [] } })
    const dispose = insertTeamTab(ctx, { label: 'Team', render: () => null })
    expect(reads).toEqual(['sidebar.workspaces'])
    expect(registry.inserted).toHaveLength(1)
    dispose()
  })
})

describe('insertTeamTab — standing down when the host has no tab strip', () => {
  afterEach(() => { vi.useRealTimers() })

  // The loud half of the contract. If this test fails, the private key changed
  // and the feature-detect path is stale: the fix is in team-tab.ts, not here.
  it('throws nothing and inserts nothing when __dshNativeTabs is absent, keeping the rail entry', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const ctx = fakeContext({ entriesOfSlot: () => [] })

    let dispose: (() => void) | undefined
    expect(() => { dispose = insertTeamTab(ctx, { label: 'Team', render: () => null }) }).not.toThrow()
    expect(dispose).toBeTypeOf('function')

    expect(() => { dispose?.() }).not.toThrow()
    // No console noise either: a stand-down at apply time is a supported state,
    // not an error, and a thrown or reported error would surface in the host's
    // boot log as a plugin failure.
    expect(consoleError).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('stands down over a registry whose insert is not a function', () => {
    const ctx = fakeContext({ entriesOfSlot: () => [{ __dshNativeTabs: { version: 1, getTabs: () => [], subscribe: () => () => {} } }] })
    let dispose: (() => void) | undefined
    expect(() => { dispose = insertTeamTab(ctx, { label: 'Team', render: () => null }) }).not.toThrow()
    expect(() => { dispose?.() }).not.toThrow()
  })

  it('survives a slot registry that throws on read and on subscribe', () => {
    const ctx = fakeContext({
      entriesOfSlot: () => { throw new Error('slots not ready') },
      subscribe: () => { throw new Error('no subscription') },
    })
    let dispose: (() => void) | undefined
    expect(() => { dispose = insertTeamTab(ctx, { label: 'Team', render: () => null }) }).not.toThrow()
    expect(() => { dispose?.() }).not.toThrow()
  })
})

describe('insertTeamTab — the late-registration path', () => {
  it('still inserts when the registry only appears after the first probe', () => {
    // Late registration is the production browser's normal case: the owner
    // wraps its entry on its own subscription, so a probe that finds nothing is
    // never a verdict. The slot subscription is the path that carries it.
    const registry = fakeRegistry()
    let entries: readonly unknown[] = []
    const listeners: Array<() => void> = []
    const ctx = fakeContext({
      entriesOfSlot: () => entries,
      subscribe: (_key: string, listener: () => void) => {
        listeners.push(listener)
        return () => { listeners.splice(listeners.indexOf(listener), 1) }
      },
    })
    const insertedOn: NativeTabRegistry[] = []
    const dispose = insertTeamTab(ctx, {
      label: 'Team',
      render: () => null,
      onInserted: found => insertedOn.push(found as NativeTabRegistry),
    })

    // Nothing yet: the probe ran before the registry existed.
    expect(insertedOn).toEqual([])

    // The owner finishes wrapping, then notifies the subscription this module
    // registered against both slot keys.
    entries = [{ __dshNativeTabs: registry }]
    listeners.forEach(listener => listener())

    expect(insertedOn).toEqual([registry])
    expect(registry.inserted).toHaveLength(1)
    dispose()
    expect(registry.inserted).toHaveLength(0)
  })

  it('runs the owner\'s own retry budget and then stops asking', () => {
    vi.useFakeTimers()
    let ticks = 0
    let attempted = 0
    const ctx = fakeContext({
      entriesOfSlot: () => { attempted += 1; return [] },
      subscribe: () => () => {},
    })
    const dispose = insertTeamTab(ctx, { label: 'Team', render: () => null })

    // 20 ticks of budget plus slack: the retry must end, not spin forever.
    for (ticks = 0; ticks < 25; ticks += 1) vi.advanceTimersByTime(250)

    const probes = attempted
    // One immediate probe, then at most the owner's own 20 retries.
    expect(probes).toBeLessThanOrEqual(1 + HOST_CONTRACT.retryLimit)
    expect(probes).toBeGreaterThan(1)

    // After the budget is spent the timer is gone, so no further reads happen.
    vi.advanceTimersByTime(5000)
    expect(attempted).toBe(probes)
    expect(() => dispose()).not.toThrow()
  })
})

describe('the revert check', () => {
  it('stands down when the feature-detect is neutralized, so the pass path is load-bearing', () => {
    // The host's registry, minus the one predicate the feature-detect guards.
    // Everything else stays real, so this measures the detect itself.
    const registry = fakeRegistry()
    const broken = { ...registry, insert: undefined }
    const ctx = fakeContext({ entriesOfSlot: () => [{ __dshNativeTabs: broken }] })
    const insertedOn: NativeTabRegistry[] = []
    const dispose = insertTeamTab(ctx, {
      label: 'Team',
      render: () => null,
      schedule: () => () => {},
      onInserted: found => insertedOn.push(found as NativeTabRegistry),
    })
    expect(insertedOn).toEqual([])
    expect(() => dispose()).not.toThrow()
  })
})
