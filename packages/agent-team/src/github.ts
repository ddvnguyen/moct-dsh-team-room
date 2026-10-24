/**
 * The GitHub mirror: GitHub Issues (and, when a project is bound, the project's
 * `Status` field) are the store; the board and the issue view read them here.
 *
 * This module is deliberately outside the ledger. An issue is not a Task and a
 * comment is not a Message: the Team's append-only operation log stays the
 * Team's only authority, and nothing here writes to it. A read answers what
 * GitHub holds right now; a write goes to GitHub, and the caller re-reads.
 *
 * Configuration is the deployment's, not a Human's, so it is read from the
 * environment at every call: `DSH_AGENT_TEAM_GITHUB_REPO=owner/repo`, a token
 * in `DSH_AGENT_TEAM_GITHUB_TOKEN` (falling back to `GITHUB_TOKEN`), an
 * optional `DSH_AGENT_TEAM_GITHUB_PROJECT=<number>`, and an optional
 * `DSH_AGENT_TEAM_GITHUB_API` for GitHub Enterprise Server.
 *
 * Everything is one capped page. A repo with more than 100 issues reports
 * `truncated` rather than pretending the board holds all of them.
 */
import type {
  AgentTeamGitHubBoard, AgentTeamGitHubColumn, AgentTeamGitHubCommentRow, AgentTeamGitHubCreateIssueRequest,
  AgentTeamGitHubIssue, AgentTeamGitHubIssueSummary, AgentTeamGitHubLabel, AgentTeamGitHubStatus,
  AgentTeamGitHubUpdateIssueRequest,
} from './types.ts'

/** The column that holds the issues a bound project does not place. */
export const GITHUB_NO_STATUS_COLUMN_ID = 'no-status'

/** One capped page: the board and the comment list both read at most this many rows. */
export const GITHUB_PAGE_LIMIT = 100

/** Upper bound for one GitHub round trip; a write never hangs the surface. */
export const GITHUB_TIMEOUT_MS = 15_000

export const GITHUB_ENV = Object.freeze({
  repo: 'DSH_AGENT_TEAM_GITHUB_REPO',
  token: 'DSH_AGENT_TEAM_GITHUB_TOKEN',
  fallbackToken: 'GITHUB_TOKEN',
  project: 'DSH_AGENT_TEAM_GITHUB_PROJECT',
  apiBase: 'DSH_AGENT_TEAM_GITHUB_API',
})

const DEFAULT_API_BASE = 'https://api.github.com'

/** Minimal response surface this module needs; the global fetch satisfies it. */
export interface GitHubResponse {
  readonly ok: boolean
  readonly status: number
  json(): Promise<unknown>
  text(): Promise<string>
}

/** Minimal fetch surface; injectable so the spec never touches the network. */
export interface GitHubFetcher {
  (url: string, init: {
    readonly method: string
    readonly headers: Readonly<Record<string, string>>
    readonly body?: string | undefined
    readonly signal?: AbortSignal | undefined
  }): Promise<GitHubResponse>
}

export interface GitHubMirrorConfig {
  readonly owner: string
  readonly repo: string
  readonly projectNumber?: number | undefined
  readonly token: string
  readonly apiBase: string
}

/** The deployment's binding, or why it cannot be used yet. */
export type GitHubSettings =
  | { readonly state: 'ready'; readonly config: GitHubMirrorConfig }
  | { readonly state: 'missing-repo' }
  | { readonly state: 'missing-token'; readonly repo: string }

type Env = { readonly [key: string]: string | undefined }

/** Resolve the environment's binding; a read of settings never touches the network. */
export function resolveGitHubSettings(env: Env = process.env): GitHubSettings {
  const repoSpec = env[GITHUB_ENV.repo]?.trim() ?? ''
  const slash = repoSpec.indexOf('/')
  if (slash <= 0 || slash === repoSpec.length - 1) return { state: 'missing-repo' }
  const owner = repoSpec.slice(0, slash)
  const repo = repoSpec.slice(slash + 1)
  const token = (env[GITHUB_ENV.token] ?? env[GITHUB_ENV.fallbackToken] ?? '').trim()
  if (token === '') return { state: 'missing-token', repo: repoSpec }
  const project = Number.parseInt(env[GITHUB_ENV.project]?.trim() ?? '', 10)
  const apiBase = (env[GITHUB_ENV.apiBase]?.trim() ?? '') || DEFAULT_API_BASE
  return {
    state: 'ready',
    config: {
      owner,
      repo,
      ...(Number.isInteger(project) && project > 0 ? { projectNumber: project } : {}),
      token,
      apiBase: apiBase.replace(/\/+$/, ''),
    },
  }
}

