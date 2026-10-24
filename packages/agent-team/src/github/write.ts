// The GitHub write half: create an issue, place it in the project, change its
// state, replace its labels and assignees, and comment. Each answers with the
// fresh read that follows it, never with what the write hoped GitHub stored.
import type {
  AgentTeamGitHubCommentRow, AgentTeamGitHubCreateIssueRequest, AgentTeamGitHubIssueSummary,
  AgentTeamGitHubUpdateIssueRequest,
} from '../types.ts'
import type { GitHubMirrorConfig } from './binding.ts'
import { asRecord, asString, call, defaultFetcher, graphql, type GitHubFetcher, type Transport } from './transport.ts'
import {
  GITHUB_NO_STATUS_COLUMN_ID, STATUS_FIELD_NAME, commentOf, readIssue, readProject, readSummary,
} from './read.ts'

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
