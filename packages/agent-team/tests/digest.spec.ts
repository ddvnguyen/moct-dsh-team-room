import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
// Harness boots over a throwaway tree; CI's worst cold replay needs headroom.
vi.setConfig({ testTimeout: 30_000 })
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { MemoryMediaPool, MemoryStorageBackend } from './helpers/memory-backend.ts'
import AgentTeam from '../src/index.ts'
import type { AgentTeamMemberId, AgentTeamMemberRole, AgentTeamRequestId } from '../src/types.ts'

/**
 * The scheduled Orchestrator digest (issue #134): a Host-side timer wakes the
 * enabled Orchestrator members and prompts one report-only digest each. The
 * timer is faked here, so the tick is driven by the clock rather than by a
 * wall-clock wait.
 */

/** The Host row's `digest` section, as a deployment's patch layer passes it. */
interface DigestConfig {
  readonly digest: {
    readonly enabled: boolean
    readonly intervalMinutes?: number
    readonly dailyAt?: string
    readonly channel?: string
  }
}

interface TeamHarness {
  readonly ctx: Context
  readonly fiber: Awaited<ReturnType<Context['plugin']>>
  readonly facility: DomainFacility
}

const cleanups: Array<() => Promise<void>> = []
const alpha = WorkspaceId('workspace:alpha')
const requestId = (value: string): AgentTeamRequestId => value as AgentTeamRequestId
const MINUTE = 60_000

