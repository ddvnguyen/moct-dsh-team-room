/**
 * D5 (A14 per-Member session history): memberSessions over the REAL TEST ledger.
 *
 * Fixture: `fixtures/ops-after-test2.json` — the 76 operations exported from the TEST
 * workspace (`cf4817d4-c9d6-42b0-9a44-271db6d259ca`) after the TEST-2b install, replayed
 * cold into a Host. Seat `a5-mv33zm0u` = `member:b91f3c8e-7e15-49d9-bc9a-3bde6034deda`
 * ran 3 recorded Turns across 2 Sessions (renewed mid-fixture at op 59).
 *
 * Metrics (lane spec D5):
 *  1. the seat's rows match the projection field by field, newest Session first;
 *  2. a Session with a null-input Turn carries `unknownInputTurns > 0` (the fixture has
 *     none, so the test appends one shape-valid null Turn — an append is how the ledger
 *     takes any new fact, no operation is edited or deleted);
 *  3. a known seat with no recorded Turns gets `runs: []` (not an error);
 *  4. revert-checked: the assertions fail when the production fold or the newest-first
 *     sort is mutated (mutation evidence recorded with the lane; source restored
 *     byte-identical).
 */
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { MemoryMediaPool, MemoryStorageBackend } from './helpers/memory-backend.ts'
import AgentTeam from '../src/index.ts'
import { AgentTeamLedger } from '../src/ledger.ts'
import { agentTeamDomainSpec } from '../src/spec.ts'
import * as agentTeamInvariant from '../src/invariant.ts'
import type { AgentTeamOperation, AgentTeamOperationId, AgentTeamSessionTurnRecordedData } from '../src/types.ts'

interface Fixture {
  readonly workspaceId: string
  readonly operations: readonly AgentTeamOperation[]
}

const fixture = JSON.parse(readFileSync(new URL('./fixtures/ops-after-test2.json', import.meta.url), 'utf8')) as Fixture
const workspace = WorkspaceId(fixture.workspaceId)
const seat = 'member:b91f3c8e-7e15-49d9-bc9a-3bde6034deda' // handle a5-mv33zm0u
const seatHandle = 'a5-mv33zm0u'
const sessionFirst = 'agent-team-f27ba2af-97e8-4cae-8031-6fc3181c9b17'
const sessionRenewed = 'agent-team-drv-mv33zm0u-resume-cold-7'
const seatThread = 'thread:cd310e23-02d2-47b3-90d6-fab6a0783000'
const route = { provider: 'cache-stub', model: 'cache-stub-1' }
/** A known seat added in the fixture that never recorded a Turn. */
const seatNoTurns = 'member:eab8ca5e-17ff-4bfc-b961-e309b84a9dd1' // handle a5-mv2wbjwt

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(cleanup => cleanup()))
})

/** A Host cold-booted over the given operations (insertion order = sequence order). */
async function replayHost(operations: readonly AgentTeamOperation[]): Promise<{ readonly ctx: Context; readonly facility: DomainFacility }> {
  const pool = new MemoryMediaPool()
  pool.versions.set('agent_team', agentTeamDomainSpec.version)
  pool.media.set('agent_team', { tables: new Map([['operations', new Map(operations.map(operation => [operation.operationId, operation] as [string, unknown]))]]), global: null })
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  ctx.provide('workspaceRegistry', {
    get: (id: WorkspaceId) => id === workspace ? { id, path: process.cwd(), attachSession: async () => {}, archiveSession: async () => {} } : undefined,
    list: () => [{ id: workspace, path: process.cwd() }],
    archiveSession: async () => {},
  })
  ctx.provide('agents', { create: async () => { throw new Error('unused') }, resume: async () => { throw new Error('unused') } })
  ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'mock', model: 'mock' }) })
  ctx.provide('agentPresets', { mount: async () => { throw new Error('unused') } })
  ctx.provide('tools', { schemas: () => [] })
  ctx.provide('sessionPersistence', { list: async () => [] })
  await ctx.plugin(agentTeamInvariant)
  await ctx.plugin(SessionProjectionRegistry)
  const fiber = await ctx.plugin(AgentTeam)
  cleanups.push(async () => { await fiber.dispose(); await facility.closeAll() })
  return { ctx, facility }
}

/** The seat's raw Turns from the fixture, folded independently of the production projection. */
function seatTurns(operations: readonly AgentTeamOperation[]): AgentTeamSessionTurnRecordedData[] {
  return operations
    .filter((operation): operation is Extract<AgentTeamOperation, { kind: 'team/session-turn-recorded' }> => operation.kind === 'team/session-turn-recorded')
    .map(operation => operation.data)
    .filter(data => data.memberId === seat)
}

/**
 * One more recorded Turn for the seat's first Session with an UNPROVABLE input
 * split (`uncachedInputTokens: null`) and an unknown cache split — every other
 * field mirrors the fixture's own Turn records, and it appends as sequence 77.
 */
