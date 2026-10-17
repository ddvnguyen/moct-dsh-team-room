// Derived from multica-x packages/views/issues/components/active-task-order.ts @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.

/** The run row the execution log and the Runs tab order. */
export interface OrderedRun {
  readonly sessionId: string
  readonly running: boolean
  readonly queued?: boolean
  readonly startedAt: string
  readonly memberId: string
}

function phase(run: OrderedRun): number {
  if (run.running) return 0
  if (run.queued === true) return 1
  return 2
}

/**
 * Show current execution first, then queued work, then history. Ties are
 * broken by start time (oldest first) and finally by id so the order is
 * stable across renders.
 */
export function compareActiveRuns(a: OrderedRun, b: OrderedRun): number {
  const phaseDiff = phase(a) - phase(b)
  if (phaseDiff) return phaseDiff
  const ageDiff = Date.parse(a.startedAt) - Date.parse(b.startedAt)
  return (Number.isFinite(ageDiff) ? ageDiff : 0) || a.sessionId.localeCompare(b.sessionId)
}
