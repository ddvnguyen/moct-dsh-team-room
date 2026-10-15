import { afterEach, describe, expect, it, vi } from 'vitest'
// Harness boots over a throwaway tree; CI's worst cold replay needs headroom.
vi.setConfig({ testTimeout: 30_000 })
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { MemoryMediaPool, MemoryStorageBackend } from './helpers/memory-backend.ts'
import { completeTurnEvents } from './helpers/turn-events.ts'
import AgentTeam from '../src/index.ts'
import type { AgentTeamLedger } from '../src/ledger.ts'
import { AgentTeamTurnRecorder } from '../src/turn-recorder.ts'
import type { AgentTeamMemberId, AgentTeamRequestId, AgentTeamThreadRef } from '../src/types.ts'

interface TeamHarness {
  readonly ctx: Context
  readonly fiber: Awaited<ReturnType<Context['plugin']>>
  readonly facility: DomainFacility
}

/** The Host row's `poisonRecovery` section, as a deployment's patch layer passes it. */
interface PoisonRecoveryConfig {
  readonly poisonRecovery: {
    readonly enabled: boolean
    readonly provider?: string
    readonly model?: string
  }
}

const cleanups: Array<() => Promise<void>> = []
const alpha = WorkspaceId('workspace:alpha')
const requestId = (value: string): AgentTeamRequestId => value as AgentTeamRequestId

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(cleanup => cleanup()))
})

async function harness(config?: PoisonRecoveryConfig): Promise<TeamHarness> {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  ctx.provide('workspaceRegistry', {
    get: (id: WorkspaceId) => id === alpha ? { id, path: process.cwd(), attachSession: async () => {} } : undefined,
    list: () => [alpha],
    archiveSession: async () => {},
  })
  ctx.provide('agents', { create: async () => { throw new Error('unused') }, resume: async () => { throw new Error('unused') } })
  ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'mock', model: 'mock' }) })
  ctx.provide('agentPresets', { mount: async () => { throw new Error('unused') } })
  ctx.provide('tools', { schemas: () => [] })
  ctx.provide('sessionPersistence', { list: async () => [] })
  await ctx.plugin(SessionProjectionRegistry)
  const fiber = config === undefined ? await ctx.plugin(AgentTeam) : await ctx.plugin(AgentTeam, config)
  cleanups.push(async () => { await fiber.dispose(); await facility.closeAll() })
  return { ctx, fiber, facility }
}

/**
 * A Host with one Member seated on a live stub agent identity, matching
 * agent-team.spec's A4 pattern, but keyed so memberStatus and recoverMember
 * see the live generation: agent.id === member.sessionId (no rollover) and a
 * composed-preset answer (the stub has no agent ctx). `steer` records the
 * resume an unpoisoned recovery would queue.
 */
async function poisonHost(config?: PoisonRecoveryConfig) {
  const test = await harness(config)
  const host = test.ctx.agentTeam
  const presets = test.ctx.agentPresets as unknown as { mount: () => Promise<never>; composedPreset?: (agentCtx: unknown) => string }
  presets.composedPreset = () => 'team-member'
  const channel = await host.createChannel({ requestId: requestId('pr-channel'), workspaceId: alpha, name: 'pr', description: '' })
  const member = (await host.addMember({
    requestId: requestId('pr-seat'), workspaceId: alpha, handle: 'seat-b', description: 'Seat B', presetId: 'team-member', channelRefs: [channel.channel.channelRef],
  })).status.member
  const session = { id: member.sessionId, header: {}, inheritedEventCount: 0, seq: 0, snapshotEvents: () => [] }
  const steer = vi.fn()
  const agent = {
    id: member.sessionId, session, status: 'idle', steer,
    inbox: { nextStep: [], nextTurn: [], remove: () => undefined },
  }
  const internals = host as unknown as { handles: Map<unknown, unknown>; memberBySessionId: Map<unknown, unknown>; modelSelections: Map<AgentTeamMemberId, { current: unknown; assembled: unknown }>; clearMemberFailure: (id: AgentTeamMemberId, slot: 'activation') => boolean }
  // addMember ran activateMember, which failed against the throwaway `agents`
  // stub and left an activation diagnostic; a seat seated on a live stub agent
  // stands for one whose activation succeeded, so drop the slot — memberStatus
  // consults it before the poison branch.
  internals.clearMemberFailure(member.memberId, 'activation')
  internals.handles.set(member.memberId, { agent })
  internals.memberBySessionId.set(member.sessionId, member.memberId)
  // Mirrors the modelSelections entry a successful activation writes
  // (src/index.ts:3427); updateMember rejects a model edit on a live handle
  // that lacks one.
  internals.modelSelections.set(member.memberId, { current: { provider: 'mock', model: 'mock' }, assembled: undefined })
  return { test, host, member, session, agent, steer }
}

