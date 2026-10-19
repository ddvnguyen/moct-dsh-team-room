// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import type { AgentTeamSessionRun, AgentTeamThreadSessionRuns } from '@ddvnguyen/moct-dsh-team-room/types'
import { runtimeWithTeam } from './harness.tsx'

vi.setConfig({ testTimeout: 30_000 })
usePinnedBrowserLanguages('zh-CN')
afterEach(() => { cleanup(); localStorage.clear() })

/** One folded Session run row, the shape the Host's threadSessions serves. */
const run = (overrides: Omit<Partial<AgentTeamSessionRun>, 'sessionId'> & { sessionId: string }): AgentTeamSessionRun => ({
  memberId: 'member:builder',
  threadRefs: ['thread:1'],
  startedAt: '2026-08-21T10:00:00.000Z',
  endedAt: '2026-08-21T10:01:00.000Z',
  turns: 1,
  tokensIn: 1200,
  unknownInputTurns: 0,
  tokensOut: 300,
  cacheReadTokens: null,
  cacheWriteTokens: null,
  reasoningTokens: null,
  toolCalls: 2,
  runMs: 60_000,
  model: null,
  lastAssistantAt: '2026-08-21T10:01:00.000Z',
  ...overrides,
  // Test literals carry plain strings; the contract brands ids and session ids.
} as AgentTeamSessionRun)

const seatRuns = (runs: { memberId: string; active: AgentTeamSessionRun | null; history: readonly AgentTeamSessionRun[] }): readonly AgentTeamThreadSessionRuns[] =>
  [runs] as unknown as readonly AgentTeamThreadSessionRuns[]

/**
 * Board 5/10: the Task (thread) detail in the Multica issue layout — the
 * header pickers and the inline title edit write the board Remotes, the
 * properties sidebar renders Claims and followers, and the execution log
 * folds the seat Session runs with their tokens, duration, model and live
 * tool, with Stop going through the dsh Session controller.
 */
