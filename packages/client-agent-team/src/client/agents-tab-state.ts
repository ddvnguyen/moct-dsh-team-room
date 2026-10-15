/**
 * Whether the Agents list has a home in the host's tab strip.
 *
 * The Agents tab only exists while the strip does. The Team Settings page shows
 * the Agents list itself when the tab is absent, so the list is reachable in a
 * profile without the automation plugin, and steps aside once the tab is in.
 */
export interface AgentsTabState {
  readonly getSnapshot: () => boolean
  readonly subscribe: (listener: () => void) => () => void
  readonly set: (inserted: boolean) => void
}

export function createAgentsTabState(): AgentsTabState {
  let inserted = false
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => inserted,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
    set: next => {
      if (next === inserted) return
      inserted = next
      for (const listener of [...listeners]) listener()
    },
  }
}
