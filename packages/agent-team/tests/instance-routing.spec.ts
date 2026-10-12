/**
 * Multi-instance contract v2 §2/§2a/§2b/§6: the slot router over a live Host.
 *
 * Slot 0 is a fake live handle; extra slots come from a fake `spawnSlotAgent` seam, so the
 * test sees every spawn. Acceptance rows covered:
 * - a new Thread arriving while slot 0 works goes to slot 1, which spawns and binds durably;
 * - an ended idle slot keeps its binding and respawns on the next message in that Thread;
 * - the seat status lists N slots, with the slot's Session and bound Threads;
 * - N=1 behaves as today: slot 0 takes everything, nothing spawns, nothing binds;
 * - extra slots act as @seat, and cannot write seat memory (host-side refusal).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { SessionId } from '@deepseek-ai/dsh-session'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { MemoryMediaPool, MemoryStorageBackend } from './helpers/memory-backend.ts'
import AgentTeam from '../src/index.ts'
import { agentTeamHumanActor } from '../src/ledger.ts'
import { memoryWriteRefusal, routeThreads } from '../src/instance-router.ts'
import * as agentTeamInvariant from '../src/invariant.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { AgentTeamChannelRef, AgentTeamMemberId, AgentTeamRequestId, AgentTeamThreadRef } from '../src/types.ts'

const cleanups: Array<() => Promise<void>> = []
const alpha = WorkspaceId('workspace:alpha')
const requestId = (value: string): AgentTeamRequestId => value as AgentTeamRequestId

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(cleanup => cleanup()))
})

async function harness(): Promise<{ readonly ctx: Context }> {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  ctx.provide('workspaceRegistry', {
    get: (id: WorkspaceId) => id === alpha ? { id, path: process.cwd(), attachSession: async () => {}, archiveSession: async () => {} } : undefined,
    list: () => [{ id: alpha, path: process.cwd() }],
    archiveSession: async () => {},
  })
  ctx.provide('agents', { create: async () => { throw new Error('unused') }, resume: async () => { throw new Error('unused') } })
  ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'mock', model: 'mock' }) })
  ctx.provide('agentPresets', { mount: async () => { throw new Error('unused') }, composedPreset: () => 'team-member' })
  ctx.provide('tools', { schemas: () => [] })
  ctx.provide('sessionPersistence', { list: async () => [] })
  await ctx.plugin(agentTeamInvariant)
  await ctx.plugin(SessionProjectionRegistry)
  const fiber = await ctx.plugin(AgentTeam)
  cleanups.push(async () => { await fiber.dispose(); await facility.closeAll() })
  return { ctx }
}

interface FakeAgent {
  readonly agent: Agent
  readonly calls: UserMessage[]
  setStatus(status: 'idle' | 'running'): void
}

function fakeAgent(sessionId: string, status: 'idle' | 'running'): FakeAgent {
  const calls: UserMessage[] = []
  const state = { status }
  const agent = {
    id: SessionId(sessionId),
    session: { id: SessionId(sessionId) },
    get status() { return state.status },
    inbox: { nextTurn: [], nextStep: [], remove: () => {} },
    steer: (message: UserMessage) => { calls.push(message) },
    followup: (message: UserMessage) => { calls.push(message) },
  } as unknown as Agent
  return { agent, calls, setStatus: next => { state.status = next } }
}

/** One enabled seat in the channel with a live slot 0, and a recording slot spawner. */
async function seat(ctx: Context, channelRef: AgentTeamChannelRef, options: { readonly instances?: number; readonly slotZero: 'idle' | 'running' }) {
  const memberId = `member:agent-${crypto.randomUUID()}` as AgentTeamMemberId
  const sessionId = SessionId(`session:${memberId}`)
  const member = {
    memberId, sessionId, workspaceId: alpha, handle: 'worker', description: 'Works', presetId: 'team-member',
    privateMemoryPath: '/mnt/workspace/fake-memory/worker', state: 'enabled' as const,
    ...(options.instances === undefined ? {} : { instances: options.instances }),
  }
  await ctx.agentTeam['ledger']!.addMember({
    requestId: requestId(`ledger-member-${memberId}`), workspaceId: alpha, handle: 'worker', description: 'Works', presetId: 'team-member',
    channelRefs: [channelRef], actor: agentTeamHumanActor(), member,
  })
  const slotZero = fakeAgent(sessionId, options.slotZero)
  ctx.agentTeam['handles'].set(memberId, { agent: slotZero.agent, dispose: async () => {} })
  ctx.agentTeam['memberBySessionId'].set(sessionId, memberId)
  const spawned: Array<{ readonly slot: number; readonly fake: FakeAgent }> = []
  ;(ctx.agentTeam as unknown as { spawnSlotAgent: unknown }).spawnSlotAgent = async (_member: unknown, slot: number) => {
    const fake = fakeAgent(`agent-team-slot-${slot}-${spawned.length + 1}`, 'idle')
    spawned.push({ slot, fake })
    return { handle: { agent: fake.agent, dispose: async () => {} }, selection: { current: { provider: 'mock', model: 'mock' }, assembled: undefined } }
  }
  return { memberId, slotZero, spawned }
}

