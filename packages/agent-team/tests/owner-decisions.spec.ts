import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { agentEvents, type Agent, type PreStepDecision } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as memberContext from '../src/member-context.ts'
import { currentDecisionRecords, ownerDecisionLines, ownerDecisionsForAgent, type OwnerDecisionsHost } from '../src/team-decisions.ts'
import type { AgentTeamDecisionRecord, AgentTeamTaskRef, AgentTeamThreadRef } from '../src/types.ts'

const WORKSPACE = 'workspace:alpha'
const TASK = 'task:3245ad40-43fd-4191-a416-7dcaf3a340f2' as AgentTeamTaskRef
const THREAD = 'thread:c98c24b1-2b37-4eb3-abf8-4137bc994b4e' as AgentTeamThreadRef
const SENATOR = 'member:agent-ann'
const HUMAN = 'member:human'

function record(index: number, options: { readonly supersedes?: string; readonly decided?: string; readonly rationale?: string } = {}): AgentTeamDecisionRecord {
  return {
    recordRef: `decisionRecord:${index}` as AgentTeamDecisionRecord['recordRef'],
    taskRef: TASK,
    decidedBy: HUMAN as AgentTeamDecisionRecord['decidedBy'],
    decided: options.decided ?? `Decision ${index}`,
    rationale: options.rationale ?? '',
    decidedAt: `2026-10-2${index % 10}T10:00:00.000Z`,
    source: { kind: 'plan', docRef: 'doc:plan', docRevision: 1 },
    ...(options.supersedes === undefined ? {} : { supersedes: options.supersedes as AgentTeamDecisionRecord['recordRef'] }),
  } as AgentTeamDecisionRecord
}

/** A Host stub answering exactly the reads one Session's current Task decisions need. */
function host(options: { readonly threadRefs?: readonly AgentTeamThreadRef[]; readonly taskRef?: AgentTeamTaskRef | undefined; readonly records?: readonly AgentTeamDecisionRecord[] } = {}): OwnerDecisionsHost & Record<string, unknown> {
  return {
    memberForAgent: () => ({ memberId: SENATOR as never, privateMemoryPath: '/nonexistent-private-memory', handle: 'ann', description: '' }),
    members: () => [{ member: { memberId: SENATOR as never }, instances: [
      { slot: 0, sessionId: 'session:ann', threadRefs: options.threadRefs ?? [THREAD] },
    ] }],
    workspacesForAgent: () => [{ workspaceId: WORKSPACE as never }],
    resolveThreadRefs: () => ({ resolved: [{ threadRef: THREAD, ...(options.taskRef === undefined ? {} : { taskRef: options.taskRef }) }] }),
    decisionRecords: () => ({ records: options.records ?? [] }),
  } as never
}

function fakeAgent(ctx: Context): Agent {
  return {
    id: SessionId('session:ann'), ctx, status: 'idle', options: { provider: 'mock', model: 'mock' },
    session: { id: SessionId('session:ann'), surface: { nodes: [] }, snapshotEvents: () => [] },
    inbox: {} as never,
    cancel() {}, whenIdle: async () => {}, runMaintenance: async (task: (signal: AbortSignal) => Promise<void>) => task(new AbortController().signal),
    send() {}, followup() {}, steer() {}, inject() {},
  } as unknown as Agent
}

async function mount(ctx: Context): Promise<void> {
  const loader = Object.create(Loader.prototype) as Loader
  await ctx.plugin(loader.unwrapExports(memberContext) as Parameters<Context['plugin']>[0])
}

async function preStep(ctx: Context, agent: Agent): Promise<PreStepDecision> {
  return agentEvents(ctx, agent).waterfall('agent/pre-step', {
    messages: [], turn: 1, step: 1, signal: new AbortController().signal,
  }, async () => ({ kind: 'enter', messages: [] }))
}

function texts(decision: PreStepDecision): readonly string[] {
  return decision.kind === 'enter' ? decision.messages.map(message => (message.content[0] as { text: string }).text) : []
}