type OperationRow = { readonly kind: string; readonly data: Record<string, unknown> }

function operationRows(test: TeamHarness): OperationRow[] {
  return [...test.facility.get('agent_team')!.table('operations').entries()]
    .map(([, operation]) => operation as unknown as OperationRow)
}

/** Team-message ops that are the poison notice (the body nests under data.message). */
type PoisonCardRow = { readonly kind: string; readonly data: { readonly message: { readonly body: string } } }

function poisonCards(test: TeamHarness): PoisonCardRow[] {
  return operationRows(test).filter((operation): operation is PoisonCardRow =>
    operation.kind === 'team/message-sent'
    && String((operation.data as { message?: { body?: string } }).message?.body ?? '').includes('Provider-poisoned seat:'))
}

function rowFor<T extends { readonly member: { readonly memberId: AgentTeamMemberId } }>(host: { members(): readonly T[] }, memberId: AgentTeamMemberId): T | undefined {
  return host.members().find(status => status.member.memberId === memberId)
}

/**
 * One errored Turn with the poison signature: identical 4xx INVALID_REQUEST,
 * zero reported usage. Seqs must stay a contiguous prefix of the session log:
 * the projection registry folds an event stream gaplessly (it falls back to
 * `session.eventAt`, which the stub does not implement, on any hole).
 */
function emitPoisonTurn(test: TeamHarness, session: unknown, turn: number, failure: { status?: number; code: string } = { status: 400, code: 'INVALID_REQUEST' }): void {
  test.ctx.emit('session/event', session as never, { type: 'turn/start', seq: turn * 2 - 1, time: Date.now(), data: { turn } } as never)
  test.ctx.emit('session/event', session as never, {
    type: 'turn/end', seq: turn * 2, time: Date.now(),
    data: { turn, reason: { kind: 'error', error: { message: 'provider refused the request body', ...failure } } },
  } as never)
}

/** A completed Turn whose text emits the tool-call markup while the message carries no tool-call part (item 3). */
function malformedTurnEvents(turn: number, firstSeq = 1): SessionEvent[] {
  const time = Date.UTC(2026, 9, 12)
  const usage = { inputTokens: 10, outputTokens: 5, totalTokens: 15, cacheReadTokens: 0, cacheWriteTokens: 0 }
  const event = (offset: number, type: string, data: unknown) => ({ seq: firstSeq + offset, time: time + offset * 1000, type, data }) as unknown as SessionEvent
  return [
    event(0, 'turn/start', { turn }),
    event(1, 'step/start', { turn, step: 1 }),
    event(2, 'assistant/message', {
      turn, step: 1, stream: [],
      message: {
        id: `message-${turn}`, role: 'assistant',
        content: [{ type: 'text', text: 'Sure:\n<atem:function_calls>\n<default.bash command="pwd"/>\n</atem:function_calls>' }],
        source: { kind: 'model', provider: 'deepseek', model: 'deepseek-chat' },
      },
      usage,
    }),
    event(3, 'step/end', { turn, step: 1 }),
    event(4, 'turn/end', { turn, reason: { kind: 'completed' } }),
  ]
}

