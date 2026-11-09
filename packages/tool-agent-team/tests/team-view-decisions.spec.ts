import { describe, expect, it } from 'vitest'
import { renderText, teamTools } from './render-text.ts'

const WORKSPACE = 'workspace:alpha'
const CHANNEL = 'channel:046dd831-c679-4279-b6aa-7813476cf12e'
const THREAD = 'thread:c98c24b1-2b37-4eb3-abf8-4137bc994b4e'
const TASK = 'task:3245ad40-43fd-4191-a416-7dcaf3a340f2'
const ANN = 'member:agent-ann'
const HUMAN = 'member:human'

interface DecisionRow { readonly recordRef: string; readonly decided: string; readonly rationale: string; readonly decidedAt: string }

function record(index: number, decided = `Decision ${index}`, supersedes?: string) {
  return {
    recordRef: `decisionRecord:${index}`, taskRef: TASK, decidedBy: HUMAN, decided, rationale: `why ${index}`,
    decidedAt: `2026-10-2${index % 10}T10:00:00.000Z`, source: { kind: 'ask', decisionRef: `decision:${index}`, messageRef: `message:${index}` },
    ...(supersedes === undefined ? {} : { supersedes }),
  }
}

/** A Host stub answering the directory read plus the Session's current-Task decision read. */
function session(options: { readonly taskRef?: string | undefined; readonly records?: readonly unknown[] } = {}) {
  const host = {
    workspacesForAgent: () => [{ workspaceId: WORKSPACE, default: true }],
    humanHandle: () => 'Ddv',
    memberForAgent: () => ({ memberId: ANN, handle: 'ann', description: 'builder' }),
    members: () => [
      { member: { memberId: ANN, handle: 'ann', description: 'builder' }, presence: 'available',
        instances: [{ slot: 0, sessionId: 'agent-1', presence: 'available', threadRefs: [THREAD] }] },
    ],
    resolveThreadRefs: () => ({ resolved: [{ threadRef: THREAD, channelRef: CHANNEL, ...(options.taskRef === undefined ? {} : { taskRef: options.taskRef }) }] }),
    decisionRecords: () => ({ records: options.records ?? [] }),
    viewForAgent: () => ({
      humanMemberId: HUMAN,
      workspaces: [{ workspaceId: WORKSPACE, default: true }],
      channels: [{ channelRef: CHANNEL, name: 'room' }],
      members: [{ channelRef: CHANNEL, memberId: ANN }, { channelRef: CHANNEL, memberId: HUMAN }],
      tasks: [{ taskRef: TASK, threadRef: THREAD, channelRef: CHANNEL, status: 'in_progress' }],
      threads: [{ threadRef: THREAD, channelRef: CHANNEL, revision: 12, taskRef: TASK }],
      items: [],
      taskNumbers: [{ taskRef: TASK, taskNumber: 7 }],
      activeTaskThreads: [],
      claims: [], activities: [], cursor: 0, hasMore: false,
    }),
  }
  const agent = { id: 'agent-1', ctx: { get: (name: string) => name === 'agentTeam' ? host : undefined } }
  return { exec: { agent, callId: 'call-1', signal: new AbortController().signal } as never }
}

async function view(exec: never): Promise<{ decisions: readonly DecisionRow[] }> {
  const tool = teamTools().get('team_view')!
  return await tool.execute({}, exec) as never
}

describe('team_view owner decisions', () => {
  it('returns the Task\'s current Owner decisions, superseded records excluded, oldest first', async () => {
    const { exec } = session({ taskRef: TASK, records: [
      record(1, 'Approved plan "First plan"'),
      record(2, 'Approved plan "Second plan"', 'decisionRecord:1'),
      record(3, 'Thursday'),
    ] })
    const value = await view(exec)
    expect(value.decisions.map(decision => decision.recordRef)).toEqual(['decisionRecord:2', 'decisionRecord:3'])
    expect(value.decisions.map(decision => decision.decided)).toEqual(['Approved plan "Second plan"', 'Thursday'])
  })

  it('caps the section at the newest ten', async () => {
    const { exec } = session({ taskRef: TASK, records: Array.from({ length: 13 }, (_value, index) => record(index + 1)) })
    const value = await view(exec)
    expect(value.decisions).toHaveLength(10)
    expect(value.decisions[0]!.recordRef).toBe('decisionRecord:4')
  })

  it('answers an empty array when the Thread carries no Task or the Owner decided nothing', async () => {
    expect((await view(session({ taskRef: undefined, records: [record(1)] }).exec)).decisions).toEqual([])
    expect((await view(session({ taskRef: TASK }).exec)).decisions).toEqual([])
  })

  it('renders the decisions section with each record ref, and omits it when empty', async () => {
    const { exec } = session({ taskRef: TASK, records: [record(2, 'Approved plan "Second plan"', 'decisionRecord:1'), record(3, 'Thursday')] })
    const tool = teamTools().get('team_view')!
    const rendered = renderText(tool, {}, await view(exec))
    expect(rendered).toContain('Owner decisions — current on the Task you are working in, newest last')
    expect(rendered).toContain('decisionRecord:3 · Thursday — because why 3')
    expect(rendered).not.toContain('decisionRecord:1 ·')

    const empty = renderText(tool, {}, await view(session({ taskRef: undefined }).exec))
    expect(empty).not.toContain('Owner decisions')
  })
})
