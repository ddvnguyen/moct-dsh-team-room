/**
 * Team memory, the Human side (memory M3): what the Web Client's Memory page
 * may read and change. The backend trusts the caller's actor on its loopback
 * port, so the Host is the trust boundary here as it is for Members:
 *
 * - The actor is the ledger's Human Member, read by the Host. A request never
 *   carries an actor, a Human ref or a reader scope; the only thing it names is
 *   the Workspace the page browses, which the Host has already checked.
 * - Record verbs are a closed set. Purge names the record back (`confirm`) and
 *   is checked against the record the Host reads before the backend sees it;
 *   widen needs an explicit confirm.
 * - Settings writes are a closed set: approval mode, orchestrators (agent
 *   Members of this Workspace only) and the layer budget (inside the backend's
 *   own bounds).
 *
 * None of this is reachable from a Member tool: it is called only from the
 * Host's human `@Remote` methods.
 */
import {
  TEAM_MEMORY_HOMES, TEAM_MEMORY_STATUSES, TEAM_MEMORY_TYPES, TeamMemoryError,
  type TeamMemoryClient, type TeamMemoryGetResult, type TeamMemoryHome, type TeamMemoryJson, type TeamMemoryRecord, type TeamMemorySearchResult,
} from './team-memory.ts'
import type {
  AgentTeamMemoryAction, AgentTeamMemoryListRequest, AgentTeamMemoryOutcome, AgentTeamMemoryRecordView, AgentTeamMemorySettingsRequest,
  TeamMemoryRecordWithLinks, TeamMemorySettings, TeamMemoryUsage, TeamMemoryVersion,
} from './types/memory.ts'

const MAX_LIST = 100
const RULE_FEED_LIMIT = 50
const MEMORY_VERBS = ['approve', 'retract', 'restore', 'purge', 'widen', 'edit', 'pin'] as const

/** What the Host resolved for one Human call. Nothing here comes from the request but the checked Workspace. */
export interface TeamMemoryHumanContext {
  /** The ledger's Human Member; undefined when the ledger has none, which refuses every call. */
  readonly humanId: string | undefined
  readonly workspaceId: string
  /** Agent Members taking part in this Workspace: the only valid orchestrators, and the expert homes the page shows. */
  readonly agentMemberIds: ReadonlySet<string>
  /** The live Channel a Task's Thread sits in, for widening a task record to its Channel. */
  readonly channelOfTask: (taskRef: string) => string | undefined
}

export class TeamMemoryHuman {
  constructor(private readonly client: TeamMemoryClient) {}

  async list(context: TeamMemoryHumanContext, request: AgentTeamMemoryListRequest): Promise<TeamMemorySearchResult> {
    const params = this.readScope(context)
    if (typeof request.q === 'string' && request.q.trim() !== '') params.set('q', request.q.trim())
    if (request.types !== undefined && request.types.length > 0) params.set('types', closed(request.types, TEAM_MEMORY_TYPES, 'type').join(','))
    if (request.homes !== undefined && request.homes.length > 0) params.set('homes', closed(request.homes, TEAM_MEMORY_HOMES, 'home').join(','))
    if (request.status !== undefined) params.set('status', closed([request.status], TEAM_MEMORY_STATUSES, 'status')[0]!)
    if (request.limit !== undefined) params.set('limit', String(Math.max(1, Math.min(MAX_LIST, Math.floor(request.limit)))))
    if (typeof request.cursor === 'string' && request.cursor !== '') params.set('cursor', request.cursor)
    return this.client.request<TeamMemorySearchResult>('GET', `/team/v1/memory?${params}`, undefined)
  }

  /** One record of this Workspace (or an expert's, which belongs to none) with its links and full history. */
  async record(context: TeamMemoryHumanContext, id: string): Promise<AgentTeamMemoryRecordView> {
    const record = await this.require(context, id)
    const { versions } = await this.client.request<{ versions: TeamMemoryVersion[] }>('GET', `/team/v1/memory/${encodeURIComponent(record.id)}/versions`, undefined)
    return { record, versions }
  }

  async ruleFeed(context: TeamMemoryHumanContext): Promise<readonly TeamMemoryVersion[]> {
    this.requireHuman(context)
    const params = new URLSearchParams({ workspaceId: context.workspaceId, limit: String(RULE_FEED_LIMIT) })
    return (await this.client.request<{ versions: TeamMemoryVersion[] }>('GET', `/team/v1/memory/rule-feed?${params}`, undefined)).versions
  }

  /** Home budgets, with expert homes narrowed to this Workspace's agent Members. */
  async usage(context: TeamMemoryHumanContext): Promise<TeamMemoryUsage> {
    this.requireHuman(context)
    const usage = await this.client.request<TeamMemoryUsage>('GET', `/team/v1/memory/usage?${new URLSearchParams({ workspaceId: context.workspaceId })}`, undefined)
    return { ...usage, homes: usage.homes.filter(entry => entry.home.kind !== 'expert' || context.agentMemberIds.has(entry.home.ref)) }
  }

