// The GitHub mirror's reads and writes, against a fake transport: the board's
// columns come from the bound project, pull requests never reach the board, an
// issue carries its whole conversation, and every write is the exact GitHub
// call it claims to be.
import { describe, expect, it } from 'vitest'
import {
  GITHUB_NO_STATUS_COLUMN_ID, createGitHubComment, createGitHubIssue, fetchGitHubBoard, fetchGitHubIssue,
  gitHubStatusOf, resolveGitHubSettings, updateGitHubIssue, type GitHubFetcher, type GitHubMirrorConfig,
} from '../src/github.ts'

const CONFIG: GitHubMirrorConfig = { owner: 'octo', repo: 'demo', projectNumber: 7, token: 'tok', apiBase: 'https://api.test' }

interface Call { readonly method: string; readonly url: string; readonly body?: unknown }

function transport(handler: (call: Call) => unknown): { readonly fetcher: GitHubFetcher; readonly calls: Call[] } {
  const calls: Call[] = []
  const fetcher: GitHubFetcher = async (url, init) => {
    const body = init.body === undefined ? undefined : JSON.parse(init.body) as unknown
    const call: Call = { method: init.method, url, ...(body === undefined ? {} : { body }) }
    calls.push(call)
    const answer = handler(call)
    return {
      ok: true,
      status: 200,
      json: async () => answer,
      text: async () => JSON.stringify(answer),
    }
  }
  return { fetcher, calls }
}

const issueRow = (number: number, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  number,
  title: `Issue ${number}`,
  state: 'open',
  body: `Body ${number}`,
  html_url: `https://github.test/octo/demo/issues/${number}`,
  user: { login: 'ada' },
  assignees: [{ login: 'lin' }],
  labels: [{ name: 'bug', color: 'd73a4a' }],
  comments: 2,
  updated_at: '2026-10-20T10:00:00Z',
  ...extra,
})

const projectAnswer = (): unknown => ({
  data: {
    repository: {
      projectV2: {
        id: 'PVT_1',
        fields: {
          nodes: [
            { id: 'F_title', name: 'Title' },
            { id: 'F_status', name: 'Status', options: [
              { id: 'opt_todo', name: 'Todo', color: 'GRAY' },
              { id: 'opt_doing', name: 'In progress', color: 'BLUE' },
              { id: 'opt_done', name: 'Done', color: 'GREEN' },
            ] },
          ],
        },
        items: {
          totalCount: 2,
          nodes: [
            { id: 'PVTI_1', content: { number: 1 }, fieldValues: { nodes: [{ optionId: 'opt_doing', name: 'In progress', field: { id: 'F_status', name: 'Status' } }] } },
            { id: 'PVTI_2', content: { number: 2 }, fieldValues: { nodes: [{ optionId: 'opt_done', name: 'Done', field: { id: 'F_status', name: 'Status' } }] } },
          ],
        },
      },
    },
  },
})

describe('the GitHub binding', () => {
  it('reads owner/repo, the token fallback and the enterprise base from the environment', () => {
    expect(resolveGitHubSettings({})).toEqual({ state: 'missing-repo' })
    expect(resolveGitHubSettings({ DSH_AGENT_TEAM_GITHUB_REPO: 'octo/demo' })).toEqual({ state: 'missing-token', repo: 'octo/demo' })
    const ready = resolveGitHubSettings({
      DSH_AGENT_TEAM_GITHUB_REPO: 'octo/demo',
      GITHUB_TOKEN: 'ghp_fallback',
      DSH_AGENT_TEAM_GITHUB_PROJECT: '7',
      DSH_AGENT_TEAM_GITHUB_API: 'https://ghe.test/api/v3/',
    })
    expect(ready).toEqual({ state: 'ready', config: { owner: 'octo', repo: 'demo', projectNumber: 7, token: 'ghp_fallback', apiBase: 'https://ghe.test/api/v3' } })
    expect(gitHubStatusOf(ready)).toEqual({ configured: true, repo: 'octo/demo', projectNumber: 7 })
  })
})