// ---------------------------------------------------------------------------
// Recorder-level: streak decoration, clear, and the malformed refusal.
// ---------------------------------------------------------------------------

const memberId = 'member:recorder-poison' as AgentTeamMemberId
const sessionId = 'session:recorder-poison' as SessionId
const threadA = 'thread:recorder-poison' as AgentTeamThreadRef

function fakeLedger() {
  return {
    projectionSequence: vi.fn(() => 7),
    attributionSequence: vi.fn(() => 7),
    getMember: vi.fn(() => ({ memberId, handle: 'recorder-poison' })),
    workspacesOf: vi.fn(() => ['workspace:w']),
    repliedThreadsBetween: vi.fn(() => []),
    recordSessionTurn: vi.fn(async (_request: Record<string, unknown>) => ({ committed: true, value: {} })),
    recordTurnFailureNotice: vi.fn(async (_request: Record<string, unknown>) => ({ committed: true, value: {} })),
  }
}

const start = (turn: number) => ({ type: 'turn/start', seq: turn * 10 + 1, time: turn, data: { turn } }) as never
const poisonEnd = (turn: number, failure: { status?: number; code: string } = { status: 400, code: 'INVALID_REQUEST' }) => ({
  type: 'turn/end', seq: turn * 10 + 2, time: turn,
  data: { turn, reason: { kind: 'error', error: { message: 'provider refused the request body', ...failure } } },
}) as never

describe('AgentTeamTurnRecorder poison streak (task-11 items 1 and 3)', () => {
  it('decorates delivered failure notices with the streak count past the threshold and reports the crossing once', async () => {
    const ledger = fakeLedger()
    const onPoisoned = vi.fn()
    const recorder = new AgentTeamTurnRecorder(() => ledger as unknown as AgentTeamLedger, () => undefined, undefined, undefined, undefined, onPoisoned)
    for (const turn of [1, 2, 3]) {
      recorder.noteDelivered(memberId, [threadA])
      recorder.onSessionEvent(memberId, sessionId, start(turn))
      recorder.onSessionEvent(memberId, sessionId, poisonEnd(turn))
    }
    await vi.waitFor(() => expect(ledger.recordTurnFailureNotice).toHaveBeenCalledTimes(3))
    await vi.waitFor(() => expect(onPoisoned).toHaveBeenCalledTimes(1))
    expect(onPoisoned).toHaveBeenCalledWith(memberId, expect.objectContaining({
      failedTurns: 3, signature: '400:INVALID_REQUEST', turn: 3, sessionId,
    }), true)
    const reasons = ledger.recordTurnFailureNotice.mock.calls.map(([request]) => (request as { reason: string }).reason)
    expect(reasons[0]).not.toContain('consecutive')
    expect(reasons[2]).toContain('3 consecutive identical provider failures')
    expect(recorder.poisonedVerdict(memberId, sessionId)).toMatchObject({ failedTurns: 3, signature: '400:INVALID_REQUEST' })
    expect(recorder.unrecordedTurns).toEqual({ failed: 0, unprovable: 3 })
  })

  it('a clean recorded Turn clears the streak and fires onPoisonCleared', async () => {
    const ledger = fakeLedger()
    const onPoisoned = vi.fn()
    const onPoisonCleared = vi.fn()
    const recorder = new AgentTeamTurnRecorder(() => ledger as unknown as AgentTeamLedger, () => undefined, undefined, undefined, undefined, onPoisoned, onPoisonCleared)
    for (const turn of [1, 2, 3]) {
      recorder.onSessionEvent(memberId, sessionId, start(turn))
      recorder.onSessionEvent(memberId, sessionId, poisonEnd(turn))
    }
    await vi.waitFor(() => expect(onPoisoned).toHaveBeenCalledTimes(1))
    for (const event of completeTurnEvents({ turn: 4, firstSeq: 41 })) recorder.onSessionEvent(memberId, sessionId, event)
    await vi.waitFor(() => expect(ledger.recordSessionTurn).toHaveBeenCalledTimes(1))
    expect(onPoisonCleared).toHaveBeenCalledTimes(1)
    expect(recorder.poisonedVerdict(memberId)).toBeUndefined()
  })

  it('refuses a tool-call-shaped generation instead of recording it, and never treats it as recovery', async () => {
    const ledger = fakeLedger()
    const onPoisonCleared = vi.fn()
    const onUnrecorded = vi.fn()
    const recorder = new AgentTeamTurnRecorder(() => ledger as unknown as AgentTeamLedger, () => undefined, undefined, undefined, onUnrecorded, undefined, onPoisonCleared)
    for (const turn of [1, 2, 3]) {
      recorder.onSessionEvent(memberId, sessionId, start(turn))
      recorder.onSessionEvent(memberId, sessionId, poisonEnd(turn))
    }
    // Three errored Turns are already unprovable; the malformed Turn adds one.
    await vi.waitFor(() => expect(recorder.unrecordedTurns.unprovable).toBe(3))
    for (const event of malformedTurnEvents(4, 41)) recorder.onSessionEvent(memberId, sessionId, event)
    await vi.waitFor(() => expect(recorder.unrecordedTurns.unprovable).toBe(4))
    expect(onUnrecorded).toHaveBeenCalledTimes(1)
    expect(onUnrecorded.mock.calls[0]![0]).toContain('malformed generation')
    expect(onUnrecorded.mock.calls[0]![0]).toContain('<atem:function_calls>')
    expect(ledger.recordSessionTurn).not.toHaveBeenCalled()
    // The refusal is not recovery: the provider rejection streak stays intact.
    expect(onPoisonCleared).not.toHaveBeenCalled()
    expect(recorder.poisonedVerdict(memberId, sessionId)).toMatchObject({ failedTurns: 3 })
  })
})

