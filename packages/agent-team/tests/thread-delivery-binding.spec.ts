import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { SessionId } from '@deepseek-ai/dsh-session'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { changeBaseline, nextChange } from './helpers/change-stream.ts'
import { MemoryMediaPool, MemoryStorageBackend } from './helpers/memory-backend.ts'
import { DEFAULT_WARM_LIMIT } from '../src/warm-limit.ts'
import AgentTeam from '../src/index.ts'
import { agentTeamHumanActor } from '../src/ledger.ts'
import * as agentTeamInvariant from '../src/invariant.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { AgentTeamChannelRef, AgentTeamMemberActor, AgentTeamRequestId } from '../src/types.ts'

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
  ctx.provide('agentPresets', { mount: async () => { throw new Error('unused') } })
  ctx.provide('tools', { schemas: () => [] })
  ctx.provide('sessionPersistence', { list: async () => [] })
  await ctx.plugin(agentTeamInvariant)
  await ctx.plugin(SessionProjectionRegistry)
  const fiber = await ctx.plugin(AgentTeam)
  cleanups.push(async () => { await fiber.dispose(); await facility.closeAll() })
  return { ctx }
}

/** One durable, enabled Member in the channel, added through the live ledger so the Host's own state carries it. */
async function addLiveMember(ctx: Context, channelRef: AgentTeamChannelRef): Promise<AgentTeamMemberActor> {
  const memberId = `member:agent-${crypto.randomUUID()}` as AgentTeamMemberActor['memberId']
  const handle = 'reader'
  await ctx.agentTeam['ledger']!.addMember({
    requestId: requestId(`ledger-member-${memberId}`), workspaceId: alpha, handle, description: 'Reads work', presetId: 'team-member',
    channelRefs: [channelRef], actor: agentTeamHumanActor(),
    member: {
      memberId, sessionId: SessionId(`session:${memberId}`), workspaceId: alpha, handle, description: 'Reads work',
      presetId: 'team-member', privateMemoryPath: '/tmp/reader', state: 'enabled' as const,
    },
  })
  return { kind: 'member', memberId, handle }
}

/**
 * One fake live Agent whose wake can be made to fail on demand. Only the
 * surface `notifyMember` touches is implemented; successful deliveries are
 * recorded so a test can prove the wake is re-derived later.
 */
function wakeSeam(): { readonly agent: Agent; readonly state: { fail: boolean; readonly calls: UserMessage[] } } {
  const state = { fail: true, calls: [] as UserMessage[] }
  const wake = (message: UserMessage): void => {
    if (state.fail) throw new Error('wake failed (test seam)')
    state.calls.push(message)
  }
  const agent = {
    id: SessionId('session:post-commit-delivery'),
    status: 'idle',
    inbox: { nextTurn: [], nextStep: [], remove: () => {} },
    steer: wake,
    followup: wake,
  } as unknown as Agent
  return { agent, state }
}


type SeamAgent = { readonly agent: Agent; status: string; readonly calls: UserMessage[] }
function liveAgent(id: string): SeamAgent {
  const calls: UserMessage[] = []
  const seam = { status: 'idle', calls } as SeamAgent
  const wake = (message: UserMessage): void => { calls.push(message) }
  const agent = { id: SessionId(id), get status() { return seam.status }, inbox: { nextTurn: [], nextStep: [], remove: () => {} }, steer: wake, followup: wake } as unknown as Agent
  Object.defineProperty(seam, 'agent', { value: agent })
  return seam
}

const lines = (spy: { readonly mock: { readonly calls: readonly (readonly unknown[])[] } }): string[] => spy.mock.calls.map(args => String(args[0]))
const settle = async (): Promise<void> => { for (let i = 0; i < 5; i += 1) await new Promise(resolve => setImmediate(resolve)) }

