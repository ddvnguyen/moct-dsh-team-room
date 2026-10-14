import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { SessionId, type SessionId as SessionIdType } from '@deepseek-ai/dsh-session'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { MemoryMediaPool, MemoryStorageBackend } from './helpers/memory-backend.ts'
import AgentTeam from '../src/index.ts'
import { AgentTeamLedger } from '../src/ledger.ts'
import type { AgentTeamLedgerResult, AgentTeamSessionTurnResult } from '../src/ledger.ts'
import { turnFailureNoticeRequestId } from '../src/turn-recorder.ts'
import type { AgentTeamAgentMember, AgentTeamMemberActor, AgentTeamOperation, AgentTeamOperationId, AgentTeamRequestId, AgentTeamRoomActivityResult, AgentTeamThreadRef, AgentTeamChannelRef, AgentTeamMessage } from '../src/types.ts'

// L3 (§19.1): one read RPC over the existing projection. Driving the Host surface end to end is the
// point — the not-found mapping, the server-side clamp and the sticky-null buckets must hold the way
// the Client will meet them. No new operation kind exists, so nothing here writes beyond seeded ops.
const cleanups: Array<() => Promise<void>> = []
const alpha = WorkspaceId('workspace:alpha')
const beta = WorkspaceId('workspace:beta')
const requestId = (value: string) => value as AgentTeamRequestId
const channelRef = (value: string) => value as AgentTeamChannelRef
const threadRef = (value: string) => value as AgentTeamThreadRef

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(cleanup => cleanup()))
})

interface Room {
  readonly host: AgentTeam
  /** The ledger the Host itself folds; Turn writes must land in this projection. */
  readonly hostLedger: AgentTeamLedger
  readonly ledger: () => AgentTeamLedger
  readonly messageA: AgentTeamMessage
  readonly messageB: AgentTeamMessage
  readonly threadRevisionA: number
  readonly channelRef: AgentTeamChannelRef
  readonly otherChannelRef: AgentTeamChannelRef
  readonly seatA: AgentTeamAgentMember
  readonly seatB: AgentTeamAgentMember
  readonly actorA: AgentTeamMemberActor
  readonly actorB: AgentTeamMemberActor
  readonly threadA: AgentTeamThreadRef
  readonly threadB: AgentTeamThreadRef
}

async function room(): Promise<Room> {
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
  // The Host owns the ledger behind a getter, so the Ledger instances used here are the same
  // projection the read RPC folds — no second copy of state can drift from the one it reads.

  const channel = await host.createChannel({ requestId: requestId('room-channel'), workspaceId: alpha, name: 'room', description: '' })
  const other = await host.createChannel({ requestId: requestId('room-other'), workspaceId: alpha, name: 'other', description: '' })
  const seatA = (await host.addMember({ requestId: requestId('room-seat-a'), workspaceId: alpha, handle: 'seat-a', description: 'Seat A', presetId: 'team-member', channelRefs: [channel.channel.channelRef] })).status.member
  const seatB = (await host.addMember({ requestId: requestId('room-seat-b'), workspaceId: alpha, handle: 'seat-b', description: 'Seat B', presetId: 'team-member', channelRefs: [channel.channel.channelRef] })).status.member
  const actorA: AgentTeamMemberActor = { kind: 'member', memberId: seatA.memberId, handle: seatA.handle }
  const actorB: AgentTeamMemberActor = { kind: 'member', memberId: seatB.memberId, handle: seatB.handle }
  const first = committed(await host.sendMessage({ requestId: requestId('room-a'), workspaceId: alpha, channelRef: channel.channel.channelRef, body: 'Thread A anchor', asTask: false }))
  const second = committed(await host.sendMessage({ requestId: requestId('room-b'), workspaceId: alpha, channelRef: channel.channel.channelRef, body: 'Thread B anchor', asTask: false }))
  return { host, hostLedger: (host as unknown as { ledger: AgentTeamLedger }).ledger, ledger: () => new AgentTeamLedger(facility.get('agent_team')!.table('operations') as unknown as KvTable<AgentTeamOperationId, AgentTeamOperation>), messageA: first.message, messageB: second.message, threadRevisionA: first.thread.revision, channelRef: channel.channel.channelRef, otherChannelRef: other.channel.channelRef, seatA, seatB, actorA, actorB, threadA: first.thread.threadRef, threadB: second.thread.threadRef }
}







function committed<T extends { readonly kind: string }>(result: T): Extract<T, { readonly kind: 'committed' }> {
  if (result.kind !== 'committed') throw new Error(`expected committed result, received ${result.kind}`)
  return result as Extract<T, { readonly kind: 'committed' }>
}