describe('current Owner decisions', () => {
  it('drops a record another decision replaced and keeps the newest ones, oldest first', () => {
    const records = [record(1), record(2, { supersedes: 'decisionRecord:1' }), record(3)]
    const current = currentDecisionRecords(records)
    expect(current.map(entry => entry.recordRef)).toEqual(['decisionRecord:2', 'decisionRecord:3'])
  })

  it('caps the list at the newest ten', () => {
    const records = Array.from({ length: 14 }, (_value, index) => record(index + 1))
    const current = currentDecisionRecords(records)
    expect(current).toHaveLength(10)
    expect(current[0]!.recordRef).toBe('decisionRecord:5')
    expect(current.at(-1)!.recordRef).toBe('decisionRecord:14')
  })

  it('renders one line per decision, carrying its record ref and a single-line rationale', () => {
    const lines = ownerDecisionLines([record(1, { decided: 'Approved plan "Release plan"', rationale: 'The gate\n is green.' })])
    expect(lines).toEqual(['decisionRecord:1 · Approved plan "Release plan" — because The gate is green.'])
  })
})

describe('ownerDecisionsForAgent', () => {
  it('resolves the Task of the Thread this Session is bound to and reads its current decisions', () => {
    const current = ownerDecisionsForAgent(host({ taskRef: TASK, records: [record(1), record(2, { supersedes: 'decisionRecord:1' })] }), fakeAgent(new Context()))
    expect(current?.taskRef).toBe(TASK)
    expect(current?.decisions.map(entry => entry.recordRef)).toEqual(['decisionRecord:2'])
  })

  it('answers nothing when the Thread carries no Task or the Session holds no Thread', () => {
    expect(ownerDecisionsForAgent(host({ taskRef: undefined }), fakeAgent(new Context()))).toBeUndefined()
    expect(ownerDecisionsForAgent(host({ threadRefs: [] }), fakeAgent(new Context()))).toBeUndefined()
  })
})

describe('Owner decisions in the Member pre-step', () => {
  it('injects the Task\'s current Owner decisions, superseded records excluded', async () => {
    const ctx = new Context()
    const agent = fakeAgent(ctx)
    ctx.provide('agentTeam', host({ taskRef: TASK, records: [
      record(1, { decided: 'Approved plan "First plan"', rationale: 'Superseded by the second.' }),
      record(2, { supersedes: 'decisionRecord:1', decided: 'Approved plan "Second plan"', rationale: 'This is the plan.' }),
    ] }) as never)
    await mount(ctx)

    const decision = await preStep(ctx, agent)
    const block = texts(decision).find(text => text.startsWith('<team-owner-decisions>'))
    expect(block).toBeDefined()
    expect(block).toContain(`Owner decisions on ${TASK}`)
    expect(block).toContain('decisionRecord:2 · Approved plan "Second plan" — because This is the plan.')
    expect(block).not.toContain('First plan')
    await ctx.fiber.dispose()
  })

  it('injects a current-but-empty block when the Owner has not decided on the Task yet', async () => {
    const ctx = new Context()
    const agent = fakeAgent(ctx)
    ctx.provide('agentTeam', host({ taskRef: TASK }) as never)
    await mount(ctx)

    const block = texts(await preStep(ctx, agent)).find(text => text.startsWith('<team-owner-decisions>'))
    expect(block).toContain('The Owner has not decided anything on this Task yet.')
    await ctx.fiber.dispose()
  })

  it('injects nothing when the Session\'s Thread has no Task, and never fails the step', async () => {
    const ctx = new Context()
    const agent = fakeAgent(ctx)
    ctx.provide('agentTeam', host({ taskRef: undefined }) as never)
    await mount(ctx)
    expect(texts(await preStep(ctx, agent)).some(text => text.startsWith('<team-owner-decisions>'))).toBe(false)
    await ctx.fiber.dispose()

    const failing = new Context()
    const failingAgent = fakeAgent(failing)
    failing.provide('agentTeam', {
      memberForAgent: () => ({ memberId: SENATOR, privateMemoryPath: '/nonexistent-private-memory', handle: 'ann', description: '' }),
      workspacesForAgent: () => [{ workspaceId: WORKSPACE, default: true }],
      members: () => { throw new Error('ledger unavailable') },
    } as never)
    await mount(failing)
    const decision = await preStep(failing, failingAgent)
    expect(decision.kind).toBe('enter')
    expect(texts(decision).some(text => text.startsWith('<team-owner-decisions>'))).toBe(false)
    await failing.fiber.dispose()
  })
})
