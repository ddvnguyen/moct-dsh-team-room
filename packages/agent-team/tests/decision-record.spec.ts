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
import { agentTeamDomainSpec, agentTeamOperationSchema } from '../src/spec.ts'
import type {
  AgentTeamAgentMember, AgentTeamChannelRef, AgentTeamMemberActor, AgentTeamOperation, AgentTeamOperationId,
  AgentTeamRequestId, AgentTeamThreadRef,
} from '../src/types.ts'

const cleanups: Array<() => Promise<void>> = []
const alpha = WorkspaceId('workspace:alpha')
const human = agentTeamHumanActor()
const requestId = (value: string): AgentTeamRequestId => value as AgentTeamRequestId

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(cleanup => cleanup()))
})

async function openLedger(pool: MemoryMediaPool): Promise<AgentTeamLedger> {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  cleanups.push(async () => { await facility.closeAll() })
  const domain = await ctx.storageDomain.open(agentTeamDomainSpec)
  const ledger = new AgentTeamLedger(domain.table('operations') as unknown as KvTable<AgentTeamOperationId, AgentTeamOperation>)
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
  return { pool, ledger, channel, ann, task, taskRef: task.task.taskRef, threadRef: task.thread.threadRef }
}

/** A taskless Thread the Human opened: no Task is bound to it yet. */
async function tasklessRoom() {
  const pool = new MemoryMediaPool()
  const ledger = await openLedger(pool)
  const channel = (await ledger.createChannel({ requestId: requestId('channel'), workspaceId: alpha,
    name: 'room', description: '', memberIds: [], actor: human })).value.channel
  const ann = await addMember(ledger, channel.channelRef, 'ann')
  const opened = committed((await ledger.sendMessage({ requestId: requestId('open'), workspaceId: alpha,
    channelRef: channel.channelRef, body: 'Plan the release', asTask: false, actor: human, recipients: [ann.memberId] })).value)
  return { pool, ledger, channel, ann, threadRef: opened.thread.threadRef }
}

const questions = [
  { prompt: 'Which release day?', multiple: false, options: [{ label: 'Thursday' }, { label: 'Friday' }], recommended: [1] },
]

/**
 * A ledger as it looked before decision records existed: the answer notice is
 * still there, but the operation carries no decision record.
 */
function legacyLedger(pool: MemoryMediaPool): Promise<AgentTeamLedger> {
  const copy = new MemoryMediaPool()
  copy.versions.set('agent_team', pool.versions.get('agent_team')!)
  const stored = pool.media.get('agent_team')!.tables.get('operations')! as Map<AgentTeamOperationId, AgentTeamOperation>
  const operations = new Map<AgentTeamOperationId, AgentTeamOperation>(stored)
  for (const [key, operation] of operations) {
    if (operation.kind === 'team/thread-replied' && operation.data.decision?.event === 'answered') {
      const { decisionRecord: _dropped, ...data } = operation.data
      operations.set(key, Object.freeze({ ...operation, data: Object.freeze(data) }))
    }
  }
  copy.media.set('agent_team', { tables: new Map([['operations', operations]]), global: null })
  return openLedger(copy)
}

async function askAndAnswer(ledger: AgentTeamLedger, ann: AgentTeamMemberActor, threadRef: AgentTeamThreadRef, tag: string) {
  const asked = (await ledger.askDecision({ requestId: requestId(`ask-${tag}`), workspaceId: alpha, threadRef, actor: ann,
    context: 'The plan is ready.', questions })).value
  const answered = (await ledger.answerDecision({ requestId: requestId(`answer-${tag}`), workspaceId: alpha,
    decisionRef: asked.notice.decisionRef, actor: human, answers: [{ selected: [0], text: 'Thursday, because the gate is green.' }] })).value
  return { decisionRef: asked.notice.decisionRef, messageRef: asked.message.messageRef, answered }
}