// ---------------------------------------------------------------------------
// Host-level: sidebar presence, the Team-room card, recoverMember's answer.
// ---------------------------------------------------------------------------

describe('provider-poison surfacing and recovery (task-11 items 1 and 4)', () => {
  it('flags the seat after three identical zero-usage rejections and posts one Team-room card', async () => {
    const { test, host, member, session } = await poisonHost()
    expect(rowFor(host, member.memberId)?.presence).toBe('available')
    for (const turn of [1, 2, 3]) emitPoisonTurn(test, session, turn)
    await vi.waitFor(() => expect(rowFor(host, member.memberId)?.diagnostic?.detail).toContain('provider-poisoned session: 3 consecutive'))
    const row = rowFor(host, member.memberId)
    expect(row).toMatchObject({ availability: 'active', presence: 'error', diagnostic: { class: 'runtime' } })
    expect(row?.diagnostic?.detail).toContain('400:INVALID_REQUEST')
    expect(row?.diagnostic?.detail).toContain('switch its model')

    await vi.waitFor(() => expect(poisonCards(test)).toHaveLength(1))
    const body = String(poisonCards(test)[0]!.data.message.body)
    expect(body).toContain('@seat-b failed 3 consecutive Turns')
    expect(body).toContain('400:INVALID_REQUEST')
    // Unresolvable against this Channel's membership they stay prose, never a failed mention.
    expect(body).toContain('@Lead @Architect')
  })

  it('does not re-queue a poisoned seat: recoverMember reports the same error instead (item 4)', async () => {
    const { test, host, member, session, steer } = await poisonHost()
    for (const turn of [1, 2, 3]) emitPoisonTurn(test, session, turn)
    await vi.waitFor(() => expect(rowFor(host, member.memberId)?.diagnostic?.detail).toContain('provider-poisoned'))
    const result = await host.recoverMember({ requestId: requestId('pr-recover'), workspaceId: alpha, memberId: member.memberId })
    expect(result.sameError).toMatchObject({ failedTurns: 3 })
    expect(result.sameError?.detail).toContain('same error again: 3 consecutive')
    expect(result.sameError?.detail).toContain('400:INVALID_REQUEST')
    expect(result.status.presence).toBe('error')
    expect(steer).not.toHaveBeenCalled()
  })

  it('reports the same error again after further identical failures, without a second card', async () => {
    const { test, host, member, session, steer } = await poisonHost()
    for (const turn of [1, 2, 3]) emitPoisonTurn(test, session, turn)
    await vi.waitFor(() => expect(rowFor(host, member.memberId)?.diagnostic?.detail).toContain('provider-poisoned'))
    emitPoisonTurn(test, session, 4)
    await vi.waitFor(() => expect(rowFor(host, member.memberId)?.diagnostic?.detail).toContain('4 consecutive'))
    const result = await host.recoverMember({ requestId: requestId('pr-recover-4'), workspaceId: alpha, memberId: member.memberId })
    expect(result.sameError).toMatchObject({ failedTurns: 4 })
    expect(steer).not.toHaveBeenCalled()
    await new Promise(resolve => setTimeout(resolve, 25))
    expect(poisonCards(test)).toHaveLength(1)
  })

  it('a seat below the threshold still recovers by steering', async () => {
    const { test, host, member, session, steer } = await poisonHost()
    emitPoisonTurn(test, session, 1)
    await vi.waitFor(() => expect(recorderOf(host).unrecordedTurns.unprovable).toBe(1))
    const result = await host.recoverMember({ requestId: requestId('pr-recover-below'), workspaceId: alpha, memberId: member.memberId })
    expect(result.sameError).toBeUndefined()
    expect(steer).toHaveBeenCalledTimes(1)
    expect(result.status.presence).not.toBe('error')
  })

  it('a clean recorded Turn clears the diagnosis and restores presence', async () => {
    const { test, host, member, session } = await poisonHost()
    for (const turn of [1, 2, 3]) emitPoisonTurn(test, session, turn)
    await vi.waitFor(() => expect(rowFor(host, member.memberId)?.presence).toBe('error'))
    for (const event of completeTurnEvents({ turn: 4, firstSeq: 7 })) test.ctx.emit('session/event', session as never, event as never)
    await vi.waitFor(() => expect(
      operationRows(test).filter(operation => operation.kind === 'team/session-turn-recorded' && operation.data.turn === 4),
    ).toHaveLength(1))
    await vi.waitFor(() => expect(rowFor(host, member.memberId)?.diagnostic?.detail ?? '').not.toContain('provider-poisoned'))
    expect(rowFor(host, member.memberId)?.presence).not.toBe('error')
    // Recovery is steering again once the streak is gone.
    const result = await host.recoverMember({ requestId: requestId('pr-recover-clean'), workspaceId: alpha, memberId: member.memberId })
    expect(result.sameError).toBeUndefined()
  })

  it('refuses the malformed generation at the host level and keeps the diagnosis', async () => {
    const { test, host, member, session, steer } = await poisonHost()
    for (const turn of [1, 2, 3]) emitPoisonTurn(test, session, turn)
    await vi.waitFor(() => expect(rowFor(host, member.memberId)?.presence).toBe('error'))
    const unprovableBefore = recorderOf(host).unrecordedTurns.unprovable
    for (const event of malformedTurnEvents(4, 7)) test.ctx.emit('session/event', session as never, event as never)
    await vi.waitFor(() => expect(recorderOf(host).unrecordedTurns.unprovable).toBe(unprovableBefore + 1))
    // Never persisted as completed, and not treated as recovery either.
    expect(
      operationRows(test).filter(operation => operation.kind === 'team/session-turn-recorded' && operation.data.turn === 4),
    ).toHaveLength(0)
    expect(rowFor(host, member.memberId)?.diagnostic?.detail).toContain('provider-poisoned')
    const result = await host.recoverMember({ requestId: requestId('pr-recover-malformed'), workspaceId: alpha, memberId: member.memberId })
    expect(result.sameError).toMatchObject({ failedTurns: 3 })
    expect(steer).not.toHaveBeenCalled()
  })
})