  async settings(context: TeamMemoryHumanContext): Promise<TeamMemorySettings> {
    this.requireHuman(context)
    return this.client.request<TeamMemorySettings>('GET', '/team/v1/memory/settings', undefined)
  }

  /** A closed set of settings, each checked here before the backend checks it again. */
  async updateSettings(context: TeamMemoryHumanContext, request: AgentTeamMemorySettingsRequest): Promise<TeamMemorySettings> {
    const humanId = this.requireHuman(context)
    const body: Record<string, unknown> = { actor: { kind: 'human', id: humanId } }
    if (request.expertApproval !== undefined) {
      if (request.expertApproval !== 'off' && request.expertApproval !== 'required') throw invalidSetting('expertApproval must be off or required')
      body['expertApproval'] = request.expertApproval
    }
    if (request.orchestrators !== undefined) {
      if (!Array.isArray(request.orchestrators)) throw invalidSetting('orchestrators must be a list of agent Members')
      const outsiders = request.orchestrators.filter(id => typeof id !== 'string' || !context.agentMemberIds.has(id))
      if (outsiders.length > 0) throw invalidSetting(`orchestrators must be agent Members of this Workspace: ${outsiders.map(String).join(', ')}`)
      body['orchestrators'] = [...new Set(request.orchestrators)]
    }
    if (request.injectLayerTokens !== undefined) {
      // The bounds are the backend's own, read from it, never a copy kept here.
      let bounds: TeamMemoryUsage['injectLayerTokens']
      try {
        bounds = (await this.client.request<TeamMemoryUsage>('GET', `/team/v1/memory/usage?${new URLSearchParams({ workspaceId: context.workspaceId })}`, undefined)).injectLayerTokens
      } catch (error) {
        throw new TeamMemoryError(503, 'BACKEND_UNAVAILABLE', `cannot read the layer budget bounds: ${error instanceof Error ? error.message : String(error)}`)
      }
      const tokens = request.injectLayerTokens
      if (!Number.isInteger(tokens) || tokens < bounds.min || tokens > bounds.max) throw invalidSetting(`injectLayerTokens must be a whole number from ${bounds.min} to ${bounds.max}`)
      body['injectLayerTokens'] = tokens
    }
    if (Object.keys(body).length === 1) throw invalidSetting('name at least one setting to change')
    return this.client.request<TeamMemorySettings>('PUT', '/team/v1/memory/settings', body)
  }

  /** One Human verb on one record of this Workspace. */
  async act(context: TeamMemoryHumanContext, id: string, action: AgentTeamMemoryAction): Promise<TeamMemoryRecord> {
    const humanId = this.requireHuman(context)
    const verb = (action as { verb?: unknown } | undefined)?.verb
    if (typeof verb !== 'string' || !(MEMORY_VERBS as readonly string[]).includes(verb)) {
      throw new TeamMemoryError(400, 'INVALID_INPUT', `verb must be one of ${MEMORY_VERBS.join(', ')}`)
    }
    // Purge names the record back. An empty confirm is refused before the backend is asked anything.
    if (action.verb === 'purge' && (typeof action.confirm !== 'string' || action.confirm.trim() === '')) {
      throw new TeamMemoryError(400, 'CONFIRM_REQUIRED', 'purge needs confirm: the record title or id')
    }
    if (action.verb === 'widen' && action.confirm !== true) {
      throw new TeamMemoryError(400, 'CONFIRM_REQUIRED', 'widen needs an explicit confirm: it changes who sees the record and when it expires')
    }
    const record = await this.require(context, id)
    const actor = { kind: 'human', id: humanId }
    const reason = typeof action.reason === 'string' && action.reason.trim() !== '' ? { reason: action.reason.trim() } : {}
    const path = `/team/v1/memory/${encodeURIComponent(record.id)}`
    switch (action.verb) {
      case 'approve':
      case 'retract':
        return this.client.request<TeamMemoryRecord>('POST', `${path}/${action.verb}`, { baseVersion: version(action.baseVersion, 'baseVersion'), actor, ...reason })
      case 'restore':
        return this.client.request<TeamMemoryRecord>('POST', `${path}/restore`, {
          version: version(action.version, 'version'), baseVersion: version(action.baseVersion, 'baseVersion'), actor, ...reason,
        })
      case 'purge': {
        const confirm = action.confirm.trim()
        if (confirm !== record.id && confirm !== (record.title ?? '').trim()) {
          throw new TeamMemoryError(400, 'CONFIRM_MISMATCH', 'purge confirm must be the record title or id exactly')
        }
        return this.client.request<TeamMemoryRecord>('POST', `${path}/purge`, { actor, ...reason })
      }
      case 'widen':
        return this.client.request<TeamMemoryRecord>('POST', `${path}/widen`, {
          to: this.widenTarget(context, record, action.to), baseVersion: version(action.baseVersion, 'baseVersion'), actor, ...reason,
        })
      case 'edit': {
        const change: Record<string, unknown> = {}
        if (typeof action.title === 'string') change['title'] = action.title
        if (typeof action.body === 'string') change['body'] = action.body
        if (Object.keys(change).length === 0) throw new TeamMemoryError(400, 'INVALID_INPUT', 'edit needs a title or a body')
        return this.client.request<TeamMemoryRecord>('PATCH', path, { baseVersion: version(action.baseVersion, 'baseVersion'), actor, ...change, ...reason })
      }
      case 'pin': {
        const change: Record<string, unknown> = {}
        if (typeof action.pinned === 'boolean') change['pinned'] = action.pinned
        if (action.priority !== undefined) {
          if (!Number.isInteger(action.priority)) throw new TeamMemoryError(400, 'INVALID_INPUT', 'priority must be a whole number')
          change['priority'] = action.priority
        }
        if (Object.keys(change).length === 0) throw new TeamMemoryError(400, 'INVALID_INPUT', 'pin needs pinned or priority')
        return this.client.request<TeamMemoryRecord>('PATCH', path, { baseVersion: version(action.baseVersion, 'baseVersion'), actor, ...change, ...reason })
      }
    }
  }

