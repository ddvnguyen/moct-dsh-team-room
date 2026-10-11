/**
 * A10 — the interim Team tab in the host's native tab strip.
 *
 * The Team's home is the sidebar's panel rail (`registerTeamPanel` in
 * `./index.ts`). This module adds the interim *native tab* on top: one extra
 * entry in the strip the automation plugin owns, so a session-scoped sidebar
 * shows a third tab beside Tasks and Scheduled without the Team panel having to
 * win the rail.
 *
 * ## Why a private key (and why it is feature-detected)
 *
 * The strip has no public registration API. Its live registry is reachable only
 * through a private key (`__dshNativeTabs`) that the owning plugin attaches to
 * the `sidebar.workspaces` entry it wraps. Ruling v0.6.1 approves reaching for
 * that key **for TEST-3 only**, and only behind a feature-detect: when the key,
 * or the registry's `insert`, is missing this module does nothing at all and
 * the Team keeps its rail entry. Nothing here may throw, because this code path
 * runs at plugin-apply time, before any seat exists to catch it.
 *
 * `HOST_CONTRACT` below is that private contract as one exported literal. The
 * suite asserts it against the owner's live bundle, which is what turns a
 * private-key change into a red test rather than a silent stand-down.
 *
 * ## The verified attach point (read out of the owner's own bundle)
 *
 * In `@michengai/dsh-automation@0.1.61`'s `lib/client.js`, the wrap routine
 * finds the first `sidebar.workspaces` entry with a `component`, wraps it, and
 * then attaches the registry to that entry **and** to its own wrapper
 * component; its own discovery helper is `KS(entry) ?? KS(entry.component)`
 * (key present AND `typeof insert === 'function'`). It also subscribes to both
 * `sidebar.workspaces` and `sidebar`, and re-probes on a
 * `dsh-native-sidebar-change` window event. This module copies those three
 * facts: the same slot key, the same two-step discovery, and both subscriptions
 * — a probe that finds nothing is never treated as a verdict.
 *
 * ## What this module deliberately does NOT do
 *
 * - No `window.__dshNativeTabs` lookup. The registry is read off the slot entry,
 *   exactly the way the owner discovers it, so a plugin that registers late
 *   still works through the subscription.
 * - No persistence of the selected tab, and no `localStorage` access at all. The
 *   strip owns that through its own `dsh-automation.sidebar-tab` key, read
 *   through a whitelist that maps any unknown value back to `tasks`. Writing a
 *   competing key would collide, so this tab never competes with it.
 * - No import of the Team shell's registered seats. The body renders the Team's
 *   own page (`TeamConversation`) through this package's React tree, fed by the
 *   same inject the registered seat uses.
 *
 * ## Version this was verified against
 *
 * `@michengai/dsh-automation` **0.1.61** — the version installed at PROD
 * (`/home/ddv/.dsh/profiles/web`) and TEST
 * (`/home/ddv/dsh-test/profiles/web`). The key literal, the registry factory
 * (v1: `officialTree`, `sessionFilters`, `getTabs`, `subscribe`, `insert`,
 * `addSessionFilter`), the feature-detect predicate, the tab sort (`order ?? 0`)
 * and the attach site are all read out of that build's `lib/client.js`.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'

/** The private registry key, spelled once. Verified against 0.1.61's `lib/client.js`. */
export const REGISTRY_KEY = '__dshNativeTabs'

/**
 * The slot key whose entries carry the registry. Verified: the owner wraps the
 * first `sidebar.workspaces` entry that has a component and attaches there.
 */
export const REGISTRY_SLOT = 'sidebar.workspaces'

/** The other slot the owner subscribes to; a change there can re-mount the wrapper. */
export const PARENT_SLOT = 'sidebar'

/**
 * This tab's id. The strip renders `Tasks` first, inserted tabs in registry
 * order, `Channels` when it is ready, and `schedule` last; `order` decides the
 * slot between Tasks and Channels. 3 puts Team after Tasks and before the
 * automation plugin's own `schedule` (order 30) and any Channels entry.
 */
export const TAB_ID = 'team'
export const TAB_ORDER = 3

/** Retry budget, mirroring the owner plugin's own 20 × 250 ms schedule. */
const RETRY_INTERVAL_MS = 250
const RETRY_LIMIT = 20

/**
 * The host contract these constants encode, in one place. The spec asserts it
 * against the values read out of `@michengai/dsh-automation@0.1.61`'s
 * `lib/client.js`, so a private-key rename, a moved attach site or a changed
 * tab order fails the suite loudly instead of silently standing down.
 */
export const HOST_CONTRACT = {
  registryKey: REGISTRY_KEY,
  registrySlot: REGISTRY_SLOT,
  siblingSlot: PARENT_SLOT,
  tabId: TAB_ID,
  tabOrder: TAB_ORDER,
  retryIntervalMs: RETRY_INTERVAL_MS,
  retryLimit: RETRY_LIMIT,
} as const

/** The minimum shape this module needs. Structural, so a newer registry stays usable. */
export interface NativeTabRegistry {
  readonly version?: number
  getTabs: () => readonly unknown[]
  subscribe: (listener: () => void) => () => void
  insert: (tab: NativeTabDescriptor) => () => void
}

/** The one tab this module contributes. Extra fields are ignored by the host. */
export interface NativeTabDescriptor {
  readonly id: string
  readonly label: string
  readonly order: number
  readonly matchSession?: (sessionId: string) => boolean
  readonly render: (props: never) => unknown
}

/**
 * The host's render props, re-exported from the body module so a caller of this
 * one (the client entry) needs a single import for "the tab and what it hands
 * the body". The body owns the shape; this module only forwards it.
 */
export type { NativeTabRenderProps } from './team-tab-body.tsx'

