import { afterEach, describe, expect, it, vi } from 'vitest'
vi.setConfig({ testTimeout: 30_000 })
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { SessionId } from '@deepseek-ai/dsh-session'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { MemoryMediaPool, MemoryStorageBackend } from './helpers/memory-backend.ts'
import AgentTeam from '../src/index.ts'
import { AgentTeamLedger, agentTeamHumanActor } from '../src/ledger.ts'
import type {
  AgentTeamAgentMember, AgentTeamChannelRef, AgentTeamMemberActor, AgentTeamMessage, AgentTeamMessageRef, AgentTeamOperation,
  AgentTeamOperationId, AgentTeamRequestId, AgentTeamThreadRef, AgentTeamThreadRepliedOperation,
} from '../src/types.ts'

interface TeamHarness {
  readonly ctx: Context
  readonly facility: DomainFacility
}

const cleanups: Array<() => Promise<void>> = []
const alpha = WorkspaceId('workspace:alpha')
const requestId = (value: string): AgentTeamRequestId => value as AgentTeamRequestId
const unknownMessage = 'message:00000000-0000-4000-8000-000000000000' as AgentTeamMessageRef

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(cleanup => cleanup()))
})

async function harness(pool = new MemoryMediaPool()): Promise<TeamHarness> {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  ctx.provide('workspaceRegistry', {
    get: (id: WorkspaceId) => id === alpha ? { id, path: process.cwd(), attachSession: async () => {} } : undefined,
    list: () => [{ id: alpha, path: process.cwd() }],
    archiveSession: async () => {},
  })
  ctx.provide('agents', { create: async () => { throw new Error('unused') }, resume: async () => { throw new Error('unused') } })
  ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'mock', model: 'mock' }) })
  ctx.provide('agentPresets', { mount: async () => { throw new Error('unused') } })
  ctx.provide('tools', { schemas: () => [] })
  ctx.provide('sessionPersistence', { list: async () => [] })
  await ctx.plugin(SessionProjectionRegistry)
  const fiber = await ctx.plugin(AgentTeam)
  cleanups.push(async () => { await fiber.dispose(); await facility.closeAll() })
  return { ctx, facility }
}

function operations(test: TeamHarness): KvTable<AgentTeamOperationId, AgentTeamOperation> {
  return test.facility.get('agent_team')!.table('operations') as unknown as KvTable<AgentTeamOperationId, AgentTeamOperation>
}

function storedOperations(pool: MemoryMediaPool): AgentTeamOperation[] {
  return [...pool.media.get('agent_team')!.tables.get('operations')!.values()] as AgentTeamOperation[]
}

function threadMessages(ledger: AgentTeamLedger, threadRef: AgentTeamThreadRef): AgentTeamMessage[] {
  return ledger.threadHistory(agentTeamHumanActor(), { workspaceId: alpha, threadRef, limit: 100 }).facts
    .flatMap(fact => fact.kind === 'message' ? [fact.message] : [])
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
  await ledger.addMember({ requestId: requestId(`add:${handle}`), actor: agentTeamHumanActor(), member, handle,
    description: member.description, presetId: member.presetId, workspaceId: alpha, channelRefs: [channelRef] })
  return { kind: 'member', memberId, handle }
}

/** Ann opens a Thread naming Bob; Bob drains it. Returns everything a reply needs. */
async function room() {
  const pool = new MemoryMediaPool()
  const test = await harness(pool)
  const ledger = new AgentTeamLedger(operations(test))
  const channel = (await ledger.createChannel({ requestId: requestId('channel'), workspaceId: alpha,
    name: 'room', description: '', memberIds: [], actor: agentTeamHumanActor() })).value.channel
  const ann = await addMember(ledger, channel.channelRef, 'ann')
  const bob = await addMember(ledger, channel.channelRef, 'bob')
  const opened = committed((await ledger.sendMessage({ requestId: requestId('open'), workspaceId: alpha,
    channelRef: channel.channelRef, body: 'Ship plan\nsecond line', asTask: false, actor: ann, recipients: [bob.memberId] })).value)
  const read = (await ledger.readThread({ requestId: requestId('bob-read'), workspaceId: alpha, threadRef: opened.thread.threadRef, actor: bob })).value
  return { pool, test, ledger, channel, ann, bob, opened, revision: read.thread.revision }
}

