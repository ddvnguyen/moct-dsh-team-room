// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { AgentTeamClientMemberStatus } from '@ddvnguyen/moct-dsh-team-room/types'
import { TeamAgentDetail } from '../src/client/TeamAgentDetail.tsx'

afterEach(cleanup)

const t = ((key: string, args?: Record<string, string>) => `${key}${args === undefined ? '' : JSON.stringify(args)}`) as never

const statusWith = (instances: readonly unknown[]): AgentTeamClientMemberStatus => ({
  member: { memberId: 'member:b', handle: '@builder' },
  instances,
  availability: 'active',
  presence: 'available',
  capabilityState: 'applied',
}) as unknown as AgentTeamClientMemberStatus

const renderDetail = (status: AgentTeamClientMemberStatus, openMemberSession = vi.fn()) => {
  const loadMemberSessions = vi.fn(async () => ({ ok: true, value: { current: null, runs: [] } }))
  render(<TeamAgentDetail
    workspaceId={'w1' as never}
    status={status}
    loadMemberSessions={loadMemberSessions as never}
    resolveThreadRefs={vi.fn(async () => ({ ok: true, value: [] })) as never}
    loadMemory={vi.fn(async () => ({ ok: true, value: { ok: true, value: { results: [], total: 0, nextCursor: null } } })) as never}
    loadChannels={vi.fn(async () => ({ ok: true, value: { channels: [] } })) as never}
    openMemberSession={openMemberSession as never}
    onClose={() => undefined}
    t={t}
  />)
  return { openMemberSession }
}

describe('Agent detail instance slots', () => {
  it('lists every slot with presence, session and thread count when the seat has more than one', async () => {
    renderDetail(statusWith([
      { slot: 0, sessionId: 'session:aaaaaaaa-0', presence: 'available', threadRefs: [] },
      { slot: 1, sessionId: 'session:bbbbbbbb-1', presence: 'working', threadRefs: ['thread:1', 'thread:2'] },
      { slot: 2, presence: 'available', threadRefs: [] },
    ]))
    const rows = document.querySelectorAll('[data-slot]')
    expect([...rows].map(row => row.getAttribute('data-slot'))).toEqual(['0', '1', '2'])
    expect(rows[1]!.getAttribute('data-presence')).toBe('working')
    expect(rows[1]!.textContent).toContain('statusWorking')
    expect(rows[1]!.textContent).toContain('agentDetailsThreads{"count":"2"}')
    // An unspawned slot says so instead of showing an id.
    expect(rows[2]!.textContent).toContain('agentDetailsSlotIdle')
    expect(rows[2]!.querySelector('button')).toBeNull()
  })

  it('opens the slot session natively', () => {
    const { openMemberSession } = renderDetail(statusWith([
      { slot: 0, sessionId: 'session:aaaaaaaa-0', presence: 'available', threadRefs: [] },
      { slot: 1, sessionId: 'session:bbbbbbbb-1', presence: 'available', threadRefs: [] },
    ]))
    fireEvent.click(screen.getByRole('button', { name: 'agentDetailsOpen{"id":"session:bbbbbbbb-1"}' }))
    expect(openMemberSession).toHaveBeenCalledWith('session:bbbbbbbb-1', expect.any(Function))
  })

  it('keeps the seat diagnostic on slot 0 only, and an idle slot reads idle rather than unavailable', () => {
    const status = { ...statusWith([
      { slot: 0, sessionId: 'session:aaaaaaaa-0', presence: 'unavailable', threadRefs: [] },
      { slot: 1, sessionId: 'session:bbbbbbbb-1', presence: 'available', threadRefs: [] },
      { slot: 2, presence: 'unavailable', threadRefs: [] },
      { slot: 3, presence: 'error', threadRefs: [] },
    ]), diagnostic: { class: 'repairable', detail: 'model route refused' } } as unknown as AgentTeamClientMemberStatus
    renderDetail(status)
    const rows = document.querySelectorAll('[data-slot]')
    expect(rows[0]!.textContent).toContain('statusUnavailable: model route refused')
    expect(rows[1]!.textContent).not.toContain('model route refused')
    // Idle-ended: one idle label, no alarm.
    expect(rows[2]!.textContent).toContain('agentDetailsSlotIdle')
    expect(rows[2]!.textContent).not.toContain('statusUnavailable')
    // A failed slot with no Session still states the failure.
    expect(rows[3]!.textContent).toContain('statusError')
    expect(rows[3]!.textContent).not.toContain('model route refused')
  })

  it('shows no slot section for a single-instance seat', () => {
    renderDetail(statusWith([{ slot: 0, sessionId: 'session:aaaaaaaa-0', presence: 'available', threadRefs: [] }]))
    expect(document.querySelector('[data-team-agent-slots]')).toBeNull()
  })
})