/** One recorded Turn, written the way the Host recorder writes it — same request shape. */
function turn(space: Room, input: {
  readonly sessionId: SessionIdType
  readonly member: AgentTeamAgentMember
  readonly actor: AgentTeamMemberActor
  readonly turn: number
  readonly threadRef: AgentTeamThreadRef
  readonly uncachedInputTokens: number | null
  readonly outputTokens: number
  readonly cacheReadTokens: number | null
  readonly cacheWriteTokens: number | null
  readonly toolCalls?: number
  readonly runMs?: number
}): Promise<AgentTeamLedgerResult<AgentTeamSessionTurnResult>> {
  return space.hostLedger.recordSessionTurn({
    requestId: requestId(`turn-${String(input.sessionId)}-${input.turn}`),
    workspaceId: alpha,
    memberId: input.member.memberId,
    sessionId: input.sessionId,
    turn: input.turn,
    startedAt: '2026-10-15T01:00:00.000Z',
    endedAt: '2026-10-15T01:00:05.000Z',
    threadRefs: [input.threadRef],
    toolCalls: input.toolCalls ?? 2,
    runMs: input.runMs ?? 500,
    usage: {
      uncachedInputTokens: input.uncachedInputTokens,
      outputTokens: input.outputTokens,
      cacheReadTokens: input.cacheReadTokens,
      cacheWriteTokens: input.cacheWriteTokens,
      reasoningTokens: null,
    },
    actor: input.actor,
  })
}

function failure(space: Room, input: {
  readonly sessionId: SessionIdType
  readonly member: AgentTeamAgentMember
  readonly actor: AgentTeamMemberActor
  readonly turn: number
  readonly threadRef: AgentTeamThreadRef
  readonly reason: string
}): Promise<unknown> {
  return space.hostLedger.recordTurnFailureNotice({
    requestId: turnFailureNoticeRequestId(input.sessionId, input.turn, input.threadRef),
    workspaceId: alpha,
    threadRef: input.threadRef,
    memberId: input.member.memberId,
    sessionId: input.sessionId,
    turn: input.turn,
    reason: input.reason,
    actor: input.actor,
  })
}

