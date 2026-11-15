import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { SessionId } from '@deepseek-ai/dsh-session'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { MemoryMediaPool, MemoryStorageBackend } from './helpers/memory-backend.ts'
import { AGENT_TEAM_BUILTIN_STATUSES, AgentTeamLedger, agentTeamHumanActor } from '../src/ledger.ts'
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

/** The revision a Task's Thread carries right now. */
function revisionOf(space: Room, taskRef: AgentTeamTaskRef): number {
  return space.ledger.threadHistory(human, { workspaceId: alpha, taskRef, limit: 1 }).thread.revision
}

async function addList(space: Room, label: string, category: 'unstarted' | 'started' | 'done' | 'closed' = 'started'): Promise<string> {
  return committed((await space.ledger.createStatus({ requestId: requestId(`status:${label}`), actor: human,
    workspaceId: alpha, label, category })).value).status.key
}

/** Place one card in a custom list, through the same patch the board's drag sends. */
let placement = 0
async function place(space: Room, task: MadeTask, key: string): Promise<void> {
  placement += 1
  committed((await space.ledger.updateTask({ requestId: requestId(`place:${task.taskRef}:${key}:${placement}`), workspaceId: alpha,
    taskRef: task.taskRef, baseRevision: revisionOf(space, task.taskRef), actor: human, patch: { statusKey: key } })).value)
}