/** The settings as the surfaces state them. */
export function gitHubStatusOf(settings: GitHubSettings): AgentTeamGitHubStatus {
  if (settings.state === 'ready') {
    return {
      configured: true,
      repo: `${settings.config.owner}/${settings.config.repo}`,
      ...(settings.config.projectNumber === undefined ? {} : { projectNumber: settings.config.projectNumber }),
    }
  }
  if (settings.state === 'missing-token') return { configured: false, repo: settings.repo, reason: 'missing-token' }
  return { configured: false, reason: 'missing-repo' }
}

// --- Payload helpers ---

type Json = { readonly [key: string]: unknown }

function asRecord(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Json : undefined
}

function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : []
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

interface RawIssue {
  readonly number: number
  readonly title: string
  readonly state: 'open' | 'closed'
  readonly author: string
  readonly assignees: readonly string[]
  readonly labels: readonly AgentTeamGitHubLabel[]
  readonly commentCount: number
  readonly updatedAt: string
  readonly url: string
  readonly body: string
}

function readIssue(value: unknown): RawIssue | undefined {
  const row = asRecord(value)
  if (row === undefined) return undefined
  const number = asNumber(row.number)
  if (number === undefined) return undefined
  const state = row.state === 'closed' ? 'closed' : 'open'
  const author = asRecord(row.user)
  return {
    number,
    title: asString(row.title),
    state,
    author: asString(author?.login, 'ghost'),
    assignees: asArray(row.assignees).flatMap(entry => {
      const login = asString(asRecord(entry)?.login)
      return login === '' ? [] : [login]
    }),
    labels: asArray(row.labels).flatMap(entry => {
      const label = asRecord(entry)
      const name = asString(label?.name)
      return name === '' ? [] : [{ name, color: asString(label?.color) }]
    }),
    commentCount: asNumber(row.comments) ?? 0,
    updatedAt: asString(row.updated_at, new Date(0).toISOString()),
    url: asString(row.html_url),
    body: asString(row.body),
  }
}

/** GitHub's issue list carries pull requests too; only issues belong on this board. */
function isPullRequest(value: unknown): boolean {
  return asRecord(value)?.pull_request !== undefined
}

// --- Transport ---

function defaultFetcher(url: string, init: {
  readonly method: string
  readonly headers: Readonly<Record<string, string>>
  readonly body?: string | undefined
  readonly signal?: AbortSignal | undefined
}): Promise<GitHubResponse> {
  const request: RequestInit = {
    method: init.method,
    headers: { ...init.headers },
    ...(init.body === undefined ? {} : { body: init.body }),
    ...(init.signal === undefined ? {} : { signal: init.signal }),
  }
  return globalThis.fetch(url, request) as unknown as Promise<GitHubResponse>
}

interface Transport {
  readonly config: GitHubMirrorConfig
  readonly fetchImpl: GitHubFetcher
}

