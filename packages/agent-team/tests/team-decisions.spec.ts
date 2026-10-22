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
  AgentTeamRequestId,
} from '../src/types.ts'

const cleanups: Array<() => Promise<void>> = []
const alpha = WorkspaceId('workspace:alpha')
const human = agentTeamHumanActor()
const HUMAN_MEMBER_ID = human.memberId
const NOBODY_MEMBER_ID = 'member:nobody' as AgentTeamAgentMember['memberId']
const ANOTHER_MEMBER_ID = 'member:another' as AgentTeamAgentMember['memberId']
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

/** One Channel, an author Agent and a bystander, and a Thread the Human opened naming the author. */
async function room() {
  const pool = new MemoryMediaPool()
  const ledger = await openLedger(pool)
  const channel = (await ledger.createChannel({ requestId: requestId('channel'), workspaceId: alpha,
    name: 'room', description: '', memberIds: [], actor: human })).value.channel
  const ann = await addMember(ledger, channel.channelRef, 'ann')
  const bob = await addMember(ledger, channel.channelRef, 'bob')
  const opened = committed((await ledger.sendMessage({ requestId: requestId('open'), workspaceId: alpha,
    channelRef: channel.channelRef, body: 'Plan the release', asTask: false, actor: human, recipients: [ann.memberId] })).value)
  return { pool, ledger, channel, ann, bob, threadRef: opened.thread.threadRef }
}

const questions = [
  { prompt: 'Which release day?', multiple: false, options: [{ label: 'Thursday', description: 'One day early.' }, { label: 'Friday' }], recommended: [1] },
  { prompt: 'Which checks must pass?', multiple: true, options: [{ label: 'Unit' }, { label: 'Browser' }, { label: 'Smoke' }], recommended: [0, 1] },
]

function copyLedger(pool: MemoryMediaPool): Promise<AgentTeamLedger> {
  const copy = new MemoryMediaPool()
  copy.versions.set('agent_team', pool.versions.get('agent_team')!)
  copy.media.set('agent_team', { tables: new Map([['operations', new Map(pool.media.get('agent_team')!.tables.get('operations')!)]]), global: null })
  return openLedger(copy)
}

