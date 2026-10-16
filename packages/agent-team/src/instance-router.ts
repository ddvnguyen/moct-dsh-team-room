import type { AgentTeamThreadRef } from './types.ts'

/** One Thread's route: the slot that takes it, and whether this route writes a new binding. */
export interface InstanceRoute {
  readonly threadRef: AgentTeamThreadRef
  readonly slot: number
  readonly bind: boolean
}

/**
 * Route a seat's unread Threads to its instance slots (multi-instance contract v2 §2/§2a).
 *
 * - A bound Thread stays on its slot (sticky), busy or not: a busy slot queues it.
 * - An unbound Thread takes slot 0 when idle, else the first idle extra slot, and binds there.
 *   A slot that already took a Thread in this pass counts as busy, so two new Threads that
 *   arrive together land on two instances.
 * - With every slot busy, an unbound Thread queues on slot 0 and binds there at once, so a later
 *   message in the same Thread can never start a second instance on it.
 *
 * `bound` must already discard slots at or past `instances` (the ledger read does). An absent
 * slot is idle: it spawns on demand. Order of `threads` is preserved in the output.
 */
export function routeThreads(
  threads: readonly AgentTeamThreadRef[],
  instances: number,
  bound: (threadRef: AgentTeamThreadRef) => number | undefined,
  busy: (slot: number) => boolean,
): readonly InstanceRoute[] {
  const taken = new Set<number>()
  for (const threadRef of threads) {
    const slot = bound(threadRef)
    if (slot !== undefined && slot < instances) taken.add(slot)
  }
  const free = (slot: number): boolean => !taken.has(slot) && !busy(slot)
  return threads.map(threadRef => {
    const slot = bound(threadRef)
    if (slot !== undefined && slot < instances) return { threadRef, slot, bind: false }
    let chosen = 0
    for (let candidate = 0; candidate < instances; candidate++) {
      if (free(candidate)) {
        chosen = candidate
        break
      }
    }
    taken.add(chosen)
    return { threadRef, slot: chosen, bind: true }
  })
}
