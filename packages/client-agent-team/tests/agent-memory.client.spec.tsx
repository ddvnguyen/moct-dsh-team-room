// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AgentTeamClientMemberStatus } from '@ddvnguyen/moct-dsh-team-room/types'
import { AGENT_MEMORY_MAX_PAGES, loadAgentMemory } from '../src/client/agent-memory.ts'
import { TeamAgentDetail } from '../src/client/TeamAgentDetail.tsx'

afterEach(cleanup)

const record = (id: string, kind: string, ref: string, type = 'how_to_work') => ({ id, type, title: `title ${id}`, body: `body ${id}`, home: { kind, ref }, status: 'active', flag: null, pinned: false, priority: 0, version: 1, authorId: 'x', updatedAt: '2026-10-15', supersedes: null, supersededBy: null, conflictsWith: [] })

/** A backend that holds to its real bound: `limit` must be 1..20, and pages come with a cursor. */
const backend = (expertRows: ReturnType<typeof record>[], teamRows: ReturnType<typeof record>[] = []) => vi.fn(async (request: { homes?: string[]; limit?: number; cursor?: string }) => {
  if (request.limit === undefined || request.limit < 1 || request.limit > 20) return { ok: false as const, code: 'BAD_REQUEST', message: 'limit must be 1..20' }
  const rows = request.homes?.[0] === 'team' ? teamRows : expertRows
  const start = request.cursor === undefined ? 0 : Number(request.cursor)
  const results = rows.slice(start, start + request.limit)
  const next = start + request.limit
  return { ok: true as const, value: { results, total: rows.length, nextCursor: next < rows.length ? String(next) : null } }
})

describe('loadAgentMemory', () => {
  it("keeps only this Member's expert records and the Team's rules", async () => {
    const list = backend([record('a', 'expert', 'member:me'), record('b', 'expert', 'member:other')], [record('r', 'team', 'w1', 'rule')])
    const result = await loadAgentMemory(list as never, 'w1' as never, 'member:me')
    expect(result).toMatchObject({ ok: true, ownMore: false, teamMore: false })
    if (result.ok) { expect(result.own.map(r => r.id)).toEqual(['a']); expect(result.team.map(r => r.id)).toEqual(['r']) }
  })
  it('stops at five pages and says more exist instead of truncating silently', async () => {
    const rows = Array.from({ length: 130 }, (_, index) => record(`m${String(index)}`, 'expert', index % 2 === 0 ? 'member:me' : 'member:other'))
    const list = backend(rows)
    const result = await loadAgentMemory(list as never, 'w1' as never, 'member:me')
    expect(list.mock.calls.filter(([request]) => request.homes?.[0] === 'expert')).toHaveLength(AGENT_MEMORY_MAX_PAGES)
    expect(result).toMatchObject({ ok: true, ownMore: true })
    if (result.ok) expect(result.own).toHaveLength(50)
  })
  it('reports a refusal with its code', async () => {
    const result = await loadAgentMemory((async () => ({ ok: false, code: 'BACKEND_UNAVAILABLE', message: 'down' })) as never, 'w1' as never, 'member:me')
    expect(result).toEqual({ ok: false, code: 'BACKEND_UNAVAILABLE', message: 'down' })
  })
})

describe('Agent detail Memory tab', () => {
  const t = ((key: string, args?: Record<string, string>) => `${key}${args === undefined ? '' : JSON.stringify(args)}`) as never
  const status = { member: { memberId: 'member:me', handle: '@me', description: '', state: 'active', presetId: 'p', workspaceIds: [] }, instances: [], workspaceIds: ['w1'], availability: 'active', presence: 'available', capabilityState: 'applied' } as unknown as AgentTeamClientMemberStatus
  const mount = (loadMemory: unknown) => render(<TeamAgentDetail
    workspaceId={'w1' as never} status={status}
    loadMemberSessions={vi.fn(async () => ({ ok: true, value: { current: null, runs: [] } })) as never}
    resolveThreadRefs={vi.fn() as never} loadChannels={vi.fn() as never} loadMemory={loadMemory as never}
    openMemberSession={vi.fn() as never} onClose={() => undefined} t={t}
  />)

  it('reads nothing until the tab opens, then lists the Agent and Team records', async () => {
    const list = backend([record('a', 'expert', 'member:me')], [record('r', 'team', 'w1', 'rule')])
    mount(list)
    expect(list).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('agentDetailsTabMemory'))
    await waitFor(() => expect(document.querySelectorAll('[data-memory-id]')).toHaveLength(2))
  })
  it('shows a failed read, not an empty list', async () => {
    mount(async () => ({ ok: false, code: 'BACKEND_UNAVAILABLE', message: 'down' }))
    fireEvent.click(screen.getByText('agentDetailsTabMemory'))
    expect((await screen.findByRole('alert')).textContent).toContain('down')
  })
})
