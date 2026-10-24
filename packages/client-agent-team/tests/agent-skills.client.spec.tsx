// @vitest-environment jsdom
//
// The Agent page's Skills tab: one read answers the Member's whole catalog and
// the selection stored on the Member, and the only write is the ordinary
// `updateMember` capabilities seam. The tab is never optimistic — the checkbox
// the reader pressed is not the source of truth, the Host's answer is.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AgentTeamClientMemberStatus } from '@ddvnguyen/moct-dsh-team-room/types'
import { TeamAgentDetail } from '../src/client/TeamAgentDetail.tsx'

afterEach(cleanup)

const t = ((key: string) => key) as never
const ok = <T,>(value: T) => ({ ok: true as const, value })

const status = (extra: Record<string, unknown> = {}): AgentTeamClientMemberStatus => ({
  member: {
    memberId: 'member:skills',
    sessionId: 'session:skills',
    handle: '@curator',
    description: 'Curates skills',
    state: 'active',
    presetId: 'team-member',
    workspaceIds: ['w1'],
    ...extra,
  },
  instances: [],
  workspaceIds: ['w1'],
  availability: 'active',
  presence: 'available',
  capabilityState: 'applied',
} as unknown as AgentTeamClientMemberStatus)

const CATALOG = {
  skills: [
    { name: 'architect', description: 'Designs changes', origin: 'private' as const },
    { name: 'member-skill-manager', description: 'Manages private skills', origin: 'bundled' as const },
  ],
  allow: null as readonly string[] | null,
}

function mountSkills(options: { readonly allow?: readonly string[] | null; readonly updateMember?: (request: unknown) => unknown; readonly member?: Record<string, unknown> } = {}) {
  const loadMemberSkills = vi.fn(async () => ok({ skills: CATALOG.skills, allow: options.allow === undefined ? null : options.allow }))
  const updateMember = vi.fn(options.updateMember ?? (async () => ok({ receipt: { operationId: 'op' } })))
  render(<TeamAgentDetail
    workspaceId={'w1' as never}
    status={status(options.member)}
    only="skills"
    loadMemberSessions={vi.fn(async () => ok({ current: null, runs: [] })) as never}
    resolveThreadRefs={vi.fn(async () => ok([])) as never}
    loadMemory={vi.fn(async () => ok({ ok: true, value: { results: [], total: 0, nextCursor: null } })) as never}
    loadChannels={vi.fn(async () => ok({ channels: [] })) as never}
    openMemberSession={vi.fn() as never}
    loadMemberSkills={loadMemberSkills as never}
    updateMember={updateMember as never}
    t={t}
  />)
  return { loadMemberSkills, updateMember }
}

const rowInput = (name: string): HTMLInputElement =>
  document.querySelector<HTMLInputElement>(`[data-agent-skill="${name}"] input`)!

describe('the Agent page Skills tab', () => {
  it('lists the whole catalog with each skill origin and starts on load-everything', async () => {
    mountSkills()
    await waitFor(() => expect(document.querySelector('[data-agent-skill="architect"]')).not.toBeNull())
    expect(document.querySelector('[data-agent-skill="architect"] [data-origin]')?.textContent).toBe('agentSkillsPrivate')
    expect(document.querySelector('[data-agent-skill="member-skill-manager"] [data-origin]')?.textContent).toBe('agentSkillsBundled')
    // Load-everything: the master box is on and every row is shown as included.
    const master = document.querySelector<HTMLInputElement>('[data-agent-skills] input[type="checkbox"]')!
    expect(master.checked).toBe(true)
    expect(rowInput('architect').checked).toBe(true)
    expect(rowInput('architect').disabled).toBe(true)
    // Nothing to save until the reader changes something.
    expect((screen.getByRole('button', { name: 'agentSkillsSave' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('writes an explicit list on the first exclusion and keeps the stored tools override', async () => {
    const { updateMember, loadMemberSkills } = mountSkills({ member: { capabilities: { tools: { allow: ['read'] } } } })
    await waitFor(() => expect(document.querySelector('[data-agent-skill="architect"]')).not.toBeNull())
    fireEvent.click(rowInput('architect'))
    // The un-tick leaves load-everything: the selection now names the rest.
    expect(rowInput('architect').checked).toBe(false)
    expect((screen.getByRole('button', { name: 'agentSkillsSave' }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'agentSkillsSave' }))
    await waitFor(() => expect(updateMember).toHaveBeenCalledTimes(1))
    expect(updateMember.mock.calls[0]![0]).toMatchObject({
      memberId: 'member:skills',
      handle: '@curator',
      description: 'Curates skills',
      capabilities: { tools: { allow: ['read'] }, skills: { allow: ['member-skill-manager'] } },
    })
    // Non-optimistic: the page re-reads the Host's answer after the commit.
    await waitFor(() => expect(loadMemberSkills).toHaveBeenCalledTimes(2))
  })

  it('shows a stored selection and clears it back to load-everything', async () => {
    const { updateMember } = mountSkills({ allow: ['architect'] })
    await waitFor(() => expect(document.querySelector('[data-agent-skill="architect"]')).not.toBeNull())
    expect(rowInput('architect').checked).toBe(true)
    expect(rowInput('member-skill-manager').checked).toBe(false)
    expect(document.querySelector<HTMLInputElement>('[data-agent-skills] input[type="checkbox"]')!.checked).toBe(false)
    fireEvent.click(document.querySelector<HTMLInputElement>('[data-agent-skills] input[type="checkbox"]')!)
    fireEvent.click(screen.getByRole('button', { name: 'agentSkillsSave' }))
    await waitFor(() => expect(updateMember).toHaveBeenCalledTimes(1))
    expect(updateMember.mock.calls[0]![0]).toMatchObject({ capabilities: {} })
  })

  it('keeps the reader error instead of claiming the selection was stored', async () => {
    const { updateMember } = mountSkills({ updateMember: async () => ({ ok: false, error: { message: 'revision moved' } }) })
    await waitFor(() => expect(document.querySelector('[data-agent-skill="architect"]')).not.toBeNull())
    fireEvent.click(rowInput('architect'))
    fireEvent.click(screen.getByRole('button', { name: 'agentSkillsSave' }))
    await waitFor(() => expect(document.querySelector('[data-agent-skills] [role="alert"]')?.textContent).toBe('revision moved'))
    expect(updateMember).toHaveBeenCalledTimes(1)
    // The reader's draft survives the refusal, so the retry sends the same intent.
    expect(rowInput('architect').checked).toBe(false)
  })
})