describe('the GitHub board', () => {
  it('takes its columns and placements from the bound project and hides pull requests', async () => {
    const { fetcher, calls } = transport(call => {
      if (call.url.endsWith('/graphql')) return projectAnswer()
      if (call.url.includes('/labels?')) return [{ name: 'bug', color: 'd73a4a' }, { name: 'ui', color: '0e8a16' }]
      if (call.url.includes('/assignees?')) return [{ login: 'ada' }, { login: 'lin' }]
      return [issueRow(1), issueRow(2), issueRow(3), issueRow(4, { pull_request: { url: 'x' } })]
    })
    const board = await fetchGitHubBoard(CONFIG, fetcher, () => '2026-10-24T00:00:00Z')
    expect(board.columns.map(column => [column.id, column.name, column.droppable])).toEqual([
      ['opt_todo', 'Todo', true],
      ['opt_doing', 'In progress', true],
      ['opt_done', 'Done', true],
      [GITHUB_NO_STATUS_COLUMN_ID, 'No status', false],
    ])
    expect(board.issues.map(issue => [issue.number, issue.columnId])).toEqual([[1, 'opt_doing'], [2, 'opt_done'], [3, GITHUB_NO_STATUS_COLUMN_ID]])
    expect(board.issues[0]?.labels).toEqual([{ name: 'bug', color: 'd73a4a' }])
    // The catalogues ride along with the board: the issue panel offers the
    // repository's real labels and people, never a guessed name.
    expect(board.labels).toEqual([{ name: 'bug', color: 'd73a4a' }, { name: 'ui', color: '0e8a16' }])
    expect(board.people).toEqual(['ada', 'lin'])
    expect(board.fetchedAt).toBe('2026-10-24T00:00:00Z')
    expect(calls[0]?.url).toContain('/repos/octo/demo/issues?state=all&per_page=100')
    expect(calls.map(call => call.url)).toContain('https://api.test/repos/octo/demo/labels?per_page=100')
    expect(calls.map(call => call.url)).toContain('https://api.test/repos/octo/demo/assignees?per_page=100')
  })

  it('reads a project the repository owner holds as a user, not only one linked to the repository', async () => {
    // GitHub answers a miss with a NOT_FOUND error beside the data, so the
    // repository that does not hold the project must not kill the read.
    const answer = projectAnswer()
    const { fetcher } = transport(call => {
      if (!call.url.endsWith('/graphql')) return [issueRow(1)]
      return {
        data: { repository: { projectV2: null }, user: (answer as { data: { repository: unknown } }).data.repository, organization: null },
        errors: [{ type: 'NOT_FOUND', message: "Could not resolve to a ProjectV2 with the number 7.", path: ['repository', 'projectV2'] }],
      }
    })
    const board = await fetchGitHubBoard(CONFIG, fetcher)
    expect(board.issues.map(issue => issue.columnId)).toEqual(['opt_doing'])
    expect(board.columns.map(column => column.name)).toEqual(['Todo', 'In progress', 'Done', 'No status'])
  })

  it('names a bound project that resolves nowhere, and still reads an issue without a status', async () => {
    const missing = {
      data: { repository: { projectV2: null }, user: null, organization: null },
      errors: [
        { type: 'NOT_FOUND', message: 'Could not resolve to a ProjectV2 with the number 7.', path: ['repository', 'projectV2'] },
        { type: 'NOT_FOUND', message: "Could not resolve to an Organization with the login of 'octo'.", path: ['organization'] },
      ],
    }
    const { fetcher } = transport(call => {
      if (call.url.endsWith('/graphql')) return missing
      if (call.url.includes('/comments?')) return []
      return issueRow(1)
    })
    await expect(fetchGitHubBoard(CONFIG, fetcher)).rejects.toThrow(/project 7 is not reachable from octo\/demo/)
    const issue = await fetchGitHubIssue(CONFIG, 1, fetcher)
    expect(issue.body).toBe('Body 1')
    expect(issue.columnId).toBe('open')
    expect(issue.statusName).toBeUndefined()
  })

  it('still fails on a GraphQL error that is not a miss', async () => {
    const { fetcher } = transport(() => ({
      data: { repository: { projectV2: null }, user: null, organization: null },
      errors: [{ type: 'FORBIDDEN', message: 'Resource not accessible by personal access token', path: ['repository', 'projectV2'] }],
    }))
    await expect(fetchGitHubBoard(CONFIG, fetcher)).rejects.toThrow(/Resource not accessible/)
  })

  it('falls back to the two issue states when no project is bound', async () => {
    const { fetcher } = transport(() => [issueRow(5), issueRow(6, { state: 'closed' })])
    const board = await fetchGitHubBoard({ ...CONFIG, projectNumber: undefined }, fetcher)
    expect(board.columns.map(column => column.id)).toEqual(['open', 'closed'])
    expect(board.issues.map(issue => issue.columnId)).toEqual(['open', 'closed'])
    expect(board.truncated).toBe(false)
  })
})

