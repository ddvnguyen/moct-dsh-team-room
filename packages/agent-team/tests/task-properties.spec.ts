import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { SessionId } from '@deepseek-ai/dsh-session'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { MemoryMediaPool, MemoryStorageBackend } from './helpers/memory-backend.ts'
import { AgentTeamLedger, agentTeamHumanActor } from '../src/ledger.ts'
import { agentTeamDomainSpec, agentTeamOperationSchema } from '../src/spec.ts'
import type { AgentTeamActivity, AgentTeamThreadFact } from '../src/types.ts'
import type {
  AgentTeamAgentMember, AgentTeamChannelRef, AgentTeamMemberActor, AgentTeamOperation, AgentTeamOperationId,
  AgentTeamRequestId, AgentTeamTaskActivity, AgentTeamTaskRef, AgentTeamThreadRef,
} from '../src/types.ts'

const cleanups: Array<() => Promise<void>> = []
const alpha = WorkspaceId('workspace:alpha')
const beta = WorkspaceId('workspace:beta')
const human = agentTeamHumanActor()
const requestId = (value: string): AgentTeamRequestId => value as AgentTeamRequestId

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(cleanup => cleanup()))
})

/**
 * A stepping clock: the instants are distinct, so an order assertion means something.
 */
let tick = 0
const clock = (): string => new Date(Date.UTC(2026, 0, 1) + (tick += 1000)).toISOString()

// M-92: the Multica property sections (parent/sub-issues, PR links, labels,
// due date). Each field is optional and forward-only, so a ledger written
// before any of them existed replays unchanged — the cold-replay test at the
// end drives a ledger that only ever wrote old-shaped patches and revalidates
// it record for record.

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