describe('roomActivity (§19.1)', () => {
  it('scopes a Thread read to that Thread with sticky-null totals and a bounded message body', async () => {
    const space = await room()
    const posted = committed(await space.host.reply({ requestId: requestId('room-thread-a-message'), workspaceId: alpha, threadRef: space.threadA, body: `Posting in A${String.fromCharCode(10)}this tail line must never leave the RPC`, baseRevision: space.threadRevisionA })).message
    const bubble = committed(await space.host.sendMessage({ requestId: requestId('room-thread-a-bubble'), workspaceId: alpha, channelRef: space.channelRef, body: 'Posting in B', asTask: false })).message
    await turn(space, { sessionId: SessionId('session-local-a'), member: space.seatA, actor: space.actorA, turn: 1, threadRef: space.threadA, uncachedInputTokens: 100, outputTokens: 40, cacheReadTokens: 900, cacheWriteTokens: null, toolCalls: 3, runMs: 1200 })
    await turn(space, { sessionId: SessionId('session-local-a'), member: space.seatA, actor: space.actorA, turn: 2, threadRef: space.threadA, uncachedInputTokens: null, outputTokens: 12, cacheReadTokens: 80, cacheWriteTokens: 30, toolCalls: 1, runMs: 300 })
    await failure(space, { sessionId: SessionId('session-local-a'), member: space.seatA, actor: space.actorA, turn: 3, threadRef: space.threadA, reason: 'provider refused to answer' })
    await turn(space, { sessionId: SessionId('session-local-b'), member: space.seatB, actor: space.actorB, turn: 1, threadRef: space.threadB, uncachedInputTokens: 500, outputTokens: 90, cacheReadTokens: null, cacheWriteTokens: 200, toolCalls: 4, runMs: 700 })

    const thread = await space.host.roomActivity({ workspaceId: alpha, channelRef: space.channelRef, threadRef: space.threadA })
    expect(thread.scope).toBe('thread')
    expect(thread.totals.messages).toBe(2)
    expect(thread.totals.turns).toBe(2)
    // One Turn reported no uncached input (null), so only that bucket stays null (§3.2) — never folded to 0.
    // The other three buckets were proven by the same Turn, so they still sum.
    expect(thread.totals.tokensIn).toBeNull()
    expect(thread.totals.tokensOut).toBe(52)
    expect(thread.totals.cacheRead).toBe(980)
    expect(thread.totals.cacheWrite).toBeNull()
    expect(thread.totals.toolCalls).toBe(4)
    expect(thread.totals.runMs).toBe(1500)
    expect(thread.totals.failedTurns).toBe(1)
    const seats = thread.perAgent.filter(agent => agent.memberId === space.seatA.memberId)
    expect(seats).toHaveLength(1)
    expect(seats[0]!.tokensIn).toBeNull()
    expect(seats[0]!.tokensOut).toBe(52)
    expect(seats[0]!.cacheRead).toBe(980)
    expect(seats[0]!.cacheWrite).toBeNull()
    expect(seats[0]!.turns).toBe(2)
    expect(seats[0]!.failedTurns).toBe(1)
    expect(seats[0]!.sessionIds).toEqual(['session-local-a'])
    const bodies = thread.events.filter(event => event.kind === 'team/message-sent' || event.kind === 'team/thread-replied').map(event => event.summary)
    expect(bodies.join(' ')).toContain('Posting in A')
    expect(bodies.join(' ')).not.toContain('must never leave the RPC')
    expect(posted.messageRef).toBeDefined()
    // The channel message opens its own Thread, so it never lands in Thread B.
    expect(bubble.threadRef).not.toBe(space.threadB)
    expect(bubble.threadRef).not.toBe(space.threadA)
  })

  it('folds every Thread of a Channel into the Channel read and rejects unknown refs as typed not-found', async () => {
    const space = await room()
    await space.host.sendMessage({ requestId: requestId('room-channel-message'), workspaceId: alpha, channelRef: space.channelRef, body: 'channel wide', asTask: false })
    await turn(space, { sessionId: SessionId('session-local-a'), member: space.seatA, actor: space.actorA, turn: 1, threadRef: space.threadA, uncachedInputTokens: 10, outputTokens: 5, cacheReadTokens: 20, cacheWriteTokens: 1, toolCalls: 1, runMs: 100 })
    await turn(space, { sessionId: SessionId('session-local-b'), member: space.seatB, actor: space.actorB, turn: 1, threadRef: space.threadB, uncachedInputTokens: 30, outputTokens: 6, cacheReadTokens: 40, cacheWriteTokens: 2, toolCalls: 2, runMs: 200 })

    const channel = await space.host.roomActivity({ workspaceId: alpha, channelRef: space.channelRef })
    expect(channel.scope).toBe('channel')
    expect(channel.totals.messages).toBe(3)
    expect(channel.totals.turns).toBe(2)
    expect(channel.totals.tokensIn).toBe(40)
    // Every sender counts, including the Human who anchored each Thread.
    expect(channel.perAgent.map(agent => agent.memberId).sort()).toEqual([space.seatA.memberId, space.seatB.memberId, 'member:human'].sort())
    const threadA = await space.host.roomActivity({ workspaceId: alpha, channelRef: space.channelRef, threadRef: space.threadA })
    expect(channel.totals.turns).toBeGreaterThanOrEqual(threadA.totals.turns)

    const foreign = await space.host.roomActivity({ workspaceId: alpha, channelRef: space.otherChannelRef })
    expect(foreign.totals.messages).toBe(0)
    for (const missing of [{ channelRef: channelRef('channel:deadbeefdeadbeef') }, { channelRef: space.channelRef, threadRef: threadRef('thread:deadbeefdeadbeef') }]) {
      let error: unknown
      try {
        await space.host.roomActivity({ workspaceId: alpha, ...missing })
      } catch (thrown) {
        error = thrown
      }
      expect((error as { code?: string }).code).toBe('team/room-activity-not-found')
    }
  })

  it('clamps an over-limit request instead of rejecting it, and pages on the cursor', async () => {
    const space = await room()
    for (let index = 0; index < 5; index += 1) {
      await space.host.sendMessage({ requestId: requestId(`room-clamp-${index}`), workspaceId: alpha, channelRef: space.channelRef, body: `overflow ${index}`, asTask: false })
    }
    const page = await space.host.roomActivity({ workspaceId: alpha, channelRef: space.channelRef, limit: 100_000 })
    expect(page.events.length).toBeLessThanOrEqual(200)
    expect(page.events.length).toBeGreaterThan(0)
    const bounded = await space.host.roomActivity({ workspaceId: alpha, channelRef: space.channelRef, limit: 2 })
    expect(bounded.events).toHaveLength(2)
    expect(bounded.nextCursor).toBeDefined()
    const next = await space.host.roomActivity({ workspaceId: alpha, channelRef: space.channelRef, limit: 2, cursor: bounded.nextCursor ?? '' })
    expect(next.events).toHaveLength(2)
    expect(next.events[0]!.sequence).toBeLessThan(bounded.events[0]!.sequence)
  })

  it('rejects a Thread paired with a foreign Channel and an archived Channel, both scopes', async () => {
    const space = await room()
    // Thread scope: the Thread must belong to the requested Channel, not merely be resolvable.
    let foreignScope: unknown
    try {
      await space.host.roomActivity({ workspaceId: alpha, channelRef: space.otherChannelRef, threadRef: space.threadA })
    } catch (thrown) { foreignScope = thrown }
    expect((foreignScope as { code?: string }).code).toBe('team/room-activity-not-found')
    expect((foreignScope as { message?: string }).message).toContain('does not belong to Channel')

    await space.host.archiveChannel({ requestId: requestId('room-archive'), workspaceId: alpha, channelRef: space.channelRef })
    for (const missing of [{ channelRef: space.channelRef }, { channelRef: space.channelRef, threadRef: space.threadA }]) {
      let error: unknown
      try {
        await space.host.roomActivity({ workspaceId: alpha, ...missing })
      } catch (thrown) { error = thrown }
      expect((error as { code?: string }).code).toBe('team/room-activity-not-found')
    }
    // A live Channel next to an archived one stays readable, so the rejection is the Channel's, not the Workspace's.
    const foreign = await space.host.roomActivity({ workspaceId: alpha, channelRef: space.otherChannelRef })
    expect(foreign.scope).toBe('channel')
  })

  it('keeps null buckets independent, so one unproven bucket nulls only itself', async () => {
    const space = await room()
    // Only cacheWrite is unproven here; the input split, output and cache read are all reported.
    await turn(space, { sessionId: SessionId('session-buckets'), member: space.seatA, actor: space.actorA, turn: 1, threadRef: space.threadA, uncachedInputTokens: 100, outputTokens: 40, cacheReadTokens: 900, cacheWriteTokens: null })
    await turn(space, { sessionId: SessionId('session-buckets'), member: space.seatA, actor: space.actorA, turn: 2, threadRef: space.threadA, uncachedInputTokens: 200, outputTokens: 60, cacheReadTokens: 100, cacheWriteTokens: null })
    await turn(space, { sessionId: SessionId('session-buckets-b'), member: space.seatB, actor: space.actorB, turn: 1, threadRef: space.threadA, uncachedInputTokens: 50, outputTokens: 10, cacheReadTokens: 20, cacheWriteTokens: 5 })

    const thread = await space.host.roomActivity({ workspaceId: alpha, channelRef: space.channelRef, threadRef: space.threadA })
    // Seat A: the only unproven bucket is cacheWrite.
    const seatA = thread.perAgent.filter(agent => agent.memberId === space.seatA.memberId)
    expect(seatA).toHaveLength(1)
    expect(seatA[0]!.tokensIn).toBe(300)
    expect(seatA[0]!.tokensOut).toBe(100)
    expect(seatA[0]!.cacheRead).toBe(1000)
    expect(seatA[0]!.cacheWrite).toBeNull()
    // Seat B proves every bucket, so its row is fully statable.
    const seatB = thread.perAgent.filter(agent => agent.memberId === space.seatB.memberId)
    expect(seatB[0]!.tokensIn).toBe(50)
    expect(seatB[0]!.cacheWrite).toBe(5)
    // A total across members inherits a null from exactly the one bucket that carries it.
    expect(thread.totals.tokensIn).toBe(350)
    expect(thread.totals.tokensOut).toBe(110)
    expect(thread.totals.cacheRead).toBe(1020)
    expect(thread.totals.cacheWrite).toBeNull()
    // Every Turn that left any bucket unproven counts as unrecorded, not only those with a null input split.
    expect(thread.totals.unrecordedTurns).toBe(2)
    expect(thread.totals.turns).toBe(3)
    // A scope with no Turn at all stays fully statable at every bucket.
    const proven = await space.host.roomActivity({ workspaceId: alpha, channelRef: space.otherChannelRef })
    expect(proven.totals.tokensIn).toBe(0)
    expect(proven.totals.unrecordedTurns).toBe(0)
  })

  it('rejects a cursor that cannot be a sequence instead of silently paging', async () => {
    const space = await room()
    await space.host.sendMessage({ requestId: requestId('room-cursor'), workspaceId: alpha, channelRef: space.channelRef, body: 'cursor row', asTask: false })
    for (const cursor of ['abc', '', '-1', '1e400', 'NaN', ' 12']) {
      let error: unknown
      try {
        await space.host.roomActivity({ workspaceId: alpha, channelRef: space.channelRef, cursor })
      } catch (thrown) { error = thrown }
      expect((error as { message?: string }).message).toContain('room activity cursor')
      expect((error as { name?: string }).name).toBe('RemoteError')
    }
        // A well-formed sequence still pages, and the page it returns is bounded by that sequence.
    const newest = await space.host.roomActivity({ workspaceId: alpha, channelRef: space.channelRef })
    const cursor = String(newest.events[0]!.sequence)
    const page = await space.host.roomActivity({ workspaceId: alpha, channelRef: space.channelRef, cursor })
    expect(page.events.every(event => event.sequence <= Number(cursor))).toBe(true)
  })
})








