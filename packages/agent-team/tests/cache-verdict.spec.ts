import { describe, expect, it } from 'vitest'
import { cacheTtlMs, cacheVerdict, DEFAULT_CACHE_TTL_SECONDS } from '../src/cache-verdict.ts'

// Fake clock: every case is decided by an explicit "now", never by the wall clock.
const last = '2026-10-11T02:00:00.000Z'
const at = (seconds: number) => Date.parse(last) + seconds * 1000

describe('cacheVerdict (§4.2, A5 unit)', () => {
  it('resumes a Session still inside the default 5-minute TTL', () => {
    expect(cacheVerdict({ lastAssistantAt: last, provider: 'claude', nowMs: at(299), resumable: true })).toEqual({ cache: 'warm', action: 'resumed', reason: 'warm' })
  })

  it('treats the exact TTL boundary as warm, one millisecond past it as cold', () => {
    expect(cacheVerdict({ lastAssistantAt: last, provider: 'claude', nowMs: at(300), resumable: true }).cache).toBe('warm')
    expect(cacheVerdict({ lastAssistantAt: last, provider: 'claude', nowMs: at(300) + 1, resumable: true })).toEqual({ cache: 'cold', action: 'seeded-new', reason: 'idle-past-ttl' })
  })

  it('uses a per-provider TTL when configured, and the default for every other provider', () => {
    const ttlSeconds = { default: 300, claude: 3600 }
    expect(cacheVerdict({ lastAssistantAt: last, provider: 'claude', nowMs: at(1800), resumable: true, ttlSeconds }).cache).toBe('warm')
    expect(cacheVerdict({ lastAssistantAt: last, provider: 'opencode-go', nowMs: at(1800), resumable: true, ttlSeconds })).toMatchObject({ cache: 'cold', reason: 'idle-past-ttl' })
    expect(cacheTtlMs(undefined, ttlSeconds)).toBe(300_000)
  })

  it('is cold when the provider no longer holds the Session, whatever the clock says', () => {
    expect(cacheVerdict({ lastAssistantAt: last, provider: 'claude', nowMs: at(1), resumable: false })).toMatchObject({ cache: 'cold', reason: 'not-resumable' })
  })

  it('is cold before any assistant turn, and when the timestamp cannot be read (fails closed)', () => {
    expect(cacheVerdict({ lastAssistantAt: undefined, provider: 'claude', nowMs: at(1), resumable: true })).toMatchObject({ reason: 'no-assistant-turn' })
    expect(cacheVerdict({ lastAssistantAt: 'not a time', provider: 'claude', nowMs: at(1), resumable: true })).toMatchObject({ cache: 'cold', reason: 'unreadable-timestamp' })
  })

  it('defaults to the contract value of 300 seconds', () => {
    expect(DEFAULT_CACHE_TTL_SECONDS).toEqual({ default: 300 })
  })
})
