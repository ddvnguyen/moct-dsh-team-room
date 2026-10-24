// The GitHub read half: one issue with its conversation, the board, and the
// Projects v2 read that turns a project's `Status` field into columns. Nothing
// here writes; a read answers what GitHub holds right now.
import type {
  AgentTeamGitHubBoard, AgentTeamGitHubColumn, AgentTeamGitHubCommentRow, AgentTeamGitHubIssue,
  AgentTeamGitHubIssueSummary, AgentTeamGitHubLabel,
} from '../types.ts'
import type { GitHubMirrorConfig } from './binding.ts'
import {
  GITHUB_PAGE_LIMIT, asArray, asNumber, asRecord, asString, call, defaultFetcher, graphql,
  type GitHubFetcher, type Json, type Transport,
} from './transport.ts'

/** The column that holds the issues a bound project does not place. */
export const GITHUB_NO_STATUS_COLUMN_ID = 'no-status'

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

export function readIssue(value: unknown): RawIssue | undefined {
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

const PROJECT_FIELDS = `id
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
      }`

/**
 * Projects v2 live on a repository, a user or an organization, and the binding
 * is only `owner/repo` plus a number: a project the repository owner created is
 * a user project unless it was linked to the repository. All three are asked in
 * one round trip, and the two that do not hold it answer `null`.
 */
const PROJECT_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) { projectV2(number: $number) { ${PROJECT_FIELDS} } }
  user(login: $owner) { projectV2(number: $number) { ${PROJECT_FIELDS} } }
  organization(login: $owner) { projectV2(number: $number) { ${PROJECT_FIELDS} } }
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

export const STATUS_FIELD_NAME = 'Status'

export async function readProject(transport: Transport, projectNumber: number): Promise<ProjectView | undefined> {
  const data = await graphql(transport, PROJECT_QUERY, {
    owner: transport.config.owner,
    name: transport.config.repo,
    number: projectNumber,
  }, { allowNotFound: true })
  const project = asRecord(asRecord(data.repository)?.projectV2)
    ?? asRecord(asRecord(data.user)?.projectV2)
    ?? asRecord(asRecord(data.organization)?.projectV2)
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

/**
 * The repository's own catalogs: the labels an issue can carry and the people
 * it can be assigned to. They are one capped page each, read with the board so
 * the issue panel can offer a real choice instead of a free-text guess — GitHub
 * replaces an issue's labels and assignees wholesale, so a wrong name would
 * rewrite the issue rather than fail.
 */
function readLabels(value: unknown): readonly AgentTeamGitHubLabel[] {
  return asArray(value).flatMap(entry => {
    const label = asRecord(entry)
    const name = asString(label?.name)
    return name === '' ? [] : [{ name, color: asString(label?.color) }]
  })
}

function readPeople(value: unknown): readonly string[] {
  return asArray(value).flatMap(entry => {
    const login = asString(asRecord(entry)?.login)
    return login === '' ? [] : [login]
  })
}

/** One capped page of issues, placed in the project's columns when one is bound. */
export async function fetchGitHubBoard(config: GitHubMirrorConfig, fetchImpl: GitHubFetcher = defaultFetcher, now: () => string = () => new Date().toISOString()): Promise<AgentTeamGitHubBoard> {
  const transport: Transport = { config, fetchImpl }
  const rows = asArray(await call(transport, 'GET', `/repos/${config.owner}/${config.repo}/issues?state=all&per_page=${GITHUB_PAGE_LIMIT}&sort=updated&direction=desc`))
  const [labelPayload, peoplePayload] = await Promise.all([
    call(transport, 'GET', `/repos/${config.owner}/${config.repo}/labels?per_page=${GITHUB_PAGE_LIMIT}`),
    call(transport, 'GET', `/repos/${config.owner}/${config.repo}/assignees?per_page=${GITHUB_PAGE_LIMIT}`),
  ])
  const project = config.projectNumber === undefined ? undefined : await readProject(transport, config.projectNumber)
  // A bound project that resolves nowhere leaves the board without columns, so
  // it is said instead of quietly falling back to the two issue states.
  if (config.projectNumber !== undefined && project === undefined) {
    throw new Error(`project ${config.projectNumber} is not reachable from ${config.owner}/${config.repo}`)
  }
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
    labels: readLabels(labelPayload),
    people: readPeople(peoplePayload),
    fetchedAt: now(),
    truncated: rows.length >= GITHUB_PAGE_LIMIT || project?.truncated === true,
  }
}

export function commentOf(value: unknown): AgentTeamGitHubCommentRow | undefined {
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

export async function readSummary(transport: Transport, number: number): Promise<AgentTeamGitHubIssueSummary> {
  const issue = readIssue(await call(transport, 'GET', `/repos/${transport.config.owner}/${transport.config.repo}/issues/${number}`))
  if (issue === undefined) throw new Error(`GitHub answered no issue for #${number}`)
  const project = transport.config.projectNumber === undefined ? undefined : await readProject(transport, transport.config.projectNumber)
  return summaryOf(issue, columnOf(project, issue))
}
