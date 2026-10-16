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

async function draftedDoc(ledger: AgentTeamLedger, author: AgentTeamMemberActor, threadRef: AgentTeamThreadRef) {
  const created = (await ledger.createDoc({ requestId: requestId('doc'), workspaceId: alpha, threadRef, actor: author,
    title: 'Release plan', outline: ['Goal', 'Steps'] })).value
  const goal = committed((await ledger.writeDocSection({ requestId: requestId('goal'), workspaceId: alpha, docRef: created.doc.docRef,
    actor: author, baseDocRevision: created.revision, sectionId: 's1', heading: 'Goal', markdown: 'Ship 1.2 on Friday.' })).value)
  return { docRef: created.doc.docRef, revision: goal.revision }
}

describe('Team Documents', () => {
  it('creates an outline, fences section writes by the Doc revision, and appends new sections', async () => {
    const { ledger, ann, threadRef } = await room()
    const created = await ledger.createDoc({ requestId: requestId('doc'), workspaceId: alpha, threadRef, actor: ann,
      title: '  Release plan ', outline: ['Goal', ' Steps '] })
    expect(created.committed).toBe(true)
    expect(created.value.doc.title).toBe('Release plan')
    expect(created.value.sections).toEqual([
      { sectionId: 's1', heading: 'Goal', markdown: '' },
      { sectionId: 's2', heading: 'Steps', markdown: '' },
    ])
    const docRef = created.value.doc.docRef
    const first = committed((await ledger.writeDocSection({ requestId: requestId('w1'), workspaceId: alpha, docRef, actor: ann,
      baseDocRevision: created.value.revision, sectionId: 's1', heading: 'Goal', markdown: 'Ship it.' })).value)
    // A write from the revision before the last one is refused, and nothing is written.
    const stale = (await ledger.writeDocSection({ requestId: requestId('w-stale'), workspaceId: alpha, docRef, actor: ann,
      baseDocRevision: created.value.revision, sectionId: 's2', heading: 'Steps', markdown: 'Late.' })).value
    expect(stale).toEqual({ kind: 'stale_doc_revision', docRef, expectedRevision: created.value.revision, revision: first.revision })
    const appended = committed((await ledger.writeDocSection({ requestId: requestId('w2'), workspaceId: alpha, docRef, actor: ann,
      baseDocRevision: first.revision, heading: 'Risks', markdown: 'None known.' })).value)
    expect(appended.section.sectionId).toBe('s3')
    await expect(ledger.writeDocSection({ requestId: requestId('w-missing'), workspaceId: alpha, docRef, actor: ann,
      baseDocRevision: appended.revision, sectionId: 's9', heading: 'Nope', markdown: '' })).rejects.toThrow(/has no section 's9'/)

    const view = ledger.doc(human, { workspaceId: alpha, docRef })
    expect(view.status).toBe('draft')
    expect(view.revision).toBe(appended.revision)
    expect(view.sections.map(section => [section.sectionId, section.markdown])).toEqual([['s1', 'Ship it.'], ['s2', ''], ['s3', 'None known.']])
    expect(ledger.docs(human, { workspaceId: alpha, threadRef }).docs.map(row => row.docRef)).toEqual([docRef])
  })

  it('a Doc write revises neither the Thread nor anyone\'s Inbox', async () => {
    const { ledger, ann, threadRef } = await room()
    const before = ledger.inbox(human, { workspaceId: alpha })
    await draftedDoc(ledger, ann, threadRef)
    expect(ledger.inbox(human, { workspaceId: alpha }).totalUnreadCount).toBe(before.totalUnreadCount)
    expect(ledger.inbox(human, { workspaceId: alpha }).totalDirectCount).toBe(before.totalDirectCount)
  })

  it('submit mentions the Human; Human comments stay pending until a review delivers them and wakes the author', async () => {
    const { pool, ledger, ann, threadRef } = await room()
    const { docRef, revision } = await draftedDoc(ledger, ann, threadRef)
    const directBefore = ledger.inbox(human, { workspaceId: alpha }).totalDirectCount
    const submitted = committed((await ledger.submitDoc({ requestId: requestId('submit'), workspaceId: alpha, docRef, actor: ann,
      docRevision: revision, note: 'Ready for a look.' })).value)
    expect(submitted.message.body).toContain(docRef)
    expect(submitted.notice).toEqual({ docRef, event: 'submitted', docRevision: revision })
    expect(ledger.inbox(human, { workspaceId: alpha }).totalDirectCount).toBeGreaterThan(directBefore)
    expect(ledger.doc(human, { workspaceId: alpha, docRef }).status).toBe('in_review')
    await expect(ledger.submitDoc({ requestId: requestId('submit-again'), workspaceId: alpha, docRef, actor: ann, docRevision: revision }))
      .rejects.toThrow(/already in review/)

    const annDirect = ledger.inbox(ann, { workspaceId: alpha }).totalDirectCount
    const first = (await ledger.commentDoc({ requestId: requestId('c1'), workspaceId: alpha, docRef, actor: human,
      sectionId: 's1', quote: 'Friday', body: 'Thursday instead?' })).value.comment
    await expect(ledger.commentDoc({ requestId: requestId('c2'), workspaceId: alpha, docRef, actor: human,
      sectionId: 's2', quote: '', body: 'Add the steps.' })).rejects.toThrow(/must quote/)
    const second = (await ledger.commentDoc({ requestId: requestId('c3'), workspaceId: alpha, docRef, actor: human,
      sectionId: 's1', quote: 'Ship 1.2', body: 'Which build?' })).value.comment
    // Comments wake nobody.
    expect(ledger.inbox(ann, { workspaceId: alpha }).totalDirectCount).toBe(annDirect)
    expect(ledger.doc(human, { workspaceId: alpha, docRef }).comments.filter(comment => comment.pending).map(comment => comment.commentRef))
      .toEqual([first.commentRef, second.commentRef])

    const reviewed = committed((await ledger.reviewDoc({ requestId: requestId('review'), workspaceId: alpha, docRef, actor: human,
      docRevision: revision, verdict: 'review' })).value)
    expect(reviewed.notice).toEqual({ docRef, event: 'reviewed', docRevision: revision, verdict: 'review',
      commentRefs: [first.commentRef, second.commentRef] })
    expect(reviewed.message.body).toMatch(/^@ann Requested changes on "Release plan"/)
    expect(ledger.inbox(ann, { workspaceId: alpha }).totalDirectCount).toBe(annDirect + 1)
    const after = ledger.doc(ann, { workspaceId: alpha, docRef })
    expect(after.status).toBe('changes_requested')
    expect(after.comments.every(comment => !comment.pending)).toBe(true)
    expect(after.reviews.map(review => review.verdict)).toEqual(['review'])

    // The author answers a comment, revises, resubmits, and the Human approves.
    await ledger.commentDoc({ requestId: requestId('answer'), workspaceId: alpha, docRef, actor: ann,
      sectionId: 's1', quote: '', body: 'Build 1.2.0-rc3.', parentCommentRef: second.commentRef })
    const revised = committed((await ledger.writeDocSection({ requestId: requestId('revise'), workspaceId: alpha, docRef, actor: ann,
      baseDocRevision: revision, sectionId: 's1', heading: 'Goal', markdown: 'Ship 1.2.0-rc3 on Thursday.' })).value)
    await ledger.submitDoc({ requestId: requestId('resubmit'), workspaceId: alpha, docRef, actor: ann, docRevision: revised.revision })
    // A verdict on a revision the Human never saw is refused.
    expect((await ledger.reviewDoc({ requestId: requestId('approve-old'), workspaceId: alpha, docRef, actor: human,
      docRevision: revision, verdict: 'approve' })).value.kind).toBe('stale_doc_revision')
    committed((await ledger.reviewDoc({ requestId: requestId('approve'), workspaceId: alpha, docRef, actor: human,
      docRevision: revised.revision, verdict: 'approve' })).value)
    expect(ledger.doc(human, { workspaceId: alpha, docRef }).status).toBe('approved')

    // Final: nothing writes, comments or reviews after approval.
    await expect(ledger.writeDocSection({ requestId: requestId('late'), workspaceId: alpha, docRef, actor: ann,
      baseDocRevision: revised.revision, sectionId: 's1', heading: 'Goal', markdown: 'x' })).rejects.toThrow(/approved/)
    await expect(ledger.commentDoc({ requestId: requestId('late-comment'), workspaceId: alpha, docRef, actor: human,
      sectionId: 's1', quote: 'Thursday', body: 'x' })).rejects.toThrow(/approved/)

    // Every stored record passes the durable schema, and a cold replay rebuilds the same Doc.
    for (const record of storedOperations(pool)) expect(agentTeamOperationSchema.safeParse(record).success).toBe(true)
    const copy = new MemoryMediaPool()
    copy.versions.set('agent_team', pool.versions.get('agent_team')!)
    copy.media.set('agent_team', { tables: new Map([['operations', new Map(pool.media.get('agent_team')!.tables.get('operations')!)]]), global: null })
    const replay = await openLedger(copy)
    replay.validate()
    expect(replay.doc(human, { workspaceId: alpha, docRef })).toEqual(ledger.doc(human, { workspaceId: alpha, docRef }))
  })

  it('only the Doc author and the Human write a section; another Channel Member is refused and commits nothing', async () => {
    const { ledger, pool, ann, bob, threadRef } = await room()
    const { docRef, revision } = await draftedDoc(ledger, ann, threadRef)
    const before = storedOperations(pool).length
    await expect(ledger.writeDocSection({ requestId: requestId('bob-write'), workspaceId: alpha, docRef, actor: bob,
      baseDocRevision: revision, heading: 'Risks', markdown: 'Bob was here.' })).rejects.toThrow(`only the Doc's author or the Human can write Doc '${docRef}'`)
    expect(storedOperations(pool)).toHaveLength(before)
    // The author and the Human still write.
    const byAuthor = committed((await ledger.writeDocSection({ requestId: requestId('ann-write'), workspaceId: alpha, docRef, actor: ann,
      baseDocRevision: revision, heading: 'Risks', markdown: 'Ann wrote this.' })).value)
    const byHuman = committed((await ledger.writeDocSection({ requestId: requestId('human-write'), workspaceId: alpha, docRef, actor: human,
      baseDocRevision: byAuthor.revision, heading: 'Risks', markdown: 'Human edited this.', sectionId: byAuthor.section.sectionId })).value)
    expect(byHuman.revision).toBeGreaterThan(byAuthor.revision)
  })

  it('only the author submits, only the Human reviews, and asking for changes needs something to say', async () => {
    const { ledger, ann, bob, threadRef } = await room()
    const { docRef, revision } = await draftedDoc(ledger, ann, threadRef)
    await expect(ledger.submitDoc({ requestId: requestId('bob-submit'), workspaceId: alpha, docRef, actor: bob, docRevision: revision }))
      .rejects.toThrow(/only the Doc's author/)
    await expect(ledger.reviewDoc({ requestId: requestId('ann-review'), workspaceId: alpha, docRef,
      actor: ann as never, docRevision: revision, verdict: 'approve' })).rejects.toThrow()
    await expect(ledger.reviewDoc({ requestId: requestId('empty-review'), workspaceId: alpha, docRef, actor: human,
      docRevision: revision, verdict: 'review' })).rejects.toThrow(/needs at least one comment or a note/)
    const cancelled = committed((await ledger.reviewDoc({ requestId: requestId('cancel'), workspaceId: alpha, docRef, actor: human,
      docRevision: revision, verdict: 'cancel', note: 'Not this release.' })).value)
    expect(cancelled.message.body).toContain('Not this release.')
    expect(ledger.doc(ann, { workspaceId: alpha, docRef }).status).toBe('cancelled')
  })

  it('a same-request retry answers the stored write even after the Doc moved on', async () => {
    const { ledger, ann, threadRef } = await room()
    const created = (await ledger.createDoc({ requestId: requestId('doc'), workspaceId: alpha, threadRef, actor: ann,
      title: 'Release plan', outline: ['Goal'] })).value
    const request = { requestId: requestId('w1'), workspaceId: alpha, docRef: created.doc.docRef, actor: ann,
      baseDocRevision: created.revision, sectionId: 's1', heading: 'Goal', markdown: 'Ship it.' }
    const first = committed((await ledger.writeDocSection(request)).value)
    await ledger.writeDocSection({ ...request, requestId: requestId('w2'), baseDocRevision: first.revision, markdown: 'Ship it later.' })
    const again = await ledger.writeDocSection(request)
    expect(again.committed).toBe(false)
    expect(committed(again.value).revision).toBe(first.revision)
    await expect(ledger.writeDocSection({ ...request, markdown: 'Different.' })).rejects.toThrow(/was reused with a different operation or payload/)
  })

  it('the Human edits a section, every version stays in its history, and the verdict names what the Human rewrote', async () => {
    const { pool, ledger, ann, threadRef } = await room()
    const { docRef, revision } = await draftedDoc(ledger, ann, threadRef)
    const submitted = committed((await ledger.submitDoc({ requestId: requestId('submit'), workspaceId: alpha, docRef, actor: ann, docRevision: revision })).value)
    expect(submitted.notice.docRevision).toBe(revision)
    // A stale Human edit is refused like an Agent's.
    expect((await ledger.writeDocSection({ requestId: requestId('stale-edit'), workspaceId: alpha, docRef, actor: human,
      baseDocRevision: revision - 1, sectionId: 's1', heading: 'Goal', markdown: 'x' })).value.kind).toBe('stale_doc_revision')
    const edited = committed((await ledger.writeDocSection({ requestId: requestId('human-edit'), workspaceId: alpha, docRef, actor: human,
      baseDocRevision: revision, sectionId: 's1', heading: 'Goal', markdown: 'Ship 1.2 on Thursday.' })).value)
    const view = ledger.doc(ann, { workspaceId: alpha, docRef })
    expect(view.sections[0]).toMatchObject({ markdown: 'Ship 1.2 on Thursday.', writer: human.memberId, writtenAtSequence: edited.revision })
    expect(view.sections[1]).toMatchObject({ writer: ann.memberId })
    expect(ledger.docSectionHistory(ann, { workspaceId: alpha, docRef, sectionId: 's1' }).versions.map(version => [version.writer, version.markdown]))
      .toEqual([[human.memberId, 'Ship 1.2 on Thursday.'], [ann.memberId, 'Ship 1.2 on Friday.'], [ann.memberId, '']])
    expect(() => ledger.docSectionHistory(ann, { workspaceId: alpha, docRef, sectionId: 's9' })).toThrow(/no section 's9'/)
    const reviewed = committed((await ledger.reviewDoc({ requestId: requestId('review'), workspaceId: alpha, docRef, actor: human,
      docRevision: edited.revision, verdict: 'review', note: 'See my edit.' })).value)
    expect(reviewed.message.body).toContain('The Human edited "Goal" since your submit')

    const copy = new MemoryMediaPool()
    copy.versions.set('agent_team', pool.versions.get('agent_team')!)
    copy.media.set('agent_team', { tables: new Map([['operations', new Map(pool.media.get('agent_team')!.tables.get('operations')!)]]), global: null })
    const replay = await openLedger(copy)
    replay.validate()
    expect(replay.doc(human, { workspaceId: alpha, docRef })).toEqual(ledger.doc(human, { workspaceId: alpha, docRef }))
    expect(replay.docSectionHistory(human, { workspaceId: alpha, docRef, sectionId: 's1' })).toEqual(ledger.docSectionHistory(human, { workspaceId: alpha, docRef, sectionId: 's1' }))
  })

  it('resolving a thread closes it for everyone and withdraws a pending Human comment from the next verdict', async () => {
    const { pool, ledger, ann, bob, threadRef } = await room()
    const { docRef, revision } = await draftedDoc(ledger, ann, threadRef)
    const kept = (await ledger.commentDoc({ requestId: requestId('keep'), workspaceId: alpha, docRef, actor: human,
      sectionId: 's1', quote: 'Friday', body: 'Thursday?' })).value.comment
    const dropped = (await ledger.commentDoc({ requestId: requestId('drop'), workspaceId: alpha, docRef, actor: human,
      sectionId: 's1', quote: 'Ship', body: 'Never mind.' })).value.comment
    const reply = (await ledger.commentDoc({ requestId: requestId('reply'), workspaceId: alpha, docRef, actor: bob,
      sectionId: 's1', quote: '', body: 'Agreed.', parentCommentRef: dropped.commentRef })).value.comment
    await expect(ledger.resolveDocComment({ requestId: requestId('resolve-reply'), workspaceId: alpha, docRef, actor: human,
      commentRef: reply.commentRef })).rejects.toThrow(/first comment, not a reply/)
    await ledger.resolveDocComment({ requestId: requestId('resolve'), workspaceId: alpha, docRef, actor: bob, commentRef: dropped.commentRef })
    await expect(ledger.resolveDocComment({ requestId: requestId('resolve-again'), workspaceId: alpha, docRef, actor: human,
      commentRef: dropped.commentRef })).rejects.toThrow(/already resolved/)
    const view = ledger.doc(human, { workspaceId: alpha, docRef })
    expect(view.comments.map(comment => [comment.commentRef, comment.resolved, comment.pending]))
      .toEqual([[kept.commentRef, false, true], [dropped.commentRef, true, false], [reply.commentRef, true, false]])
    const reviewed = committed((await ledger.reviewDoc({ requestId: requestId('review'), workspaceId: alpha, docRef, actor: human,
      docRevision: revision, verdict: 'review' })).value)
    expect(reviewed.notice).toMatchObject({ commentRefs: [kept.commentRef] })

    // The Channel lists its Docs too.
    const channelRef = ledger.doc(human, { workspaceId: alpha, docRef }).doc.channelRef
    expect(ledger.docs(human, { workspaceId: alpha, channelRef }).docs.map(doc => doc.docRef)).toEqual([docRef])

    const copy = new MemoryMediaPool()
    copy.versions.set('agent_team', pool.versions.get('agent_team')!)
    copy.media.set('agent_team', { tables: new Map([['operations', new Map(pool.media.get('agent_team')!.tables.get('operations')!)]]), global: null })
    const replay = await openLedger(copy)
    replay.validate()
    expect(replay.doc(human, { workspaceId: alpha, docRef })).toEqual(ledger.doc(human, { workspaceId: alpha, docRef }))
  })
})