describe('per-Thread binding on delivery (task-16)', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }) })
  afterEach(() => { vi.useRealTimers() })

  it('binds each delivered Thread to the Session carrying it, once', async () => {
    const { ctx } = await harness()
    const channel = await ctx.agentTeam.createChannel({ requestId: requestId('b-channel'), workspaceId: alpha, name: 'engineering', description: 'Engineering' })
    const member = await addLiveMember(ctx, channel.channel.channelRef)
    const seam = liveAgent('session:live-1')
    ctx.agentTeam['handles'].set(member.memberId, { agent: seam.agent, dispose: async () => {} })
    const sent = await ctx.agentTeam.sendMessage({ asTask: false, requestId: requestId('b-send'), workspaceId: alpha, channelRef: channel.channel.channelRef, body: 'Look', recipients: [member.memberId] })
    expect(sent.kind).toBe('committed')
    if (sent.kind !== 'committed') return
    await settle()
    const ledger = ctx.agentTeam['ledger']!
    expect(ledger.threadSessionsOf(sent.thread.threadRef, member.memberId).map(b => [b.sessionId, b.reason])).toEqual([['session:live-1', 'start']])
    // A repeated delivery to the same Session records nothing more.
    ctx.emit('agent/status', { agent: seam.agent, status: 'running' })
    await settle()
    expect(ledger.threadSessionsOf(sent.thread.threadRef, member.memberId)).toHaveLength(1)
    expect(() => ctx.agentTeam.validateLedger()).not.toThrow()
  })

  it('opens cold-restart and names the stale binding when the seat now runs another Session', async () => {
    const { ctx } = await harness()
    const info = vi.spyOn(ctx.logger, 'info')
    const channel = await ctx.agentTeam.createChannel({ requestId: requestId('s-channel'), workspaceId: alpha, name: 'engineering', description: 'Engineering' })
    const member = await addLiveMember(ctx, channel.channel.channelRef)
    const first = liveAgent('session:live-1')
    ctx.agentTeam['handles'].set(member.memberId, { agent: first.agent, dispose: async () => {} })
    const sent = await ctx.agentTeam.sendMessage({ asTask: false, requestId: requestId('s-send'), workspaceId: alpha, channelRef: channel.channel.channelRef, body: 'Look', recipients: [member.memberId] })
    if (sent.kind !== 'committed') throw new Error('not committed')
    await settle()
    // The seat is renewed: a new live Session picks the same Thread's next fact up.
    const second = liveAgent('session:live-2')
    second.status = 'running'
    ctx.agentTeam['handles'].set(member.memberId, { agent: second.agent, dispose: async () => {} })
    ctx.agentTeam['notifiedInbox'].delete(member.memberId)
    ctx.emit('agent/status', { agent: second.agent, status: 'running' })
    await settle()
    const bindings = ctx.agentTeam['ledger']!.threadSessionsOf(sent.thread.threadRef, member.memberId)
    expect(bindings.map(b => [b.sessionId, b.reason])).toEqual([['session:live-1', 'start'], ['session:live-2', 'cold-restart']])
    expect(lines(info).some(line => line.includes('cold fallback cause stale-binding') && line.includes('session:live-1'))).toBe(true)
    info.mockRestore()
  })

  // One Thread, so every delivery goes to slot 0 (a second Thread would route to the seat's other instance).
  async function oneThread(ctx: Awaited<ReturnType<typeof harness>>['ctx'], seam: SeamAgent) {
    const channel = await ctx.agentTeam.createChannel({ requestId: requestId(`o-channel-${seam.agent.id}`), workspaceId: alpha, name: 'engineering', description: 'Engineering' })
    const member = await addLiveMember(ctx, channel.channel.channelRef)
    ctx.agentTeam['handles'].set(member.memberId, { agent: seam.agent, dispose: async () => {} })
    const first = await ctx.agentTeam.sendMessage({ asTask: false, requestId: requestId(`o-first-${seam.agent.id}`), workspaceId: alpha, channelRef: channel.channel.channelRef, body: 'First', recipients: [member.memberId] })
    if (first.kind !== 'committed') throw new Error('not committed')
    let revision = first.thread.revision
    const reply = async (id: string, body: string) => {
      const sent = await ctx.agentTeam.reply({ requestId: requestId(id), workspaceId: alpha, threadRef: first.thread.threadRef, body, recipients: [member.memberId], baseRevision: revision })
      if (sent.kind !== 'committed') throw new Error('not committed')
      revision = sent.thread.revision
    }
    return { reply }
  }

  it('coalesces a second warm start inside the window into one deferred delivery', async () => {
    const { ctx } = await harness()
    ctx.agentTeam.configureWarmLimit(DEFAULT_WARM_LIMIT)
    const seam = liveAgent('session:live-w')
    const { reply } = await oneThread(ctx, seam)
    expect(seam.calls).toHaveLength(1)
    // The seat goes idle again; more facts arrive inside the 60 s window: no second warm Turn yet.
    await reply('w-two', 'Second')
    await reply('w-three', 'Third')
    expect(seam.calls).toHaveLength(1)
    // When the window frees, one delivery carries everything that arrived meanwhile.
    await vi.advanceTimersByTimeAsync(61_000)
    expect(seam.calls).toHaveLength(2)
    expect(JSON.stringify(seam.calls[1]!.content)).toContain('3')
    // A busy seat is not a warm start: a steer goes through at once.
    seam.status = 'running'
    await reply('w-four', 'Fourth')
    expect(seam.calls).toHaveLength(3)
  })

  it('wakes an idle seat at once while no limit is configured', async () => {
    const { ctx } = await harness()
    const seam = liveAgent('session:live-u')
    const { reply } = await oneThread(ctx, seam)
    await reply('u-two', 'Second')
    expect(seam.calls).toHaveLength(2)
  })
})
