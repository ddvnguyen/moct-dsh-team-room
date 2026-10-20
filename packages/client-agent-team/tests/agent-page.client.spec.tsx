// @vitest-environment jsdom
//
// A14 Agent pages: the roster row answers "what is this Agent doing right
// now", and the detail page makes that answer actionable — Chat opens the
// Agent's Session, Stop cancels every Session it is running. Both surfaces
// read the same live snapshot (`memberActivity`) and the same board catalog
// (`view`), so the row and the header cannot disagree.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type {
  AgentTeamClientMemberStatus,
  AgentTeamMemberActivity,
  AgentTeamSessionRun,
  AgentTeamView,
} from '@ddvnguyen/moct-dsh-team-room/types'
import { TeamAgentsPanel } from '../src/client/TeamAgentsPanel.tsx'
import { TeamAgentDetail } from '../src/client/TeamAgentDetail.tsx'

afterEach(cleanup)

const t = ((key: string, args?: Record<string, string>) => `${key}${args === undefined ? '' : JSON.stringify(args)}`) as never
const ok = <T,>(value: T) => ({ ok: true as const, value })

const member = (id: string, handle: string, extra: Record<string, unknown> = {}): AgentTeamClientMemberStatus => ({
  member: {
    memberId: id,
    sessionId: `session:${id}`,
    handle,
    description: '',
    state: 'active',
    presetId: 'team-member',
    workspaceIds: [],
    ...extra,
  },
  instances: [],
  workspaceIds: ['w1'],
  availability: 'active',
  presence: 'available',
  capabilityState: 'applied',
} as unknown as AgentTeamClientMemberStatus)

const run = (sessionId: string, startedAt: string, tokensIn: number, tokensOut: number): AgentTeamSessionRun => ({
  sessionId,
  memberId: 'member:b',
  threadRefs: [],
  startedAt,
  endedAt: startedAt,
  turns: 2,
  tokensIn,
  unknownInputTurns: 0,
  tokensOut,
  cacheReadTokens: null,
  cacheWriteTokens: null,
  reasoningTokens: null,
  toolCalls: 3,
  runMs: 61_000,
  model: { provider: 'deepseek', model: 'deepseek-chat' },
  lastAssistantAt: startedAt,
} as unknown as AgentTeamSessionRun)

const view = (tasks: AgentTeamView['tasks'], claims: AgentTeamView['claims'] = []): AgentTeamView => ({
  humanMemberId: 'member:human',
  workspaces: [],
  channels: [{ channelRef: 'channel:eng', name: 'engineering' }],
  members: [],
  tasks,
  threads: [],
  taskNumbers: tasks.map((task, index) => ({ taskRef: task.taskRef, taskNumber: index + 1 })),
  items: [],
  activeTaskThreads: [],
  claims,
  activities: [],
  cursor: 0,
  hasMore: false,
} as unknown as AgentTeamView)

const activity = (memberId: string, label: string, threadRef?: string): AgentTeamMemberActivity => ({
  memberId,
  handle: `@${memberId}`,
  ...(threadRef === undefined ? {} : { threadRef }),
  turnStartedAt: new Date().toISOString(),
  stepCount: 3,
  toolCount: 2,
  current: { tool: 'bash', label },
  updatedAt: new Date().toISOString(),
} as unknown as AgentTeamMemberActivity)

function mountPanel(options: {
  readonly members: readonly AgentTeamClientMemberStatus[]
  readonly activities?: readonly AgentTeamMemberActivity[]
  readonly board?: AgentTeamView
  readonly runs?: Readonly<Record<string, readonly AgentTeamSessionRun[]>>
}) {
  return render(<TeamAgentsPanel
    workspaceId={'w1' as never}
    loadMembers={vi.fn(async () => ok(options.members)) as never}
    subscribeChanges={(() => () => {}) as never}
    addMember={vi.fn() as never}
    updateMember={vi.fn() as never}
    recoverMember={vi.fn() as never}
    archiveMember={vi.fn() as never}
    joinWorkspace={vi.fn() as never}
    leaveWorkspace={vi.fn() as never}
    loadModels={vi.fn(async () => ok([])) as never}
    loadMemberActivity={vi.fn(async () => ok({ revision: 1, activities: options.activities ?? [] })) as never}
    {...(options.board === undefined ? {} : { loadBoard: vi.fn(async () => ok(options.board!)) as never })}
    loadMemberSessions={vi.fn(async (request: { memberId: string }) => ok({ current: null, runs: options.runs?.[request.memberId] ?? [] })) as never}
    openMemberSession={vi.fn() as never}
    openAgentDetail={vi.fn() as never}
    onCreatingChange={vi.fn() as never}
    t={t}
  />)
}

