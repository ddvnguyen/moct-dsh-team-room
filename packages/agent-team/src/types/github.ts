/**
 * The GitHub mirror: GitHub Issues and Projects are the store, and the board
 * and issue surfaces read them through these requests.
 *
 * Nothing here is a Team fact: an issue is not a Task, a comment is not a
 * Message, and the mirror owns no ledger operation. The Host answers with what
 * GitHub holds, and every write goes straight to GitHub — the board and the
 * issue view re-read after a commit instead of mutating a local copy.
 */
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'

/**
 * Where the mirror stands. Reading settings can fail in a way the surface
 * shows as setup, not as an error: a deployment with no repo or no token has
 * not been bound yet, and that is the normal first state.
 */
export interface AgentTeamGitHubStatusRequest {
  readonly workspaceId: WorkspaceId
}

export interface AgentTeamGitHubStatus {
  readonly configured: boolean
  /** `owner/repo`, when the deployment named one. */
  readonly repo?: string | undefined
  readonly projectNumber?: number | undefined
  /** Why the mirror is not usable yet; absent when it is configured. */
  readonly reason?: 'missing-repo' | 'missing-token' | undefined
}

export interface AgentTeamGitHubBoardRequest {
  readonly workspaceId: WorkspaceId
}

/**
 * One board column: a single-select option of the project's `Status` field
 * when a project is bound, or the issue state otherwise. The bucket column
 * (`droppable: false`) holds the issues the project does not place, so a drop
 * there is refused rather than silently clearing a field.
 */
export interface AgentTeamGitHubColumn {
  readonly id: string
  readonly name: string
  readonly kind: 'project-status' | 'state'
  readonly droppable: boolean
  readonly color?: string | undefined
}

export interface AgentTeamGitHubLabel {
  readonly name: string
  readonly color: string
}

export interface AgentTeamGitHubIssueSummary {
  readonly number: number
  readonly title: string
  readonly state: 'open' | 'closed'
  readonly author: string
  readonly assignees: readonly string[]
  readonly labels: readonly AgentTeamGitHubLabel[]
  readonly commentCount: number
  readonly updatedAt: string
  readonly url: string
  /** The column the issue sits in, as {@link AgentTeamGitHubColumn.id}. */
  readonly columnId: string
}

export interface AgentTeamGitHubBoard {
  readonly repo: string
  readonly projectNumber?: number | undefined
  readonly columns: readonly AgentTeamGitHubColumn[]
  readonly issues: readonly AgentTeamGitHubIssueSummary[]
  /** The labels this repository defines: the only names an issue may carry. */
  readonly labels: readonly AgentTeamGitHubLabel[]
  /** The logins this repository can assign an issue to. */
  readonly people: readonly string[]
  /** ISO-8601, the moment GitHub answered. */
  readonly fetchedAt: string
  /** GitHub holds more rows than one capped page: the board says so instead of pretending. */
  readonly truncated: boolean
}

export interface AgentTeamGitHubIssueRequest {
  readonly workspaceId: WorkspaceId
  readonly number: number
}

export interface AgentTeamGitHubCommentRow {
  readonly id: string
  readonly author: string
  readonly body: string
  /** ISO-8601. */
  readonly createdAt: string
  readonly url: string
}

/** One issue with the conversation on it: the communication surface's whole read. */
export interface AgentTeamGitHubIssue extends AgentTeamGitHubIssueSummary {
  readonly body: string
  readonly comments: readonly AgentTeamGitHubCommentRow[]
  readonly truncatedComments: boolean
  /** The project field's option name, when a project places the issue. */
  readonly statusName?: string | undefined
}

export interface AgentTeamGitHubCreateIssueRequest {
  readonly workspaceId: WorkspaceId
  readonly title: string
  readonly body: string
  /** The project option the new issue starts in; ignored without a project. */
  readonly columnId?: string | undefined
}

/**
 * One field write. Absent fields are untouched — a write names exactly what
 * it changes, because every one of them is a separate GitHub call. `labels`
 * and `assignees` are the complete new sets: GitHub replaces an issue's
 * labels and assignees wholesale, so a caller removes by sending the rest.
 */
export interface AgentTeamGitHubUpdateIssueRequest {
  readonly workspaceId: WorkspaceId
  readonly number: number
  readonly state?: 'open' | 'closed' | undefined
  /** A project `Status` option id, when a project is bound. */
  readonly status?: string | undefined
  readonly assignees?: readonly string[] | undefined
  readonly labels?: readonly string[] | undefined
}

export interface AgentTeamGitHubCommentRequest {
  readonly workspaceId: WorkspaceId
  readonly number: number
  readonly body: string
}