const noticeText = (message: UserMessage | undefined): string => {
  const block = message?.content[0]
  return block !== undefined && 'text' in block ? String(block.text) : ''
}

describe('multi-instance slot router (contract v2)', () => {
  it('routes a new Thread to slot 1 while slot 0 works, binds it, and respawns the slot after an idle end', async () => {
    const { ctx } = await harness()
    const channel = await ctx.agentTeam.createChannel({ requestId: requestId('mi-channel'), workspaceId: alpha, name: 'engineering', description: 'Engineering' })
    const { memberId, slotZero, spawned } = await seat(ctx, channel.channel.channelRef, { slotZero: 'running' })
    const ledger = ctx.agentTeam['ledger']!

    const sent = await ctx.agentTeam.sendMessage({ asTask: false, requestId: requestId('mi-send'), workspaceId: alpha,
      channelRef: channel.channel.channelRef, body: 'Task A for @worker', recipients: [memberId] })
    if (sent.kind !== 'committed') throw new Error('send must commit')
    const thread = sent.thread.threadRef as AgentTeamThreadRef

    await vi.waitFor(() => { expect(spawned[0]?.fake.calls).toHaveLength(1) })
    expect(spawned.map(entry => entry.slot)).toEqual([1])
    expect(noticeText(spawned[0]!.fake.calls[0])).toContain(thread)
    expect(noticeText(spawned[0]!.fake.calls[0])).toContain('You are instance 1 of @worker')
    // Slot 0 was busy: it got no notice for this Thread.
    expect(slotZero.calls.some(message => noticeText(message).includes(thread))).toBe(false)
    await vi.waitFor(() => { expect(ledger.threadInstanceOf(thread, memberId)).toBe(1) })

    // Shared identity: the slot acts as the seat.
    expect(ctx.agentTeam.seatMemberForAgent(spawned[0]!.fake.agent)?.memberId).toBe(memberId)
    expect(ctx.agentTeam.memberForAgent(spawned[0]!.fake.agent)).toBeUndefined()

    // Seat status: N=2 slots, slot 1 live with its Session and bound Thread.
    const status = ctx.agentTeam.members().find(entry => entry.member.memberId === memberId)!
    expect(status.instances).toHaveLength(2)
    expect(status.instances[1]).toEqual({ slot: 1, sessionId: spawned[0]!.fake.agent.session.id, presence: 'available', threadRefs: [thread] })
    expect(status.instances[0]!.threadRefs).toEqual([])

    // §2a: ending an idle slot keeps the binding; the next message respawns the slot.
    expect(await ctx.agentTeam['endSlot'](memberId, 1)).toBe(true)
    expect(ledger.threadInstanceOf(thread, memberId)).toBe(1)
    expect(ctx.agentTeam.members().find(entry => entry.member.memberId === memberId)!.instances[1]!.presence).toBe('unavailable')
    slotZero.setStatus('idle')
    const replied = await ctx.agentTeam.reply({ requestId: requestId('mi-reply'), workspaceId: alpha,
      threadRef: thread, body: 'More on task A, @worker', recipients: [memberId], baseRevision: sent.thread.revision })
    expect(replied.kind).toBe('committed')
    await vi.waitFor(() => { expect(spawned[1]?.fake.calls).toHaveLength(1) })
    // Sticky: slot 0 is idle now, yet the bound Thread goes back to slot 1 on a fresh Session.
    expect(spawned.map(entry => entry.slot)).toEqual([1, 1])
    expect(spawned[1]!.fake.agent.session.id).not.toBe(spawned[0]!.fake.agent.session.id)
    expect(slotZero.calls.some(message => noticeText(message).includes(thread))).toBe(false)
    expect(() => ctx.agentTeam.validateLedger()).not.toThrow()
  })

  it('a slot reports its own activity line (D6): slot field, its Thread, and an end on idle or error', async () => {
    const { ctx } = await harness()
    const channel = await ctx.agentTeam.createChannel({ requestId: requestId('mi-act-channel'), workspaceId: alpha, name: 'engineering', description: 'Engineering' })
    const { memberId, slotZero, spawned } = await seat(ctx, channel.channel.channelRef, { slotZero: 'running' })
    const sent = await ctx.agentTeam.sendMessage({ asTask: false, requestId: requestId('mi-act-send'), workspaceId: alpha,
      channelRef: channel.channel.channelRef, body: 'Task D for @worker', recipients: [memberId] })
    if (sent.kind !== 'committed') throw new Error('send must commit')
    const thread = sent.thread.threadRef as AgentTeamThreadRef
    await vi.waitFor(() => { expect(spawned[0]?.fake.calls).toHaveLength(1) })
    const slotAgent = spawned[0]!.fake.agent
    const event = (type: string, data: Record<string, unknown>) => ({ type, seq: 1, time: Date.now(), data }) as never
    // The projection registry also folds session events: give it the minimal Session it reads.
    const sessionOf = (agent: Agent) => ({ id: agent.id, header: {}, inheritedEventCount: 0, seq: 0, snapshotEvents: () => [] }) as never

    // Both instances of one seat run at once: two lines, told apart by `slot`.
    ctx.emit('session/event', sessionOf(slotZero.agent), event('step/start', { turn: 1, step: 1 }))
    ctx.emit('session/event', sessionOf(slotAgent), event('step/start', { turn: 1, step: 1 }))
    ctx.emit('session/event', sessionOf(slotAgent), event('tool/call', { turn: 1, step: 1, callId: 'c1', name: 'read', arguments: JSON.stringify({ path: '/w/notes.md' }) }))
    const both = ctx.agentTeam.memberActivity({ workspaceId: alpha }).activities.filter(activity => activity.memberId === memberId)
    expect(both.map(activity => activity.slot ?? 0)).toEqual([0, 1])
    expect(both.find(activity => activity.slot === undefined)).toMatchObject({ stepCount: 1, toolCount: 0 })
    expect(both.find(activity => activity.slot === 1)).toMatchObject({ handle: '@worker', threadRef: thread, stepCount: 1, toolCount: 1, current: { tool: 'read', label: 'read notes.md' } })
    // The Thread filter finds the slot that works on it.
    expect(ctx.agentTeam.memberActivity({ workspaceId: alpha, threadRef: thread }).activities.map(activity => activity.slot)).toEqual([1])

    // The slot going idle ends only its own line.
    ctx.emit('agent/status', { agent: slotAgent, status: 'idle' } as never)
    expect(ctx.agentTeam.memberActivity({ workspaceId: alpha }).activities.filter(activity => activity.memberId === memberId).map(activity => activity.slot)).toEqual([undefined])
    // A slot error ends its line too, and a Session that is no longer a live slot is ignored.
    ctx.emit('session/event', sessionOf(slotAgent), event('step/start', { turn: 2, step: 1 }))
    ctx.emit('agent/error', { agent: slotAgent, error: new Error('boom') } as never)
    expect(ctx.agentTeam.memberActivity({ workspaceId: alpha }).activities.some(activity => activity.slot === 1)).toBe(false)
    expect(await ctx.agentTeam['endSlot'](memberId, 1)).toBe(true)
    ctx.emit('session/event', sessionOf(slotAgent), event('step/start', { turn: 3, step: 1 }))
    expect(ctx.agentTeam.memberActivity({ workspaceId: alpha }).activities.some(activity => activity.slot === 1)).toBe(false)
  })

  it('takes an unbound Thread on an idle slot 0 and binds it there', async () => {
    const { ctx } = await harness()
    const channel = await ctx.agentTeam.createChannel({ requestId: requestId('mi-idle-channel'), workspaceId: alpha, name: 'engineering', description: 'Engineering' })
    const { memberId, slotZero, spawned } = await seat(ctx, channel.channel.channelRef, { slotZero: 'idle' })
    const sent = await ctx.agentTeam.sendMessage({ asTask: false, requestId: requestId('mi-idle-send'), workspaceId: alpha,
      channelRef: channel.channel.channelRef, body: 'Task B', recipients: [memberId] })
    if (sent.kind !== 'committed') throw new Error('send must commit')
    expect(slotZero.calls).toHaveLength(1)
    await vi.waitFor(() => { expect(ctx.agentTeam['ledger']!.threadInstanceOf(sent.thread.threadRef as AgentTeamThreadRef, memberId)).toBe(0) })
    expect(spawned).toHaveLength(0)
  })

  it('N=1 behaves as today: slot 0 takes the Thread even while busy, nothing spawns or binds', async () => {
    const { ctx } = await harness()
    const channel = await ctx.agentTeam.createChannel({ requestId: requestId('mi-one-channel'), workspaceId: alpha, name: 'engineering', description: 'Engineering' })
    const { memberId, slotZero, spawned } = await seat(ctx, channel.channel.channelRef, { instances: 1, slotZero: 'running' })
    const sent = await ctx.agentTeam.sendMessage({ asTask: false, requestId: requestId('mi-one-send'), workspaceId: alpha,
      channelRef: channel.channel.channelRef, body: 'Task C', recipients: [memberId] })
    if (sent.kind !== 'committed') throw new Error('send must commit')
    expect(slotZero.calls).toHaveLength(1)
    expect(noticeText(slotZero.calls[0])).not.toContain('main instance')
    expect(spawned).toHaveLength(0)
    expect(ctx.agentTeam['ledger']!.threadInstanceOf(sent.thread.threadRef as AgentTeamThreadRef, memberId)).toBeUndefined()
    expect(ctx.agentTeam.members().find(entry => entry.member.memberId === memberId)!.instances.map(instance => instance.slot)).toEqual([0])
  })
})

