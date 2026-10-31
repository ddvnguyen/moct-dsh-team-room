import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { ACTIVITY_STALE_MS, ACTIVITY_STEPS_MAX, ACTIVITY_THROTTLE_MS, AgentTeamActivityFeed, activityLabel } from '../src/activity-feed.ts'
import type { AgentTeamMemberId, AgentTeamThreadRef } from '../src/types/entities.ts'

const memberId = 'member:feed-a' as AgentTeamMemberId
const thread = 'thread:feed' as AgentTeamThreadRef
const FORBIDDEN = ['sk-FAKE', 'Bearer', 'Authorization', 'https://']

const step = (time: number, turn = 1) => ({ type: 'step/start', seq: 1, time, data: { turn, step: 1 } }) as never
const call = (time: number, callId: string, name: string, args: Record<string, unknown>, turn = 1) =>
  ({ type: 'tool/call', seq: 1, time, data: { turn, step: 1, callId, name, arguments: JSON.stringify(args) } }) as never
const result = (time: number, callId: string) =>
  ({ type: 'tool/result', seq: 1, time, data: { message: { source: { callId } } } }) as never

function harness() {
  let clock = 0
  const timers: { at: number; fn: () => void; done: boolean }[] = []
  const invalidations: number[] = []
  const feed = new AgentTeamActivityFeed({
    identify: () => ({ handle: '@dev', threadRef: thread }),
    invalidate: () => invalidations.push(clock),
    now: () => clock,
    schedule: (fn, ms) => {
      const timer = { at: clock + ms, fn, done: false }
      timers.push(timer)
      return timer as never
    },
  })
  /** Run every due scheduled callback up to `target`, then move the clock there. */
  const advanceTo = (target: number) => {
    for (const timer of [...timers].filter(t => !t.done && t.at <= target).sort((a, b) => a.at - b.at)) {
      clock = timer.at
      timer.done = true
      timer.fn()
    }
    clock = target
  }
  return { feed, invalidations, advanceTo, setClock: (t: number) => { clock = t } }
}