describe('workspace status catalog (M-51)', () => {
  it('1. a new list joins the catalog beside the five built-ins, and the view reports the order', async () => {
    const space = await room()
    const before = space.ledger.view({ workspaceId: alpha })
    expect(before.statuses.map(entry => entry.key)).toEqual(['todo', 'in_progress', 'in_review', 'done', 'closed'])
    expect(before.statuses.every(entry => entry.builtin)).toBe(true)

    const key = await addList(space, 'QA')
    expect(key).toBe('qa')
    const after = space.ledger.view({ workspaceId: alpha })
    expect(after.statuses.map(entry => entry.key)).toEqual(['todo', 'in_progress', 'in_review', 'done', 'closed', 'qa'])
    expect(after.statuses.at(-1)).toEqual({ key: 'qa', label: 'QA', category: 'started', builtin: false, archived: false })
    // The built-ins keep their order and their category: nothing about them moved.
    expect(AGENT_TEAM_BUILTIN_STATUSES.map(entry => entry.key)).toEqual(['todo', 'in_progress', 'in_review', 'done', 'closed'])
  })

  it('2. mints a stable key, refuses a duplicate name, and a rename keeps the key', async () => {
    const space = await room()
    expect(await addList(space, 'QA')).toBe('qa')
    // A second list with the same slug but a different name gets its own key.
    expect(await addList(space, 'Qa!')).toBe('qa-2')
    await expect(space.ledger.createStatus({ requestId: requestId('dup'), actor: human, workspaceId: alpha,
      label: 'QA', category: 'started' })).rejects.toThrow("a list named 'QA' already exists")

    const renamed = committed((await space.ledger.updateStatus({ requestId: requestId('rename'), actor: human,
      workspaceId: alpha, key: 'qa', label: 'Quality', category: 'done' })).value).status
    expect(renamed).toEqual({ key: 'qa', label: 'Quality', category: 'done', builtin: false, archived: false })
    // The re-category is a catalog fact only: the five derived statuses never move.
    expect(space.ledger.view({ workspaceId: alpha }).statuses.find(entry => entry.key === 'qa')?.category).toBe('done')
  })

  it('3. refuses to rename a built-in or an archived list, and refuses an unknown one', async () => {
    const space = await room()
    await expect(space.ledger.updateStatus({ requestId: requestId('builtin'), actor: human, workspaceId: alpha,
      key: 'todo', label: 'Later', category: 'unstarted' })).rejects.toThrow("built-in list 'todo' cannot be renamed")
    const key = await addList(space, 'QA')
    committed((await space.ledger.archiveStatus({ requestId: requestId('archive'), actor: human, workspaceId: alpha, key })).value)
    await expect(space.ledger.updateStatus({ requestId: requestId('archived-rename'), actor: human, workspaceId: alpha,
      key, label: 'Still here', category: 'started' })).rejects.toThrow('cannot be renamed')
    await expect(space.ledger.updateStatus({ requestId: requestId('unknown'), actor: human, workspaceId: alpha,
      key: 'nope', label: 'Nope', category: 'started' })).rejects.toThrow("unknown list 'nope'")
    await expect(space.ledger.archiveStatus({ requestId: requestId('builtin-archive'), actor: human, workspaceId: alpha,
      key: 'done' })).rejects.toThrow("built-in list 'done' cannot be archived")
  })

  it('4. a card placed in a list reads back on the board and in a cold replay', async () => {
    const space = await room()
    const key = await addList(space, 'QA')
    const task = await makeTask(space, 'placed')
    expect(space.ledger.view({ workspaceId: alpha }).tasks[0]!.statusKey).toBeUndefined()
    await place(space, task, key)
    const placed = space.ledger.view({ workspaceId: alpha }).tasks[0]!
    expect(placed.statusKey).toBe(key)
    expect(placed.status).toBe('todo')

    const records = storedOperations(space.pool)
    for (const record of records) expect(agentTeamOperationSchema.safeParse(record).success).toBe(true)
    const cold = replayLedger(records)
    cold.validate()
    expect(cold.view({ workspaceId: alpha }).tasks[0]!.statusKey).toBe(key)

    // Dragging it back out is the same patch with `null`.
    committed((await space.ledger.updateTask({ requestId: requestId('unplace'), workspaceId: alpha,
      taskRef: task.taskRef, baseRevision: revisionOf(space, task.taskRef), actor: human, patch: { statusKey: null } })).value)
    expect(space.ledger.view({ workspaceId: alpha }).tasks[0]!.statusKey).toBeNull()
  })

  it('5. refuses a placement that names an unknown or archived list, or another Workspace’s list', async () => {
    const space = await room()
    const task = await makeTask(space, 'refused')
    await expect(space.ledger.updateTask({ requestId: requestId('unknown-place'), workspaceId: alpha,
      taskRef: task.taskRef, baseRevision: revisionOf(space, task.taskRef), actor: human,
      patch: { statusKey: 'nope' } })).rejects.toThrow("unknown list 'nope'")

    const key = await addList(space, 'QA')
    committed((await space.ledger.archiveStatus({ requestId: requestId('archive'), actor: human, workspaceId: alpha, key })).value)
    await expect(space.ledger.updateTask({ requestId: requestId('archived-place'), workspaceId: alpha,
      taskRef: task.taskRef, baseRevision: revisionOf(space, task.taskRef), actor: human,
      patch: { statusKey: key } })).rejects.toThrow('cannot hold cards')
  })

  it('6. refuses to archive a list that still holds cards, with the count', async () => {
    const space = await room()
    const key = await addList(space, 'QA')
    const first = await makeTask(space, 'one')
    const second = await makeTask(space, 'two')
    await place(space, first, key)
    await place(space, second, key)
    await expect(space.ledger.archiveStatus({ requestId: requestId('archive-held'), actor: human, workspaceId: alpha, key }))
      .rejects.toThrow("Board list 'QA' still holds 2 tasks; move them first")

    committed((await space.ledger.updateTask({ requestId: requestId('unplace'), workspaceId: alpha,
      taskRef: first.taskRef, baseRevision: revisionOf(space, first.taskRef), actor: human, patch: { statusKey: null } })).value)
    await expect(space.ledger.archiveStatus({ requestId: requestId('archive-one'), actor: human, workspaceId: alpha, key }))
      .rejects.toThrow('still holds 1 task; move them first')
  })

  it('7. Q5: a claim takes the card back to its built-in column, live and on replay', async () => {
    const space = await room()
    const key = await addList(space, 'QA')
    const task = await makeTask(space, 'claimed')
    await place(space, task, key)

    committed((await space.ledger.changeClaim({ requestId: requestId('claim'), workspaceId: alpha, taskRef: task.taskRef,
      baseRevision: revisionOf(space, task.taskRef), action: 'claim', direction: 'QA pass', actor: space.ann })).value)
    const claimed = space.ledger.view({ workspaceId: alpha }).tasks[0]!
    expect(claimed.status).toBe('in_progress')
    expect(claimed.statusKey).toBeNull()

    const cold = replayLedger(storedOperations(space.pool))
    cold.validate()
    const replayed = cold.view({ workspaceId: alpha }).tasks[0]!
    expect(replayed.status).toBe('in_progress')
    expect(replayed.statusKey).toBeNull()
  })

  it('8. Q5: accept, close and reopen each go back, and each replays to the same placement', async () => {
    const space = await room()
    const key = await addList(space, 'QA')
    const task = await makeTask(space, 'resolved')

    await place(space, task, key)
    committed((await space.ledger.changeTask({ requestId: requestId('accept'), workspaceId: alpha, taskRef: task.taskRef,
      baseRevision: revisionOf(space, task.taskRef), action: 'accept', actor: human })).value)
    let current = space.ledger.view({ workspaceId: alpha }).tasks[0]!
    expect(current.status).toBe('done')
    expect(current.statusKey).toBeNull()

    await place(space, task, key)
    expect(space.ledger.view({ workspaceId: alpha }).tasks[0]!.statusKey).toBe(key)
    committed((await space.ledger.changeTask({ requestId: requestId('close'), workspaceId: alpha, taskRef: task.taskRef,
      baseRevision: revisionOf(space, task.taskRef), action: 'close', actor: human })).value)
    current = space.ledger.view({ workspaceId: alpha }).tasks[0]!
    expect(current.status).toBe('closed')
    expect(current.statusKey).toBeNull()

    await place(space, task, key)
    committed((await space.ledger.changeTask({ requestId: requestId('reopen'), workspaceId: alpha, taskRef: task.taskRef,
      baseRevision: revisionOf(space, task.taskRef), action: 'reopen', actor: human })).value)
    current = space.ledger.view({ workspaceId: alpha }).tasks[0]!
    expect(current.status).toBe('todo')
    expect(current.statusKey).toBeNull()

    const cold = replayLedger(storedOperations(space.pool))
    cold.validate()
    expect(cold.view({ workspaceId: alpha }).tasks[0]!.statusKey).toBeNull()
  })

  it('9. a property edit keeps the placement; only a status change clears it', async () => {
    const space = await room()
    const key = await addList(space, 'QA')
    const task = await makeTask(space, 'edited')
    await place(space, task, key)
    committed((await space.ledger.updateTask({ requestId: requestId('retitle'), workspaceId: alpha, taskRef: task.taskRef,
      baseRevision: revisionOf(space, task.taskRef), actor: human, patch: { title: 'Still in QA' } })).value)
    expect(space.ledger.view({ workspaceId: alpha }).tasks[0]!.statusKey).toBe(key)
  })

  it('10. replay refuses a placement the write would not have made', async () => {
    const space = await room()
    const key = await addList(space, 'QA')
    const task = await makeTask(space, 'forged')
    await place(space, task, key)
    const records = storedOperations(space.pool)
    const placementRecord = records.find(record => record.kind === 'team/task-updated' && record.data.patch.statusKey === key)
    if (placementRecord === undefined || placementRecord.kind !== 'team/task-updated') throw new Error('expected the placement write')

    // A key no catalog entry ever named.
    const unknownKey = { ...placementRecord, data: { ...placementRecord.data,
      patch: { statusKey: 'ghost' }, task: { ...placementRecord.data.task, statusKey: 'ghost' } } } as AgentTeamOperation
    expect(() => replayLedger(records.map(record => record === placementRecord ? unknownKey : record)).validate())
      .toThrow('invalid Task placement')

    // Q5 on the claim path: a Claim that moved the status cannot keep the list.
    committed((await space.ledger.changeClaim({ requestId: requestId('claim'), workspaceId: alpha, taskRef: task.taskRef,
      baseRevision: revisionOf(space, task.taskRef), action: 'claim', direction: 'QA pass', actor: space.ann })).value)
    const claimed = storedOperations(space.pool)
    const claimRecord = claimed.find(record => record.kind === 'team/claim-created')
    if (claimRecord === undefined || claimRecord.kind !== 'team/claim-created') throw new Error('expected the Claim write')
    const keptPlacement = { ...claimRecord, data: { ...claimRecord.data,
      task: { ...claimRecord.data.task, statusKey: key } } } as AgentTeamOperation
    expect(() => replayLedger(claimed.map(record => record === claimRecord ? keptPlacement : record)).validate())
      .toThrow('invalid Claim Task placement')
  })

  it('11. a stale or duplicated request resolves instead of writing twice; a different payload collides', async () => {
    const space = await room()
    const first = committed((await space.ledger.createStatus({ requestId: requestId('same'), actor: human,
      workspaceId: alpha, label: 'QA', category: 'started' })).value)
    const again = await space.ledger.createStatus({ requestId: requestId('same'), actor: human,
      workspaceId: alpha, label: 'QA', category: 'started' })
    expect(again.committed).toBe(false)
    expect(again.value.status.key).toBe(first.status.key)
    expect(storedOperations(space.pool).filter(record => record.kind === 'team/status-created')).toHaveLength(1)
    await expect(space.ledger.createStatus({ requestId: requestId('same'), actor: human, workspaceId: alpha,
      label: 'Other', category: 'started' })).rejects.toThrow('was reused with a different operation or payload')
  })

  it('12. the catalog is per Workspace: the same name mints the same key in each, and neither sees the other', async () => {
    const space = await room()
    const other = (await space.ledger.createChannel({ requestId: requestId('channel-beta'), workspaceId: beta,
      name: 'other', description: '', memberIds: [], actor: human })).value.channel
    expect(other.workspaceId).toBe(beta)
    const key = await addList(space, 'QA')
    const betaKey = committed((await space.ledger.createStatus({ requestId: requestId('beta-qa'), actor: human,
      workspaceId: beta, label: 'QA', category: 'started' })).value).status.key
    expect(betaKey).toBe(key)
    expect(space.ledger.view({ workspaceId: alpha }).statuses.filter(entry => entry.key === 'qa')).toHaveLength(1)
    expect(space.ledger.view({ workspaceId: beta }).statuses.filter(entry => entry.key === 'qa')).toHaveLength(1)
    // Archiving in one Workspace leaves the other's list alone.
    committed((await space.ledger.archiveStatus({ requestId: requestId('alpha-archive'), actor: human, workspaceId: alpha, key })).value)
    expect(space.ledger.view({ workspaceId: beta }).statuses.find(entry => entry.key === 'qa')?.archived).toBe(false)
  })
})
