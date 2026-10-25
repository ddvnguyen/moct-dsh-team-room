import { afterEach, describe, expect, it, vi } from 'vitest'
vi.setConfig({ testTimeout: 30_000 })
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { SessionId } from '@deepseek-ai/dsh-session'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { MemoryMediaPool, MemoryStorageBackend } from './helpers/memory-backend.ts'
import { AgentTeamLedger, agentTeamHumanActor } from '../src/ledger.ts'
import { isPlanningPhase } from '../src/issue-view.ts'
import { agentTeamDomainSpec, agentTeamOperationSchema } from '../src/spec.ts'
import type {
  AgentTeamAgentMember, AgentTeamChannelRef, AgentTeamMemberActor, AgentTeamOperation, AgentTeamOperationId,
  AgentTeamRequestId, AgentTeamTaskRef, AgentTeamThreadRef,
} from '../src/types.ts'

const cleanups: Array<() => Promise<void>> = []
const alpha = WorkspaceId('workspace:alpha')
const beta = WorkspaceId('workspace:beta')
const human = agentTeamHumanActor()
const requestId = (value: string): AgentTeamRequestId => value as AgentTeamRequestId

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(cleanup => cleanup()))
})

/** A stepping clock: the instants are distinct, so an order assertion means something. */
let tick = 0
const clock = (): string => new Date(Date.UTC(2026, 0, 1) + (tick += 1000)).toISOString()

async function openLedger(pool: MemoryMediaPool): Promise<AgentTeamLedger> {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  cleanups.push(async () => { await facility.closeAll() })
  const domain = await ctx.storageDomain.open(agentTeamDomainSpec)
  const ledger = new AgentTeamLedger(domain.table('operations') as unknown as KvTable<AgentTeamOperationId, AgentTeamOperation>, { occurredAt: clock })
  await ledger.initialize()
  return ledger
}

function storedOperations(pool: MemoryMediaPool): AgentTeamOperation[] {
  return [...pool.media.get('agent_team')!.tables.get('operations')!.values()] as AgentTeamOperation[]
}

function committed<T extends { readonly kind: string }>(result: T): Extract<T, { readonly kind: 'committed' }> {
  if (result.kind !== 'committed') throw new Error(`expected committed result, received ${result.kind}`)
  return result as Extract<T, { readonly kind: 'committed' }>
}

async function addMember(ledger: AgentTeamLedger, channelRef: AgentTeamChannelRef, handle: string): Promise<AgentTeamMemberActor> {
  const memberId = `member:agent-${handle}` as AgentTeamAgentMember['memberId']
  const member: AgentTeamAgentMember = {
    memberId, sessionId: SessionId(`session:${memberId}`), workspaceId: alpha, handle, description: 'Test Agent',
    presetId: 'team-member', privateMemoryPath: `/mnt/workspace/${memberId}`, state: 'enabled',
  }
  await ledger.addMember({ requestId: requestId(`add:${handle}`), actor: human, member, handle,
    description: member.description, presetId: member.presetId, workspaceId: alpha, channelRefs: [channelRef] })
  return { kind: 'member', memberId, handle }
}

/** One Channel, an author Agent, and a Task whose Thread the Human opened. */
async function room() {
  const pool = new MemoryMediaPool()
  const ledger = await openLedger(pool)
  const channel = (await ledger.createChannel({ requestId: requestId('channel'), workspaceId: alpha,
    name: 'room', description: '', memberIds: [], actor: human })).value.channel
  const ann = await addMember(ledger, channel.channelRef, 'ann')
  const task = (await ledger.createTask({ requestId: requestId('task'), workspaceId: alpha, channelRef: channel.channelRef,
    body: 'Ship the board', title: 'Ship the board', actor: human })).value
  return { pool, ledger, channel, ann, task, taskRef: task.task.taskRef, threadRef: task.thread.threadRef, revision: task.thread.revision }
}

const questions = [
  { prompt: 'Which release day?', multiple: false, options: [{ label: 'Thursday', description: 'One day early.' }, { label: 'Friday' }], recommended: [1] },
]