describe('AgentTeamActivityFeed (D3 metrics)', () => {
  it('metric 1: step x3 and tool start/end x2 yield stepCount 3, toolCount 2 and the correct current', () => {
    const { feed, advanceTo } = harness()
    feed.onSessionEvent(memberId, step(0))
    feed.onSessionEvent(memberId, step(10))
    feed.onSessionEvent(memberId, step(20))
    advanceTo(20)
    feed.onSessionEvent(memberId, call(30, 'c1', 'read', { file_path: '/work/src/file.ts' }))
    expect(feed.snapshot(thread)[0]?.current).toEqual({ tool: 'read', label: 'read file.ts' })
    feed.onSessionEvent(memberId, result(40, 'c1'))
    feed.onSessionEvent(memberId, call(50, 'c2', 'bash', { command: 'npm test' }))
    feed.onSessionEvent(memberId, result(60, 'c2'))
    const [activity] = feed.snapshot(thread)
    expect(activity).toMatchObject({
      memberId,
      handle: '@dev',
      threadRef: thread,
      stepCount: 3,
      toolCount: 2,
      turnStartedAt: new Date(0).toISOString(),
      updatedAt: new Date(60).toISOString(),
    })
    expect(activity?.current).toBeUndefined()
    expect(feed.snapshot('thread:other' as AgentTeamThreadRef)).toEqual([])
  })

  it('metric 1b: a shell tool call leaves current as the tool name only', () => {
    const { feed } = harness()
    feed.onSessionEvent(memberId, step(0))
    feed.onSessionEvent(memberId, call(5, 'c1', 'bash', { command: 'npm test -- --token abc' }))
    expect(feed.snapshot()[0]?.current).toEqual({ tool: 'bash', label: 'bash' })
  })

  it('metric 2: the entry is removed on agent idle and on agent error', () => {
    const { feed } = harness()
    feed.onSessionEvent(memberId, step(0))
    expect(feed.snapshot()).toHaveLength(1)
    feed.onAgentIdle(memberId)
    expect(feed.snapshot()).toEqual([])

    feed.onSessionEvent(memberId, step(10))
    expect(feed.snapshot()).toHaveLength(1)
    feed.onAgentError(memberId)
    expect(feed.snapshot()).toEqual([])
  })

  it('metric 3: an entry older than 5 minutes is dropped on read', () => {
    const { feed, setClock } = harness()
    feed.onSessionEvent(memberId, step(0))
    setClock(ACTIVITY_STALE_MS - 1)
    expect(feed.snapshot()).toHaveLength(1)
    setClock(ACTIVITY_STALE_MS + 1)
    expect(feed.snapshot()).toEqual([])
  })

  it('metric 4: 100 events in 100 ms give at most one invalidation per 500 ms per seat', () => {
    const { feed, invalidations, advanceTo } = harness()
    for (let i = 0; i < 100; i += 1) {
      advanceTo(i)
      feed.onSessionEvent(memberId, step(i))
    }
    advanceTo(2000)
    expect(invalidations).toEqual([0, ACTIVITY_THROTTLE_MS])
    for (let i = 1; i < invalidations.length; i += 1) {
      expect(invalidations[i]! - invalidations[i - 1]!).toBeGreaterThanOrEqual(ACTIVITY_THROTTLE_MS)
    }
  })

  it('metric 5: redaction keeps curl, Authorization, Bearer, sk-FAKE and https:// out of every label', () => {
    const curl = 'curl -H "Authorization: Bearer sk-FAKE-123456789" https://x'
    const shell = activityLabel('bash', JSON.stringify({ command: curl }))
    const dotenv = activityLabel('read', JSON.stringify({ path: '/home/u/.env' }))
    const secretPath = activityLabel('read', JSON.stringify({ path: '/home/u/sk-FAKE-123456789' }))
    const mixed = activityLabel('curl_fetch', JSON.stringify({ command: curl, path: '/home/u/.env' }))
    const spaced = activityLabel('run me now', JSON.stringify({ path: '/home/u/a.txt' }))
    const bad = [shell, dotenv, secretPath, mixed, spaced]
    for (const item of bad) {
      for (const word of FORBIDDEN) expect(JSON.stringify(item)).not.toContain(word)
      expect(item.label.length).toBeLessThanOrEqual(80)
    }
    expect(shell.label).toBe('bash')
    expect(dotenv.label).toBe('read .env')
    expect(secretPath.label).toBe('read')
    expect(spaced.tool).toBe('tool')
  })

  it('metric 5b: the feed snapshot itself carries no forbidden text after a redacted call stream', () => {
    const { feed } = harness()
    const curl = 'curl -H "Authorization: Bearer sk-FAKE-123456789" https://x'
    feed.onSessionEvent(memberId, step(0))
    feed.onSessionEvent(memberId, call(1, 'c1', 'bash', { command: curl }))
    feed.onSessionEvent(memberId, call(2, 'c2', 'read', { path: '/home/u/.env' }))
    const serialized = JSON.stringify(feed.snapshot())
    for (const word of FORBIDDEN) expect(serialized).not.toContain(word)
    expect(serialized).toContain('read .env')
  })

  it('step feed: the last few labels are kept newest last, capped, and reset with the Turn', () => {
    const { feed } = harness()
    feed.onSessionEvent(memberId, step(0))
    expect(feed.snapshot()[0]).not.toHaveProperty('steps')
    feed.onSessionEvent(memberId, call(1, 'c1', 'read', { path: '/work/a.ts' }))
    feed.onSessionEvent(memberId, call(2, 'c2', 'grep', { path: '/work/b.ts' }))
    expect(feed.snapshot()[0]?.steps).toEqual([
      { tool: 'read', label: 'read a.ts' },
      { tool: 'grep', label: 'grep b.ts' },
    ])
    // The window is the last ACTIVITY_STEPS_MAX steps: older ones fall off the front.
    for (let i = 3; i <= ACTIVITY_STEPS_MAX + 2; i += 1) {
      feed.onSessionEvent(memberId, call(i, `c${i}`, 'edit', { path: `/work/f${i}.ts` }))
    }
    const steps = feed.snapshot()[0]?.steps ?? []
    expect(steps).toHaveLength(ACTIVITY_STEPS_MAX)
    expect(steps.at(-1)).toEqual({ tool: 'edit', label: `edit f${ACTIVITY_STEPS_MAX + 2}.ts` })
    // A new Turn starts a new feed: the previous Turn's steps never carry over.
    feed.onSessionEvent(memberId, step(ACTIVITY_STEPS_MAX + 3, 2))
    expect(feed.snapshot()[0]?.steps).toBeUndefined()
  })

  it('step feed: labels only, per slot, and no argument text or secret survives it', () => {
    const { feed } = harness()
    const curl = 'curl -H "Authorization: Bearer sk-FAKE-123456789" https://x'
    feed.onSessionEvent(memberId, step(0))
    feed.onSessionEvent(memberId, step(1), 1)
    feed.onSessionEvent(memberId, call(2, 'c1', 'bash', { command: curl }))
    feed.onSessionEvent(memberId, call(3, 'c2', 'read', { path: '/home/u/.env' }), 1)
    const [main, extra] = feed.snapshot()
    expect(main?.steps).toEqual([{ tool: 'bash', label: 'bash' }])
    expect(extra?.steps).toEqual([{ tool: 'read', label: 'read .env' }])
    const serialized = JSON.stringify([main?.steps, extra?.steps])
    for (const word of [...FORBIDDEN, 'curl -H', '/home/u/.env']) expect(serialized).not.toContain(word)
  })

  it('metric 7: a non-delivery Turn after an idle shows no Thread; the host clears its per-seat Thread map on idle (index.ts mirror)', () => {
    // Mirrors index.ts: activityThreads is set on delivery, read by identify at a Turn's start,
    // and must be cleared on agent/status idle and agent/error before the feed sees the idle.
    const activityThreads = new Map<AgentTeamMemberId, AgentTeamThreadRef>([[memberId, thread]])
    const feed = new AgentTeamActivityFeed({
      identify: id => {
        const threadRef = activityThreads.get(id)
        return threadRef === undefined ? { handle: '@dev' } : { handle: '@dev', threadRef }
      },
      invalidate: () => {},
      now: () => 0,
    })
    const hostIdle = (id: AgentTeamMemberId) => {
      activityThreads.delete(id)
      feed.onAgentIdle(id)
    }
    feed.onSessionEvent(memberId, step(0, 1))
    expect(feed.snapshot()[0]?.threadRef).toBe(thread)
    hostIdle(memberId)
    feed.onSessionEvent(memberId, step(1, 2))
    expect(feed.snapshot()[0]).toBeDefined()
    expect(feed.snapshot()[0]).not.toHaveProperty('threadRef')
  })

  it('multi-instance: two slots of one seat run side by side, each with its own Turn and end', () => {
    const { feed } = harness()
    feed.onSessionEvent(memberId, step(0))
    feed.onSessionEvent(memberId, step(1), 1)
    feed.onSessionEvent(memberId, call(2, 'c1', 'read', { path: '/a/b.ts' }), 1)
    const both = feed.snapshot()
    expect(both).toHaveLength(2)
    expect(both[0]).not.toHaveProperty('slot')
    expect(both[0]).toMatchObject({ memberId, stepCount: 1, toolCount: 0 })
    expect(both[1]).toMatchObject({ memberId, slot: 1, stepCount: 1, toolCount: 1, current: { tool: 'read', label: 'read b.ts' } })
    // A result on slot 0 never clears slot 1's open call.
    feed.onSessionEvent(memberId, result(3, 'c1'))
    expect(feed.snapshot()[1]?.current).toEqual({ tool: 'read', label: 'read b.ts' })
    feed.onAgentIdle(memberId, 1)
    expect(feed.snapshot()).toHaveLength(1)
    expect(feed.snapshot()[0]).not.toHaveProperty('slot')
    feed.onAgentError(memberId)
    expect(feed.snapshot()).toHaveLength(0)
  })

  it('metric 6: folding events writes nothing to the ledger, and the module imports no ledger, fs or op code', () => {
    const put = vi.fn()
    const ledgerOperations = { put }
    const { feed } = harness()
    feed.onSessionEvent(memberId, step(0))
    feed.onSessionEvent(memberId, call(1, 'c1', 'read', { path: '/a/b.ts' }))
    feed.onAgentIdle(memberId)
    expect(ledgerOperations.put).toHaveBeenCalledTimes(0)

    const source = readFileSync(new URL('../src/activity-feed.ts', import.meta.url), 'utf8')
    const imports = source.match(/^import .*$/gm) ?? []
    expect(imports.join('\n')).not.toMatch(/ledger|operations|node:fs/)
    expect(source).not.toMatch(/\.put\(/)
  })
})
