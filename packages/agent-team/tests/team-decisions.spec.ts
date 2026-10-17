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
