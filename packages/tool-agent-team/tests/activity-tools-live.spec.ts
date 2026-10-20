import { afterEach, describe, expect, it, vi } from 'vitest'
// Harness boots over a throwaway tree; CI's worst cold replay needs headroom.
vi.setConfig({ testTimeout: 30_000 })
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import AgentTeam from '@ddvnguyen/moct-dsh-team-room/host'
import type { AgentTeamMemberId, AgentTeamRequestId } from '@ddvnguyen/moct-dsh-team-room/types'
import { MemoryMediaPool, MemoryStorageBackend } from '../../agent-team/tests/helpers/memory-backend.ts'
import { renderText, teamTools } from './render-text.ts'

/**
 * `team_activity` against a live Host: the fake-host render spec proves the
 * tool's own contract, this one proves the contract still holds when the
 * reads come from the real ledger rather than a stand-in.
 */

const cleanups: Array<() => Promise<void>> = []
const alpha = WorkspaceId('workspace:alpha')
const requestId = (value: string): AgentTeamRequestId => value as AgentTeamRequestId

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(cleanup => cleanup()))
})

async function hostWithSeat(): Promise<{ host: AgentTeam; agent: unknown }> {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  ctx.provide('workspaceRegistry', {
    get: (id: WorkspaceId) => id === alpha ? { id, path: process.cwd(), attachSession: async () => {} } : undefined,
    list: () => [alpha],
    archiveSession: async () => {},
  })
  ctx.provide('agents', { create: async () => { throw new Error('unused') }, resume: async () => { throw new Error('unused') } })
  ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'mock', model: 'mock' }) })
  ctx.provide('agentPresets', { mount: async () => { throw new Error('unused') }, composedPreset: () => 'team-member' })
  ctx.provide('tools', { schemas: () => [] })
  ctx.provide('sessionPersistence', { list: async () => [] })
  await ctx.plugin(SessionProjectionRegistry)
  const fiber = await ctx.plugin(AgentTeam)
  cleanups.push(async () => { await fiber.dispose(); await facility.closeAll() })
  const host = ctx.agentTeam
  const channel = await host.createChannel({ requestId: requestId('live-channel'), workspaceId: alpha, name: 'room', description: '' })
  const member = (await host.addMember({
    requestId: requestId('live-member'), workspaceId: alpha, handle: 'live-seat', description: 'Live seat',
    presetId: 'team-member', role: 'orchestrator', channelRefs: [channel.channel.channelRef],
  })).status.member
  const agent = { id: member.sessionId, status: 'idle', followup: () => undefined, inbox: { nextStep: [], nextTurn: [] }, ctx: { get: (name: string) => name === 'agentTeam' ? host : undefined } }
  const internals = host as unknown as { handles: Map<unknown, unknown>; memberBySessionId: Map<unknown, unknown>; clearMemberFailure: (id: AgentTeamMemberId, slot: 'activation') => boolean }
  internals.clearMemberFailure(member.memberId, 'activation')
  internals.handles.set(member.memberId, { agent })
  internals.memberBySessionId.set(member.sessionId, member.memberId)
  // A real Task, so the snapshot's task rows come from the real catalog.
  await host.createTask({ requestId: requestId('live-task'), workspaceId: alpha, channelRef: channel.channel.channelRef, body: 'Ship the digest', title: 'Ship the digest' })
  return { host, agent }
}

/** The snapshot shape the tool returns; the render consumes the same fields. */
interface ActivitySnapshot {
  readonly workspaceId: string
  readonly windowMinutes: number
  readonly agents: readonly { readonly handle: string; readonly memberId: string }[]
  readonly tasks: { readonly counts: Record<string, number>; readonly open: readonly { readonly title?: string }[] }
}

describe('team_activity against a live Host', () => {
  it('reports the Workspace it was called for, with the caller\'s own agent row and the open Tasks', async () => {
    const { agent } = await hostWithSeat()
    const tool = teamTools().get('team_activity')!
    const exec = { agent, callId: 'call-1', signal: new AbortController().signal } as never
    const value = await tool.execute({ sinceMinutes: 60 }, exec) as ActivitySnapshot
    const text = renderText(tool, { sinceMinutes: 60 }, value)

    expect(value.workspaceId).toBe(alpha)
    expect(value.windowMinutes).toBe(60)
    expect(value.agents.map(row => row.handle)).toContain('live-seat')
    expect(text).toContain('@live-seat')
    expect(text).toContain('read-only')
    // The Task the Human created is in the catalog the snapshot reads.
    expect(value.tasks.counts.todo).toBe(1)
    expect(value.tasks.open.map(task => task.title)).toContain('Ship the digest')
    expect(text).toContain('Ship the digest')
    expect(text).toContain('No open decision cards.')
  })
})