function headers(config: GitHubMirrorConfig): Record<string, string> {
  return {
    Authorization: `Bearer ${config.token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'moct-dsh-team-room',
  }
}

async function call(transport: Transport, method: string, path: string, body?: unknown): Promise<unknown> {
  const response = await transport.fetchImpl(`${transport.config.apiBase}${path}`, {
    method,
    headers: headers(transport.config),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`GitHub ${method} ${path} failed (${response.status})${detail === '' ? '' : `: ${detail.slice(0, 300)}`}`)
  }
  return response.status === 204 ? undefined : response.json()
}

async function graphql(transport: Transport, query: string, variables: Readonly<Record<string, unknown>>): Promise<Json> {
  const payload = asRecord(await call(transport, 'POST', '/graphql', { query, variables }))
  const errors = asArray(payload?.errors)
  if (errors.length > 0) {
    const message = errors.map(entry => asString(asRecord(entry)?.message, 'unknown error')).join('; ')
    throw new Error(`GitHub GraphQL failed: ${message}`)
  }
  return asRecord(payload?.data) ?? {}
}

// --- Projects (Projects v2, the board's grouping) ---

const PROJECT_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    projectV2(number: $number) {
      id
      fields(first: 50) {
        nodes {
          ... on ProjectV2SingleSelectField { id name options { id name color } }
        }
      }
      items(first: ${GITHUB_PAGE_LIMIT}) {
        totalCount
        nodes {
          id
          content { ... on Issue { number } }
          fieldValues(first: 20) {
            nodes {
              ... on ProjectV2ItemFieldSingleSelectValue {
                optionId
                name
                field { ... on ProjectV2SingleSelectField { id name } }
              }
            }
          }
        }
      }
    }
  }
}`

interface ProjectOption {
  readonly id: string
  readonly name: string
  readonly color?: string | undefined
}

interface ProjectItem {
  readonly itemId: string
  readonly optionId?: string | undefined
  readonly statusName?: string | undefined
}

interface ProjectView {
  readonly projectId: string
  readonly fieldId: string
  readonly options: readonly ProjectOption[]
  readonly items: ReadonlyMap<number, ProjectItem>
  readonly truncated: boolean
}

const STATUS_FIELD_NAME = 'Status'

async function readProject(transport: Transport, projectNumber: number): Promise<ProjectView | undefined> {
  const data = await graphql(transport, PROJECT_QUERY, {
    owner: transport.config.owner,
    name: transport.config.repo,
    number: projectNumber,
  })
  const project = asRecord(asRecord(data.repository)?.projectV2)
  const projectId = asString(project?.id)
  if (projectId === '') return undefined
  const fieldNodes = asArray(asRecord(project?.fields)?.nodes).map(asRecord).filter((node): node is Json => node !== undefined)
  const statusField = fieldNodes.find(node => asString(node.name) === STATUS_FIELD_NAME)
  const fieldId = asString(statusField?.id)
  const options = asArray(statusField?.options).flatMap((entry): readonly ProjectOption[] => {
    const option = asRecord(entry)
    const id = asString(option?.id)
    if (id === '') return []
    return [{ id, name: asString(option?.name), ...(asString(option?.color) === '' ? {} : { color: asString(option?.color) }) }]
  })
  const items = new Map<number, ProjectItem>()
  let totalCount = 0
  for (const entry of asArray(asRecord(project?.items)?.nodes)) {
    const node = asRecord(entry)
    const itemId = asString(node?.id)
    const number = asNumber(asRecord(node?.content)?.number)
    if (itemId === '' || number === undefined) continue
    totalCount += 1
    const values = asArray(asRecord(node?.fieldValues)?.nodes)
    const status = values
      .map(asRecord)
      .find(value => value !== undefined && asString(asRecord(value.field)?.name) === STATUS_FIELD_NAME)
    const optionId = asString(status?.optionId)
    items.set(number, {
      itemId,
      ...(optionId === '' ? {} : { optionId }),
      ...(asString(status?.name) === '' ? {} : { statusName: asString(status?.name) }),
    })
  }
  return {
    projectId,
    fieldId,
    options,
    items,
    truncated: (asNumber(asRecord(project?.items)?.totalCount) ?? totalCount) > GITHUB_PAGE_LIMIT,
  }
}

function stateColumns(): readonly AgentTeamGitHubColumn[] {
  return [
    { id: 'open', name: 'Open', kind: 'state', droppable: true },
    { id: 'closed', name: 'Closed', kind: 'state', droppable: true },
  ]
}

/** The board's columns: the project's options in their own order, or the two states. */
export function columnsOf(project: ProjectView | undefined): readonly AgentTeamGitHubColumn[] {
  if (project === undefined || project.options.length === 0) return stateColumns()
  return [
    ...project.options.map<AgentTeamGitHubColumn>(option => ({
      id: option.id,
      name: option.name,
      kind: 'project-status',
      droppable: true,
      ...(option.color === undefined ? {} : { color: option.color }),
    })),
    { id: GITHUB_NO_STATUS_COLUMN_ID, name: 'No status', kind: 'project-status', droppable: false },
  ]
}

function summaryOf(issue: RawIssue, columnId: string): AgentTeamGitHubIssueSummary {
  return {
    number: issue.number,
    title: issue.title,
    state: issue.state,
    author: issue.author,
    assignees: issue.assignees,
    labels: issue.labels,
    commentCount: issue.commentCount,
    updatedAt: issue.updatedAt,
    url: issue.url,
    columnId,
  }
}

function columnOf(project: ProjectView | undefined, issue: RawIssue): string {
  if (project === undefined || project.options.length === 0) return issue.state
  return project.items.get(issue.number)?.optionId ?? GITHUB_NO_STATUS_COLUMN_ID
}

// --- Reads ---

/** One capped page of issues, placed in the project's columns when one is bound. */
export async function fetchGitHubBoard(config: GitHubMirrorConfig, fetchImpl: GitHubFetcher = defaultFetcher, now: () => string = () => new Date().toISOString()): Promise<AgentTeamGitHubBoard> {
  const transport: Transport = { config, fetchImpl }
  const rows = asArray(await call(transport, 'GET', `/repos/${config.owner}/${config.repo}/issues?state=all&per_page=${GITHUB_PAGE_LIMIT}&sort=updated&direction=desc`))
  const project = config.projectNumber === undefined ? undefined : await readProject(transport, config.projectNumber)
  const issues = rows
    .filter(row => !isPullRequest(row))
    .flatMap(row => {
      const issue = readIssue(row)
      return issue === undefined ? [] : [summaryOf(issue, columnOf(project, issue))]
    })
  return {
    repo: `${config.owner}/${config.repo}`,
    ...(config.projectNumber === undefined ? {} : { projectNumber: config.projectNumber }),
    columns: columnsOf(project),
    issues,
    fetchedAt: now(),
    truncated: rows.length >= GITHUB_PAGE_LIMIT || project?.truncated === true,
  }
}

function commentOf(value: unknown): AgentTeamGitHubCommentRow | undefined {
  const row = asRecord(value)
  const id = asNumber(row?.id)
  if (row === undefined || id === undefined) return undefined
  return {
    id: String(id),
    author: asString(asRecord(row.user)?.login, 'ghost'),
    body: asString(row.body),
    createdAt: asString(row.created_at, new Date(0).toISOString()),
    url: asString(row.html_url),
  }
}

/** One issue with its whole conversation: the issue surface's read. */
export async function fetchGitHubIssue(config: GitHubMirrorConfig, number: number, fetchImpl: GitHubFetcher = defaultFetcher): Promise<AgentTeamGitHubIssue> {
  const transport: Transport = { config, fetchImpl }
  const [issuePayload, commentPayload] = await Promise.all([
    call(transport, 'GET', `/repos/${config.owner}/${config.repo}/issues/${number}`),
    call(transport, 'GET', `/repos/${config.owner}/${config.repo}/issues/${number}/comments?per_page=${GITHUB_PAGE_LIMIT}&sort=created&direction=asc`),
  ])
  const issue = readIssue(issuePayload)
  if (issue === undefined) throw new Error(`GitHub answered no issue for #${number}`)
  const project = config.projectNumber === undefined ? undefined : await readProject(transport, config.projectNumber)
  const item = project?.items.get(number)
  const comments = asArray(commentPayload).flatMap(entry => {
    const comment = commentOf(entry)
    return comment === undefined ? [] : [comment]
  })
  return {
    ...summaryOf(issue, columnOf(project, issue)),
    body: issue.body,
    comments,
    truncatedComments: asArray(commentPayload).length >= GITHUB_PAGE_LIMIT,
    ...(item?.statusName === undefined ? {} : { statusName: item.statusName }),
  }
}

// --- Writes ---

/** Add an issue to the bound project and place it in one option. */
async function setProjectStatus(transport: Transport, projectNumber: number, number: number, optionId: string): Promise<void> {
  const project = await readProject(transport, projectNumber)
  if (project === undefined) throw new Error(`project ${projectNumber} is not reachable`)
  if (project.fieldId === '') throw new Error(`project ${projectNumber} has no '${STATUS_FIELD_NAME}' field`)
  if (!project.options.some(option => option.id === optionId)) throw new Error(`'${optionId}' is not an option of the project's '${STATUS_FIELD_NAME}' field`)
  let itemId = project.items.get(number)?.itemId
  if (itemId === undefined) {
    const added = await graphql(transport, `mutation($project: ID!, $content: ID!) {
      addProjectV2ItemById(input: { projectId: $project, contentId: $content }) { item { id } }
    }`, { project: project.projectId, content: await issueNodeId(transport, number) })
    itemId = asString(asRecord(asRecord(added.addProjectV2ItemById)?.item)?.id)
    if (itemId === '') throw new Error(`GitHub did not add #${number} to project ${projectNumber}`)
  }
  await graphql(transport, `mutation($project: ID!, $item: ID!, $field: ID!, $option: String!) {
    updateProjectV2ItemFieldValue(input: {
      projectId: $project, itemId: $item, fieldId: $field, value: { singleSelectOptionId: $option }
    }) { projectV2Item { id } }
  }`, { project: project.projectId, item: itemId, field: project.fieldId, option: optionId })
}

async function issueNodeId(transport: Transport, number: number): Promise<string> {
  const data = await graphql(transport, `query($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) { issue(number: $number) { id } }
  }`, { owner: transport.config.owner, name: transport.config.repo, number })
  const id = asString(asRecord(asRecord(data.repository)?.issue)?.id)
  if (id === '') throw new Error(`GitHub answered no issue for #${number}`)
  return id
}

async function readSummary(transport: Transport, number: number): Promise<AgentTeamGitHubIssueSummary> {
  const issue = readIssue(await call(transport, 'GET', `/repos/${transport.config.owner}/${transport.config.repo}/issues/${number}`))
  if (issue === undefined) throw new Error(`GitHub answered no issue for #${number}`)
  const project = transport.config.projectNumber === undefined ? undefined : await readProject(transport, transport.config.projectNumber)
  return summaryOf(issue, columnOf(project, issue))
}

export async function createGitHubIssue(config: GitHubMirrorConfig, input: Pick<AgentTeamGitHubCreateIssueRequest, 'title' | 'body' | 'columnId'>, fetchImpl: GitHubFetcher = defaultFetcher): Promise<AgentTeamGitHubIssueSummary> {
  const transport: Transport = { config, fetchImpl }
  const created = readIssue(await call(transport, 'POST', `/repos/${config.owner}/${config.repo}/issues`, {
    title: input.title,
    body: input.body,
  }))
  if (created === undefined) throw new Error('GitHub did not answer the created issue')
  // The project placement is a second call, and a failure there leaves a real
  // issue behind: the caller re-reads, so the issue the reader just wrote is on
  // the board even when the placement needs another try.
  if (config.projectNumber !== undefined && input.columnId !== undefined && input.columnId !== GITHUB_NO_STATUS_COLUMN_ID) {
    await setProjectStatus(transport, config.projectNumber, created.number, input.columnId)
  }
  return readSummary(transport, created.number)
}

export async function updateGitHubIssue(config: GitHubMirrorConfig, input: AgentTeamGitHubUpdateIssueRequest, fetchImpl: GitHubFetcher = defaultFetcher): Promise<AgentTeamGitHubIssueSummary> {
  const transport: Transport = { config, fetchImpl }
  const patch: Record<string, unknown> = {}
  if (input.state !== undefined) patch.state = input.state
  if (input.assignees !== undefined) patch.assignees = [...input.assignees]
  if (input.labels !== undefined) patch.labels = [...input.labels]
  if (Object.keys(patch).length > 0) {
    await call(transport, 'PATCH', `/repos/${config.owner}/${config.repo}/issues/${input.number}`, patch)
  }
  if (input.status !== undefined) {
    if (config.projectNumber === undefined) throw new Error('no project is bound: the board has no status field to write')
    if (input.status === GITHUB_NO_STATUS_COLUMN_ID) throw new Error("'No status' is a bucket, not a column: pick a status")
    await setProjectStatus(transport, config.projectNumber, input.number, input.status)
  }
  return readSummary(transport, input.number)
}

/** One comment on the issue: the communication surface's write. */
export async function createGitHubComment(config: GitHubMirrorConfig, number: number, body: string, fetchImpl: GitHubFetcher = defaultFetcher): Promise<AgentTeamGitHubCommentRow> {
  const transport: Transport = { config, fetchImpl }
  const comment = commentOf(await call(transport, 'POST', `/repos/${config.owner}/${config.repo}/issues/${number}/comments`, { body }))
  if (comment === undefined) throw new Error('GitHub did not answer the created comment')
  return comment
}
