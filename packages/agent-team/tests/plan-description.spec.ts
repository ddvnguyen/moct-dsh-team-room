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
  AgentTeamAgentMember, AgentTeamChannelRef, AgentTeamDocRef, AgentTeamMemberActor, AgentTeamOperation,
  AgentTeamOperationId, AgentTeamRequestId, AgentTeamTaskRef, AgentTeamThreadRef,
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

/**
 * The promotion is the write that carries an approved plan into a Task; the
 * Human's own description edit is a different write and is not refused.
 */
function isPromotion(operation: AgentTeamOperation): boolean {
  return operation.kind === 'team/task-updated' && operation.data.patch.description?.source === 'approvedPlan'
}

/**
 * A table that refuses promotion writes, the way a lost write refuses them.
 *
 * The ledger applies an operation only after its durable write, so a failed
 * write leaves the ledger exactly as it was: the verdict committed, the
 * description not written. That is the half-state the convergence repairs.
 */
function refusingTable(
  table: KvTable<AgentTeamOperationId, AgentTeamOperation>,
  remaining: { count: number },
): KvTable<AgentTeamOperationId, AgentTeamOperation> {
  return {
    get: key => table.get(key),
    entries: () => table.entries(),
    keys: () => table.keys(),
    get size() { return table.size },
    put: async (key, value) => {
      if (isPromotion(value) && remaining.count > 0) {
        remaining.count -= 1
        throw new Error('the write failed')
      }
      await table.put(key, value)
    },
    delete: key => table.delete(key),
    deleteMany: keys => table.deleteMany(keys),
    update: (key, fn) => table.update(key, fn),
  }
}