/** A cold ledger replaying the given records in insertion (= sequence) order. */
function replayLedger(records: readonly AgentTeamOperation[]): AgentTeamLedger {
  const table = new Map<AgentTeamOperationId, AgentTeamOperation>(records.map(record => [record.operationId, record] as const))
  return new AgentTeamLedger(table as unknown as KvTable<AgentTeamOperationId, AgentTeamOperation>)
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

interface Room {
  readonly pool: MemoryMediaPool
  readonly ledger: AgentTeamLedger
  readonly channelRef: AgentTeamChannelRef
  readonly ann: AgentTeamMemberActor
}

async function room(): Promise<Room> {
  const pool = new MemoryMediaPool()
  const ledger = await openLedger(pool)
  const channel = (await ledger.createChannel({ requestId: requestId('channel'), workspaceId: alpha,
    name: 'room', description: '', memberIds: [], actor: human })).value.channel
  const ann = await addMember(ledger, channel.channelRef, 'ann')
  return { pool, ledger, channelRef: channel.channelRef, ann }
}

interface MadeTask {
  readonly taskRef: AgentTeamTaskRef
  readonly threadRef: AgentTeamThreadRef
  readonly revision: number
}

async function makeTask(space: Room, name: string): Promise<MadeTask> {
  const created = committed((await space.ledger.createTask({ requestId: requestId(`task-${name}`), workspaceId: alpha,
    channelRef: space.channelRef, body: `Task ${name}`, title: `Task ${name}`, actor: human })).value)
  return { taskRef: created.task.taskRef, threadRef: created.thread.threadRef, revision: created.thread.revision }
}

/** The revision a Task's Thread carries right now, live from the Thread history read. */
function revisionOf(space: Room, taskRef: AgentTeamTaskRef): number {
  return space.ledger.threadHistory(human, { workspaceId: alpha, taskRef, limit: 1 }).thread.revision
}

/** The Task activity of the given kind carried by one issue view; throws when the fact is absent. */
function taskActivityOf(view: { readonly items: readonly AgentTeamThreadFact[] }, kind: 'patch' | 'assign'): AgentTeamTaskActivity {
  const found = view.items.map(fact => fact.kind === 'activity' ? fact.activity : undefined).find(activity => activity?.kind === kind)
  if (found === undefined) throw new Error(`expected a ${kind} activity`)
  if (found.kind !== 'patch' && found.kind !== 'assign') throw new Error('not a Task activity')
  return found
}

describe('task property fields (M-92 S1)', () => {
  it('1. writes the parent, derives sub-issues in the read model, and clears it with null', async () => {
    const space = await room()
    const parent = await makeTask(space, 'parent')
    const child = await makeTask(space, 'child')
    const before = (await space.ledger.issueView(human, { workspaceId: alpha, taskRef: child.taskRef })).properties
    expect(before.parent).toBeUndefined()
    expect(before.subIssues).toEqual([])

    const patched = committed((await space.ledger.updateTask({ requestId: requestId('set-parent'), workspaceId: alpha,
      taskRef: child.taskRef, baseRevision: child.revision, actor: human,
      patch: { parentTaskRef: parent.taskRef } })).value)
    expect(patched.task.parentTaskRef).toBe(parent.taskRef)

    const childView = (await space.ledger.issueView(human, { workspaceId: alpha, taskRef: child.taskRef })).properties
    expect(childView.parent).toEqual({ taskRef: parent.taskRef, taskNumber: 1, title: 'Task parent', status: 'todo' })
    // The sub-issue is a read-time fact: the child stores only its parent.
    const parentView = (await space.ledger.issueView(human, { workspaceId: alpha, taskRef: parent.taskRef })).properties
    expect(parentView.subIssues).toEqual([{ taskRef: child.taskRef, taskNumber: 2, title: 'Task child', status: 'todo' }])

    const cleared = committed((await space.ledger.updateTask({ requestId: requestId('clear-parent'), workspaceId: alpha,
      taskRef: child.taskRef, baseRevision: revisionOf(space, child.taskRef), actor: human,
      patch: { parentTaskRef: null } })).value)
    expect(cleared.task.parentTaskRef).toBeNull()
    expect((await space.ledger.issueView(human, { workspaceId: alpha, taskRef: parent.taskRef })).properties.subIssues).toEqual([])
  })

  it('2. refuses a self parent, a cycle and a parent of another Workspace, and permits a chain', async () => {
    const space = await room()
    const first = await makeTask(space, 'first')
    const second = await makeTask(space, 'second')
    const third = await makeTask(space, 'third')
    committed((await space.ledger.updateTask({ requestId: requestId('p-2'), workspaceId: alpha, taskRef: second.taskRef,
      baseRevision: second.revision, actor: human, patch: { parentTaskRef: first.taskRef } })).value)
    committed((await space.ledger.updateTask({ requestId: requestId('p-3'), workspaceId: alpha, taskRef: third.taskRef,
      baseRevision: third.revision, actor: human, patch: { parentTaskRef: second.taskRef } })).value)
    // The cycle sits two levels up the chain: the check walks the parent's ancestors.
    await expect(space.ledger.updateTask({ requestId: requestId('self'), workspaceId: alpha, taskRef: first.taskRef,
      baseRevision: revisionOf(space, first.taskRef), actor: human, patch: { parentTaskRef: first.taskRef } })).rejects.toThrow('its own parent')
    await expect(space.ledger.updateTask({ requestId: requestId('cycle'), workspaceId: alpha, taskRef: first.taskRef,
      baseRevision: revisionOf(space, first.taskRef), actor: human, patch: { parentTaskRef: third.taskRef } })).rejects.toThrow('cycle')
    // Same-workspace provenance: a Task of another Workspace never resolves.
    const betaChannel = (await space.ledger.createChannel({ requestId: requestId('beta-channel'), workspaceId: beta,
      name: 'other-room', description: '', memberIds: [], actor: human })).value.channel
    const betaTask = (await space.ledger.createTask({ requestId: requestId('beta-task'), workspaceId: beta,
      channelRef: betaChannel.channelRef, body: 'Beta task', title: 'Beta task', actor: human })).value
    await expect(space.ledger.updateTask({ requestId: requestId('cross'), workspaceId: alpha, taskRef: first.taskRef,
      baseRevision: revisionOf(space, first.taskRef), actor: human, patch: { parentTaskRef: betaTask.task.taskRef } })).rejects.toThrow(
      `does not belong to Workspace '${alpha}'`)
  })

  it('3. prints each property change once per action and leaves property-identical patches silent', async () => {
    const space = await room()
    const task = await makeTask(space, 'labeled')
    committed((await space.ledger.updateTask({ requestId: requestId('labels-1'), workspaceId: alpha,
      taskRef: task.taskRef, baseRevision: task.revision, actor: human,
      patch: { labels: ['ui'], dueDate: '2026-11-05' } })).value)
    const activityView = (await space.ledger.issueView(human, { workspaceId: alpha, taskRef: task.taskRef })).activity
    expect(activityView.items.map(fact => fact.activity.kind)).toEqual(['patch'])
    const change = taskActivityOf(activityView, 'patch').change ?? []
    expect(change.map(entry => entry.field)).toEqual(['labels', 'dueDate'])
    expect(change[0]).toEqual({ field: 'labels', value: ['ui'], added: ['ui'] })
    expect(change[1]).toEqual({ field: 'dueDate', value: '2026-11-05' })

    // The silent twin: sending the same property values again is a fact-free write.
    const quietRevision = revisionOf(space, task.taskRef)
    const again = committed((await space.ledger.updateTask({ requestId: requestId('labels-2'), workspaceId: alpha,
      taskRef: task.taskRef, baseRevision: quietRevision, actor: human,
      patch: { labels: ['ui'], dueDate: '2026-11-05' } })).value)
    expect(again.task.labels).toEqual(['ui'])
    expect(revisionOf(space, task.taskRef)).toBe(quietRevision)
    expect((await space.ledger.issueView(human, { workspaceId: alpha, taskRef: task.taskRef })).activity.items).toHaveLength(1)
  })

  it('4. normalizes PR links (http(s), dedupe, title trim/cap) and labels (trim, case-insensitive dedupe, bounds)', async () => {
    const space = await room()
    const task = await makeTask(space, 'linked')
    await expect(space.ledger.updateTask({ requestId: requestId('pr-bad'), workspaceId: alpha, taskRef: task.taskRef,
      baseRevision: task.revision, actor: human, patch: { pullRequests: [{ url: 'ftp://example.com/a' }] } })).rejects.toThrow('http(s) URL')
    await expect(space.ledger.updateTask({ requestId: requestId('pr-parse'), workspaceId: alpha, taskRef: task.taskRef,
      baseRevision: task.revision, actor: human, patch: { pullRequests: [{ url: 'not a url' }] } })).rejects.toThrow('http(s) URL')
    await expect(space.ledger.updateTask({ requestId: requestId('label-empty'), workspaceId: alpha, taskRef: task.taskRef,
      baseRevision: task.revision, actor: human, patch: { labels: ['   '] } })).rejects.toThrow('empty')
    await expect(space.ledger.updateTask({ requestId: requestId('label-long'), workspaceId: alpha, taskRef: task.taskRef,
      baseRevision: task.revision, actor: human, patch: { labels: ['x'.repeat(41)] } })).rejects.toThrow('40 characters')
    await expect(space.ledger.updateTask({ requestId: requestId('label-many'), workspaceId: alpha, taskRef: task.taskRef,
      baseRevision: task.revision, actor: human, patch: { labels: Array.from({ length: 21 }, (_, index) => `label-${index}`) } })).rejects.toThrow('20 labels')
    await expect(space.ledger.updateTask({ requestId: requestId('pr-many'), workspaceId: alpha, taskRef: task.taskRef,
      baseRevision: task.revision, actor: human,
      patch: { pullRequests: Array.from({ length: 21 }, (_, index) => ({ url: `https://example.com/pull/${index}` })) } })).rejects.toThrow('20 pull request')

    const stored = committed((await space.ledger.updateTask({ requestId: requestId('pr-store'), workspaceId: alpha, taskRef: task.taskRef,
      baseRevision: task.revision, actor: human,
      patch: {
        pullRequests: [
          { url: 'https://github.com/ddvnguyen/moct-dsh-team-room/pull/198  ', title: '  The property sections  ' },
          { url: 'http://example.com/a', title: '   ' },
          { url: 'https://github.com/ddvnguyen/moct-dsh-team-room/pull/198 ' },
        ],
        labels: ['UI', 'ui', '  api '],
      } })).value)
    expect(stored.task.pullRequests).toEqual([
      { url: 'https://github.com/ddvnguyen/moct-dsh-team-room/pull/198', title: 'The property sections' },
      { url: 'http://example.com/a' },
    ])
    expect(stored.task.labels).toEqual(['UI', 'api'])
    const view = (await space.ledger.issueView(human, { workspaceId: alpha, taskRef: task.taskRef })).properties
    expect(view.pullRequests).toEqual(stored.task.pullRequests)
    expect(view.labels).toEqual(['UI', 'api'])
  })

  it('5. stores and clears the due date as a real calendar date', async () => {
    const space = await room()
    const task = await makeTask(space, 'due')
    await expect(space.ledger.updateTask({ requestId: requestId('due-shape'), workspaceId: alpha, taskRef: task.taskRef,
      baseRevision: task.revision, actor: human, patch: { dueDate: '2026-2-1' } })).rejects.toThrow('YYYY-MM-DD')
    await expect(space.ledger.updateTask({ requestId: requestId('due-real'), workspaceId: alpha, taskRef: task.taskRef,
      baseRevision: task.revision, actor: human, patch: { dueDate: '2026-02-30' } })).rejects.toThrow('real calendar')
    const stored = committed((await space.ledger.updateTask({ requestId: requestId('due-store'), workspaceId: alpha, taskRef: task.taskRef,
      baseRevision: task.revision, actor: human, patch: { dueDate: '2026-03-01' } })).value)
    expect(stored.task.dueDate).toBe('2026-03-01')
    expect((await space.ledger.issueView(human, { workspaceId: alpha, taskRef: task.taskRef })).properties.dueDate).toBe('2026-03-01')
    const cleared = committed((await space.ledger.updateTask({ requestId: requestId('due-clear'), workspaceId: alpha, taskRef: task.taskRef,
      baseRevision: revisionOf(space, task.taskRef), actor: human, patch: { dueDate: null } })).value)
    expect(cleared.task.dueDate).toBeNull()
    expect((await space.ledger.issueView(human, { workspaceId: alpha, taskRef: task.taskRef })).properties.dueDate).toBeUndefined()
  })

  it('6. keeps the stale-revision outcome and retry resolution for property writes', async () => {
    const space = await room()
    const task = await makeTask(space, 'fences')
    const stale = await space.ledger.updateTask({ requestId: requestId('stale'), workspaceId: alpha, taskRef: task.taskRef,
      baseRevision: task.revision - 1, actor: human, patch: { labels: ['late'] } })
    expect(stale.value.kind).toBe('stale_revision')
    expect((await space.ledger.issueView(human, { workspaceId: alpha, taskRef: task.taskRef })).activity.items).toHaveLength(0)

    const first = committed((await space.ledger.updateTask({ requestId: requestId('retry'), workspaceId: alpha, taskRef: task.taskRef,
      baseRevision: task.revision, actor: human, patch: { labels: ['kept'] } })).value)
    // The same request resolves the stored record instead of committing twice.
    const retry = await space.ledger.updateTask({ requestId: requestId('retry'), workspaceId: alpha, taskRef: task.taskRef,
      baseRevision: task.revision, actor: human, patch: { labels: ['kept'] } })
    if (retry.value.kind !== 'committed') throw new Error('the retry must resolve to the stored commit')
    expect(retry.value.task).toEqual(first.task)
    expect(storedOperations(space.pool).filter(record => record.kind === 'team/task-updated')).toHaveLength(1)
  })

  it('7. composes the room gist from the change summary', async () => {
    const space = await room()
    const parent = await makeTask(space, 'gist-parent')
    const child = await makeTask(space, 'gist-child')
    await space.ledger.updateTask({ requestId: requestId('gist-set'), workspaceId: alpha, taskRef: child.taskRef,
      baseRevision: child.revision, actor: human, patch: { parentTaskRef: parent.taskRef, labels: ['ui'] } })
    const feed = space.ledger.roomActivity({ workspaceId: alpha, channelRef: space.channelRef, threadRef: child.threadRef })
    const gist = feed.events.filter(event => event.kind === 'team/task-updated').map(event => event.summary).join(' ')
    expect(gist).toContain('set parent #1')
    expect(gist).toContain('added label ui')
  })

  it('8. assigns and edits properties in one patch: one assign fact carrying the change', async () => {
    const space = await room()
    const task = await makeTask(space, 'both')
    committed((await space.ledger.updateTask({ requestId: requestId('assign-and-label'), workspaceId: alpha, taskRef: task.taskRef,
      baseRevision: task.revision, actor: human, patch: { assignee: space.ann.memberId, labels: ['ui'] } })).value)
    const activity = taskActivityOf((await space.ledger.issueView(human, { workspaceId: alpha, taskRef: task.taskRef })).activity, 'assign')
    if (activity.kind !== 'assign') throw new Error('unreachable')
    expect(activity.assignee).toBe(space.ann.memberId)
    expect((activity.change ?? []).map(entry => entry.field)).toEqual(['labels'])
  })

  it('9. cold-replays a legacy-shaped ledger: old patches carry no new field and still validate', async () => {
    const space = await room()
    const task = await makeTask(space, 'legacy')
    // Every patch here states only keys the pre-M-92 ledger could write.
    committed((await space.ledger.updateTask({ requestId: requestId('legacy-title'), workspaceId: alpha, taskRef: task.taskRef,
      baseRevision: task.revision, actor: human, patch: { title: 'Legacy title' } })).value)
    await space.ledger.updateTask({ requestId: requestId('legacy-assign'), workspaceId: alpha, taskRef: task.taskRef,
      baseRevision: revisionOf(space, task.taskRef), actor: human, patch: { assignee: space.ann.memberId } })

    const records = storedOperations(space.pool)
    for (const record of records) expect(agentTeamOperationSchema.safeParse(record).success).toBe(true)
    const updated = records.filter(record => record.kind === 'team/task-updated')
    expect(updated.length).toBe(2)
    for (const record of updated) {
      expect(record.data.patch).not.toHaveProperty('parentTaskRef')
      expect(record.data.patch).not.toHaveProperty('pullRequests')
      expect(record.data.patch).not.toHaveProperty('labels')
      expect(record.data.patch).not.toHaveProperty('dueDate')
    }

    // Cold replay: constructor replay, then a full validation pass.
    const cold = replayLedger(records)
    cold.validate()
    const view = (await cold.issueView(human, { workspaceId: alpha, taskRef: task.taskRef })).properties
    expect(view.parent).toBeUndefined()
    expect(view.subIssues).toEqual([])
    expect(view.pullRequests).toEqual([])
    expect(view.labels).toEqual([])
    expect(view.dueDate).toBeUndefined()
  })

  it('10. cold-replays a ledger that used every field: present and cleared values survive validation', async () => {
    const space = await room()
    const parent = await makeTask(space, 'replay-parent')
    const child = await makeTask(space, 'replay-child')
    committed((await space.ledger.updateTask({ requestId: requestId('replay-1'), workspaceId: alpha, taskRef: child.taskRef,
      baseRevision: child.revision, actor: human,
      patch: { parentTaskRef: parent.taskRef, labels: ['ui', 'api'], dueDate: '2026-11-05',
        pullRequests: [{ url: 'https://example.com/pull/1', title: 'One' }] } })).value)
    committed((await space.ledger.updateTask({ requestId: requestId('replay-2'), workspaceId: alpha, taskRef: child.taskRef,
      baseRevision: revisionOf(space, child.taskRef), actor: human, patch: { parentTaskRef: null, dueDate: null } })).value)

    const records = storedOperations(space.pool)
    const cold = replayLedger(records)
    cold.validate()
    const view = (await cold.issueView(human, { workspaceId: alpha, taskRef: child.taskRef })).properties
    expect(view.parent).toBeUndefined()
    expect(view.labels).toEqual(['ui', 'api'])
    expect(view.dueDate).toBeUndefined()
    expect(view.pullRequests).toEqual([{ url: 'https://example.com/pull/1', title: 'One' }])
  })

  // The replay validator is the only guard a hand-edited ledger meets, so it
  // re-checks what the write enforced: a self parent, a parent of another
  // Workspace, and an assign fact whose change list the patch did not produce.
  it('11. replay refuses a forged self-parent, a cross-Workspace parent and an invented assign change', async () => {
    const space = await room()
    const task = await makeTask(space, 'forged')
    // The other Workspace's Task exists before the forged record is replayed,
    // so the replay reaches the workspace check rather than an unknown ref.
    const betaChannel = (await space.ledger.createChannel({ requestId: requestId('forge-beta-channel'), workspaceId: beta,
      name: 'beta-room', description: '', memberIds: [], actor: human })).value.channel
    const betaTask = (await space.ledger.createTask({ requestId: requestId('forge-beta-task'), workspaceId: beta,
      channelRef: betaChannel.channelRef, body: 'Beta task', title: 'Beta task', actor: human })).value.task
    committed((await space.ledger.updateTask({ requestId: requestId('forge-labels'), workspaceId: alpha, taskRef: task.taskRef,
      baseRevision: task.revision, actor: human, patch: { labels: ['ui'] } })).value)
    committed((await space.ledger.updateTask({ requestId: requestId('forge-assign'), workspaceId: alpha, taskRef: task.taskRef,
      baseRevision: revisionOf(space, task.taskRef), actor: human, patch: { assignee: space.ann.memberId } })).value)

    const records = storedOperations(space.pool)
    const updates = records.filter((record): record is Extract<AgentTeamOperation, { kind: 'team/task-updated' }> =>
      record.kind === 'team/task-updated')
    const labelsRecord = updates.find(record => record.data.patch.labels !== undefined)!
    const assignRecord = updates.find(record => record.data.activity?.kind === 'assign')!

    // A self parent: the write refuses it, so a stored one is forged. The
    // task snapshot must agree with the patch, or the earlier shape check
    // would catch it first.
    const selfParent = {
      ...labelsRecord,
      data: { ...labelsRecord.data, patch: { ...labelsRecord.data.patch, parentTaskRef: task.taskRef },
        task: { ...labelsRecord.data.task, parentTaskRef: task.taskRef } },
    } as AgentTeamOperation
    expect(() => replayLedger(records.map(record => record === labelsRecord ? selfParent : record)).validate())
      .toThrow('invalid Task parent')

    // A parent in another Workspace: the parent itself, not only an ancestor.
    const crossParent = {
      ...labelsRecord,
      data: { ...labelsRecord.data, patch: { ...labelsRecord.data.patch, parentTaskRef: betaTask.taskRef },
        task: { ...labelsRecord.data.task, parentTaskRef: betaTask.taskRef } },
    } as AgentTeamOperation
    expect(() => replayLedger(records.map(record => record === labelsRecord ? crossParent : record)).validate())
      .toThrow('invalid Task parent')

    // An assign fact claiming a label change the patch never made.
    const inventedChange = {
      ...assignRecord,
      data: { ...assignRecord.data, activity: { ...assignRecord.data.activity!, change: [
        { field: 'labels' as const, value: ['ui'], added: ['ui'] },
      ] } },
    } as AgentTeamOperation
    expect(() => replayLedger(records.map(record => record === assignRecord ? inventedChange : record)).validate())
      .toThrow('invalid Task assignment activity')
  })
})
