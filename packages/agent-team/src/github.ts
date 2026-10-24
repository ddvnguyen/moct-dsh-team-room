/**
 * The GitHub mirror: GitHub Issues (and, when a project is bound, the project's
 * `Status` field) are the store; the board and the issue view read them here.
 *
 * The mirror is deliberately outside the ledger. An issue is not a Task and a
 * comment is not a Message: the Team's append-only operation log stays the
 * Team's only authority, and nothing here writes to it. A read answers what
 * GitHub holds right now; a write goes to GitHub, and the caller re-reads.
 *
 * Four modules hold the work, and this file is only their public surface:
 * `github/binding.ts` resolves the deployment's repository, token, project and
 * API base from the environment; `github/transport.ts` is the one request every
 * call goes through, with the payload helpers both halves parse with;
 * `github/read.ts` reads issues, their conversations, the catalogues and the
 * Projects v2 view behind the columns; `github/write.ts` creates, places, edits
 * and comments. Everything is one capped page — a repository with more than 100
 * issues reports `truncated` rather than pretending the board holds all of them.
 */
export { GITHUB_ENV, gitHubStatusOf, resolveGitHubSettings } from './github/binding.ts'
export type { GitHubMirrorConfig, GitHubSettings } from './github/binding.ts'
export { GITHUB_PAGE_LIMIT, GITHUB_TIMEOUT_MS } from './github/transport.ts'
export type { GitHubFetcher, GitHubResponse } from './github/transport.ts'
export { GITHUB_NO_STATUS_COLUMN_ID, columnsOf, fetchGitHubBoard, fetchGitHubIssue } from './github/read.ts'
export { createGitHubComment, createGitHubIssue, updateGitHubIssue } from './github/write.ts'