describe('one GitHub issue', () => {
  it('carries the body, the whole conversation and the project placement', async () => {
    const { fetcher } = transport(call => {
      if (call.url.endsWith('/graphql')) return projectAnswer()
      if (call.url.includes('/comments?')) {
        return [
          { id: 91, body: 'first', created_at: '2026-10-19T09:00:00Z', html_url: 'u1', user: { login: 'ada' } },
          { id: 92, body: 'second', created_at: '2026-10-20T09:00:00Z', html_url: 'u2', user: { login: 'lin' } },
        ]
      }
      return issueRow(1)
    })
    const issue = await fetchGitHubIssue(CONFIG, 1, fetcher)
    expect(issue.body).toBe('Body 1')
    expect(issue.statusName).toBe('In progress')
    expect(issue.comments.map(comment => [comment.id, comment.author, comment.body])).toEqual([
      ['91', 'ada', 'first'],
      ['92', 'lin', 'second'],
    ])
  })
})

describe('GitHub writes', () => {
  it('posts one comment and answers with the row GitHub created', async () => {
    const { fetcher, calls } = transport(call => {
      expect(call.method).toBe('POST')
      expect(call.body).toEqual({ body: 'Looks good' })
      return { id: 101, body: 'Looks good', created_at: '2026-10-24T01:00:00Z', html_url: 'u', user: { login: 'ada' } }
    })
    const comment = await createGitHubComment(CONFIG, 1, 'Looks good', fetcher)
    expect(comment).toEqual({ id: '101', author: 'ada', body: 'Looks good', createdAt: '2026-10-24T01:00:00Z', url: 'u' })
    expect(calls[0]?.url).toBe('https://api.test/repos/octo/demo/issues/1/comments')
  })

  it('moves an issue into a project option through the project mutation', async () => {
    const { fetcher, calls } = transport(call => {
      if (call.url.endsWith('/graphql')) {
        const body = call.body as { readonly query: string; readonly variables?: Record<string, unknown> }
        if (body.query.includes('updateProjectV2ItemFieldValue')) return { data: { updateProjectV2ItemFieldValue: { projectV2Item: { id: 'PVTI_x' } } } }
        if (body.query.includes('addProjectV2ItemById')) return { data: { addProjectV2ItemById: { item: { id: 'PVTI_new' } } } }
        if (body.query.includes('issue(number: $number)')) return { data: { repository: { issue: { id: 'I_3' } } } }
        return projectAnswer()
      }
      return issueRow(3)
    })
    const summary = await updateGitHubIssue(CONFIG, { workspaceId: 'w1' as never, number: 3, status: 'opt_done' }, fetcher)
    const mutation = calls.find(call => call.url.endsWith('/graphql') && (call.body as { readonly query: string }).query.includes('updateProjectV2ItemFieldValue'))
    expect(mutation?.body).toMatchObject({ variables: { project: 'PVT_1', item: 'PVTI_new', field: 'F_status', option: 'opt_done' } })
    expect(summary.columnId).toBe(GITHUB_NO_STATUS_COLUMN_ID)
  })

  it('replaces an issue’s labels and assignees with the sets the reader chose', async () => {
    const { fetcher, calls } = transport(call => {
      if (call.url.endsWith('/graphql')) return projectAnswer()
      if (call.url.includes('/labels?')) return [{ name: 'ui', color: '0e8a16' }]
      if (call.url.includes('/assignees?')) return [{ login: 'lin' }]
      // The write goes to GitHub and the summary is a fresh read of it.
      return issueRow(3, { labels: [{ name: 'ui', color: '0e8a16' }], assignees: [{ login: 'lin' }] })
    })
    const summary = await updateGitHubIssue(CONFIG, {
      workspaceId: 'w1' as never, number: 3, labels: ['ui'], assignees: ['lin'],
    }, fetcher)
    const patch = calls.find(call => call.method === 'PATCH')
    expect(patch?.url).toBe('https://api.test/repos/octo/demo/issues/3')
    // The whole set, not a delta: GitHub replaces both fields wholesale.
    expect(patch?.body).toEqual({ labels: ['ui'], assignees: ['lin'] })
    expect(summary.labels).toEqual([{ name: 'ui', color: '0e8a16' }])
    expect(summary.assignees).toEqual(['lin'])
    expect(summary.number).toBe(3)
  })

  it('clears every label and assignee when the reader removed the last one', async () => {
    const { fetcher, calls } = transport(call => {
      if (call.url.endsWith('/graphql')) return projectAnswer()
      return issueRow(3, { labels: [], assignees: [] })
    })
    await updateGitHubIssue(CONFIG, { workspaceId: 'w1' as never, number: 3, labels: [], assignees: [] }, fetcher)
    expect(calls.find(call => call.method === 'PATCH')?.body).toEqual({ labels: [], assignees: [] })
  })

  it('surfaces a refused write instead of answering with a summary', async () => {
    const fetcher: GitHubFetcher = async (url, init) => init.method === 'PATCH'
      ? { ok: false, status: 403, json: async () => ({}), text: async () => 'Resource not accessible by personal access token' }
      : { ok: true, status: 200, json: async () => issueRow(3), text: async () => '' }
    await expect(updateGitHubIssue(CONFIG, { workspaceId: 'w1' as never, number: 3, labels: ['ui'] }, fetcher))
      .rejects.toThrow(/\(403\): Resource not accessible by personal access token/)
  })

  it('refuses the bucket column and an unknown option', async () => {
    const { fetcher } = transport(call => call.url.endsWith('/graphql') ? projectAnswer() : issueRow(3))
    await expect(updateGitHubIssue(CONFIG, { workspaceId: 'w1' as never, number: 3, status: GITHUB_NO_STATUS_COLUMN_ID }, fetcher))
      .rejects.toThrow(/bucket/)
    await expect(updateGitHubIssue(CONFIG, { workspaceId: 'w1' as never, number: 3, status: 'opt_nope' }, fetcher))
      .rejects.toThrow(/'opt_nope' is not an option/)
  })

  it('creates the issue and then places it in the project', async () => {
    const { fetcher, calls } = transport(call => {
      if (call.url.endsWith('/graphql')) {
        const body = call.body as { readonly query: string }
        if (body.query.includes('updateProjectV2ItemFieldValue')) return { data: {} }
        if (body.query.includes('addProjectV2ItemById')) return { data: { addProjectV2ItemById: { item: { id: 'PVTI_new' } } } }
        if (body.query.includes('issue(number: $number)')) return { data: { repository: { issue: { id: 'I_9' } } } }
        return projectAnswer()
      }
      if (call.method === 'POST' && call.url.endsWith('/issues')) {
        return issueRow(9, { title: 'New one' })
      }
      return issueRow(9, { title: 'New one' })
    })
    const summary = await createGitHubIssue(CONFIG, { title: 'New one', body: 'hello', columnId: 'opt_todo' }, fetcher)
    expect(summary.number).toBe(9)
    expect(calls[0]).toMatchObject({ method: 'POST', body: { title: 'New one', body: 'hello' } })
    expect(calls.some(call => call.url.endsWith('/graphql') && (call.body as { readonly query: string }).query.includes('addProjectV2ItemById'))).toBe(true)
  })

  it('reports a refused request with its status', async () => {
    const fetcher: GitHubFetcher = async () => ({ ok: false, status: 401, json: async () => ({}), text: async () => 'Bad credentials' })
    await expect(fetchGitHubBoard(CONFIG, fetcher)).rejects.toThrow(/\(401\): Bad credentials/)
  })
})