  /** The wider home's ref comes from the Session and the ledger: the Workspace, or the Channel the record's Task sits in. */
  private widenTarget(context: TeamMemoryHumanContext, record: TeamMemoryRecord, to: unknown): TeamMemoryHome {
    if (to === 'team') return { kind: 'team', ref: context.workspaceId }
    if (to === 'channel' && record.home.kind === 'task') {
      const channelRef = context.channelOfTask(record.home.ref)
      if (channelRef === undefined) throw new TeamMemoryError(409, 'SCOPE_FORBIDDEN', 'the Task this record lives in has no live Channel in this Workspace')
      return { kind: 'channel', ref: channelRef }
    }
    throw new TeamMemoryError(400, 'INVALID_INPUT', `cannot widen a ${record.home.kind} record to ${String(to)}: widen to the team, or a task record to its channel`)
  }

  private requireHuman(context: TeamMemoryHumanContext): string {
    if (context.humanId === undefined) throw new TeamMemoryError(403, 'NO_HUMAN', 'the Team has no Human Member yet: memory changes need one')
    return context.humanId
  }

  /** The Human reads the whole Workspace; the reader id is the Human's own. */
  private readScope(context: TeamMemoryHumanContext): URLSearchParams {
    return new URLSearchParams({ workspaceId: context.workspaceId, expertId: this.requireHuman(context), all: '1' })
  }

  /** A record this Workspace's reader can see, read back by the Host; another Workspace's id is missing. */
  private async require(context: TeamMemoryHumanContext, id: unknown): Promise<TeamMemoryRecordWithLinks> {
    if (typeof id !== 'string' || id.trim() === '') throw new TeamMemoryError(400, 'INVALID_INPUT', 'id must name a record')
    const found = await this.client.request<TeamMemoryGetResult>('POST', `/team/v1/memory/get?${this.readScope(context)}`, { ids: [id] })
    const record = found.records[0]
    if (record === undefined || record.id !== id) throw new TeamMemoryError(404, 'NOT_FOUND', `no memory record ${id} in this Workspace`)
    return { ...record, links: record.links ?? [] }
  }
}

/** Run one Human memory call and carry a refusal's stable code to the Client. */
export async function memoryOutcome<T>(run: () => Promise<T>): Promise<AgentTeamMemoryOutcome<T>> {
  try {
    return { ok: true, value: await run() }
  } catch (error) {
    if (error instanceof TeamMemoryError) {
      return { ok: false, code: error.code ?? 'REFUSED', message: error.message, ...(error.details === undefined ? {} : { details: error.details as TeamMemoryJson }) }
    }
    throw error
  }
}

function closed<T extends string>(values: readonly unknown[], allowed: readonly T[], label: string): T[] {
  for (const value of values) {
    if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) throw new TeamMemoryError(400, 'INVALID_INPUT', `${label} must be one of ${allowed.join(', ')}`)
  }
  return [...new Set(values as T[])]
}

function version(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) throw new TeamMemoryError(400, 'INVALID_INPUT', `${label} must be the version you were shown`)
  return value
}

function invalidSetting(message: string): TeamMemoryError {
  return new TeamMemoryError(400, 'INVALID_SETTING', message)
}

