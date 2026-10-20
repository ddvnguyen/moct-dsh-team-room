import { describe, expect, it } from 'vitest'
import { teamTools } from './render-text.ts'

/**
 * The Orchestrator's report-only contract, enforced by the tools themselves:
 * a surface that predates the role (a Session composed before the Member was
 * given the role) must still refuse the mutation-capable calls.
 */

const WORKSPACE = 'workspace:alpha'
const ANN = 'member:agent-ann'
const TASK = 'task:3245ad40-43fd-4191-a416-7dcaf3a340f2'
const THREAD = 'thread:d78400e4-4925-4065-87b1-3f81b4a4b5fb'
const CHANNEL = 'channel:046dd831-c679-4279-b6aa-7813476cf12e'

type Role = 'orchestrator' | 'worker'

/** A fake Host that records the mutation calls the Orchestrator must never reach. */
function session(role: Role) {
  const calls: Array<{ readonly method: string; readonly request: Record<string, unknown> }> = []
  const host = {
    workspacesForAgent: () => [{ workspaceId: WORKSPACE }],
    memberForAgent: () => ({ memberId: ANN, handle: 'ann', role }),
    humanHandle: () => 'Ddv',
    listClaimsForAgent: (_agent: unknown, request: Record<string, unknown>) => {
      calls.push({ method: 'listClaims', request })
      return { task: { taskRef: TASK, status: 'in_progress' }, thread: { threadRef: THREAD, revision: 12 }, claims: [] }
    },
    sendMessageForAgent: async (_agent: unknown, request: Record<string, unknown>) => {
      calls.push({ method: 'sendMessage', request })
      return { kind: 'committed', receipt: {}, message: { messageRef: 'message:a' }, thread: { threadRef: THREAD, revision: 13 } }
    },
  }
  const agent = { id: 'agent-1', ctx: { get: (name: string) => name === 'agentTeam' ? host : undefined } }
  return { calls, exec: { agent, callId: 'call-1', signal: new AbortController().signal } as never }
}

async function run(name: string, args: Record<string, unknown>, exec: never): Promise<unknown> {
  const tool = teamTools().get(name)!
  return tool.execute(args, exec)
}

describe('the Orchestrator reports and never acts', () => {
  it('refuses a Claim from an Orchestrator', async () => {
    const { calls, exec } = session('orchestrator')
    await expect(run('team_claim', { action: 'list', taskRef: TASK }, exec)).rejects.toThrow(/never claim/i)
    expect(calls).toEqual([])
  })

  it('refuses a Task-creating message from an Orchestrator', async () => {
    const { calls, exec } = session('orchestrator')
    await expect(run('team_message', { action: 'start', channelRef: CHANNEL, body: 'Digest', asTask: true }, exec)).rejects.toThrow(/only report/i)
    expect(calls).toEqual([])
  })

  it('leaves the same calls available to a Member without the role', async () => {
    const { calls, exec } = session('worker')
    await run('team_claim', { action: 'list', taskRef: TASK }, exec)
    await run('team_message', { action: 'start', channelRef: CHANNEL, body: 'Digest', asTask: true }, exec)
    expect(calls.map(call => call.method)).toEqual(['listClaims', 'sendMessage'])
  })
})
