import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { SessionId, type SessionId as SessionIdType } from '@deepseek-ai/dsh-session'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { MemoryMediaPool, MemoryStorageBackend } from './helpers/memory-backend.ts'
import AgentTeam from '../src/index.ts'
import type { AgentTeamLedger, AgentTeamLedgerResult, AgentTeamSessionTurnResult } from '../src/ledger.ts'
import type { AgentTeamAgentMember, AgentTeamMemberActor, AgentTeamRequestId, AgentTeamChannelRef, AgentTeamThreadRef } from '../src/types.ts'

// Board 7/10 (#132): one workspace-wide aggregate over the room-activity projection. The read is
// the Host surface the Overview page meets, so the assertions run against the Host RPC, not a
// second ledger copy: aggregation across Channels, the per-agent sum, day-boundary buckets,
// cursor paging, and the empty Workspace that must render before any Channel exists.
const cleanups: Array<() => Promise<void>> = []
const alpha = WorkspaceId('workspace:alpha')
const beta = WorkspaceId('workspace:beta')
const requestId = (value: string) => value as AgentTeamRequestId

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(cleanup => cleanup()))
})

interface Space {
  readonly host: AgentTeam
  readonly hostLedger: AgentTeamLedger
  readonly channelRef: AgentTeamChannelRef
  readonly otherChannelRef: AgentTeamChannelRef
  readonly seatA: AgentTeamAgentMember
  readonly seatB: AgentTeamAgentMember
  readonly actorA: AgentTeamMemberActor
  readonly actorB: AgentTeamMemberActor
  readonly threadA: AgentTeamThreadRef
  readonly threadB: AgentTeamThreadRef
}

async function space(): Promise<Space> {
  const ctx = new Context()
  await ctx.plugin(Storage)
  const pool = new MemoryMediaPool()
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  ctx.provide('workspaceRegistry', {
    get: (id: WorkspaceId) => id === alpha || id === beta ? { id, path: process.cwd(), attachSession: async () => {} } : undefined,
    list: () => [alpha, beta].map(id => ({ id, path: process.cwd() })),
    archiveSession: async () => {},
  })
  ctx.provide('agents', { create: async () => { throw new Error('unused') }, resume: async () => { throw new Error('unused') } })
  ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'mock', model: 'mock' }) })
  ctx.provide('agentPresets', { mount: async () => { throw new Error('unused') } })
  ctx.provide('tools', { schemas: () => [] })
  ctx.provide('sessionPersistence', { list: async () => [] })
  await ctx.plugin(SessionProjectionRegistry)
  const fiber = await ctx.plugin(AgentTeam)
  cleanups.push(async () => { await fiber.dispose(); await facility.closeAll() })
  const host = ctx.agentTeam as AgentTeam
  const first = await host.createChannel({ requestId: requestId('ws-channel'), workspaceId: alpha, name: 'room', description: '' })
  const other = await host.createChannel({ requestId: requestId('ws-other'), workspaceId: alpha, name: 'other', description: '' })
  const seatA = (await host.addMember({ requestId: requestId('ws-seat-a'), workspaceId: alpha, handle: 'seat-a', description: 'Seat A', presetId: 'team-member', channelRefs: [first.channel.channelRef, other.channel.channelRef] })).status.member
  const seatB = (await host.addMember({ requestId: requestId('ws-seat-b'), workspaceId: alpha, handle: 'seat-b', description: 'Seat B', presetId: 'team-member', channelRefs: [first.channel.channelRef, other.channel.channelRef] })).status.member
  const actorA: AgentTeamMemberActor = { kind: 'member', memberId: seatA.memberId, handle: seatA.handle }
  const actorB: AgentTeamMemberActor = { kind: 'member', memberId: seatB.memberId, handle: seatB.handle }
  const anchorA = committed(await host.sendMessage({ requestId: requestId('ws-a'), workspaceId: alpha, channelRef: first.channel.channelRef, body: 'Thread A anchor', asTask: false }))
  const anchorB = committed(await host.sendMessage({ requestId: requestId('ws-b'), workspaceId: alpha, channelRef: other.channel.channelRef, body: 'Thread B anchor', asTask: false }))
  return { host, hostLedger: (host as unknown as { ledger: AgentTeamLedger }).ledger, channelRef: first.channel.channelRef, otherChannelRef: other.channel.channelRef, seatA, seatB, actorA, actorB, threadA: anchorA.thread.threadRef, threadB: anchorB.thread.threadRef }
}