describe('routeThreads (pure)', () => {
  const a = 'thread:a' as AgentTeamThreadRef
  const b = 'thread:b' as AgentTeamThreadRef
  const c = 'thread:c' as AgentTeamThreadRef

  it('spreads two new Threads over two idle slots, and keeps a bound Thread on its busy slot', () => {
    expect(routeThreads([a, b], 2, () => undefined, () => false)).toEqual([
      { threadRef: a, slot: 0, bind: true }, { threadRef: b, slot: 1, bind: true },
    ])
    expect(routeThreads([a], 2, () => 1, () => true)).toEqual([{ threadRef: a, slot: 1, bind: false }])
  })

  it('queues on slot 0 and binds there when every slot is busy; a slot past N reads as unbound', () => {
    expect(routeThreads([c], 2, () => undefined, () => true)).toEqual([{ threadRef: c, slot: 0, bind: true }])
    expect(routeThreads([a], 2, () => 3, slot => slot === 0)).toEqual([{ threadRef: a, slot: 1, bind: true }])
  })

  it('a slot held by a bound Thread in the same pass is not given to a new Thread', () => {
    expect(routeThreads([a, b], 2, threadRef => threadRef === a ? 0 : undefined, () => false)).toEqual([
      { threadRef: a, slot: 0, bind: false }, { threadRef: b, slot: 1, bind: true },
    ])
  })
})

describe('memoryWriteRefusal (contract v2 §2b, host-enforced)', () => {
  const dir = '/home/u/.dsh/agent-team/members/member-x'
  it('refuses a writing tool that names the seat-memory directory', () => {
    expect(memoryWriteRefusal('write', { path: `${dir}/memory.md`, content: 'x' }, dir)).toMatch(/main instance/)
    expect(memoryWriteRefusal('bash', { command: `echo hi >> ${dir}/notes/a.md` }, `${dir}/`)).toMatch(/main instance/)
  })
  it('allows read-only tools and calls that do not touch the directory', () => {
    expect(memoryWriteRefusal('read', { path: `${dir}/memory.md` }, dir)).toBeUndefined()
    expect(memoryWriteRefusal('write', { path: '/mnt/workspace/x.md', content: 'x' }, dir)).toBeUndefined()
  })
})
