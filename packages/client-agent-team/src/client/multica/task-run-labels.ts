// Derived from multica-x packages/views/issues/components/task-run-labels.ts @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
//
// Labels shared by the execution log and the Runs tab so the two cannot
// drift. Multica's version binds `useT`; here the caller resolves the locale
// key, keeping this module pure and node-testable.

/** The run states the execution log renders. */
export type RunState = 'running' | 'queued' | 'completed' | 'failed' | 'cancelled'

export const RUN_STATE_LABEL_KEY: Readonly<Record<RunState, string>> = {
  running: 'runStateRunning',
  queued: 'runStateQueued',
  completed: 'runStateCompleted',
  failed: 'runStateFailed',
  cancelled: 'runStateCancelled',
}

/**
 * Wall-clock duration of a finished run, or null when it never started or
 * never finished. Running rows tick a live elapsed timer instead, so a frozen
 * figure beside it would contradict the timer.
 */
export function runDurationMs(run: {
  readonly startedAt: string
  readonly endedAt?: string | undefined
  readonly running?: boolean | undefined
}): number | null {
  if (run.running === true || run.endedAt === undefined) return null
  const start = new Date(run.startedAt).getTime()
  const end = new Date(run.endedAt).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null
  return end - start
}

/** Cache-hit percentage over every input bucket; null when no bucket is known. */
export function cacheHitPercent(run: {
  readonly tokensIn: number
  readonly cacheReadTokens?: number | null | undefined
  readonly cacheWriteTokens?: number | null | undefined
}): number | null {
  const cacheRead = run.cacheReadTokens ?? 0
  const cacheWrite = run.cacheWriteTokens ?? 0
  const totalInput = run.tokensIn + cacheRead + cacheWrite
  if (totalInput <= 0 || run.cacheReadTokens === null) return null
  return Math.round((cacheRead / totalInput) * 100)
}

/** Human duration: `1h 04m`, `4m 12s`, `38s`, `820ms`. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`
  const totalSeconds = Math.floor(ms / 1000)
  const seconds = totalSeconds % 60
  const minutes = Math.floor(totalSeconds / 60) % 60
  const hours = Math.floor(totalSeconds / 3600)
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, '0')}s`
  return `${seconds}s`
}