function committed<T extends { readonly kind: string }>(result: T): Extract<T, { readonly kind: 'committed' }> {
  if (result.kind !== 'committed') throw new Error(`expected committed result, received ${result.kind}`)
  return result as Extract<T, { readonly kind: 'committed' }>
}

/** One recorded Turn, written the way the Host recorder writes it, with a configurable start instant. */
function turn(space: Space, input: {
  readonly sessionId: SessionIdType
  readonly member: AgentTeamAgentMember
  readonly actor: AgentTeamMemberActor
  readonly turn: number
  readonly threadRef: AgentTeamThreadRef
  readonly startedAt: string
  readonly uncachedInputTokens: number | null
  readonly outputTokens: number
  readonly runMs?: number
}): Promise<AgentTeamLedgerResult<AgentTeamSessionTurnResult>> {
  return space.hostLedger.recordSessionTurn({
    requestId: requestId(`turn-${String(input.sessionId)}-${input.turn}`),
    workspaceId: alpha,
    memberId: input.member.memberId,
    sessionId: input.sessionId,
    turn: input.turn,
    startedAt: input.startedAt,
    endedAt: input.startedAt,
    threadRefs: [input.threadRef],
    toolCalls: 1,
    runMs: input.runMs ?? 500,
    usage: {
      uncachedInputTokens: input.uncachedInputTokens,
      outputTokens: input.outputTokens,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: null,
    },
    actor: input.actor,
  })
}

