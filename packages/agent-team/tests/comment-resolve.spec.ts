/**
 * M-72: one issue comment thread closed and reopened from the ledger.
 *
 * The op is its own kind, not the Doc-comment resolve reused: an issue comment
 * thread is a run of Thread Messages (so it reopens), it is fenced by the
 * Thread revision, and the client reads its state from `AgentTeamIssueView`.
 * These tests cover the write path, the replay of that path from a fresh
 * ledger, the fence, and the projection the client renders.
 */
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
  AgentTeamAgentMember, AgentTeamChannelRef, AgentTeamIssueView, AgentTeamMemberActor, AgentTeamMemberId,
  AgentTeamMessageRef, AgentTeamOperation, AgentTeamOperationId, AgentTeamRequestId, AgentTeamTaskRef,
} from '../src/types.ts'

const cleanups: Array<() => Promise<void>> = []
const alpha = WorkspaceId('workspace:alpha')
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

/** A second ledger over the same records: the replay this op must survive. */
async function replayOf(pool: MemoryMediaPool): Promise<AgentTeamLedger> {
  const copy = new MemoryMediaPool()
  copy.versions.set('agent_team', pool.versions.get('agent_team')!)
  copy.media.set('agent_team', { tables: new Map([['operations', new Map(pool.media.get('agent_team')!.tables.get('operations')!)]]), global: null })
  const replay = await openLedger(copy)
  replay.validate()
  return replay
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

/** One Channel, two author Agents, and a Task whose Thread the Human opened. */
async function room() {
  const pool = new MemoryMediaPool()
  const ledger = await openLedger(pool)
  const channel = (await ledger.createChannel({ requestId: requestId('channel'), workspaceId: alpha,
    name: 'room', description: '', memberIds: [], actor: human })).value.channel
  const ann = await addMember(ledger, channel.channelRef, 'ann')
  const bob = await addMember(ledger, channel.channelRef, 'bob')
  const task = (await ledger.createTask({ requestId: requestId('task'), workspaceId: alpha, channelRef: channel.channelRef,
    body: 'Ship the board', title: 'Ship the board', actor: human })).value
  return { pool, ledger, channel, ann, bob, taskRef: task.task.taskRef, threadRef: task.thread.threadRef }
}

/** The Thread revision on screen: what a writer fences its write on. */
function revisionOf(ledger: AgentTeamLedger, taskRef: AgentTeamTaskRef): number {
  return ledger.threadHistory(human, { workspaceId: alpha, taskRef, limit: 1 }).thread.revision
}

async function comment(ledger: AgentTeamLedger, taskRef: AgentTeamTaskRef, actor: AgentTeamMemberActor, body: string): Promise<AgentTeamMessageRef> {
  const replied = committed((await ledger.reply({ requestId: requestId(`reply:${body}`), workspaceId: alpha, taskRef, body,
    baseRevision: revisionOf(ledger, taskRef), actor })).value)
  return replied.message.messageRef
}

async function viewOf(ledger: AgentTeamLedger, taskRef: AgentTeamTaskRef, commentLimit?: number): Promise<AgentTeamIssueView> {
  return ledger.issueView(human, { workspaceId: alpha, taskRef, ...(commentLimit === undefined ? {} : { commentLimit }) })
}

describe('comment resolution', () => {
  it('1. resolves a root comment, replays it from the ledger, and reopens it', async () => {
    const { pool, ledger, ann, taskRef } = await room()
    const root = await comment(ledger, taskRef, ann, 'Which release day?')

    const resolved = committed((await ledger.resolveComment({ requestId: requestId('resolve'), workspaceId: alpha, taskRef,
      messageRef: root, resolved: true, baseRevision: revisionOf(ledger, taskRef), actor: human })).value)
    expect(resolved.messageRef).toBe(root)
    expect(resolved.resolved).toEqual({ memberId: human.memberId, resolvedAt: expect.any(String) })

    const closed = await viewOf(ledger, taskRef)
    expect(closed.comments.items.map(item => [item.message.body, item.resolved?.memberId])).toEqual([['Which release day?', human.memberId]])
    // The stored record is the durable shape, and the write did not advance
    // the Thread revision: a reply already in flight is not made stale by a
    // resolution.
    expect(storedOperations(pool).every(record => agentTeamOperationSchema.safeParse(record).success)).toBe(true)
    expect(revisionOf(ledger, taskRef)).toBe(resolved.receipt.sequence - 1)

    // A fresh ledger over the same records answers the same view: the fold is
    // the operation, not the runtime.
    const replay = await replayOf(pool)
    expect(await viewOf(replay, taskRef)).toEqual(await viewOf(ledger, taskRef))

    const reopened = committed((await ledger.resolveComment({ requestId: requestId('reopen'), workspaceId: alpha, taskRef,
      messageRef: root, resolved: false, baseRevision: revisionOf(ledger, taskRef), actor: human })).value)
    expect(reopened.resolved).toBeUndefined()
    expect((await viewOf(ledger, taskRef)).comments.items.map(item => item.resolved)).toEqual([undefined])
    expect(await viewOf(await replayOf(pool), taskRef)).toEqual(await viewOf(ledger, taskRef))
  })

  it('2. refuses a stale Thread revision and leaves the thread as it was', async () => {
    const { ledger, ann, taskRef } = await room()
    const root = await comment(ledger, taskRef, ann, 'Which release day?')

    expect((await ledger.resolveComment({ requestId: requestId('stale'), workspaceId: alpha, taskRef,
      messageRef: root, resolved: true, baseRevision: revisionOf(ledger, taskRef) - 1, actor: human })).value.kind)
      .toBe('stale_revision')
    expect((await viewOf(ledger, taskRef)).comments.items.map(item => item.resolved)).toEqual([undefined])

    // The fence is the same one the other Thread writes use, so a reply that
    // moved the revision makes the writer's revision stale.
    const settled = revisionOf(ledger, taskRef)
    await comment(ledger, taskRef, ann, 'Thursday.')
    expect((await ledger.resolveComment({ requestId: requestId('stale-after-reply'), workspaceId: alpha, taskRef,
      messageRef: root, resolved: true, baseRevision: settled, actor: human })).value.kind).toBe('stale_revision')
  })

  it('3. resolves by the root only: a reply, the anchor, a repeat and an unknown ref are refused', async () => {
    const { ledger, ann, taskRef } = await room()
    const root = await comment(ledger, taskRef, ann, 'Which release day?')
    const reply = committed((await ledger.reply({ requestId: requestId('reply'), workspaceId: alpha, taskRef, body: 'Thursday.',
      baseRevision: revisionOf(ledger, taskRef), actor: ann, replyToMessageRef: root })).value).message.messageRef

    await expect(ledger.resolveComment({ requestId: requestId('resolve-reply'), workspaceId: alpha, taskRef,
      messageRef: reply, resolved: true, baseRevision: revisionOf(ledger, taskRef), actor: human }))
      .rejects.toThrow(/a reply cannot be resolved/)
    const anchor = ledger.threadHistory(human, { workspaceId: alpha, taskRef, limit: 1 }).anchor
    await expect(ledger.resolveComment({ requestId: requestId('resolve-anchor'), workspaceId: alpha, taskRef,
      messageRef: anchor.messageRef, resolved: true, baseRevision: revisionOf(ledger, taskRef), actor: human }))
      .rejects.toThrow(/the opening Message is not a comment/)
    await expect(ledger.resolveComment({ requestId: requestId('resolve-unknown'), workspaceId: alpha, taskRef,
      messageRef: 'message:nowhere' as AgentTeamMessageRef, resolved: true, baseRevision: revisionOf(ledger, taskRef), actor: human }))
      .rejects.toThrow(/unknown Message/)

    await ledger.resolveComment({ requestId: requestId('resolve'), workspaceId: alpha, taskRef,
      messageRef: root, resolved: true, baseRevision: revisionOf(ledger, taskRef), actor: human })
    await expect(ledger.resolveComment({ requestId: requestId('resolve-again'), workspaceId: alpha, taskRef,
      messageRef: root, resolved: true, baseRevision: revisionOf(ledger, taskRef), actor: human }))
      .rejects.toThrow(/already resolved/)
    await expect(ledger.resolveComment({ requestId: requestId('reopen-unresolved'), workspaceId: alpha, taskRef,
      messageRef: reply, resolved: false, baseRevision: revisionOf(ledger, taskRef), actor: human }))
      .rejects.toThrow(/a reply cannot be resolved/)
  })

  it('4. admits the comment author, the Task assignee and the Human, and nobody else', async () => {
    const { ledger, ann, bob, taskRef } = await room()
    const byAnn = await comment(ledger, taskRef, ann, 'The build is green.')

    // A seat that neither wrote the comment nor holds the Task may not close it.
    await expect(ledger.resolveComment({ requestId: requestId('bob'), workspaceId: alpha, taskRef,
      messageRef: byAnn, resolved: true, baseRevision: revisionOf(ledger, taskRef), actor: bob }))
      .rejects.toThrow(/only the comment's author, the Task's assignee, or the Human/)

    // The author may.
    await ledger.resolveComment({ requestId: requestId('ann'), workspaceId: alpha, taskRef,
      messageRef: byAnn, resolved: true, baseRevision: revisionOf(ledger, taskRef), actor: ann })
    expect((await viewOf(ledger, taskRef)).comments.items[0]?.resolved?.memberId).toBe(ann.memberId)

    // The Task's assignee may, on a comment it did not write.
    await ledger.updateTask({ requestId: requestId('assign'), workspaceId: alpha, taskRef, actor: human,
      baseRevision: revisionOf(ledger, taskRef), patch: { assignee: bob.memberId } })
    const byAnn2 = await comment(ledger, taskRef, ann, 'Ready for review.')
    await ledger.resolveComment({ requestId: requestId('bob-assignee'), workspaceId: alpha, taskRef,
      messageRef: byAnn2, resolved: true, baseRevision: revisionOf(ledger, taskRef), actor: bob })
    expect((await viewOf(ledger, taskRef)).comments.items.map(item => item.resolved?.memberId)).toEqual([ann.memberId, bob.memberId])
  })

  it('5. a reply that leaves the thread unresolved does not reopen it', async () => {
    const { pool, ledger, ann, taskRef } = await room()
    const root = await comment(ledger, taskRef, ann, 'Which release day?')
    await ledger.resolveComment({ requestId: requestId('resolve'), workspaceId: alpha, taskRef,
      messageRef: root, resolved: true, baseRevision: revisionOf(ledger, taskRef), actor: human })
    await ledger.reply({ requestId: requestId('late-reply'), workspaceId: alpha, taskRef, body: 'Thursday, then.',
      baseRevision: revisionOf(ledger, taskRef), actor: ann, replyToMessageRef: root })

    const view = await viewOf(ledger, taskRef)
    // Only the root carries the state; the reply is not resolvable on its own,
    // and a later reply is not a reopen — reopening is an explicit act.
    expect(view.comments.items.map(item => [item.message.body, item.resolved?.memberId])).toEqual([
      ['Which release day?', human.memberId],
      ['Thursday, then.', undefined],
    ])
    expect(await viewOf(await replayOf(pool), taskRef)).toEqual(view)
  })

  it('6. answers a same-request retry with the stored write, and refuses a different resolution under it', async () => {
    const { pool, ledger, ann, taskRef } = await room()
    const root = await comment(ledger, taskRef, ann, 'Which release day?')
    const fence = revisionOf(ledger, taskRef)
    const first = (await ledger.resolveComment({ requestId: requestId('once'), workspaceId: alpha, taskRef,
      messageRef: root, resolved: true, baseRevision: fence, actor: human })).value

    const retried = (await ledger.resolveComment({ requestId: requestId('once'), workspaceId: alpha, taskRef,
      messageRef: root, resolved: true, baseRevision: fence, actor: human })).value
    expect(retried).toEqual(first)
    // A retry commits nothing: the ledger still holds one resolution record.
    expect(storedOperations(pool).filter(record => record.kind === 'team/comment-resolved')).toHaveLength(1)
    await expect(ledger.resolveComment({ requestId: requestId('once'), workspaceId: alpha, taskRef,
      messageRef: root, resolved: false, baseRevision: fence, actor: human })).rejects.toThrow(/was reused with a different operation or payload/)
  })

  it('7. carries the resolution onto the older pages, where a closed root actually sits', async () => {
    const { pool, ledger, ann, taskRef } = await room()
    const root = await comment(ledger, taskRef, ann, 'First')
    await comment(ledger, taskRef, ann, 'Second')
    await comment(ledger, taskRef, ann, 'Third')
    const closed = committed((await ledger.resolveComment({ requestId: requestId('resolve'), workspaceId: alpha, taskRef,
      messageRef: root, resolved: true, baseRevision: revisionOf(ledger, taskRef), actor: human })).value)

    // The newest page holds only 'Third', so the closed thread's root is on the
    // older page the reader pages back to. The history read carries the same
    // answer the issue view does: the same overlay, so no page offers a Resolve
    // the Host would refuse with "already resolved".
    const view = await viewOf(ledger, taskRef, 1)
    expect(view.comments.items.map(item => item.message.body)).toEqual(['Third'])
    const older = ledger.threadHistory(human, { workspaceId: alpha, taskRef, beforeSequence: view.comments.cursor, limit: 50 })
    const page = older.facts.filter(fact => fact.kind === 'message')
    expect(page.map(fact => [fact.message.body, fact.resolved])).toEqual([
      ['Ship the board', undefined],
      ['First', closed.resolved],
      ['Second', undefined],
    ])
    // A fresh ledger over the same records reads the same page.
    expect((await replayOf(pool)).threadHistory(human, { workspaceId: alpha, taskRef,
      beforeSequence: view.comments.cursor, limit: 50 }).facts).toEqual(older.facts)

    // Reopening removes it from the older page too: the overlay is the current
    // state, never a history of closes.
    await ledger.resolveComment({ requestId: requestId('reopen'), workspaceId: alpha, taskRef,
      messageRef: root, resolved: false, baseRevision: revisionOf(ledger, taskRef), actor: human })
    const reopened = ledger.threadHistory(human, { workspaceId: alpha, taskRef, beforeSequence: view.comments.cursor, limit: 50 })
    expect(reopened.facts.filter(fact => fact.kind === 'message').map(fact => fact.resolved)).toEqual([undefined, undefined, undefined])
  })
})