async function draftPlan(ledger: AgentTeamLedger, ann: AgentTeamMemberActor, threadRef: AgentTeamThreadRef, title: string) {
  const created = (await ledger.createDoc({ requestId: requestId(`doc-${title}`), workspaceId: alpha, threadRef, actor: ann,
    title, outline: ['Goal'] })).value
  const written = committed((await ledger.writeDocSection({ requestId: requestId(`write-${title}`), workspaceId: alpha,
    docRef: created.doc.docRef, actor: ann, baseDocRevision: created.revision, sectionId: 's1', heading: 'Goal', markdown: 'Ship it.' })).value)
  await ledger.submitDoc({ requestId: requestId(`submit-${title}`), workspaceId: alpha, docRef: created.doc.docRef, actor: ann,
    docRevision: written.revision })
  return { docRef: created.doc.docRef, revision: written.revision }
}

describe('decision records', () => {
  it('1. records the Human\'s answer to an ask card on the Task, exactly once', async () => {
    const { pool, ledger, ann, taskRef, threadRef } = await room()
    const { decisionRef, messageRef } = await askAndAnswer(ledger, ann, threadRef, 'one')

    const records = ledger.decisionRecords(human, { workspaceId: alpha, taskRef }).records
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      taskRef,
      decidedBy: human.memberId,
      decided: 'Thursday — Thursday, because the gate is green.',
      rationale: 'Thursday, because the gate is green.',
      source: { kind: 'ask', decisionRef, messageRef },
    })
    expect(records[0]!.supersedes).toBeUndefined()

    for (const record of storedOperations(pool)) expect(agentTeamOperationSchema.safeParse(record).success).toBe(true)
  })

  it('2. records the Human\'s approval of a plan on the Task, with the review note as the rationale', async () => {
    const { ledger, ann, taskRef, threadRef } = await room()
    const { docRef, revision } = await draftPlan(ledger, ann, threadRef, 'Release plan')
    await ledger.reviewDoc({ requestId: requestId('approve'), workspaceId: alpha, docRef, actor: human,
      docRevision: revision, verdict: 'approve', note: 'The gate is green.' })

    const records = ledger.decisionRecords(human, { workspaceId: alpha, taskRef }).records
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      taskRef,
      decidedBy: human.memberId,
      decided: 'Approved plan "Release plan"',
      rationale: 'The gate is green.',
      source: { kind: 'plan', docRef, docRevision: revision },
    })
  })

  it('3. records nothing for an ask, a withdrawal, a change request or a cancellation', async () => {
    const { ledger, ann, taskRef, threadRef } = await room()
    const asked = (await ledger.askDecision({ requestId: requestId('ask'), workspaceId: alpha, threadRef, actor: ann, questions })).value
    expect(ledger.decisionRecords(human, { workspaceId: alpha, taskRef }).records).toHaveLength(0)

    await ledger.withdrawDecision({ requestId: requestId('withdraw'), workspaceId: alpha, decisionRef: asked.notice.decisionRef, actor: ann })
    expect(ledger.decisionRecords(human, { workspaceId: alpha, taskRef }).records).toHaveLength(0)

    const { docRef, revision } = await draftPlan(ledger, ann, threadRef, 'Release plan')
    await ledger.reviewDoc({ requestId: requestId('changes'), workspaceId: alpha, docRef, actor: human,
      docRevision: revision, verdict: 'review', note: 'Add the steps.' })
    expect(ledger.decisionRecords(human, { workspaceId: alpha, taskRef }).records).toHaveLength(0)
  })

  it('4. writes exactly one record when the same request is replayed, and refuses a second answer', async () => {
    const { ledger, ann, taskRef, threadRef } = await room()
    const { decisionRef } = await askAndAnswer(ledger, ann, threadRef, 'retry')
    expect(ledger.decisionRecords(human, { workspaceId: alpha, taskRef }).records).toHaveLength(1)

    // A same-request retry resolves the stored answer, so no second record.
    const retry = await ledger.answerDecision({ requestId: requestId('answer-retry'), workspaceId: alpha, decisionRef, actor: human,
      answers: [{ selected: [1] }] })
    expect(retry.committed).toBe(false)
    expect(ledger.decisionRecords(human, { workspaceId: alpha, taskRef }).records).toHaveLength(1)

    // A fresh request id may not answer the same card twice.
    await expect(ledger.answerDecision({ requestId: requestId('answer-again'), workspaceId: alpha, decisionRef, actor: human,
      answers: [{ selected: [1] }] })).rejects.toThrow(/already answered/)
    expect(ledger.decisionRecords(human, { workspaceId: alpha, taskRef }).records).toHaveLength(1)
  })

  it('5. supersedes the earlier plan record on the Task, and never supersedes an ask card', async () => {
    const { ledger, ann, taskRef, threadRef } = await room()
    const first = await draftPlan(ledger, ann, threadRef, 'First plan')
    await ledger.reviewDoc({ requestId: requestId('approve-first'), workspaceId: alpha, docRef: first.docRef, actor: human,
      docRevision: first.revision, verdict: 'approve' })
    const second = await draftPlan(ledger, ann, threadRef, 'Second plan')
    await ledger.reviewDoc({ requestId: requestId('approve-second'), workspaceId: alpha, docRef: second.docRef, actor: human,
      docRevision: second.revision, verdict: 'approve' })

    const plans = ledger.decisionRecords(human, { workspaceId: alpha, taskRef }).records
    expect(plans).toHaveLength(2)
    expect(plans[0]!.supersedes).toBeUndefined()
    expect(plans[1]!.supersedes).toBe(plans[0]!.recordRef)
    // The superseded record is still listed, and still says what it said.
    expect(plans[0]).toMatchObject({ decided: 'Approved plan "First plan"' })

    await askAndAnswer(ledger, ann, threadRef, 'ask')
    const records = ledger.decisionRecords(human, { workspaceId: alpha, taskRef }).records
    const ask = records.find(record => record.source.kind === 'ask')!
    expect(ask.supersedes).toBeUndefined()
  })

  it('6. keeps the records of one Task out of another Task\'s list', async () => {
    const { ledger, ann, taskRef, threadRef, channel } = await room()
    await askAndAnswer(ledger, ann, threadRef, 'scoped')
    const other = (await ledger.createTask({ requestId: requestId('task-other'), workspaceId: alpha, channelRef: channel.channelRef,
      body: 'Other work', actor: human })).value
    expect(ledger.decisionRecords(human, { workspaceId: alpha, taskRef: other.task.taskRef }).records).toHaveLength(0)
    expect(ledger.decisionRecords(human, { workspaceId: alpha, taskRef }).records).toHaveLength(1)
  })

  it('7. replays an old ledger unchanged, deriving the record its answer already implies', async () => {
    const { pool, ledger, ann, taskRef, threadRef } = await room()
    await askAndAnswer(ledger, ann, threadRef, 'legacy')

    // A ledger written before decision records existed carries the answer
    // notice but no record.
    const legacy = await legacyLedger(pool)
    const replayed = legacy.decisionRecords(human, { workspaceId: alpha, taskRef }).records
    expect(replayed).toHaveLength(1)
    expect(replayed[0]).toMatchObject({
      taskRef,
      decidedBy: human.memberId,
      decided: 'Thursday — Thursday, because the gate is green.',
      rationale: 'Thursday, because the gate is green.',
      source: { kind: 'ask' },
    })
    // The derived ref is a function of the operation, so a second replay derives
    // the same ref and the same indexes.
    const again = (await legacyLedger(pool)).decisionRecords(human, { workspaceId: alpha, taskRef }).records
    expect(again.map(record => record.recordRef)).toEqual(replayed.map(record => record.recordRef))
    expect(again[0]!.recordRef).toMatch(/^decisionRecord:/)
  })

  it('8. records a decision on a taskless Thread and attaches it when the Thread is promoted', async () => {
    const { pool, ledger, ann, threadRef } = await tasklessRoom()
    await askAndAnswer(ledger, ann, threadRef, 'taskless')

    // The decision is recorded even though the Thread has no Task yet.
    const answer = storedOperations(pool).find(operation => operation.kind === 'team/thread-replied'
      && operation.data.decision?.event === 'answered')
    expect(answer?.kind === 'team/thread-replied' ? answer.data.decisionRecord : undefined).toMatchObject({
      decided: 'Thursday — Thursday, because the gate is green.',
    })
    expect(answer?.kind === 'team/thread-replied' ? answer.data.decisionRecord?.taskRef : undefined).toBeUndefined()

    // The Human reads the Thread first: a promotion needs the unread work behind it.
    const read = (await ledger.readThread({ requestId: requestId('read'), workspaceId: alpha, threadRef, actor: human })).value
    const promoted = committed((await ledger.promoteThread({ requestId: requestId('promote'), workspaceId: alpha, threadRef,
      baseRevision: read.thread.revision, actor: human })).value)
    const records = ledger.decisionRecords(human, { workspaceId: alpha, taskRef: promoted.task.taskRef }).records
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ taskRef: promoted.task.taskRef, source: { kind: 'ask' } })
  })

  it('9. records nothing when a seat answers the card addressed to it, and the card still closes', async () => {
    const { pool, ledger, channel, ann } = await room()
    const bob = await addMember(ledger, channel.channelRef, 'bob')
    // A Task the asking seat opened: the seat follows the Thread it works in.
    const opened = committed((await ledger.sendMessage({ requestId: requestId('open-seat'), workspaceId: alpha,
      channelRef: channel.channelRef, body: 'Ship the release', asTask: true, actor: ann, recipients: [bob.memberId] })).value)
    const taskRef = opened.task!.taskRef
    const threadRef = opened.thread.threadRef

    const asked = (await ledger.askDecision({ requestId: requestId('ask-seat'), workspaceId: alpha, threadRef, actor: ann,
      target: bob.memberId, questions })).value
    const answered = (await ledger.answerDecision({ requestId: requestId('answer-seat'), workspaceId: alpha,
      decisionRef: asked.notice.decisionRef, actor: bob, answers: [{ selected: [0], text: 'Thursday' }] })).value

    // The seat's call resolves the card like any answer.
    expect(answered.notice).toMatchObject({ event: 'answered' })
    expect(ledger.decision(human, { workspaceId: alpha, decisionRef: asked.notice.decisionRef })).toMatchObject({
      status: 'answered', closedBy: bob.memberId, target: bob.memberId,
    })

    // It is a seat call, not an Owner decision: no record is written, and the
    // operation carries none.
    expect(ledger.decisionRecords(human, { workspaceId: alpha, taskRef }).records).toHaveLength(0)
    const answer = storedOperations(pool).find(operation => operation.kind === 'team/thread-replied'
      && operation.data.decision?.event === 'answered')
    expect(answer?.kind === 'team/thread-replied' ? answer.data.decisionRecord : 'missing').toBeUndefined()

    // A replay derives nothing for the Member's answer either.
    const replayed = await legacyLedger(pool)
    expect(replayed.decisionRecords(human, { workspaceId: alpha, taskRef }).records).toHaveLength(0)
  })

  it('10. records the Human\'s answer to a card addressed to a seat', async () => {
    const { ledger, channel, ann, taskRef, threadRef } = await room()
    const bob = await addMember(ledger, channel.channelRef, 'bob')
    const asked = (await ledger.askDecision({ requestId: requestId('ask-takeover'), workspaceId: alpha, threadRef, actor: ann,
      target: bob.memberId, questions })).value
    await ledger.answerDecision({ requestId: requestId('answer-takeover'), workspaceId: alpha,
      decisionRef: asked.notice.decisionRef, actor: human, answers: [{ selected: [1], text: 'Friday.' }] })

    const records = ledger.decisionRecords(human, { workspaceId: alpha, taskRef }).records
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      taskRef,
      decidedBy: human.memberId,
      decided: 'Friday — Friday.',
      rationale: 'Friday.',
      source: { kind: 'ask', decisionRef: asked.notice.decisionRef },
    })
  })
})