/** The local calendar day of an ISO instant, the same conversion the ledger buckets by. */
function localDay(instant: string): string {
  const date = new Date(instant)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

describe('workspaceActivity (Board 7/10)', () => {
  it('aggregates two Channels into one workspace fold, per-agent shares equal to the Channels summed', async () => {
    const room = await space()
    await turn(room, { sessionId: SessionId('session-a1'), member: room.seatA, actor: room.actorA, turn: 1, threadRef: room.threadA, startedAt: '2026-10-15T01:00:00.000Z', uncachedInputTokens: 100, outputTokens: 40, runMs: 1200 })
    await turn(room, { sessionId: SessionId('session-b1'), member: room.seatB, actor: room.actorB, turn: 1, threadRef: room.threadB, startedAt: '2026-10-15T02:00:00.000Z', uncachedInputTokens: 30, outputTokens: 6, runMs: 200 })

    const workspace = await room.host.workspaceActivity({ workspaceId: alpha })
    const first = await room.host.roomActivity({ workspaceId: alpha, channelRef: room.channelRef })
    const second = await room.host.roomActivity({ workspaceId: alpha, channelRef: room.otherChannelRef })

    // Every workspace total is the sum of the two Channel folds — no bucket drifts.
    expect(workspace.totals.messages).toBe(first.totals.messages + second.totals.messages)
    expect(workspace.totals.turns).toBe(first.totals.turns + second.totals.turns)
    expect(workspace.totals.tokensIn).toBe((first.totals.tokensIn ?? 0) + (second.totals.tokensIn ?? 0))
    expect(workspace.totals.tokensOut).toBe((first.totals.tokensOut ?? 0) + (second.totals.tokensOut ?? 0))
    expect(workspace.totals.runMs).toBe((first.totals.runMs ?? 0) + (second.totals.runMs ?? 0))

    // Per-agent shares too: each seat's workspace row is its two Channel rows summed.
    for (const seat of [room.seatA, room.seatB]) {
      const workspaceRow = workspace.perAgent.find(agent => agent.memberId === seat.memberId)!
      const sumOfRows = [first, second].map(page => page.perAgent.find(agent => agent.memberId === seat.memberId))
      expect(workspaceRow.tokensOut).toBe(sumOfRows.reduce((sum, row) => sum + (row?.tokensOut ?? 0), 0))
      expect(workspaceRow.turns).toBe(sumOfRows.reduce((sum, row) => sum + (row?.turns ?? 0), 0))
    }

    // The feed narrates both Channels: an event from each is present, newest first.
    const kinds = workspace.events.map(event => event.kind)
    expect(kinds.filter(kind => kind === 'team/message-sent')).toHaveLength(2)
    expect(workspace.events[0]!.sequence).toBeGreaterThan(workspace.events.at(-1)!.sequence)
  })

  it('buckets spend by the local day of each Session start, per agent, ascending', async () => {
    const room = await space()
    // Two Sessions starting on different local days — constructed from local-time Date components,
    // so the two instants straddle the Host's own midnight whatever its timezone — and one Session
    // whose only Turn left the input split unreported: that day's tokensIn is null.
    const early = new Date(2026, 9, 14, 12, 0, 0).toISOString()
    const late = new Date(2026, 9, 15, 12, 0, 0).toISOString()
    await turn(room, { sessionId: SessionId('session-day-a'), member: room.seatA, actor: room.actorA, turn: 1, threadRef: room.threadA, startedAt: early, uncachedInputTokens: 100, outputTokens: 40, runMs: 1200 })
    await turn(room, { sessionId: SessionId('session-day-b'), member: room.seatB, actor: room.actorB, turn: 1, threadRef: room.threadB, startedAt: late, uncachedInputTokens: null, outputTokens: 6, runMs: 200 })

    const workspace = await room.host.workspaceActivity({ workspaceId: alpha })
    const days = workspace.perDay.map(entry => entry.day)
    expect(days).toEqual([localDay(early), localDay(late)].sort((left, right) => left.localeCompare(right)))
    expect([...days]).toEqual([...new Set(days)])
    const earlyDay = workspace.perDay.find(entry => entry.day === localDay(early))!
    const lateDay = workspace.perDay.find(entry => entry.day === localDay(late))!
    expect(earlyDay.tokensIn).toBe(100)
    expect(earlyDay.tokensOut).toBe(40)
    expect(earlyDay.runMs).toBe(1200)
    // The unproven input split nulls only the bucket it reaches, per agent and for the day.
    expect(lateDay.tokensIn).toBeNull()
    expect(lateDay.tokensOut).toBe(6)
    expect(earlyDay.perAgent.map(row => row.memberId)).toEqual([room.seatA.memberId])
    expect(lateDay.perAgent.map(row => row.memberId)).toEqual([room.seatB.memberId])
    expect(lateDay.perAgent[0]!.tokensIn).toBeNull()
  })

  it('pages the workspace feed on the cursor, newest first, without repeats', async () => {
    const room = await space()
    for (let index = 0; index < 5; index += 1) {
      await room.host.sendMessage({ requestId: requestId(`ws-page-${index}`), workspaceId: alpha, channelRef: index % 2 === 0 ? room.channelRef : room.otherChannelRef, body: `overflow ${index}`, asTask: false })
    }
    const whole = await room.host.workspaceActivity({ workspaceId: alpha })
    const bounded = await room.host.workspaceActivity({ workspaceId: alpha, limit: 2 })
    expect(bounded.events).toHaveLength(2)
    expect(bounded.nextCursor).toBeDefined()
    const next = await room.host.workspaceActivity({ workspaceId: alpha, limit: 2, cursor: bounded.nextCursor ?? '' })
    expect(next.events).toHaveLength(2)
    expect(next.events[0]!.sequence).toBeLessThan(bounded.events[0]!.sequence)
    // Walking every page from the head collects exactly the unbounded read's rows, in order.
    const paged = [...bounded.events, ...next.events]
    expect(whole.events.slice(0, paged.length).map(event => event.sequence)).toEqual(paged.map(event => event.sequence))
    for (const cursor of ['abc', '', '-1', ' 12']) {
      let error: unknown
      try {
        await room.host.workspaceActivity({ workspaceId: alpha, cursor })
      } catch (thrown) { error = thrown }
      expect((error as { message?: string }).message).toContain('workspace activity cursor')
    }
  })

  it('renders an empty Workspace as a valid empty aggregate', async () => {
    const room = await space()
    const empty = await room.host.workspaceActivity({ workspaceId: beta })
    expect(empty.totals.messages).toBe(0)
    expect(empty.totals.turns).toBe(0)
    expect(empty.totals.tokensIn).toBe(0)
    expect(empty.totals.unrecordedTurns).toBe(0)
    expect(empty.perAgent).toEqual([])
    expect(empty.perDay).toEqual([])
    expect(empty.sessions).toEqual([])
    expect(empty.events).toEqual([])
    expect(empty.nextCursor).toBeUndefined()
  })
})
