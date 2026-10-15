// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { AgentTeamClientMemberStatus } from '@ddvnguyen/moct-dsh-team-room/types'
import { AgentViewBody, resetAgentSessions } from '../src/client/agent-detail-views.tsx'

afterEach(() => { cleanup(); resetAgentSessions() })

const t = ((key: string, args?: Record<string, string>) => `${key}${args === undefined ? '' : JSON.stringify(args)}`) as never
const status = (over: Record<string, unknown> = {}) => ({
  member: { memberId: 'member:b', handle: 'builder', description: 'Builds', state: 'active', presetId: 'p', workspaceIds: [], sessionId: 'session:current', ...over },
  workspaceIds: ['w1'], availability: 'active', instances: [], presence: 'available', capabilityState: 'applied',
}) as unknown as AgentTeamClientMemberStatus
const navigation = { getSnapshot: () => ({ mode: 'team', workspaceId: 'w1' }), subscribe: () => () => {}, actions: () => ({}) } as never

function mount(over: { updateMember?: ReturnType<typeof vi.fn<(request: Record<string, unknown>) => Promise<unknown>>>; roster?: () => AgentTeamClientMemberStatus } = {}) {
  const updateMember = over.updateMember ?? vi.fn(async (_request: Record<string, unknown>) => ({ ok: true, value: {} }))
  const loadMembers = vi.fn(async () => ({ ok: true, value: [over.roster?.() ?? status()] }))
  const remotes = {
    loadMembers, updateMember,
    loadModels: vi.fn(async () => ({ ok: true, value: { groups: [], failures: [] } })),
    loadMemberSessions: vi.fn(async () => ({ ok: true, value: { current: null, runs: [] } })),
    resolveThreadRefs: vi.fn(async () => ({ ok: true, value: { resolved: [] } })),
    loadMemory: vi.fn(async () => ({ ok: true, value: { ok: true, value: { results: [], total: 0, nextCursor: null } } })),
    loadChannels: vi.fn(async () => ({ ok: true, value: { channels: [] } })),
    openMemberSession: vi.fn(),
  } as never
  render(<AgentViewBody tab="overview" sessionId="session:current" remotes={remotes} navigation={navigation} t={t} />)
  return { updateMember, loadMembers }
}
const form = () => document.querySelector('[data-agent-config-editor]') as HTMLFormElement
const instancesInput = () => form().querySelector('input[type="number"]') as HTMLInputElement
const save = () => [...form().querySelectorAll('button')].find(button => button.textContent === 'editSave') as HTMLButtonElement

describe('Agent Config tab edits the model and Instances (A14 i)', () => {
  it('shows the stored Instances (default 2) and keeps Save off until something changes', async () => {
    mount()
    await waitFor(() => expect(form()).not.toBeNull())
    expect(instancesInput().value).toBe('2')
    expect(instancesInput().min).toBe('1')
    expect(instancesInput().max).toBe('5')
    expect(save().disabled).toBe(true)
    fireEvent.change(instancesInput(), { target: { value: '3' } })
    expect(save().disabled).toBe(false)
    fireEvent.change(instancesInput(), { target: { value: '2' } })
    expect(save().disabled).toBe(true)
  })

  it('saves through the same update as the editor dialog and re-reads the Member', async () => {
    let stored = 2
    const updateMember = vi.fn(async (request: { instances?: number }) => { stored = request.instances ?? stored; return { ok: true, value: {} } })
    const { loadMembers } = mount({ updateMember, roster: () => status({ instances: stored }) })
    await waitFor(() => expect(form()).not.toBeNull())
    fireEvent.change(instancesInput(), { target: { value: '4' } })
    fireEvent.click(save())
    await waitFor(() => expect(updateMember).toHaveBeenCalledTimes(1))
    // Handle and description go along unchanged; the model is stated (null = follow the Host default); Instances only because it changed.
    expect(updateMember.mock.calls[0]![0]).toMatchObject({ memberId: 'member:b', handle: 'builder', description: 'Builds', model: null, instances: 4 })
    expect(typeof (updateMember.mock.calls[0]![0] as { requestId: string }).requestId).toBe('string')
    await waitFor(() => expect(loadMembers.mock.calls.length).toBeGreaterThan(1))
    await waitFor(() => expect(instancesInput().value).toBe('4'))
    expect(save().disabled).toBe(true)
  })

  it('clamps to 1..5 and reports a refusal in place without losing the edit', async () => {
    const updateMember = vi.fn(async (_request: Record<string, unknown>) => ({ ok: false, error: { message: 'seat is busy' } }))
    mount({ updateMember })
    await waitFor(() => expect(form()).not.toBeNull())
    fireEvent.change(instancesInput(), { target: { value: '9' } })
    fireEvent.blur(instancesInput())
    expect(instancesInput().value).toBe('5')
    fireEvent.click(save())
    await waitFor(() => expect(form().querySelector('[role="alert"]')?.textContent).toBe('seat is busy'))
    expect(updateMember.mock.calls[0]![0]).toMatchObject({ instances: 5 })
    expect(instancesInput().value).toBe('5')
    expect(save().disabled).toBe(false)
  })
})