describe('issue view', () => {
  it('1. carries every region of a populated issue', async () => {
    const { pool, ledger, ann, taskRef, threadRef } = await room()
    const replied = committed((await ledger.reply({ requestId: requestId('reply'), workspaceId: alpha, taskRef, body: 'On it.',
      baseRevision: ledger.threadHistory(human, { workspaceId: alpha, taskRef, limit: 1 }).thread.revision, actor: ann })).value)
    const claimed = committed((await ledger.changeClaim({ requestId: requestId('claim'), workspaceId: alpha, taskRef, action: 'claim',
      direction: 'Build the board', baseRevision: replied.thread.revision, actor: ann })).value)
    const asked = (await ledger.askDecision({ requestId: requestId('ask'), workspaceId: alpha, threadRef, actor: ann,
      context: 'The plan is ready.', questions })).value

    const view = await ledger.issueView(human, { workspaceId: alpha, taskRef })

    expect(view.task.taskRef).toBe(taskRef)
    expect(view.thread.threadRef).toBe(threadRef)
    expect(view.taskNumber).toBe(1)
    expect(view.title).toBe('Ship the board')
    expect(view.description).toMatchObject({ body: 'Ship the board', author: human.memberId, source: 'anchor', revision: 0 })
    expect(view.description.editedAt).toBeUndefined()
    expect(view.properties).toMatchObject({ status: 'in_progress', resolution: 'open', priority: 'none',
      channelRef: view.task.channelRef, channelName: 'room', taskNumber: 1, planningPhase: false })
    expect(view.properties.claimOwners).toEqual([ann.memberId])
    // The anchor and the ask message are not comments: the anchor opens the
    // Thread, and the card renders in the timeline in the ask message's place.
    expect(view.comments.items.map(item => item.message.body)).toEqual(['On it.'])
    expect(view.comments.hasMore).toBe(false)
    expect(view.comments.cursor).toBe(view.comments.items[0]!.sequence)
    expect(view.activity.items.map(fact => fact.activity.kind)).toEqual(['claim'])
    expect(view.decisions).toEqual([{ kind: 'card', card: expect.objectContaining({ decisionRef: asked.notice.decisionRef }) }])
    expect(view.executionLog.sessions).toEqual([])
    expect(view.executionLog.failures).toEqual([])
    expect(view.docs).toEqual([])
    expect(claimed.claim.state).toBe('active')

    for (const record of storedOperations(pool)) expect(agentTeamOperationSchema.safeParse(record).success).toBe(true)
  })

  it('2. carries each activity with the ordering key the timeline merges on', async () => {
    const { ledger, ann, taskRef } = await room()
    const reply = async (body: string): Promise<number> => committed((await ledger.reply({ requestId: requestId(`reply-${body}`),
      workspaceId: alpha, taskRef, body,
      baseRevision: ledger.threadHistory(human, { workspaceId: alpha, taskRef, limit: 1 }).thread.revision, actor: ann })).value).receipt.sequence
    const claim = async (direction: string): Promise<number> => committed((await ledger.changeClaim({ requestId: requestId(`claim-${direction}`),
      workspaceId: alpha, taskRef, action: 'claim', direction,
      baseRevision: ledger.threadHistory(human, { workspaceId: alpha, taskRef, limit: 1 }).thread.revision, actor: ann })).value).receipt.sequence
    const first = await reply('First')
    const claimed = await claim('One')
    const second = await reply('Second')

    const view = await ledger.issueView(human, { workspaceId: alpha, taskRef })

    // Oldest first, and the key rides along: the client never re-derives it.
    expect(view.activity.items.map(fact => fact.activity.kind)).toEqual(['claim'])
    expect(view.activity.items[0]!.sequence).toBe(claimed)
    // The instant rides on the fact, not on the activity: an activity has none of its own.
    expect(Number.isNaN(Date.parse(view.activity.items[0]!.occurredAt))).toBe(false)
    // The activity sits between the two comments on the one key both arms share.
    const order = [
      ...view.comments.items.map(item => ({ sequence: item.sequence, kind: item.kind })),
      ...view.activity.items.map(fact => ({ sequence: fact.sequence, kind: fact.kind })),
    ].sort((left, right) => left.sequence - right.sequence)
    expect(order.map(row => row.kind)).toEqual(['message', 'activity', 'message'])
    expect(order.map(row => row.sequence)).toEqual([first, claimed, second])
    expect(view.comments.items.map(item => item.message.body)).toEqual(['First', 'Second'])
  })

  it('3. answers a bare issue with empty regions and the anchor description', async () => {
    const { ledger, taskRef } = await room()
    const view = await ledger.issueView(human, { workspaceId: alpha, taskRef })

    expect(view.comments).toEqual({ items: [], hasMore: false, cursor: 0 })
    expect(view.activity).toEqual({ items: [], hasMore: false })
    expect(view.decisions).toEqual([])
    expect(view.executionLog).toEqual({ sessions: [], failures: [] })
    expect(view.docs).toEqual([])
    expect(view.description).toMatchObject({ body: 'Ship the board', source: 'anchor', revision: 0 })
    expect(view.properties.planningPhase).toBe(true)
  })

  it('4. pages the older comments through the existing history path, with no repeat and no gap', async () => {
    const { ledger, ann, taskRef } = await room()
    for (const body of ['First', 'Second', 'Third']) {
      await ledger.reply({ requestId: requestId(`reply-${body}`), workspaceId: alpha, taskRef, body,
        baseRevision: ledger.threadHistory(human, { workspaceId: alpha, taskRef, limit: 1 }).thread.revision, actor: ann })
    }

    const view = await ledger.issueView(human, { workspaceId: alpha, taskRef, commentLimit: 2 })
    expect(view.comments.items.map(item => item.message.body)).toEqual(['Second', 'Third'])
    expect(view.comments.hasMore).toBe(true)

    const older = ledger.threadHistory(human, { workspaceId: alpha, taskRef, beforeSequence: view.comments.cursor, limit: 50 })
    // The history page carries the anchor too — the anchor opens the Thread
    // and is not a comment — so the older comments are the rest of it.
    const olderBodies = older.facts.filter(fact => fact.kind === 'message')
      .map(fact => fact.message.body).filter(body => body !== 'Ship the board')
    expect(olderBodies).toEqual(['First'])
    expect(older.facts.every(fact => fact.sequence < view.comments.cursor)).toBe(true)
    const carried = view.comments.items.map(item => item.message.body)
    expect(carried.filter(body => olderBodies.includes(body))).toEqual([])
  })

  it('5. carries the Host\'s planning-phase answer, and never lets the client re-derive it', async () => {
    const { ledger, ann, taskRef } = await room()

    const planned = await ledger.issueView(human, { workspaceId: alpha, taskRef })
    expect(planned.properties.status).toBe('todo')
    expect(planned.properties.planningPhase).toBe(true)
    expect(isPlanningPhase(planned)).toBe(true)

    const claimed = committed((await ledger.changeClaim({ requestId: requestId('claim'), workspaceId: alpha, taskRef, action: 'claim',
      direction: 'Build the board', baseRevision: ledger.threadHistory(human, { workspaceId: alpha, taskRef, limit: 1 }).thread.revision, actor: ann })).value)
    const running = await ledger.issueView(human, { workspaceId: alpha, taskRef })
    expect(running.properties.status).toBe('in_progress')
    expect(running.properties.planningPhase).toBe(false)
    expect(isPlanningPhase(running)).toBe(false)

    const done = committed((await ledger.changeClaim({ requestId: requestId('done'), workspaceId: alpha, taskRef, action: 'done',
      claimRef: claimed.claim.claimRef, baseRevision: claimed.thread.revision, actor: ann })).value)
    const reviewing = await ledger.issueView(human, { workspaceId: alpha, taskRef })
    expect(reviewing.properties.status).toBe('in_review')
    expect(reviewing.properties.planningPhase).toBe(false)
    expect(isPlanningPhase(reviewing)).toBe(false)
    expect(done.claim.state).toBe('done')
  })

  it('6. refuses an unknown Task, a Task of another Workspace and an out-of-range limit', async () => {
    const { ledger, taskRef } = await room()
    await expect(ledger.issueView(human, { workspaceId: alpha, taskRef: 'task:missing' as AgentTeamTaskRef })).rejects.toThrow(/unknown Task ref/)
    await expect(ledger.issueView(human, { workspaceId: beta, taskRef })).rejects.toThrow(/does not belong to Workspace/)
    await expect(ledger.issueView(human, { workspaceId: alpha, taskRef, commentLimit: 0 })).rejects.toThrow(/comment limit/)
    await expect(ledger.issueView(human, { workspaceId: alpha, taskRef, commentLimit: 101 })).rejects.toThrow(/comment limit/)
  })

  it('7. carries the Doc→Task binding, and the ask message stays out of the comments', async () => {
    const { ledger, ann, channel, taskRef, threadRef } = await room()
    const bound = (await ledger.createDoc({ requestId: requestId('doc-bound'), workspaceId: alpha, threadRef, taskRef, actor: ann,
      title: 'Release plan', outline: ['Goal'] })).value
    const unbound = (await ledger.createDoc({ requestId: requestId('doc-free'), workspaceId: alpha, threadRef, actor: ann,
      title: 'Scratch notes', outline: ['Goal'] })).value
    const asked = (await ledger.askDecision({ requestId: requestId('ask'), workspaceId: alpha, threadRef, actor: ann, questions })).value

    const view = await ledger.issueView(human, { workspaceId: alpha, taskRef })
    expect(view.docs.map(doc => [doc.docRef, doc.taskRef])).toEqual([
      [bound.doc.docRef, taskRef],
      [unbound.doc.docRef, undefined],
    ])
    expect(view.comments.items.map(item => item.message.messageRef)).not.toContain(asked.message.messageRef)

    // A Doc bound to a Task must live in that Task's Thread.
    const other = (await ledger.createTask({ requestId: requestId('other-task'), workspaceId: alpha, channelRef: channel.channelRef,
      body: 'Other task', actor: human })).value
    await expect(ledger.createDoc({ requestId: requestId('doc-wrong-thread'), workspaceId: alpha, threadRef,
      taskRef: other.task.taskRef, actor: ann, title: 'Misbound', outline: ['Goal'] })).rejects.toThrow(/does not belong to Thread/)
  })

  it('8. carries every card exactly once and every record exactly once', async () => {
    const { ledger, ann, taskRef, threadRef } = await room()
    const asked = (await ledger.askDecision({ requestId: requestId('ask'), workspaceId: alpha, threadRef, actor: ann, questions })).value
    await ledger.answerDecision({ requestId: requestId('answer'), workspaceId: alpha, decisionRef: asked.notice.decisionRef,
      actor: human, answers: [{ selected: [0] }] })
    const second = (await ledger.askDecision({ requestId: requestId('ask-2'), workspaceId: alpha, threadRef, actor: ann, questions })).value

    const view = await ledger.issueView(human, { workspaceId: alpha, taskRef })
    expect(view.decisions).toEqual([
      { kind: 'decision', record: expect.objectContaining({ recordRef: expect.any(String) }), card: expect.objectContaining({ decisionRef: asked.notice.decisionRef }) },
      { kind: 'card', card: expect.objectContaining({ decisionRef: second.notice.decisionRef }) },
    ])
    const cards = view.decisions.flatMap(row => row.kind === 'card' ? [row.card] : row.card === undefined ? [] : [row.card])
    expect(new Set(cards.map(card => card.decisionRef)).size).toBe(cards.length)
    const records = view.decisions.flatMap(row => row.kind === 'decision' ? [row.record] : [])
    expect(new Set(records.map(record => record.recordRef)).size).toBe(records.length)
  })
})
