import { describe, expect, it } from 'vitest'
import { renderText, teamTools } from './render-text.ts'

const WORKSPACE = 'workspace:alpha'
const THREAD = 'thread:c98c24b1-2b37-4eb3-abf8-4137bc994b4e'
const TASK = 'task:9a1f2c3d-4b5e-4f60-8a9b-0c1d2e3f4a5b'
const DOC = 'doc:5f0e1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b'
const ANN = 'member:agent-ann'

/** A fake Host that records what team_plan hands it; the actor is the calling seat, never an argument. */
function session() {
  const calls: Array<{ readonly method: string; readonly request: Record<string, unknown> }> = []
  const record = (method: string) => (_agent: unknown, request: Record<string, unknown>) => {
    calls.push({ method, request })
    return request
  }
  const host = {
    workspacesForAgent: () => [{ workspaceId: WORKSPACE }],
    members: () => [{ member: { memberId: ANN, handle: 'ann' } }],
    humanHandle: () => 'Ddv',
    createPlanForAgent: async (agent: unknown, request: Record<string, unknown>) => {
      record('create')(agent, request)
      return { receipt: {}, doc: { docRef: DOC, channelRef: 'channel:room', threadRef: THREAD, taskRef: TASK, author: ANN,
        title: request['title'], createdAtSequence: 10 }, revision: 10,
      sections: (request['outline'] as string[]).map((heading, index) => ({ sectionId: `s${index + 1}`, heading, markdown: '' })) }
    },
    writeDocSectionForAgent: async (agent: unknown, request: Record<string, unknown>) => {
      record('write')(agent, request)
      return request['baseDocRevision'] === 12
        ? { kind: 'committed', receipt: {}, docRef: DOC, section: { sectionId: 's3', heading: request['heading'], markdown: request['markdown'] }, revision: 16 }
        : { kind: 'stale_doc_revision', docRef: DOC, expectedRevision: request['baseDocRevision'], revision: 12 }
    },
    submitDocForAgent: async (agent: unknown, request: Record<string, unknown>) => {
      record('submit')(agent, request)
      return { kind: 'committed', receipt: {}, message: { messageRef: 'message:s' }, thread: { threadRef: THREAD },
        notice: { docRef: DOC, event: 'submitted', docRevision: request['docRevision'] } }
    },
    planStatusForAgent: async (agent: unknown, request: Record<string, unknown>) => {
      record('status')(agent, request)
      return { taskRef: TASK,
        plan: { docRef: DOC, title: 'Release plan', status: 'approved', revision: 12 },
        description: { source: 'approvedPlan', planRef: DOC, revision: 1 } }
    },
    docForAgent: () => ({ doc: { docRef: DOC, channelRef: 'channel:room', threadRef: THREAD, author: ANN, title: 'Release plan', createdAtSequence: 10 },
      status: 'approved', revision: 12, submittedRevision: 12, updatedAt: '', sections: [], comments: [], reviews: [] }),
    waitInThreadForAgent: async (_agent: unknown, request: Record<string, unknown>, settled: () => unknown, timeoutMs: number) => {
      record('wait')(_agent, { ...request, timeoutMs })
      return settled()
    },
  }
  const agent = { id: 'agent-1', ctx: { get: (name: string) => name === 'agentTeam' ? host : undefined } }
  return { calls, exec: { agent, callId: 'call-1' } as never }
}

async function run(args: Record<string, unknown>, exec: never): Promise<string> {
  const tool = teamTools().get('team_plan')!
  return renderText(tool, args, await tool.execute(args, exec))
}

describe('team_plan', () => {
  it('creates a plan on a Task and renders the revision the first write needs', async () => {
    const { calls, exec } = session()
    const text = await run({ action: 'create', taskRef: TASK, title: 'Release plan', outline: ['Goal', 'Steps'], actor: 'member:forged' }, exec)
    expect(calls[0]!.request).toEqual({ requestId: 'agent-team:tool:agent-1:call-1', workspaceId: WORKSPACE, taskRef: TASK,
      title: 'Release plan', outline: ['Goal', 'Steps'] })
    expect(text).toContain(`Committed — plan created for ${TASK}: ${DOC} "Release plan"`)
    expect(text).toContain('[s2] Steps (empty)')
    expect(text).toContain('Doc revision 10')
  })

  it('renders a stale write as nothing written, with the way back', async () => {
    const { exec } = session()
    const stale = await run({ action: 'write', docRef: DOC, baseDocRevision: 10, heading: 'Risks', markdown: 'None.' }, exec)
    expect(stale).toContain('Not written')
    expect(stale).toContain('team_doc read')
    const written = await run({ action: 'write', docRef: DOC, baseDocRevision: 12, heading: 'Risks', markdown: 'None.' }, exec)
    expect(written).toContain(`Committed — wrote [s3] Risks in ${DOC}`)
  })

  it('submits the plan and reads the verdict back', async () => {
    const { exec } = session()
    const text = await run({ action: 'submit', docRef: DOC, docRevision: 12, waitMinutes: 0 }, exec)
    expect(text).toContain('submitted for review')
    expect(text).toContain('Do not act on the plan before it is approved')
  })

  it('reports the plan of a Task and whether it became the description', async () => {
    const { calls, exec } = session()
    const text = await run({ action: 'status', taskRef: TASK }, exec)
    expect(calls[0]!.request).toEqual({ workspaceId: WORKSPACE, taskRef: TASK })
    expect(text).toContain(`Plan ${DOC} "Release plan" — approved — final — revision 12.`)
    expect(text).toContain('promoted from the approved plan')
  })

  it('refuses an action without the arguments it needs', async () => {
    const { exec } = session()
    await expect(run({ action: 'create', title: 'No Task' }, exec)).rejects.toThrow(/create requires taskRef and title/)
    await expect(run({ action: 'status' }, exec)).rejects.toThrow(/status requires taskRef/)
  })
})