/**
 * The feature-detect, copied in shape from the owner plugin: the value must be
 * an object whose `insert` is a function. Anything else (absent key, a stub, a
 * frozen registration object) reads as "no registry" and the caller stands
 * down.
 */
export function readRegistry(holder: unknown): NativeTabRegistry | undefined {
  if (holder === null || (typeof holder !== 'object' && typeof holder !== 'function')) return undefined
  const candidate = (holder as Record<string, unknown>)[REGISTRY_KEY]
  if (candidate === null || typeof candidate !== 'object') return undefined
  const registry = candidate as Partial<NativeTabRegistry>
  return typeof registry.insert === 'function' && typeof registry.getTabs === 'function' && typeof registry.subscribe === 'function'
    ? (registry as NativeTabRegistry)
    : undefined
}

/** The owner's two-step discovery: the entry itself, else the entry's component. */
export function discoverRegistry(entry: unknown): NativeTabRegistry | undefined {
  return readRegistry(entry) ?? readRegistry((entry as { component?: unknown } | undefined)?.component)
}

/**
 * Slot entries for one key, never throwing. `entriesOfSlot` is the owner's own
 * first choice and exists on the renderer's registry; `entries` is the fallback
 * the owner itself uses.
 */
function slotEntries(ctx: ClientContext, key: string): readonly unknown[] {
  try {
    const slots = ctx.slots as unknown as {
      entriesOfSlot?: (key: string) => readonly unknown[]
      entries?: (key: string) => readonly unknown[]
    } | undefined
    const read = slots?.entriesOfSlot ?? slots?.entries
    return typeof read === 'function' ? read.call(slots, key) : []
  } catch {
    return []
  }
}

/** Subscribe to one slot key, never throwing; a missing or broken `subscribe` yields no cleanup. */
function slotSubscribe(ctx: ClientContext, key: string, listener: () => void): (() => void) | undefined {
  try {
    const slots = ctx.slots as unknown as {
      subscribe?: (key: string, listener: () => void) => (() => void) | undefined
    } | undefined
    const unsubscribe = typeof slots?.subscribe === 'function' ? slots.subscribe(key, listener) : undefined
    return typeof unsubscribe === 'function' ? unsubscribe : undefined
  } catch {
    return undefined
  }
}

/** Options the tests inject; production callers pass only `label` and `render`. */
export interface TeamTabOptions {
  /** The localized tab label. */
  readonly label: string
  /** Renders the tab body from the host's render props. */
  readonly render: (props: never) => unknown
  /** Test seam: replaces `setInterval`, so the retry budget is deterministic. */
  readonly schedule?: (fn: () => void, ms: number) => () => void
  /** Test seam: observes that an insert actually happened, and on which registry. */
  readonly onInserted?: (registry: NativeTabRegistry) => void
}

/**
 * Insert the Team tab, or stand down.
 *
 * Returns a disposer in every case, so the caller never has to test whether an
 * insert happened. The returned disposer is always a function: the caller uses
 * `ctx.effect(() => disposeTeamTab, …)` style cleanup without a null test, and
 * calling it twice is harmless.
 */
export function insertTeamTab(ctx: ClientContext, options: TeamTabOptions): () => void {
  const noop = (): void => {}
  let dispose: () => void = noop
  let unsubscribe: (() => void) | undefined
  let timer: (() => void) | undefined
  let attempts = 0
  let stopped = false

  // The only timer this module may hold. The owner retries with a plain
  // interval; a client plugin has no scheduler of its own.
  const schedule = options.schedule ?? ((fn: () => void, ms: number) => {
    const handle = setInterval(fn, ms)
    return () => { clearInterval(handle) }
  })

  /**
   * One probe of every entry that can carry the registry. The owner may attach
   * it after this plugin's `apply` ran — it wraps lazily, on its own slot
   * subscription — so a probe that finds nothing is not a verdict.
   */
  const probe = (): boolean => {
    if (stopped) return false
    for (const entry of slotEntries(ctx, REGISTRY_SLOT)) {
      const registry = discoverRegistry(entry)
      if (registry === undefined) continue
      dispose = registry.insert({
        id: TAB_ID,
        label: options.label,
        order: TAB_ORDER,
        matchSession: () => false,
        render: options.render,
      })
      options.onInserted?.(registry)
      // Found: drop the retry and the subscriptions, keep the insert for the
      // life of this plugin. The host's own `insert` is idempotent per id, so a
      // later probe cannot double-register even if this one raced another.
      stopWaiting()
      return true
    }
    return false
  }

  function stopWaiting(): void {
    timer?.()
    timer = undefined
    unsubscribe?.()
    unsubscribe = undefined
  }

  probe()
  if (dispose !== noop) return () => { stopped = true; dispose() }

  // Late-registration path one: the owner's own subscriptions. It wraps on
  // `sidebar.workspaces` and re-wraps on `sidebar`, so both are watched.
  unsubscribe = slotSubscribe(ctx, REGISTRY_SLOT, probe)
  const unsubscribeParent = slotSubscribe(ctx, PARENT_SLOT, probe)
  const dropParent = (): void => { unsubscribeParent?.() }

  // Late-registration path two, the belt to path one's braces: a registry
  // attached with no slot change at all still lands. The budget matches the
  // owner's own 20 × 250 ms, so the worst case is work the automation plugin
  // already does for itself.
  timer = schedule(() => {
    if (stopped) return
    if (probe() || attempts >= RETRY_LIMIT) {
      stopWaiting()
      dropParent()
      return
    }
    attempts += 1
    if (attempts >= RETRY_LIMIT) {
      stopWaiting()
      dropParent()
    }
  }, RETRY_INTERVAL_MS)

  return () => {
    stopped = true
    stopWaiting()
    dropParent()
    dispose()
    dispose = noop
  }
}