describe('decision cards', () => {
  it('asks the Human in the Thread, answers once, wakes the asker, and replays', async () => {
    const { pool, ledger, ann, threadRef } = await room()
    const humanDirect = ledger.inbox(human, { workspaceId: alpha }).totalDirectCount
    const asked = (await ledger.askDecision({ requestId: requestId('ask'), workspaceId: alpha, threadRef, actor: ann,
      context: '  The plan is ready.  ', questions })).value
    expect(asked.notice).toMatchObject({ event: 'asked', context: 'The plan is ready.' })
    expect(asked.message.body).toContain('@human I need your call on 2 questions')
    expect(asked.message.body).toContain('b) Friday (recommended)')
    expect(ledger.inbox(human, { workspaceId: alpha }).totalDirectCount).toBe(humanDirect + 1)
    const decisionRef = asked.notice.decisionRef
    expect(ledger.decisions(human, { workspaceId: alpha, threadRef }).decisions).toEqual([
      expect.objectContaining({ decisionRef, status: 'open', asker: ann.memberId, messageRef: asked.message.messageRef }),
    ])

    const annDirect = ledger.inbox(ann, { workspaceId: alpha }).totalDirectCount
    const answered = (await ledger.answerDecision({ requestId: requestId('answer'), workspaceId: alpha, decisionRef, actor: human,
      answers: [{ selected: [0] }, { selected: [2, 0], text: ' and lint ' }] })).value
    expect(answered.message.body).toContain('1. Which release day? → Thursday')
    expect(answered.message.body).toContain('2. Which checks must pass? → Unit, Smoke + "and lint"')
    expect(ledger.inbox(ann, { workspaceId: alpha }).totalDirectCount).toBe(annDirect + 1)
    expect(ledger.decision(ann, { workspaceId: alpha, decisionRef })).toMatchObject({
      status: 'answered', closedBy: human.memberId, answers: [{ selected: [0] }, { selected: [0, 2], text: 'and lint' }],
    })

    // A card answers once; a same-request retry returns the stored answer.
    await expect(ledger.answerDecision({ requestId: requestId('answer-again'), workspaceId: alpha, decisionRef, actor: human,
      answers: [{ selected: [1] }, { selected: [1] }] })).rejects.toThrow(/already answered/)
    const retry = await ledger.answerDecision({ requestId: requestId('answer'), workspaceId: alpha, decisionRef, actor: human,
      answers: [{ selected: [1] }, { selected: [1] }] })
    expect(retry.committed).toBe(false)
    expect(retry.value.message.messageRef).toBe(answered.message.messageRef)

    for (const record of storedOperations(pool)) expect(agentTeamOperationSchema.safeParse(record).success).toBe(true)
    const replay = await copyLedger(pool)
    replay.validate()
    expect(replay.decisions(human, { workspaceId: alpha, threadRef })).toEqual(ledger.decisions(human, { workspaceId: alpha, threadRef }))
  })

  it('checks the card and the answer against their limits', async () => {
    const { ledger, ann, threadRef } = await room()
    const ask = (overrides: object) => ledger.askDecision({ requestId: requestId(`ask-${Math.random()}`), workspaceId: alpha, threadRef, actor: ann,
      questions: [{ ...questions[0]!, ...overrides }] })
    await expect(ledger.askDecision({ requestId: requestId('none'), workspaceId: alpha, threadRef, actor: ann, questions: [] })).rejects.toThrow(/1 to 6 questions/)
    await expect(ledger.askDecision({ requestId: requestId('seven'), workspaceId: alpha, threadRef, actor: ann,
      questions: Array.from({ length: 7 }, () => questions[0]!) })).rejects.toThrow(/1 to 6 questions/)
    await expect(ask({ options: [{ label: 'Only' }] })).rejects.toThrow(/2 to 4 options/)
    await expect(ask({ recommended: [0, 1] })).rejects.toThrow(/at most one option/)
    await expect(ask({ recommended: [5] })).rejects.toThrow(/does not have/)
    await expect(ask({ prompt: 'x'.repeat(301) })).rejects.toThrow(/at most 300/)
    await expect(ask({ options: [{ label: 'Same' }, { label: 'same' }] })).rejects.toThrow(/same label/)
    const { notice } = (await ledger.askDecision({ requestId: requestId('ok'), workspaceId: alpha, threadRef, actor: ann, questions })).value
    const answer = (answers: object[]) => ledger.answerDecision({ requestId: requestId(`answer-${Math.random()}`), workspaceId: alpha,
      decisionRef: notice.decisionRef, actor: human, answers: answers as never })
    await expect(answer([{ selected: [0] }])).rejects.toThrow(/each of the 2/)
    await expect(answer([{ selected: [0, 1] }, { selected: [0] }])).rejects.toThrow(/more than one option/)
    await expect(answer([{ selected: [] }, { selected: [0] }])).rejects.toThrow(/picked option or a written answer/)
    await expect(answer([{ selected: [0] }, { selected: [9] }])).rejects.toThrow(/does not have/)
    await expect(ledger.answerDecision({ requestId: requestId('ann-answers'), workspaceId: alpha, decisionRef: notice.decisionRef,
      actor: ann as never, answers: [{ selected: [0] }, { selected: [0] }] })).rejects.toThrow()
  })

  it('lets only the asker withdraw an open card, which then takes no answer', async () => {
    const { pool, ledger, ann, bob, threadRef } = await room()
    const { notice } = (await ledger.askDecision({ requestId: requestId('ask'), workspaceId: alpha, threadRef, actor: ann, questions })).value
    await expect(ledger.withdrawDecision({ requestId: requestId('bob'), workspaceId: alpha, decisionRef: notice.decisionRef, actor: bob }))
      .rejects.toThrow(/only the Member that asked/)
    const withdrawn = (await ledger.withdrawDecision({ requestId: requestId('withdraw'), workspaceId: alpha, decisionRef: notice.decisionRef, actor: ann })).value
    expect(withdrawn.message.body).toContain('no longer needs an answer')
    expect(ledger.decision(human, { workspaceId: alpha, decisionRef: notice.decisionRef })).toMatchObject({ status: 'withdrawn', closedBy: ann.memberId })
    await expect(ledger.answerDecision({ requestId: requestId('late'), workspaceId: alpha, decisionRef: notice.decisionRef, actor: human,
      answers: [{ selected: [0] }, { selected: [0] }] })).rejects.toThrow(/already withdrawn/)
    const replay = await copyLedger(pool)
    replay.validate()
    expect(replay.decision(human, { workspaceId: alpha, decisionRef: notice.decisionRef }).status).toBe('withdrawn')
  })
})