function nullInputTurn(): Extract<AgentTeamOperation, { kind: 'team/session-turn-recorded' }> {
  const tail = fixture.operations.at(-1)
  if (tail === undefined) throw new Error('fixture must not be empty')
  return {
    sequence: tail.sequence + 1,
    operationId: 'operation:d5-null-input-turn' as AgentTeamOperationId,
    requestId: `turn:${sessionFirst}:3`,
    occurredAt: '2026-10-11T01:05:00.000Z',
    actor: { kind: 'member', memberId: seat, handle: seatHandle },
    previousOperationId: tail.operationId,
    kind: 'team/session-turn-recorded',
    data: {
      workspaceId: fixture.workspaceId,
      memberId: seat,
      sessionId: sessionFirst,
      threadRefs: [seatThread],
      turn: 3,
      startedAt: '2026-10-11T01:05:00.000Z',
      endedAt: '2026-10-11T01:05:00.064Z',
      toolCalls: 0,
      runMs: 64,
      usage: { uncachedInputTokens: null, outputTokens: 9, cacheReadTokens: null, cacheWriteTokens: null, reasoningTokens: null, route },
      startSequence: 76,
      endSequence: 77,
    },
  }
}

describe('D5 per-Member session history over the real TEST ledger (A14)', () => {
  it('returns the seat\'s rows field by field, newest Session first, current = renewed Session', async () => {
    const host = await replayHost(fixture.operations)
    const rows = host.ctx.agentTeam.memberSessions({ workspaceId: workspace, memberId: seat as never })
    expect(rows.current).toBe(sessionRenewed)
    // Newest first: the renewed Session started at 00:57:49.750Z, the first at 00:52:41.467Z.
    expect(rows.runs).toEqual([
      {
        sessionId: sessionRenewed,
        memberId: seat,
        threadRefs: [seatThread],
        startedAt: '2026-10-11T00:57:49.750Z',
        endedAt: '2026-10-11T00:57:49.832Z',
        turns: 1,
        tokensIn: 2400,
        unknownInputTurns: 0,
        tokensOut: 24,
        cacheReadTokens: null, // its single Turn had no cache split
        cacheWriteTokens: null,
        reasoningTokens: null,
        toolCalls: 0,
        runMs: 28,
        model: route,
        lastAssistantAt: '2026-10-11T00:57:49.832Z',
      },
      {
        sessionId: sessionFirst,
        memberId: seat,
        threadRefs: [seatThread],
        startedAt: '2026-10-11T00:52:41.467Z',
        endedAt: '2026-10-11T00:52:44.606Z',
        turns: 2,
        tokensIn: 400,
        unknownInputTurns: 0,
        tokensOut: 24,
        cacheReadTokens: 2000, // the fold sums each Turn's cache read: 1000 + 1000
        cacheWriteTokens: null,
        reasoningTokens: null,
        toolCalls: 0,
        runMs: 33,
        model: route,
        lastAssistantAt: '2026-10-11T00:52:44.606Z',
      },
    ])
    // The row values are a fold of the seat's raw Turn records in this very fixture.
    const turns = seatTurns(fixture.operations)
    expect(turns).toHaveLength(3)
    expect(rows.runs.reduce((total, row) => total + row.turns, 0)).toBe(turns.length)
  })

  it('marks a Session with a null-input Turn unknownInputTurns > 0 without inflating tokensIn', async () => {
    const host = await replayHost([...fixture.operations, nullInputTurn()])
    const rows = host.ctx.agentTeam.memberSessions({ workspaceId: workspace, memberId: seat as never })
    expect(rows.current).toBe(sessionRenewed)
    const first = rows.runs.find(row => row.sessionId === sessionFirst)
    expect(first, 'the null-input Turn joins the seat\'s first Session').toBeDefined()
    expect(first!.unknownInputTurns).toBe(1)
    expect(first!.turns).toBe(3)
    expect(first!.tokensIn).toBe(400) // the null Turn adds nothing; tokensIn stays partial below unknownInputTurns
    expect(first!.tokensOut).toBe(33)
    // Unknown is null, never 0: an unprovable cache split nulls the Session's bucket.
    expect(first!.cacheReadTokens).toBeNull()
  })

  it('returns runs: [] (not an error) for a known seat with no recorded Turns', async () => {
    const host = await replayHost(fixture.operations)
    const added = fixture.operations.find(operation => operation.kind === 'team/member-added' && operation.data.member.memberId === seatNoTurns)
    if (added === undefined || added.kind !== 'team/member-added') throw new Error('fixture must contain the no-Turn seat')
    const rows = host.ctx.agentTeam.memberSessions({ workspaceId: workspace, memberId: seatNoTurns as never })
    expect(rows.runs).toEqual([])
    expect(rows.current).toBe(added.data.member.sessionId) // the seat's current Session exists; it simply holds no Turn
    // An unknown seat is a different case and stays an explicit error (existing contract).
    expect(() => host.ctx.agentTeam.memberSessions({ workspaceId: workspace, memberId: 'member:d5-unknown' as never })).toThrow(/not known to this Team/)
  })

  it('replays the fixture cold: the ledger validates and the projection agrees row-for-row', async () => {
    const host = await replayHost(fixture.operations)
    const ledger = new AgentTeamLedger(host.facility.get('agent_team')!.table('operations') as unknown as KvTable<AgentTeamOperationId, AgentTeamOperation>)
    expect(() => ledger.validate()).not.toThrow()
    // memberSessions and the ledger's own projection are one path: same rows, same order.
    const viaLedger = ledger.memberSessionRuns(seat as never)
    const viaRemote = host.ctx.agentTeam.memberSessions({ workspaceId: workspace, memberId: seat as never }).runs
    expect(viaRemote).toEqual([...viaLedger])
    expect(viaLedger.map(row => row.sessionId)).toEqual([sessionRenewed, sessionFirst])
  })
})