async function harness(config?: DigestConfig): Promise<TeamHarness> {
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

/** A Member seated on a live stub agent identity, as a successful activation would leave it. */
interface LiveMember {
  readonly memberId: AgentTeamMemberId
  readonly followup: Mock
  readonly agent: { id: string; status: string; followup: unknown; inbox: { nextStep: unknown[]; nextTurn: unknown[] } }
}

/**
 * A Member with a live handle, so the digest tick finds an idle seat to wake.
 * The `agents` stub refuses to create a Session, so the handle is installed
 * directly — the same shape a successful activation leaves behind.
 */
async function seatMember(host: AgentTeam, options: {
  readonly handle: string
  readonly role: AgentTeamMemberRole
  readonly status?: 'idle' | 'running'
}): Promise<LiveMember> {
  const channel = await host.createChannel({ requestId: requestId(`digest-channel-${options.handle}`), workspaceId: alpha, name: `room-${options.handle}`, description: '' })
  const member = (await host.addMember({
    requestId: requestId(`digest-member-${options.handle}`),
    workspaceId: alpha,
    handle: options.handle,
    description: 'Digest seat',
    presetId: 'team-member',
    role: options.role,
    channelRefs: [channel.channel.channelRef],
  })).status.member
  const followup = vi.fn()
  const agent = { id: member.sessionId, status: options.status ?? 'idle', followup, inbox: { nextStep: [], nextTurn: [] } }
  const internals = host as unknown as { handles: Map<unknown, unknown>; memberBySessionId: Map<unknown, unknown>; clearMemberFailure: (id: AgentTeamMemberId, slot: 'activation') => boolean }
  internals.clearMemberFailure(member.memberId, 'activation')
  internals.handles.set(member.memberId, { agent })
  internals.memberBySessionId.set(member.sessionId, member.memberId)
  return { memberId: member.memberId, followup, agent }
}

/** The text of the prompt the digest tick delivered, or undefined when it stayed silent. */
function promptOf(followup: Mock): string | undefined {
  const call = followup.mock.calls[0]
  if (call === undefined) return undefined
  const message = call[0] as { content?: readonly { type: string; text?: string }[] }
  return message.content?.map(part => part.text ?? '').join('\n')
}

/** Let the tick's own promise chain settle; the fake clock does not advance microtasks. */
async function settle(): Promise<void> {
  await new Promise<void>(resolve => setImmediate(resolve))
  await new Promise<void>(resolve => setImmediate(resolve))
}

beforeEach(() => {
  // Only the digest timer is faked: the Host's other timers (the attachment
  // collector) stay real, and the boot's own awaits keep working.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(cleanup => cleanup()))
  vi.useRealTimers()
})

describe('scheduled Orchestrator digest', () => {
  it('delivers the report-only digest prompt to an idle Orchestrator and creates the digest Channel', async () => {
    const test = await harness({ digest: { enabled: true, intervalMinutes: 1 } })
    const host = test.ctx.agentTeam
    const orchestrator = await seatMember(host, { handle: 'digest-orchestrator', role: 'orchestrator' })

    await vi.advanceTimersByTimeAsync(MINUTE)
    await settle()

    expect(orchestrator.followup).toHaveBeenCalledTimes(1)
    const prompt = promptOf(orchestrator.followup)
    expect(prompt).toContain('team_activity')
    expect(prompt).toContain('team_message')
    expect(prompt).toContain('team-digest')
    // The Workspace is named, not inferred: a Member that participates in more
    // than one cannot resolve it from context.
    expect(prompt).toContain(`workspace '${alpha}'`)
    // Report only: the prompt never authorizes a task-state change.
    expect(prompt?.toLowerCase()).toContain('do not claim, assign, or change any task')

    const channels = host.view({ workspaceId: alpha }).channels.filter(channel => channel.name === 'team-digest')
    expect(channels).toHaveLength(1)
    // The Orchestrator is a member of the Channel it is asked to post in.
    const memberships = host.view({ workspaceId: alpha }).members.filter(entry => entry.channelRef === channels[0]!.channelRef)
    expect(memberships.map(entry => entry.memberId)).toContain(orchestrator.memberId)
  })

  it('skips a busy Orchestrator instead of steering its running turn', async () => {
    const test = await harness({ digest: { enabled: true, intervalMinutes: 1 } })
    const host = test.ctx.agentTeam
    const orchestrator = await seatMember(host, { handle: 'digest-busy', role: 'orchestrator', status: 'running' })

    await vi.advanceTimersByTimeAsync(MINUTE)
    await settle()

    expect(orchestrator.followup).not.toHaveBeenCalled()
  })

  it('leaves a Member without the Orchestrator role alone', async () => {
    const test = await harness({ digest: { enabled: true, intervalMinutes: 1 } })
    const host = test.ctx.agentTeam
    const worker = await seatMember(host, { handle: 'digest-worker', role: 'worker' })

    await vi.advanceTimersByTimeAsync(MINUTE)
    await settle()

    expect(worker.followup).not.toHaveBeenCalled()
    expect(host.view({ workspaceId: alpha }).channels.filter(channel => channel.name === 'team-digest')).toHaveLength(0)
  })

  it('delivers one digest per Member per tick even when it participates in several Workspaces', async () => {
    const test = await harness({ digest: { enabled: true, intervalMinutes: 1 } })
    const host = test.ctx.agentTeam
    const orchestrator = await seatMember(host, { handle: 'digest-multi', role: 'orchestrator' })

    // Two Workspaces for one seat. A second `followup` inside the same tick would
    // steer the turn the first one started, so the tick must stop after one.
    const internals = host as unknown as { requireLedger: () => { workspacesOf: (id: AgentTeamMemberId) => readonly string[] }; ensureDigestChannel: unknown }
    const ledger = internals.requireLedger()
    const original = ledger.workspacesOf.bind(ledger)
    ledger.workspacesOf = (memberId: AgentTeamMemberId) => memberId === orchestrator.memberId ? [alpha, WorkspaceId('workspace:beta')] : original(memberId)

    await vi.advanceTimersByTimeAsync(MINUTE)
    await settle()

    expect(orchestrator.followup).toHaveBeenCalledTimes(1)
    expect(promptOf(orchestrator.followup)).toContain(`workspace '${alpha}'`)
  })

  it('never lets an oversized interval collapse into a 1 ms wake loop', async () => {
    const test = await harness({ digest: { enabled: true, intervalMinutes: 1 } })
    const host = test.ctx.agentTeam
    const orchestrator = await seatMember(host, { handle: 'digest-long', role: 'orchestrator' })

    // The row's live value, past both the schema cap and the 32-bit timer limit:
    // `setTimeout` would clamp a raw `intervalMinutes * 60_000` to 1 ms.
    const internals = host as unknown as { config: { digest: { intervalMinutes: { get: () => number } } }; digestDelayMs: () => number; armDigestTimer: () => void }
    // The row's schema refuses this value at mount; the clamp is the second
    // line of defence for a value that reaches the running Host anyway.
    internals.config.digest.intervalMinutes = { get: () => 99_999_999 }
    expect(internals.digestDelayMs()).toBe(2_147_483_647)

    // The re-armed timer really waits, instead of firing once per millisecond.
    internals.armDigestTimer()
    await vi.advanceTimersByTimeAsync(1_000)
    await settle()
    expect(orchestrator.followup).not.toHaveBeenCalled()
  })

  it('creates the digest Channel once across ticks', async () => {
    const test = await harness({ digest: { enabled: true, intervalMinutes: 1 } })
    const host = test.ctx.agentTeam
    const orchestrator = await seatMember(host, { handle: 'digest-once', role: 'orchestrator' })

    await vi.advanceTimersByTimeAsync(MINUTE)
    await settle()
    await vi.advanceTimersByTimeAsync(MINUTE)
    await settle()

    expect(host.view({ workspaceId: alpha }).channels.filter(channel => channel.name === 'team-digest')).toHaveLength(1)
    expect(orchestrator.followup).toHaveBeenCalledTimes(2)
  })

  it('runs no timer at all while the digest is disabled', async () => {
    const test = await harness({ digest: { enabled: false, intervalMinutes: 1 } })
    const host = test.ctx.agentTeam
    const orchestrator = await seatMember(host, { handle: 'digest-off', role: 'orchestrator' })

    await vi.advanceTimersByTimeAsync(MINUTE * 5)
    await settle()

    expect(orchestrator.followup).not.toHaveBeenCalled()
    expect(host.view({ workspaceId: alpha }).channels.filter(channel => channel.name === 'team-digest')).toHaveLength(0)
  })

  it('disposes the digest timer with the Host', async () => {
    const test = await harness({ digest: { enabled: true, intervalMinutes: 1 } })
    const host = test.ctx.agentTeam
    const orchestrator = await seatMember(host, { handle: 'digest-dispose', role: 'orchestrator' })

    await test.fiber.dispose()
    await vi.advanceTimersByTimeAsync(MINUTE * 3)
    await settle()

    expect(orchestrator.followup).not.toHaveBeenCalled()
  })
})