describe('cards addressed to a seat', () => {
  /** A Channel, an asker, a target seat, and a Task the asker owns. */
  async function planningRoom() {
    const pool = new MemoryMediaPool()
    const ledger = await openLedger(pool)
    const channel = (await ledger.createChannel({ requestId: requestId('channel'), workspaceId: alpha,
      name: 'room', description: '', memberIds: [], actor: human })).value.channel
    const ann = await addMember(ledger, channel.channelRef, 'ann')
    const bob = await addMember(ledger, channel.channelRef, 'bob')
    const started = (await ledger.createTask({ requestId: requestId('task'), workspaceId: alpha,
      channelRef: channel.channelRef, body: 'Ship the release', actor: human })).value
    return { pool, ledger, channel, ann, bob, task: started.task, thread: started.thread }
  }

  it('asks the named seat, puts the card in its Inbox, and wakes it', async () => {
    const { ledger, ann, bob, task } = await planningRoom()
    const bobDirect = ledger.inbox(bob, { workspaceId: alpha }).totalDirectCount
    const asked = (await ledger.askDecision({ requestId: requestId('ask'), workspaceId: alpha, taskRef: task.taskRef,
      actor: ann, target: bob.memberId, context: 'Which day ships?', questions })).value
    expect(asked.notice).toMatchObject({ event: 'asked', target: bob.memberId })
    expect(asked.message.body).toContain('@bob I need your call on 2 questions')
    expect(asked.message.body).not.toContain('@human')
    expect(ledger.inbox(bob, { workspaceId: alpha }).totalDirectCount).toBe(bobDirect + 1)
    expect(ledger.decision(bob, { workspaceId: alpha, decisionRef: asked.notice.decisionRef })).toMatchObject({
      status: 'open', asker: ann.memberId, target: bob.memberId,
    })
    // The seat is woken by the mention: the ask is the operation that names it.
    const operation = ledger.getOperation(asked.receipt.operationId)!
    expect(ledger.affectedMembersOf(operation)).toContain(bob.memberId)
  })

  it('lets the named seat answer, which wakes the asker', async () => {
    const { ledger, ann, bob, task } = await planningRoom()
    const asked = (await ledger.askDecision({ requestId: requestId('ask'), workspaceId: alpha, taskRef: task.taskRef,
      actor: ann, target: bob.memberId, questions })).value
    const decisionRef = asked.notice.decisionRef
    const annDirect = ledger.inbox(ann, { workspaceId: alpha }).totalDirectCount
    const answered = (await ledger.answerDecision({ requestId: requestId('answer'), workspaceId: alpha, decisionRef,
      actor: bob, answers: [{ selected: [1] }, { selected: [0] }] })).value
    expect(answered.message.body).toContain('1. Which release day? → Friday')
    expect(ledger.inbox(ann, { workspaceId: alpha }).totalDirectCount).toBe(annDirect + 1)
    expect(ledger.decision(ann, { workspaceId: alpha, decisionRef })).toMatchObject({
      status: 'answered', closedBy: bob.memberId, target: bob.memberId,
    })
  })

  it('refuses a seat that has left the card Channel', async () => {
    const { ledger, ann, bob, task, channel } = await planningRoom()
    const { notice } = (await ledger.askDecision({ requestId: requestId('ask'), workspaceId: alpha, taskRef: task.taskRef,
      actor: ann, target: bob.memberId, questions })).value
    await ledger.removeChannelMember({ requestId: requestId('remove'), workspaceId: alpha, channelRef: channel.channelRef,
      memberId: bob.memberId, actor: human })
    await expect(ledger.answerDecision({ requestId: requestId('answer'), workspaceId: alpha, decisionRef: notice.decisionRef,
      actor: bob, answers: [{ selected: [0] }, { selected: [0] }] })).rejects.toThrow(/not authorized for Channel/)
  })

  it('lets the Human take over a card addressed to a seat, and keeps every other Member out', async () => {
    const { ledger, ann, bob, task } = await planningRoom()
    const { notice } = (await ledger.askDecision({ requestId: requestId('ask'), workspaceId: alpha, taskRef: task.taskRef,
      actor: ann, target: bob.memberId, questions })).value
    await expect(ledger.answerDecision({ requestId: requestId('ann'), workspaceId: alpha, decisionRef: notice.decisionRef,
      actor: ann, answers: [{ selected: [0] }, { selected: [0] }] })).rejects.toThrow(/only '.*bob.*' can answer/)
    const taken = (await ledger.answerDecision({ requestId: requestId('human'), workspaceId: alpha, decisionRef: notice.decisionRef,
      actor: human, answers: [{ selected: [0] }, { selected: [0] }] })).value
    expect(taken.notice).toMatchObject({ event: 'answered' })
    expect(ledger.decision(human, { workspaceId: alpha, decisionRef: notice.decisionRef })).toMatchObject({ closedBy: human.memberId })
  })

  it('refuses a card addressed to a seat once the Task has left its planning phase', async () => {
    const { ledger, ann, bob, task, thread } = await planningRoom()
    const askSeat = (id: string) => ledger.askDecision({ requestId: requestId(id), workspaceId: alpha,
      taskRef: task.taskRef, actor: ann, target: bob.memberId, questions })
    // A Claim puts the Task in execution, so the planning-phase question is refused.
    const claimed = committed((await ledger.changeClaim({ requestId: requestId('claim'), workspaceId: alpha, taskRef: task.taskRef,
      action: 'claim', direction: 'ship it', baseRevision: thread.revision, actor: ann })).value)
    expect(claimed.task.status).toBe('in_progress')
    await expect(askSeat('ask-claimed')).rejects.toThrow(/planning-phase question: Task .* is claimed/)
    // A released Claim leaves nobody holding the Task, so it is back in design.
    const released = committed((await ledger.changeClaim({ requestId: requestId('release'), workspaceId: alpha, taskRef: task.taskRef,
      action: 'release', claimRef: claimed.claim.claimRef, baseRevision: claimed.thread.revision, actor: ann })).value)
    expect(released.task.status).toBe('todo')
    const asked = await askSeat('ask-released-claim')
    expect(asked.value.notice).toMatchObject({ target: bob.memberId })
  })

  it('keeps a card with no target the Human\'s alone, as every card before this change was', async () => {
    const { ledger, ann, bob, task } = await planningRoom()
    const { notice } = (await ledger.askDecision({ requestId: requestId('ask'), workspaceId: alpha, taskRef: task.taskRef,
      actor: ann, questions })).value
    expect(notice).not.toHaveProperty('target')
    await expect(ledger.answerDecision({ requestId: requestId('answer'), workspaceId: alpha, decisionRef: notice.decisionRef,
      actor: bob, answers: [{ selected: [0] }, { selected: [0] }] })).rejects.toThrow(/addressed to the Human/)
    const answered = (await ledger.answerDecision({ requestId: requestId('human'), workspaceId: alpha, decisionRef: notice.decisionRef,
      actor: human, answers: [{ selected: [0] }, { selected: [0] }] })).value
    expect(answered.notice).toMatchObject({ event: 'answered' })
  })

  it('refuses a target that is not a reachable Member of the card Channel', async () => {
    const { ledger, ann, task } = await planningRoom()
    const other = (await ledger.createChannel({ requestId: requestId('other-channel'), workspaceId: alpha,
      name: 'other', description: '', memberIds: [], actor: human })).value.channel
    const outsider = await addMember(ledger, other.channelRef, 'outsider')
    await expect(ledger.askDecision({ requestId: requestId('ask'), workspaceId: alpha, taskRef: task.taskRef,
      actor: ann, target: outsider.memberId, questions })).rejects.toThrow(/cannot be reached in Channel/)
    await expect(ledger.askDecision({ requestId: requestId('ask-human'), workspaceId: alpha, taskRef: task.taskRef,
      actor: ann, target: HUMAN_MEMBER_ID, questions })).rejects.toThrow(/already addresses the Human/)
    await expect(ledger.askDecision({ requestId: requestId('ask-self'), workspaceId: alpha, taskRef: task.taskRef,
      actor: ann, target: ann.memberId, questions })).rejects.toThrow(/cannot be addressed to the seat that asked/)
    await expect(ledger.askDecision({ requestId: requestId('ask-unknown'), workspaceId: alpha, taskRef: task.taskRef,
      actor: ann, target: NOBODY_MEMBER_ID, questions })).rejects.toThrow(/unknown Agent Member/)
  })

  it('reads a card recorded before targeted asks existed, unchanged', () => {
    // The shape every card had before this change: an asked notice with no
    // target, addressed to the Human.
    const legacy = {
      operationId: 'operation:1', requestId: 'req:1', sequence: 1, previousOperationId: null,
      occurredAt: '2026-01-01T00:00:00.000Z',
      actor: { kind: 'human', memberId: 'member:human', handle: 'human' },
      kind: 'team/thread-replied',
      data: {
        workspaceId: alpha, baseRevision: 1,
        mentions: ['member:human'],
        message: { messageRef: 'message:1', channelRef: 'channel:a', threadRef: 'thread:a', sender: 'member:human',
          body: '@human I need your call on 1 question — decision:1.', topLevel: false, sequence: 1, occurredAt: '2026-01-01T00:00:00.000Z' },
        thread: { threadRef: 'thread:a', revision: 1 },
        inbox: { attention: { set: [], removed: [] }, directMarkers: { added: [], removed: [] }, activityMarkers: { added: [], removed: [] } },
        decision: { decisionRef: 'decision:1', event: 'asked', questions: [{ prompt: 'Which day?', multiple: false, options: [{ label: 'A' }, { label: 'B' }], recommended: [0] }] },
      },
    }
    expect(agentTeamOperationSchema.safeParse(legacy).success).toBe(true)
  })

  it('collides when the same request asks a different seat, and replays a card addressed to a seat', async () => {
    const { pool, ledger, ann, bob, task } = await planningRoom()
    const askSeat = (id: string, target: AgentTeamAgentMember['memberId']) => ledger.askDecision({ requestId: requestId(id), workspaceId: alpha,
      taskRef: task.taskRef, actor: ann, target, questions })
    const asked = await askSeat('ask', bob.memberId)
    expect(asked.value.notice).toMatchObject({ target: bob.memberId })
    const retry = await askSeat('ask', bob.memberId)
    expect(retry.committed).toBe(false)
    expect(retry.value.message.messageRef).toBe(asked.value.message.messageRef)
    await expect(askSeat('ask', ANOTHER_MEMBER_ID)).rejects.toThrow(/reused with a different operation or payload/)

    for (const record of storedOperations(pool)) expect(agentTeamOperationSchema.safeParse(record).success).toBe(true)
    const replay = await copyLedger(pool)
    replay.validate()
    expect(replay.decision(bob, { workspaceId: alpha, decisionRef: asked.value.notice.decisionRef })).toMatchObject({
      status: 'open', target: bob.memberId,
    })
  })
})
