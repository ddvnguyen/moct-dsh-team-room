/**
 * Warm-or-cold verdict for a Member's Session before a Thread delivery (contract §4.2).
 *
 * Pure: the caller supplies the clock, the provider's resumability, and the TTL config,
 * so the verdict is testable with a fake clock. Fails closed: an unreadable timestamp is cold.
 */

/** Idle seconds after the last assistant turn beyond which the provider cache is treated as cold. */
export interface CacheTtlSeconds {
  readonly default: number
  /** Per-provider override, keyed by the provider id on the SessionRun model. */
  readonly [provider: string]: number
}

/** The contract default: 5 minutes for every provider until a per-provider value is configured. */
export const DEFAULT_CACHE_TTL_SECONDS: CacheTtlSeconds = Object.freeze({ default: 300 })

export interface CacheVerdictInput {
  /** The Session's last assistant turn (SessionRun.lastAssistantAt); undefined when it has none yet. */
  readonly lastAssistantAt: string | undefined
  /** The Session's provider (SessionRun.model.provider); undefined falls back to the default TTL. */
  readonly provider: string | undefined
  /** Milliseconds since the epoch. */
  readonly nowMs: number
  /** Whether the provider still holds the Session record (§4.2 step 2). */
  readonly resumable: boolean
  readonly ttlSeconds?: CacheTtlSeconds
}

export interface CacheVerdict {
  readonly cache: 'warm' | 'cold'
  /** `resumed` keeps the Session; `seeded-new` starts a fresh one from the summary (§4.2 step 3). */
  readonly action: 'resumed' | 'seeded-new'
  readonly reason: 'warm' | 'not-resumable' | 'no-assistant-turn' | 'unreadable-timestamp' | 'idle-past-ttl'
}

/** The TTL in milliseconds for one provider: its own value when configured, else the default. */
export function cacheTtlMs(provider: string | undefined, ttlSeconds: CacheTtlSeconds = DEFAULT_CACHE_TTL_SECONDS): number {
  const seconds = provider !== undefined && Object.hasOwn(ttlSeconds, provider) ? ttlSeconds[provider]! : ttlSeconds.default
  return seconds * 1000
}

export function cacheVerdict(input: CacheVerdictInput): CacheVerdict {
  const cold = (reason: CacheVerdict['reason']): CacheVerdict => ({ cache: 'cold', action: 'seeded-new', reason })
  if (!input.resumable) return cold('not-resumable')
  if (input.lastAssistantAt === undefined) return cold('no-assistant-turn')
  const lastMs = Date.parse(input.lastAssistantAt)
  if (!Number.isFinite(lastMs)) return cold('unreadable-timestamp')
  if (input.nowMs - lastMs > cacheTtlMs(input.provider, input.ttlSeconds)) return cold('idle-past-ttl')
  return { cache: 'warm', action: 'resumed', reason: 'warm' }
}