describe('reply-link (replyToMessageRef)', () => {
  it('refuses a reply citing an unknown Message or one from another Thread, and omits unknown refs on resolve', async () => {
    const { ledger, channel, ann, bob, opened, revision } = await room()
    await expect(ledger.reply({ requestId: requestId('unknown'), workspaceId: alpha, threadRef: opened.thread.threadRef,
      body: 'answer', baseRevision: revision, replyToMessageRef: unknownMessage, actor: bob })).rejects.toThrow(/unknown Message/)
    const other = committed((await ledger.sendMessage({ requestId: requestId('other'), workspaceId: alpha,
      channelRef: channel.channelRef, body: 'Unrelated', asTask: false, actor: ann })).value)
    await expect(ledger.reply({ requestId: requestId('cross'), workspaceId: alpha, threadRef: opened.thread.threadRef,
      body: 'answer', baseRevision: revision, replyToMessageRef: other.message.messageRef, actor: bob })).rejects.toThrow(/another Thread/)
    // Neither refusal wrote anything: the next valid reply still commits on the same token.
    expect(committed((await ledger.reply({ requestId: requestId('valid'), workspaceId: alpha, threadRef: opened.thread.threadRef,
      body: 'answer', baseRevision: revision, replyToMessageRef: opened.message.messageRef, actor: bob })).value).message.replyToMessageRef)
      .toBe(opened.message.messageRef)

    expect(ledger.resolveMessageRefs(alpha, [unknownMessage, opened.message.messageRef, other.message.messageRef])).toEqual([
      { messageRef: opened.message.messageRef, threadRef: opened.thread.threadRef, sender: ann.memberId, excerpt: 'Ship plan' },
      { messageRef: other.message.messageRef, threadRef: other.thread.threadRef, sender: ann.memberId, excerpt: 'Unrelated' },
    ])
    expect(ledger.resolveMessageRefs(WorkspaceId('workspace:beta'), [opened.message.messageRef])).toEqual([])
  })

  it('delivers the reply to the cited author like a mention, without naming them', async () => {
    const { pool, ledger, ann, bob, opened, revision } = await room()
    const reply = committed((await ledger.reply({ requestId: requestId('reply'), workspaceId: alpha, threadRef: opened.thread.threadRef,
      body: 'Looks right to me', baseRevision: revision, replyToMessageRef: opened.message.messageRef, actor: bob })).value)
    expect(reply.message.replyToMessageRef).toBe(opened.message.messageRef)
    expect(reply.directMarkers.map(marker => marker.memberId)).toEqual([ann.memberId])
    const op = storedOperations(pool).find(candidate => candidate.operationId === reply.receipt.operationId) as AgentTeamThreadRepliedOperation
    expect(op.data.mentions).toEqual([ann.memberId])
    expect(op.data.message.replyToMessageRef).toBe(opened.message.messageRef)
    // Answering one's own Message adds no one, and an explicit mention is not doubled.
    const own = committed((await ledger.reply({ requestId: requestId('own'), workspaceId: alpha, threadRef: opened.thread.threadRef,
      body: 'Following up on my own note', baseRevision: reply.thread.revision, replyToMessageRef: reply.message.messageRef, actor: bob })).value)
    expect(own.directMarkers).toEqual([])
  })

  it('N=1: a single cited ref resolves to exactly one quote, and its only author is the only recipient', async () => {
    const { ledger, ann, bob, opened, revision } = await room()
    const reply = committed((await ledger.reply({ requestId: requestId('n1'), workspaceId: alpha, threadRef: opened.thread.threadRef,
      body: `@ann ${'x'.repeat(10)}`, baseRevision: revision, replyToMessageRef: opened.message.messageRef, actor: bob })).value)
    expect(reply.directMarkers.map(marker => marker.memberId)).toEqual([ann.memberId])
    const resolved = ledger.resolveMessageRefs(alpha, [opened.message.messageRef])
    expect(resolved).toHaveLength(1)
    expect(resolved[0]).toEqual({ messageRef: opened.message.messageRef, threadRef: opened.thread.threadRef, sender: ann.memberId, excerpt: 'Ship plan' })
    // An abbreviated ref resolves and is stored in full.
    const abbreviated = `message:${opened.message.messageRef.slice('message:'.length).replaceAll('-', '').slice(0, 8)}` as AgentTeamMessageRef
    expect(ledger.resolveMessageRefs(alpha, [abbreviated]).map(entry => entry.messageRef)).toEqual([opened.message.messageRef])
    // The excerpt is the first line, capped at 120 characters.
    const long = committed((await ledger.reply({ requestId: requestId('long'), workspaceId: alpha, threadRef: opened.thread.threadRef,
      body: 'y'.repeat(200), baseRevision: reply.thread.revision, actor: bob })).value)
    expect(ledger.resolveMessageRefs(alpha, [long.message.messageRef])[0]!.excerpt).toBe(`${'y'.repeat(119)}…`)
  })

  it('a retried reply must cite the same parent', async () => {
    const { ledger, bob, opened, revision } = await room()
    const request = { requestId: requestId('retry'), workspaceId: alpha, threadRef: opened.thread.threadRef,
      body: 'answer', baseRevision: revision, replyToMessageRef: opened.message.messageRef, actor: bob }
    const first = await ledger.reply(request)
    const again = await ledger.reply(request)
    expect(again.committed).toBe(false)
    expect(committed(again.value).message.messageRef).toBe(committed(first.value).message.messageRef)
    const { replyToMessageRef: _dropped, ...unlinked } = request
    await expect(ledger.reply(unlinked)).rejects.toThrow()
  })

  it('legacy replay: a pre-reply-link Message replays unchanged, and a linked reply replays with its link', async () => {
    const { pool, ledger, bob, opened, revision } = await room()
    const legacy = committed((await ledger.reply({ requestId: requestId('legacy'), workspaceId: alpha, threadRef: opened.thread.threadRef,
      body: 'Plain reply', baseRevision: revision, actor: bob })).value)
    const linked = committed((await ledger.reply({ requestId: requestId('linked'), workspaceId: alpha, threadRef: opened.thread.threadRef,
      body: 'Linked reply', baseRevision: legacy.thread.revision, replyToMessageRef: opened.message.messageRef, actor: bob })).value)
    // A Message that is not a reply stores no key at all, so its record is
    // byte-identical to one written before reply-link existed.
    const records = storedOperations(pool)
    const legacyRecord = records.find(record => record.operationId === legacy.receipt.operationId) as AgentTeamThreadRepliedOperation
    expect(Object.keys(legacyRecord.data.message)).not.toContain('replyToMessageRef')
    expect(JSON.stringify(records)).not.toContain('"replyToMessageRef":null')

    // Cold boot over the stored records: every op passes the spec on replay.
    const copy = new MemoryMediaPool()
    copy.versions.set('agent_team', pool.versions.get('agent_team')!)
    copy.media.set('agent_team', { tables: new Map([['operations', new Map(pool.media.get('agent_team')!.tables.get('operations')!)]]), global: null })
    const rebooted = await harness(copy)
    const replay = new AgentTeamLedger(operations(rebooted))
    replay.validate()
    const messages = threadMessages(replay, opened.thread.threadRef)
    const plain = messages.find(message => message.messageRef === legacy.message.messageRef)!
    expect(Object.keys(plain)).not.toContain('replyToMessageRef')
    expect(plain).toEqual(legacy.message)
    expect(messages.find(message => message.messageRef === linked.message.messageRef)?.replyToMessageRef).toBe(opened.message.messageRef)
    // A legacy parent stays citable after replay.
    expect(replay.resolveMessageRefs(alpha, [legacy.message.messageRef])).toEqual([
      { messageRef: legacy.message.messageRef, threadRef: opened.thread.threadRef, sender: bob.memberId, excerpt: 'Plain reply' },
    ])
  })
})
