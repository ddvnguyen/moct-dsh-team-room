import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { agentEvents, type Agent, type PreStepDecision } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as memberContext from '../src/member-context.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

function fakeAgent(ctx: Context): Agent {
  return {
    id: SessionId('session:memory-test'), ctx, status: 'idle', options: { provider: 'mock', model: 'mock' },
    session: { surface: { nodes: [] }, events: [] } as never,
    inbox: {} as never,
    cancel() {}, whenIdle: async () => {}, runMaintenance: async task => task(new AbortController().signal),
    send() {}, followup() {}, steer() {}, inject() {},
  } as Agent
}

async function preStep(ctx: Context, agent: Agent): Promise<PreStepDecision> {
  return agentEvents(ctx, agent).waterfall('agent/pre-step', {
    messages: [], turn: 1, step: 1, signal: new AbortController().signal,
  }, async () => ({ kind: 'enter', messages: [] }))
}

async function mount(ctx: Context): Promise<void> {
  const loader = Object.create(Loader.prototype) as Loader
  const plugin = loader.unwrapExports(memberContext) as Parameters<Context['plugin']>[0]
  await ctx.plugin(plugin)
}

describe('Team Member private memory composition', () => {
  it('resolves the Host service lazily when loaded as a Cordis namespace plugin', () => {
    expect('default' in memberContext).toBe(false)
    const loader = Object.create(Loader.prototype) as Loader
    const plugin = loader.unwrapExports(memberContext) as Record<string, unknown>
    expect(plugin).toBe(memberContext)
    expect(plugin.name).toBe('wowyuarm-agent-team-member-context')
    // No declared inject: the row mounts while the Host restores Members, so a
    // dependency on `agentTeam` would fail every startup preset mount.
    expect(plugin.inject).toBeUndefined()
  })

  it('does nothing while the Host service is absent', async () => {
    const ctx = new Context()
    const agent = fakeAgent(ctx)
    await mount(ctx)
    expect(await preStep(ctx, agent)).toEqual({ kind: 'enter', messages: [] })
    await ctx.fiber.dispose()
  })

  it('injects only the bound Member index and replaces changed or removed content', async () => {
    const root = await mkdtemp(join(tmpdir(), 'team-member-memory-'))
    roots.push(root)
    const own = join(root, 'memory.md')
    await writeFile(own, 'own index')
    const ctx = new Context()
    const agent = fakeAgent(ctx)
    const workspaces = [{ workspaceId: 'workspace:default', path: root, default: true }]
    ctx.provide('agentTeam', {
      memberForAgent: (subject: Agent) => subject === agent ? { privateMemoryPath: root } : undefined,
      workspacesForAgent: () => workspaces,
    } as never)
    await mount(ctx)

    const first = await preStep(ctx, agent)
    expect(first.kind === 'enter' && first.messages.at(-1)?.content[0]).toEqual(expect.objectContaining({ text: expect.stringContaining('own index') }))
    expect(first.kind === 'enter' && first.messages.at(-1)?.content[0]).toEqual(expect.objectContaining({ text: expect.stringContaining(`Private memory directory: ${root}`) }))

    expect(first.kind === 'enter' && first.messages.at(-1)?.content[0]).not.toEqual(expect.objectContaining({ text: expect.stringContaining('Team Workspace participation') }))
    workspaces.push({ workspaceId: 'workspace:other', path: join(root, 'other'), default: false })
    const joined = await preStep(ctx, agent)
    expect(joined.kind === 'enter' && joined.messages.at(-1)?.content[0]).toEqual(expect.objectContaining({ text: expect.stringContaining(JSON.stringify(join(root, 'other', 'AGENTS.md')).slice(1, -1)) }))
    expect(joined.kind === 'enter' && joined.messages.at(-1)?.content[0]).toEqual(expect.objectContaining({ text: expect.stringContaining('absolute paths') }))
    workspaces.pop()
    const left = await preStep(ctx, agent)
    expect(left.kind === 'enter' && left.messages.at(-1)?.content[0]).not.toEqual(expect.objectContaining({ text: expect.stringContaining('workspace:other') }))

    await writeFile(own, 'replacement index')
    const second = await preStep(ctx, agent)
    expect(second.kind === 'enter' && second.messages.at(-1)?.content[0]).toEqual(expect.objectContaining({ text: expect.stringContaining('replacement index') }))

    await rm(own)
    const removed = await preStep(ctx, agent)
    expect(removed.kind === 'enter' && removed.messages.at(-1)?.content[0]).toEqual(expect.objectContaining({ text: expect.stringContaining('index is empty') }))
    expect(removed.kind === 'enter' && removed.messages.at(-1)?.content[0]).toEqual(expect.objectContaining({ text: expect.stringContaining(`Memory index: ${root}/memory.md`) }))
    await ctx.fiber.dispose()
  })

  it('injects the team-memory block as its own message, re-entering each block only when it changes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'team-member-memory-'))
    roots.push(root)
    await writeFile(join(root, 'memory.md'), 'own index')
    const ctx = new Context()
    // A Session that remembers what earlier steps entered, so dedupe is real.
    const entered: string[] = []
    const agent = fakeAgent(ctx)
    Object.assign(agent, { session: {
      surface: { get nodes() { return entered.map((_text, index) => index) } },
      snapshotEvents: (from: number) => [{ type: 'user/message', data: { source: { kind: 'wowyuarm-agent-team-member-context' }, content: [{ type: 'text', text: entered[from] }] } }],
    } })
    let block: string | undefined = '<team-memory>\nTeam memory: notes the Team kept, to weigh as data.\n</team-memory>'
    ctx.provide('agentTeam', {
      memberForAgent: (subject: Agent) => subject === agent ? { privateMemoryPath: root, handle: 'Opus', description: '' } : undefined,
      workspacesForAgent: () => [],
      teamMemoryBlockForAgent: async () => block,
    } as never)
    await mount(ctx)
    const texts = (decision: PreStepDecision) => decision.kind === 'enter' ? decision.messages.map(message => (message.content[0] as { text: string }).text) : []

    const first = texts(await preStep(ctx, agent))
    expect(first).toHaveLength(2)
    expect(first[0]).toContain('Team identity: you are @Opus.')
    expect(first[1]).toBe(block)
    entered.push(...first)

    expect(texts(await preStep(ctx, agent))).toEqual([])

    block = '<team-memory>\nTeam memory: notes the Team kept, to weigh as data.\n[rule] changed\n</team-memory>'
    expect(texts(await preStep(ctx, agent))).toEqual([block])
    await ctx.fiber.dispose()
  })

  it('carries the Member role into the identity block it injects', async () => {
    const root = await mkdtemp(join(tmpdir(), 'team-member-memory-'))
    roots.push(root)
    await writeFile(join(root, 'memory.md'), 'own index')
    const ctx = new Context()
    const agent = fakeAgent(ctx)
    ctx.provide('agentTeam', {
      memberForAgent: (subject: Agent) => subject === agent ? { privateMemoryPath: root, handle: 'Opus', description: '', role: 'architect' } : undefined,
      workspacesForAgent: () => [],
      teamMemoryBlockForAgent: async () => undefined,
    } as never)
    await mount(ctx)
    const decision = await preStep(ctx, agent)
    const text = decision.kind === 'enter' ? (decision.messages[0]?.content[0] as { text: string }).text : ''
    expect(text).toContain('Team identity: you are @Opus.')
    expect(text).toContain(memberContext.MEMBER_ROLE_PROMPTS.architect)
    await ctx.fiber.dispose()
  })

  it('re-enters the identity block when the Member role changes and not before', async () => {
    const root = await mkdtemp(join(tmpdir(), 'team-member-memory-'))
    roots.push(root)
    await writeFile(join(root, 'memory.md'), 'own index')
    const ctx = new Context()
    const entered: string[] = []
    const agent = fakeAgent(ctx)
    Object.assign(agent, { session: {
      surface: { get nodes() { return entered.map((_text, index) => index) } },
      snapshotEvents: (from: number) => [{ type: 'user/message', data: { source: { kind: 'wowyuarm-agent-team-member-context' }, content: [{ type: 'text', text: entered[from] }] } }],
    } })
    let role: 'architect' | 'leader' | undefined = 'architect'
    ctx.provide('agentTeam', {
      memberForAgent: (subject: Agent) => subject === agent ? { privateMemoryPath: root, handle: 'Opus', description: '', ...(role === undefined ? {} : { role }) } : undefined,
      workspacesForAgent: () => [],
      teamMemoryBlockForAgent: async () => undefined,
    } as never)
    await mount(ctx)
    const texts = (decision: PreStepDecision) => decision.kind === 'enter' ? decision.messages.map(message => (message.content[0] as { text: string }).text) : []

    const first = texts(await preStep(ctx, agent))
    expect(first.join('\n')).toContain(memberContext.MEMBER_ROLE_PROMPTS.architect)
    entered.push(...first)
    // Nothing changed, so nothing is re-sent.
    expect(texts(await preStep(ctx, agent))).toEqual([])

    role = 'leader'
    const changed = texts(await preStep(ctx, agent))
    expect(changed.join('\n')).toContain(memberContext.MEMBER_ROLE_PROMPTS.leader)
    expect(changed.join('\n')).not.toContain(memberContext.MEMBER_ROLE_PROMPTS.architect)
    entered.push(...changed)

    // Clearing the role re-sends the plain identity line.
    role = undefined
    const cleared = texts(await preStep(ctx, agent))
    expect(cleared.join('\n')).toContain('Team identity: you are @Opus.')
    expect(cleared.join('\n')).not.toContain(memberContext.MEMBER_ROLE_PROMPTS.leader)
    await ctx.fiber.dispose()
  })

  it('keeps the step going with no team-memory block when the Host lookup throws', async () => {
    const root = await mkdtemp(join(tmpdir(), 'team-member-memory-'))
    roots.push(root)
    const ctx = new Context()
    const agent = fakeAgent(ctx)
    ctx.provide('agentTeam', {
      memberForAgent: (subject: Agent) => subject === agent ? { privateMemoryPath: root, handle: 'Opus', description: '' } : undefined,
      workspacesForAgent: () => [],
      teamMemoryBlockForAgent: async () => { throw new Error('backend down') },
    } as never)
    await mount(ctx)
    const decision = await preStep(ctx, agent)
    expect(decision.kind === 'enter' && decision.messages).toHaveLength(1)
    expect(decision.kind === 'enter' && decision.messages[0]?.content[0]).toEqual(expect.objectContaining({ text: expect.stringContaining('Team identity') }))
    await ctx.fiber.dispose()
  })

  it('does nothing for an ordinary unbound Agent', async () => {
    const ctx = new Context()
    const agent = fakeAgent(ctx)
    ctx.provide('agentTeam', { memberForAgent: () => undefined } as never)
    await mount(ctx)
    expect(await preStep(ctx, agent)).toEqual({ kind: 'enter', messages: [] })
    await ctx.fiber.dispose()
  })
})