async function openLedger(pool: MemoryMediaPool, refusedPromotions = 0): Promise<{ readonly ledger: AgentTeamLedger; readonly table: KvTable<AgentTeamOperationId, AgentTeamOperation> }> {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  cleanups.push(async () => { await facility.closeAll() })
  const domain = await ctx.storageDomain.open(agentTeamDomainSpec)
  const table = domain.table('operations') as unknown as KvTable<AgentTeamOperationId, AgentTeamOperation>
  const remaining = { count: refusedPromotions }
  const ledger = new AgentTeamLedger(
    refusedPromotions > 0 ? refusingTable(table, remaining) : table,
    { occurredAt: clock },
  )
  await ledger.initialize()
  return { ledger, table }
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

/** One Channel, an author Agent, and a Task the Human opened. */
async function room(refusedPromotions = 0) {
  const pool = new MemoryMediaPool()
  const { ledger, table } = await openLedger(pool, refusedPromotions)
  const channel = (await ledger.createChannel({ requestId: requestId('channel'), workspaceId: alpha,
    name: 'room', description: '', memberIds: [], actor: human })).value.channel
  const ann = await addMember(ledger, channel.channelRef, 'ann')
  const task = (await ledger.createTask({ requestId: requestId('task'), workspaceId: alpha, channelRef: channel.channelRef,
    body: 'Ship the board', title: 'Ship the board', actor: human })).value
  const taskRef = task.task.taskRef
  const threadRef = task.thread.threadRef
  return { pool, ledger, table, channel, ann, task, taskRef, threadRef }
}

/** A plan proposed on the Task: a Doc bound to it, filled in, and submitted. */
async function proposedPlan(ledger: AgentTeamLedger, ann: AgentTeamMemberActor, taskRef: AgentTeamTaskRef, threadRef: AgentTeamThreadRef) {
  const created = await ledger.createDoc({ requestId: requestId('plan'), workspaceId: alpha, threadRef, taskRef, actor: ann,
    title: 'Release plan', outline: ['Goal', 'Steps'] })
  const docRef = created.value.doc.docRef as AgentTeamDocRef
  const goal = committed((await ledger.writeDocSection({ requestId: requestId('goal'), workspaceId: alpha, docRef,
    actor: ann, baseDocRevision: created.value.revision, sectionId: 's1', heading: 'Goal', markdown: 'Ship 1.2 on Friday.' })).value)
  const steps = committed((await ledger.writeDocSection({ requestId: requestId('steps'), workspaceId: alpha, docRef,
    actor: ann, baseDocRevision: goal.revision, sectionId: 's2', heading: 'Steps', markdown: 'Cut the branch.' })).value)
  const submitted = await ledger.submitDoc({ requestId: requestId('submit'), workspaceId: alpha, docRef,
    actor: ann, docRevision: steps.revision })
  return { docRef, revision: steps.revision, submitted }
}

const PLAN_BODY = '## Goal\n\nShip 1.2 on Friday.\n\n## Steps\n\nCut the branch.'

describe('the plan becomes the description', () => {
  it('1. an approved plan replaces the description, attributed and fenced', async () => {
    const { pool, ledger, ann, taskRef, threadRef } = await room()
    const { docRef, revision } = await proposedPlan(ledger, ann, taskRef, threadRef)
    const approved = await ledger.reviewDoc({ requestId: requestId('approve'), workspaceId: alpha, docRef, actor: human,
      docRevision: revision, verdict: 'approve' })
    expect(committed(approved.value).notice).toMatchObject({ event: 'reviewed', verdict: 'approve' })

    const view = await ledger.issueView(human, { workspaceId: alpha, taskRef })
    expect(view.description).toMatchObject({
      body: PLAN_BODY, source: 'approvedPlan', planRef: docRef, author: human.memberId, revision: 1,
    })
    expect(view.description.editedAt).toBeUndefined()
    // The plan is read with the issue it belongs to.
    expect(view.docs.map(row => [row.docRef, row.taskRef])).toEqual([[docRef, taskRef]])

    for (const record of storedOperations(pool)) expect(agentTeamOperationSchema.safeParse(record).success).toBe(true)
  })

  it('2. a lost description write is completed by the next read, not refused', async () => {
    const { ledger, ann, taskRef, threadRef } = await room(1)
    const { docRef, revision } = await proposedPlan(ledger, ann, taskRef, threadRef)
    // The verdict commits; the description write that follows it fails.
    await expect(ledger.reviewDoc({ requestId: requestId('approve'), workspaceId: alpha, docRef, actor: human,
      docRevision: revision, verdict: 'approve' })).rejects.toThrow(/the write failed/)

    // The half-state: the plan is approved, the description was never written.
    expect(ledger.getTask(taskRef)?.description).toBeUndefined()

    // The read converges: the description is the approved plan.
    const repaired = await ledger.issueView(human, { workspaceId: alpha, taskRef })
    expect(repaired.description).toMatchObject({ body: PLAN_BODY, source: 'approvedPlan', planRef: docRef, revision: 1 })
  })

  it('3. the convergence is ordered: a Human edit after the approval wins', async () => {
    const { ledger, ann, taskRef, threadRef } = await room(1)
    const { docRef, revision } = await proposedPlan(ledger, ann, taskRef, threadRef)
    await expect(ledger.reviewDoc({ requestId: requestId('approve'), workspaceId: alpha, docRef, actor: human,
      docRevision: revision, verdict: 'approve' })).rejects.toThrow(/the write failed/)

    // The Human edits after the approval: her word is the current one.
    const edit = await ledger.updateTask({ requestId: requestId('edit'), workspaceId: alpha, taskRef,
      baseRevision: ledger.threadHistory(human, { workspaceId: alpha, taskRef, limit: 1 }).thread.revision,
      patch: { description: 'The Human wrote this.', baseDescriptionRevision: 0 }, actor: human })
    expect(committed(edit.value).task.description?.body).toBe('The Human wrote this.')

    // The read does not clobber it: the edit is newer than the approval.
    const view = await ledger.issueView(human, { workspaceId: alpha, taskRef })
    expect(view.description).toMatchObject({ body: 'The Human wrote this.', source: 'anchor', revision: 1 })
    expect(view.description.planRef).toBeUndefined()
  })

  it('3b. an edit made before the approval is replaced by the approved plan', async () => {
    const { ledger, ann, taskRef, threadRef } = await room(1)
    const edit = await ledger.updateTask({ requestId: requestId('edit'), workspaceId: alpha, taskRef,
      baseRevision: ledger.threadHistory(human, { workspaceId: alpha, taskRef, limit: 1 }).thread.revision,
      patch: { description: 'An earlier draft.', baseDescriptionRevision: 0 }, actor: human })
    expect(committed(edit.value).task.description?.body).toBe('An earlier draft.')

    const { docRef, revision } = await proposedPlan(ledger, ann, taskRef, threadRef)
    await expect(ledger.reviewDoc({ requestId: requestId('approve'), workspaceId: alpha, docRef, actor: human,
      docRevision: revision, verdict: 'approve' })).rejects.toThrow(/the write failed/)

    // The plan was approved after her edit, so the plan wins.
    const view = await ledger.issueView(human, { workspaceId: alpha, taskRef })
    expect(view.description).toMatchObject({ body: PLAN_BODY, source: 'approvedPlan', planRef: docRef, revision: 2 })
  })

  it('4. the repair is idempotent and never collides', async () => {
    const { ledger, ann, taskRef, threadRef } = await room(1)
    const { docRef, revision } = await proposedPlan(ledger, ann, taskRef, threadRef)
    await expect(ledger.reviewDoc({ requestId: requestId('approve'), workspaceId: alpha, docRef, actor: human,
      docRevision: revision, verdict: 'approve' })).rejects.toThrow(/the write failed/)

    const first = await ledger.promoteApprovedPlanDescription(alpha, taskRef)
    expect(first?.data.patch.description?.body).toBe(PLAN_BODY)
    const second = await ledger.promoteApprovedPlanDescription(alpha, taskRef)
    expect(second).toBeUndefined()

    const view = await ledger.issueView(human, { workspaceId: alpha, taskRef })
    expect(view.description).toMatchObject({ body: PLAN_BODY, source: 'approvedPlan', revision: 1 })
  })

  it('5. the approval wakes the proposer: the verdict mentions the plan author', async () => {
    const { pool, ledger, ann, taskRef, threadRef } = await room()
    const { docRef, revision } = await proposedPlan(ledger, ann, taskRef, threadRef)
    await ledger.reviewDoc({ requestId: requestId('approve'), workspaceId: alpha, docRef, actor: human,
      docRevision: revision, verdict: 'approve' })

    const verdict = storedOperations(pool).find(operation => operation.kind === 'team/thread-replied' && operation.data.doc?.event === 'reviewed')
    expect(verdict).toBeDefined()
    expect(verdict?.kind === 'team/thread-replied' ? verdict.data.mentions : []).toContain(ann.memberId)
  })

  it('6. a plan sent back does not change the description, and the same plan is revised and resubmitted', async () => {
    const { ledger, ann, taskRef, threadRef } = await room()
    const { docRef, revision } = await proposedPlan(ledger, ann, taskRef, threadRef)
    await ledger.reviewDoc({ requestId: requestId('review'), workspaceId: alpha, docRef, actor: human,
      docRevision: revision, verdict: 'review', note: 'Say more about the rollout.' })

    const view = await ledger.issueView(human, { workspaceId: alpha, taskRef })
    expect(view.description).toMatchObject({ body: 'Ship the board', source: 'anchor', revision: 0 })

    // The plan is one Doc, many revisions: it is revised and submitted again.
    const revised = await ledger.writeDocSection({ requestId: requestId('revise'), workspaceId: alpha, docRef, actor: ann,
      baseDocRevision: revision, sectionId: 's2', heading: 'Steps', markdown: 'Cut the branch on Monday.' })
    const step = committed(revised.value)
    const resubmitted = await ledger.submitDoc({ requestId: requestId('resubmit'), workspaceId: alpha, docRef, actor: ann,
      docRevision: step.revision })
    expect(committed(resubmitted.value).notice).toMatchObject({ event: 'submitted' })
  })

  it('7. the Human edits the description directly, and a stale fence is a business outcome', async () => {
    const { ledger, taskRef } = await room()
    const edit = await ledger.updateTask({ requestId: requestId('edit'), workspaceId: alpha, taskRef,
      baseRevision: ledger.threadHistory(human, { workspaceId: alpha, taskRef, limit: 1 }).thread.revision,
      patch: { description: 'The Human wrote this.', baseDescriptionRevision: 0 }, actor: human })
    const written = committed(edit.value)
    expect(written.task.description).toMatchObject({ body: 'The Human wrote this.', source: 'anchor', author: human.memberId })
    expect(written.task.description?.editedAt).toBeDefined()
    expect(written.task.descriptionRevision).toBe(1)

    // A write based on a stale fence is refused, and nothing is written.
    const stale = await ledger.updateTask({ requestId: requestId('stale'), workspaceId: alpha, taskRef,
      baseRevision: ledger.threadHistory(human, { workspaceId: alpha, taskRef, limit: 1 }).thread.revision,
      patch: { description: 'A later draft.', baseDescriptionRevision: 0 }, actor: human })
    expect(stale.value).toEqual({ kind: 'stale_description_revision', taskRef, expectedRevision: 0, revision: 1 })

    const view = await ledger.issueView(human, { workspaceId: alpha, taskRef })
    expect(view.description).toMatchObject({ body: 'The Human wrote this.', source: 'anchor', revision: 1 })
  })

  it('8. a plan is proposed only in the planning phase, and a cancelled plan frees the Task', async () => {
    const { ledger, ann, taskRef, threadRef } = await room()
    const { docRef, revision } = await proposedPlan(ledger, ann, taskRef, threadRef)

    // One plan per Task: a second one is refused while the first is in flight.
    await expect(ledger.createDoc({ requestId: requestId('second'), workspaceId: alpha, threadRef, taskRef, actor: ann,
      title: 'Another plan', outline: ['Goal'] })).rejects.toThrow(/already has a plan/)

    // A claim on the Task ends its planning phase.
    const claimed = await ledger.changeClaim({ requestId: requestId('claim'), workspaceId: alpha, taskRef, action: 'claim',
      direction: 'Build it', baseRevision: ledger.threadHistory(human, { workspaceId: alpha, taskRef, limit: 1 }).thread.revision, actor: ann })
    const claimRef = committed(claimed.value).claim.claimRef
    await expect(ledger.createDoc({ requestId: requestId('third'), workspaceId: alpha, threadRef, taskRef, actor: ann,
      title: 'Third plan', outline: ['Goal'] })).rejects.toThrow(/not in its planning phase/)

    // The Task is designed again once the claim is released.
    await ledger.changeClaim({ requestId: requestId('release'), workspaceId: alpha, taskRef, action: 'release', claimRef,
      baseRevision: ledger.threadHistory(human, { workspaceId: alpha, taskRef, limit: 1 }).thread.revision, actor: ann })

    // A cancelled plan is final but is not a plan in flight: the Task is free again.
    await ledger.reviewDoc({ requestId: requestId('cancel'), workspaceId: alpha, docRef, actor: human,
      docRevision: revision, verdict: 'cancel' })
    const again = await ledger.createDoc({ requestId: requestId('fourth'), workspaceId: alpha, threadRef, taskRef, actor: ann,
      title: 'Fourth plan', outline: ['Goal'] })
    expect(again.value.doc.taskRef).toBe(taskRef)
  })

  it('10. a cold ledger replays the description, the convergence index, and the forward-only shape', async () => {
    // A promoted plan, then the Human's own edit on top of it: the record
    // keeps the plan it came from and carries the edit.
    const first = await room()
    const plan = await proposedPlan(first.ledger, first.ann, first.taskRef, first.threadRef)
    await first.ledger.reviewDoc({ requestId: requestId('approve'), workspaceId: alpha, docRef: plan.docRef, actor: human,
      docRevision: plan.revision, verdict: 'approve' })
    const edit = await first.ledger.updateTask({ requestId: requestId('edit'), workspaceId: alpha, taskRef: first.taskRef,
      baseRevision: first.ledger.threadHistory(human, { workspaceId: alpha, taskRef: first.taskRef, limit: 1 }).thread.revision,
      patch: { description: 'The Human wrote this.', baseDescriptionRevision: 1 }, actor: human })
    const edited = committed(edit.value)

    // The edit survives a reload: a cold ledger over the same operations
    // carries the same record and the same fence.
    const cold = new AgentTeamLedger(first.table)
    await cold.initialize()
    const coldTask = cold.getTask(first.taskRef)
    expect(coldTask?.description).toEqual(edited.task.description)
    expect(coldTask?.description).toMatchObject({ body: 'The Human wrote this.', source: 'approvedPlan',
      author: human.memberId, planRef: plan.docRef })
    expect(coldTask?.description?.editedAt).toBeDefined()
    expect(coldTask?.descriptionRevision).toBe(2)
    const coldView = await cold.issueView(human, { workspaceId: alpha, taskRef: first.taskRef })
    expect(coldView.description).toMatchObject({ body: 'The Human wrote this.', source: 'approvedPlan', planRef: plan.docRef, revision: 2 })

    // A promotion that landed is not written twice: the read adds no
    // operation to a ledger that already carries one.
    const landed = storedOperations(first.pool).length
    await cold.issueView(human, { workspaceId: alpha, taskRef: first.taskRef })
    expect(storedOperations(first.pool).length).toBe(landed)

    // The convergence's index survives the restart: a cold ledger over a
    // ledger whose approval landed and whose promotion was dropped still
    // repairs on the next read.
    const half = await room(1)
    const dropped = await proposedPlan(half.ledger, half.ann, half.taskRef, half.threadRef)
    await expect(half.ledger.reviewDoc({ requestId: requestId('approve'), workspaceId: alpha, docRef: dropped.docRef, actor: human,
      docRevision: dropped.revision, verdict: 'approve' })).rejects.toThrow(/the write failed/)
    const restarted = new AgentTeamLedger(half.table)
    await restarted.initialize()
    expect(restarted.getTask(half.taskRef)?.description).toBeUndefined()
    const repairedView = await restarted.issueView(human, { workspaceId: alpha, taskRef: half.taskRef })
    expect(repairedView.description).toMatchObject({ body: PLAN_BODY, source: 'approvedPlan', planRef: dropped.docRef, revision: 1 })

    // A promotion that landed is not written twice: the read adds no
    // operation to a ledger that already carries one.
    const before = storedOperations(half.pool).length
    await restarted.issueView(human, { workspaceId: alpha, taskRef: half.taskRef })
    expect(storedOperations(half.pool).length).toBe(before)

    // The forward-only property: a ledger with no description operation
    // replays to a Task with no description, and the view reads the anchor.
    const plain = await room()
    const plainCold = new AgentTeamLedger(plain.table)
    await plainCold.initialize()
    expect(plainCold.getTask(plain.taskRef)?.description).toBeUndefined()
    expect(plainCold.getTask(plain.taskRef)?.descriptionRevision).toBeUndefined()
    const plainView = await plainCold.issueView(human, { workspaceId: alpha, taskRef: plain.taskRef })
    expect(plainView.description).toMatchObject({ body: 'Ship the board', source: 'anchor', revision: 0 })
  })

  it('9. a failed repair never fails the read', async () => {
    const { ledger, ann, taskRef, threadRef } = await room(99)
    const { docRef, revision } = await proposedPlan(ledger, ann, taskRef, threadRef)
    await expect(ledger.reviewDoc({ requestId: requestId('approve'), workspaceId: alpha, docRef, actor: human,
      docRevision: revision, verdict: 'approve' })).rejects.toThrow(/the write failed/)

    // The read answers with the description as it is.
    const view = await ledger.issueView(human, { workspaceId: alpha, taskRef })
    expect(view.description).toMatchObject({ body: 'Ship the board', source: 'anchor', revision: 0 })
    expect(view.task.taskRef).toBe(taskRef)
  })
})