function mountDetail(options: {
  readonly status: AgentTeamClientMemberStatus
  readonly activities?: readonly AgentTeamMemberActivity[]
  readonly board?: AgentTeamView
  readonly runs?: readonly AgentTeamSessionRun[]
  readonly failures?: readonly never[]
  readonly stopSession?: ReturnType<typeof vi.fn>
  readonly openMemberSession?: ReturnType<typeof vi.fn>
  readonly openThread?: ReturnType<typeof vi.fn>
}) {
  return render(<TeamAgentDetail
    workspaceId={'w1' as never}
    status={options.status}
    loadMemberSessions={vi.fn(async () => ok({ current: null, runs: options.runs ?? [] })) as never}
    resolveThreadRefs={vi.fn(async () => ok([])) as never}
    loadMemory={vi.fn(async () => ok({ ok: true, value: { results: [], total: 0, nextCursor: null } })) as never}
    loadChannels={vi.fn(async () => ok({ channels: [] })) as never}
    openMemberSession={(options.openMemberSession ?? vi.fn()) as never}
    {...(options.openThread === undefined ? {} : { openThread: options.openThread as never })}
    {...(options.board === undefined ? {} : { loadBoard: vi.fn(async () => ok(options.board!)) as never })}
    loadMemberActivity={vi.fn(async () => ok({ revision: 1, activities: options.activities ?? [] })) as never}
    subscribeChanges={(() => () => {}) as never}
    threadTurnFailures={vi.fn(async () => ok(options.failures ?? [])) as never}
    {...(options.stopSession === undefined ? {} : { stopSession: options.stopSession as never })}
    t={t}
  />)
}

describe('the Agents list row', () => {
  it('shows the role pill and the live current tool beside the current Task', async () => {
    mountPanel({
      members: [member('member:b', '@builder', { role: 'worker' })],
      activities: [activity('member:b', 'Running tests')],
      board: view([{ taskRef: 'task:1', channelRef: 'channel:eng', threadRef: 'thread:1', status: 'in_progress', resolution: 'open', title: 'Fix login', assignee: 'member:b' } as never]),
    })
    await waitFor(() => expect(document.querySelector('[data-agent-handle]')?.textContent).toBe('builder'))
    expect(document.querySelector('[data-member-role="worker"]')?.textContent).toBe('roleWorker')
    expect(document.querySelector('[data-agent-current-tool]')?.textContent).toBe('Running tests')
    expect(document.querySelector('[data-agent-current-task]')?.textContent).toContain('#1')
    expect(document.querySelector('[data-agent-current-task]')?.textContent).toContain('Fix login')
  })

  it('filters the roster by presence', async () => {
    mountPanel({
      members: [member('member:a', '@alpha'), { ...member('member:b', '@beta'), presence: 'unavailable', availability: 'unavailable' } as never],
    })
    await waitFor(() => expect(document.querySelectorAll('[data-agent-handle]')).toHaveLength(2))
    fireEvent.change(screen.getByLabelText('agentFilterPresence'), { target: { value: 'offline' } })
    await waitFor(() => expect(document.querySelectorAll('[data-agent-handle]')).toHaveLength(1))
    expect(document.querySelector('[data-agent-handle]')?.textContent).toBe('beta')
    expect(document.querySelector('[data-agent-list-count]')?.textContent).toContain('"visible":"1"')
  })
})

