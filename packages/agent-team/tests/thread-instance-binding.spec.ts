/**
 * Multi-instance contract v2 §2a/§2c: `team/thread-instance-bound` over the REAL TEST
 * ledger (`fixtures/ops-after-test2.json`, see member-sessions-replay.spec.ts).
 *
 * - the latest binding per (Thread, seat) wins; there is no release op;
 * - a restart reads the binding back from the ledger;
 * - a slot at or past the seat's current `instances` reads as unbound, and comes back
 *   when N is raised again (the op is never rewritten);
 * - a slot outside the seat's N is refused at commit, and only the seat's own actor binds.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { MemoryStorageBackend, MemoryMediaPool } from './helpers/memory-backend.ts'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { AgentTeamLedger, agentTeamHumanActor } from '../src/ledger.ts'
import { agentTeamDomainSpec } from '../src/spec.ts'
import type { AgentTeamMemberActor, AgentTeamMemberId, AgentTeamOperation, AgentTeamOperationId, AgentTeamRequestId, AgentTeamThreadRef } from '../src/types.ts'

interface Fixture {
  readonly workspaceId: string
  readonly operations: readonly AgentTeamOperation[]
}

const fixture = JSON.parse(readFileSync(new URL('./fixtures/ops-after-test2.json', import.meta.url), 'utf8')) as Fixture
const workspaceId = WorkspaceId('cf4817d4-c9d6-42b0-9a44-271db6d259ca')
const seat = 'member:b91f3c8e-7e15-49d9-bc9a-3bde6034deda' as AgentTeamMemberId
const seatActor: AgentTeamMemberActor = { kind: 'member', memberId: seat, handle: 'a5-mv33zm0u' }
const thread = 'thread:cd310e23-02d2-47b3-90d6-fab6a0783000' as AgentTeamThreadRef
const boundAt = '2026-10-13T00:45:00+08:00'

async function ledgerTable(): Promise<KvTable<AgentTeamOperationId, AgentTeamOperation>> {
  const pool = new MemoryMediaPool()
  pool.versions.set('agent_team', agentTeamDomainSpec.version)
  pool.media.set('agent_team', { tables: new Map([['operations', new Map(fixture.operations.map(operation => [operation.operationId, operation] as [string, unknown]))]]), global: null })
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  const domain = await ctx.storageDomain.open(agentTeamDomainSpec)
  return domain.table('operations') as unknown as KvTable<AgentTeamOperationId, AgentTeamOperation>
}

const bind = (ledger: AgentTeamLedger, requestId: string, slot: number, actor: AgentTeamMemberActor = seatActor) =>
  ledger.bindThreadInstance({ requestId: requestId as AgentTeamRequestId, workspaceId, threadRef: thread, slot, boundAt, actor })

const setInstances = (ledger: AgentTeamLedger, requestId: string, instances: number | null) => {
  const member = ledger.getMember(seat)!
  return ledger.updateMember({ requestId: requestId as AgentTeamRequestId, memberId: seat, handle: member.handle, description: member.description, instances, actor: agentTeamHumanActor() })
}

describe('thread-instance-bound (multi-instance contract v2 §2c)', () => {
  it('an unbound Thread reads undefined; the latest binding wins and survives a restart', async () => {
    const table = await ledgerTable()
    const ledger = new AgentTeamLedger(table)
    expect(ledger.threadInstanceOf(thread, seat)).toBeUndefined()
    await bind(ledger, 'mi-bind-1', 1)
    expect(ledger.threadInstanceOf(thread, seat)).toBe(1)
    await bind(ledger, 'mi-bind-2', 0)
    expect(ledger.threadInstanceOf(thread, seat)).toBe(0)
    const restarted = new AgentTeamLedger(table)
    expect(() => { restarted.validate() }).not.toThrow()
    expect(restarted.threadInstanceOf(thread, seat)).toBe(0)
    expect([...restarted.threadInstancesOf(seat)]).toEqual([[thread, 0]])
  })

  it('a slot past a lowered N reads as unbound, and returns when N is raised', async () => {
    const ledger = new AgentTeamLedger(await ledgerTable())
    await setInstances(ledger, 'mi-n3', 3)
    await bind(ledger, 'mi-bind-slot2', 2)
    expect(ledger.threadInstanceOf(thread, seat)).toBe(2)
    await setInstances(ledger, 'mi-n1', 1)
    expect(ledger.threadInstanceOf(thread, seat)).toBeUndefined()
    expect(ledger.threadInstancesOf(seat).size).toBe(0)
    await setInstances(ledger, 'mi-n3-again', 3)
    expect(ledger.threadInstanceOf(thread, seat)).toBe(2)
  })

  it('refuses a slot outside the seat\'s N and a changed retry; seats bind independently', async () => {
    const ledger = new AgentTeamLedger(await ledgerTable())
    await expect(bind(ledger, 'mi-bad-slot', 2)).rejects.toThrow(/outside 0\.\.1/)
    await expect(bind(ledger, 'mi-bad-neg', -1)).rejects.toThrow(/outside/)
    await bind(ledger, 'mi-retry', 1)
    const again = await bind(ledger, 'mi-retry', 1)
    expect(again.committed).toBe(false)
    await expect(bind(ledger, 'mi-retry', 0)).rejects.toThrow()
    const other = fixture.operations.find(operation => operation.kind === 'team/member-added' && operation.data.member.memberId !== seat)
    if (other?.kind !== 'team/member-added') throw new Error('fixture must hold a second seat')
    // A second seat binding for itself is its own row; it never moves this seat's slot.
    expect(ledger.threadInstanceOf(thread, other.data.member.memberId)).toBeUndefined()
    expect(ledger.threadInstanceOf(thread, seat)).toBe(1)
  })
})