describe('Team thread detail (Multica issue layout)', () => {
  const openTaskThread = async (b: Awaited<ReturnType<typeof runtimeWithTeam>>) => {
    fireEvent.click(await b.view.findByRole('button', { name: '# engineering' }))
    const [link] = await b.view.findAllByRole('button', { name: /打开 Task/ })
    fireEvent.click(link!)
    await b.view.findByText('# engineering / Task #1')
  }

  const side = (b: Awaited<ReturnType<typeof runtimeWithTeam>>) =>
    b.view.container.querySelector('[data-team-thread-side]') as HTMLElement

  it('writes status through changeTask and priority and assignee through updateTask', async () => {
    const b = await runtimeWithTeam({
      mode: 'team', workspaceId: 'w1', initialChannels: true,
      seededMessages: [{ body: 'thread opener', occurredAt: '2026-08-21T09:00:00.000Z', sender: 'agent' }],
    })
    await openTaskThread(b)

    // Status: Done accepts the Task through the ledger transition.
    fireEvent.click(within(side(b)).getByRole('button', { name: /^修改状态/ }))
    fireEvent.click(within(document.body).getByRole('menuitem', { name: '已完成' }))
    await waitFor(() => expect(b.changeTask).toHaveBeenCalledWith(expect.objectContaining({ action: 'accept' })))

    // Priority: high writes the board patch.
    fireEvent.click(within(side(b)).getByRole('button', { name: /^修改优先级/ }))
    fireEvent.click(within(document.body).getByRole('menuitem', { name: '高' }))
    await waitFor(() => expect(b.updateTask).toHaveBeenCalledWith(expect.objectContaining({ patch: { priority: 'high' } })))

    // Assignee: builder replaces Unassigned. The row's accessible name
    // concatenates the avatar's label with the handle text.
    fireEvent.click(within(side(b)).getByRole('button', { name: /^修改负责人/ }))
    const assigneeRow = within(document.body).getAllByRole('menuitem', { name: /builder/ })[0]!
    fireEvent.click(assigneeRow)
    await waitFor(() => expect(b.updateTask).toHaveBeenCalledWith(expect.objectContaining({ patch: { assignee: 'member:builder' } })))
    await b.runtime.dispose()
  })

  it('edits the Task title inline and saves it as the board title', async () => {
    const b = await runtimeWithTeam({
      mode: 'team', workspaceId: 'w1', initialChannels: true,
      seededMessages: [{ body: 'thread opener', occurredAt: '2026-08-21T09:00:00.000Z', sender: 'agent' }],
    })
    await openTaskThread(b)

    const title = document.querySelector('button[class*="issueTitle"]') as HTMLElement
    expect(title.textContent).toBe('thread opener')
    fireEvent.click(title)
    const input = document.querySelector('input[class*="titleInput"]') as HTMLInputElement
    expect(input).toBeTruthy()
    fireEvent.change(input, { target: { value: 'Ship the board' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(b.updateTask).toHaveBeenCalledWith(expect.objectContaining({ patch: { title: 'Ship the board' } })))
    await b.runtime.dispose()
  })

  it('renders the active claims and the followers in the properties sidebar', async () => {
    const b = await runtimeWithTeam({
      mode: 'team', workspaceId: 'w1', initialChannels: true,
      seedTaskStatus: 'in_progress',
      seededMessages: [{ body: 'thread opener', occurredAt: '2026-08-21T09:00:00.000Z', sender: 'agent' }],
    })
    await openTaskThread(b)
    // The reply wake carries the Claim: the passive refresh folds it into the
    // projection, and the sidebar's claim rows re-render from it.
    b.publishAgentReply()

    // Claims live behind a disclosure; expanding it reveals the claim rows.
    fireEvent.click(within(side(b)).getByRole('button', { name: /Claims/ }))
    const panel = await waitFor(() => {
      const el = side(b)
      expect(el.textContent).toContain('Implement API')
      return el
    })
    // The claim owner names the seat; the follower stack names the Human.
    expect(panel.textContent).toContain('@builder')
    expect(within(panel).getAllByText('1 位关注者').length).toBeGreaterThan(0)
    await b.runtime.dispose()
  })

  it('renders past runs with tokens, duration and model', async () => {
    const b = await runtimeWithTeam({
      mode: 'team', workspaceId: 'w1', initialChannels: true,
      seededMessages: [{ body: 'thread opener', occurredAt: '2026-08-21T09:00:00.000Z', sender: 'agent' }],
      seedThreadSessions: seatRuns({
        memberId: 'member:builder',
        active: null,
        history: [run({
          sessionId: 'session:1',
          tokensIn: 1200,
          tokensOut: 300,
          runMs: 60_000,
          model: { provider: 'deepseek', model: 'deepseek-chat' },
        })],
      }),
    })
    await openTaskThread(b)

    const log = await waitFor(() => {
      const el = document.querySelector('[data-team-execution-log]') as HTMLElement
      expect(el).toBeTruthy()
      expect(el.textContent).toContain('已完成')
      return el
    })
    expect(log.textContent).toContain('1.2k → 300')
    expect(log.textContent).toContain('1m 00s')
    expect(log.textContent).toContain('deepseek-chat')
    await b.runtime.dispose()
  })

  it('shows the live tool on the running row and stops it after a confirmation', async () => {
    const b = await runtimeWithTeam({
      mode: 'team', workspaceId: 'w1', initialChannels: true,
      seededMessages: [{ body: 'thread opener', occurredAt: '2026-08-21T09:00:00.000Z', sender: 'agent' }],
      seedThreadSessions: seatRuns({
        memberId: 'member:builder',
        active: run({ sessionId: 'session:2', endedAt: '2026-08-21T10:01:00.000Z' }),
        history: [],
      }),
    })
    await openTaskThread(b)
    b.publishActivity({ memberId: 'member:builder', handle: 'builder', threadRef: 'thread:1', current: { tool: 'bash', label: 'Edit file' } })

    const log = await waitFor(() => {
      const el = document.querySelector('[data-team-execution-log]') as HTMLElement
      expect(el.textContent).toContain('Edit file')
      return el
    })
    expect(within(log).getByRole('button', { name: '停止' })).toBeTruthy()

    // Stop is destructive: the confirm dialog stands between the click and
    // the Session controller's cancel.
    fireEvent.click(within(log).getByRole('button', { name: '停止' }))
    const dialog = await b.view.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: '停止' }))
    await waitFor(() => expect(b.sessionCancel).toHaveBeenCalledWith({ sessionId: 'session:2' }))
    await b.runtime.dispose()
  })

  it("opens the run's native session from the row", async () => {
    const b = await runtimeWithTeam({
      mode: 'team', workspaceId: 'w1', initialChannels: true,
      seededMessages: [{ body: 'thread opener', occurredAt: '2026-08-21T09:00:00.000Z', sender: 'agent' }],
      seedThreadSessions: seatRuns({
        memberId: 'member:builder',
        active: run({ sessionId: 'session:2' }),
        history: [],
      }),
    })
    await openTaskThread(b)
    const log = await waitFor(() => document.querySelector('[data-team-execution-log]') as HTMLElement)
    fireEvent.click(within(log).getByRole('button', { name: '打开会话' }))
    await waitFor(() => expect(b.openSession).toHaveBeenCalledWith('session:2'))
    await b.runtime.dispose()
  })
})