describe('the Agent detail header', () => {
  it('names the current Task and the current tool', async () => {
    mountDetail({
      status: member('member:b', '@builder'),
      activities: [activity('member:b', 'Editing BoardCard.tsx', 'thread:1')],
      board: view([{ taskRef: 'task:1', channelRef: 'channel:eng', threadRef: 'thread:1', status: 'in_progress', resolution: 'open', title: 'Fix login', assignee: 'member:b' } as never]),
    })
    await waitFor(() => expect(document.querySelector('[data-agent-current-task]')?.textContent).toContain('Fix login'))
    expect(document.querySelector('[data-agent-current-task]')?.textContent).toContain('#1')
    expect(document.querySelector('[data-agent-current-tool]')?.textContent).toBe('Editing BoardCard.tsx')
  })

  it('disables Stop while the Agent is idle', async () => {
    mountDetail({ status: member('member:b', '@builder'), stopSession: vi.fn() })
    const stop = await waitFor(() => {
      const button = document.querySelector('[data-agent-stop]') as HTMLButtonElement | null
      expect(button).not.toBeNull()
      return button!
    })
    expect(stop.disabled).toBe(true)
  })

  it('confirms, then cancels slot 0 and every busy instance once', async () => {
    const stopSession = vi.fn(async () => ok({ accepted: true as const }))
    mountDetail({
      status: {
        ...member('member:b', '@builder'),
        presence: 'working',
        instances: [
          { slot: 0, sessionId: 'session:member:b', presence: 'working', threadRefs: [] },
          { slot: 1, sessionId: 'session:side', presence: 'working', threadRefs: [] },
          { slot: 2, sessionId: 'session:idle', presence: 'available', threadRefs: [] },
        ],
      } as never,
      stopSession,
    })
    const stop = await waitFor(() => {
      const button = document.querySelector('[data-agent-stop]') as HTMLButtonElement | null
      expect(button?.disabled).toBe(false)
      return button!
    })
    fireEvent.click(stop)
    fireEvent.click(await screen.findByText('agentStopConfirm'))
    await waitFor(() => expect(stopSession).toHaveBeenCalledTimes(2))
    expect(stopSession.mock.calls.map(call => (call as unknown as [string])[0]).sort())
      .toEqual(['session:member:b', 'session:side'])
  })

  it('opens the Member Session from Chat', async () => {
    const openMemberSession = vi.fn()
    mountDetail({ status: member('member:b', '@builder'), openMemberSession })
    fireEvent.click(await waitFor(() => {
      const button = document.querySelector('[data-agent-chat]')
      expect(button).not.toBeNull()
      return button!
    }))
    expect(openMemberSession).toHaveBeenCalledWith('session:member:b', expect.any(Function))
  })
})

describe('the Agent detail tabs', () => {
  const today = new Date().toISOString()

  it('paints the Runs table and its 14-day token sparkline', async () => {
    mountDetail({
      status: member('member:b', '@builder'),
      runs: [run('session:a', today, 1_200, 300), run('session:b', today, 800, 200)],
    })
    fireEvent.click(await waitFor(() => {
      const tab = document.getElementById('agent-detail-tab-runs')
      expect(tab).not.toBeNull()
      return tab!
    }))
    await waitFor(() => expect(document.querySelectorAll('[data-agent-runs-table] tbody[data-session-id]')).toHaveLength(2))
    const chart = document.querySelector('[data-agent-runs-chart] [role="img"]')
    expect(chart?.getAttribute('aria-label')).toContain('2.5k')
    expect(document.querySelector('[data-agent-runs]')?.textContent).toContain('agentRunsTotals')
  })

  it('groups the Member Tasks by status with the compact board card', async () => {
    mountDetail({
      status: member('member:b', '@builder'),
      board: view([
        { taskRef: 'task:1', channelRef: 'channel:eng', threadRef: 'thread:1', status: 'todo', resolution: 'open', title: 'Write docs', assignee: 'member:b' } as never,
        { taskRef: 'task:2', channelRef: 'channel:eng', threadRef: 'thread:2', status: 'in_progress', resolution: 'open', title: 'Fix login', assignee: 'member:b' } as never,
      ]),
    })
    fireEvent.click(await waitFor(() => {
      const tab = document.getElementById('agent-detail-tab-tasks')
      expect(tab).not.toBeNull()
      return tab!
    }))
    await waitFor(() => expect(document.querySelectorAll('[data-task-group]')).toHaveLength(2))
    expect(document.querySelector('[data-task-group="todo"]')?.textContent).toContain('Write docs')
    expect(document.querySelector('[data-task-group="in_progress"]')?.textContent).toContain('Fix login')
    expect(document.querySelectorAll('[data-board-card-compact]')).toHaveLength(2)
  })
})