function recorderOf(host: unknown): { unrecordedTurns: { failed: number; unprovable: number } } {
  return (host as { turnRecorder: { unrecordedTurns: { failed: number; unprovable: number } } }).turnRecorder
}

// ---------------------------------------------------------------------------
// Host-level: poisoned-seat auto-recovery (task-11 item 2, default OFF).
// ---------------------------------------------------------------------------

describe('poisoned-seat auto-recovery (task-11 item 2)', () => {
  it('default OFF: the crossing stays a flag — no renewal, no model swap, diagnosis intact', async () => {
    const { test, host, member, session } = await poisonHost()
    for (const turn of [1, 2, 3]) emitPoisonTurn(test, session, turn)
    await vi.waitFor(() => expect(poisonCards(test)).toHaveLength(1))
    // The OFF path returns before its first await, so the card is the whole crossing:
    // give any stray recovery a moment and nothing may follow it.
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(operationRows(test).filter(operation => operation.kind === 'team/member-session-renewed')).toHaveLength(0)
    expect(operationRows(test).filter(operation => operation.kind === 'team/member-updated')).toHaveLength(0)
    expect(rowFor(host, member.memberId)?.diagnostic?.detail).toContain('provider-poisoned')
    expect(rowFor(host, member.memberId)?.presence).toBe('error')
  })

  it('opted in: the crossing renews the session from a fresh context and clears the diagnosis', async () => {
    const { test, host, member, session, steer } = await poisonHost({ poisonRecovery: { enabled: true } })
    for (const turn of [1, 2, 3]) emitPoisonTurn(test, session, turn)
    await vi.waitFor(() => expect(
      operationRows(test).filter(operation => operation.kind === 'team/member-session-renewed'),
    ).toHaveLength(1))
    // The card still fires: auto-recovery is additive, not a replacement for the operator's notice.
    await vi.waitFor(() => expect(poisonCards(test)).toHaveLength(1))
    // No route configured → the seat keeps its model; only the context is fresh.
    expect(operationRows(test).filter(operation => operation.kind === 'team/member-updated')).toHaveLength(0)
    await vi.waitFor(() => expect(rowFor(host, member.memberId)?.diagnostic?.detail ?? '').not.toContain('provider-poisoned'))
    expect(rowFor(host, member.memberId)?.presence).not.toBe('error')
    // The seat restarts by renewal, never by a steered resume. Any steer the
    // card's own delivery performs is the ordinary Inbox wake (summary
    // 'Team Inbox has unread work.'); only the recovery resume carries
    // RECOVERY_NOTICE_SUMMARY (src/index.ts:189).
    const recoverySteers = steer.mock.calls
      .filter(([message]) => (message as { source?: { summary?: string } }).source?.summary === 'Recovery: continue your interrupted work.')
    expect(recoverySteers).toHaveLength(0)
  })

  it('opted in with a route: the model swap lands before the fresh context', async () => {
    const { test, host, member, session } = await poisonHost({ poisonRecovery: { enabled: true, provider: 'mock2', model: 'mock-backup' } })
    for (const turn of [1, 2, 3]) emitPoisonTurn(test, session, turn)
    await vi.waitFor(() => expect(
      operationRows(test).filter(operation => operation.kind === 'team/member-session-renewed'),
    ).toHaveLength(1))
    const rows = operationRows(test)
    const swap = rows.findIndex(operation => operation.kind === 'team/member-updated')
    const renew = rows.findIndex(operation => operation.kind === 'team/member-session-renewed')
    expect(swap).toBeGreaterThanOrEqual(0)
    expect(swap).toBeLessThan(renew)
    expect((rows[swap]!.data as { member: { model?: unknown } }).member.model).toEqual({ provider: 'mock2', model: 'mock-backup' })
    await vi.waitFor(() => expect(rowFor(host, member.memberId)?.diagnostic?.detail ?? '').not.toContain('provider-poisoned'))
  })
})
