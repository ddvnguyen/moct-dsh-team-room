// The deployment's GitHub binding: which repository, project and API base, read
// from the environment rather than from a Human, and how the surfaces state it.
import type { AgentTeamGitHubStatus } from '../types.ts'

/**
 * The environment names this binding reads. Configuration is the deployment's,
 * not a Human's, so every call reads them again: a restart rebinds.
 */
export const GITHUB_ENV = Object.freeze({
  repo: 'DSH_AGENT_TEAM_GITHUB_REPO',
  token: 'DSH_AGENT_TEAM_GITHUB_TOKEN',
  fallbackToken: 'GITHUB_TOKEN',
  project: 'DSH_AGENT_TEAM_GITHUB_PROJECT',
  apiBase: 'DSH_AGENT_TEAM_GITHUB_API',
})

const DEFAULT_API_BASE = 'https://api.github.com'

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
