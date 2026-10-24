// The one way this port talks to GitHub: the fetch surface a spec can inject,
// the single capped request and its error text, the GraphQL read that treats a
// `NOT_FOUND` miss as an answer, and the payload helpers both halves parse with.
import type { GitHubMirrorConfig } from './binding.ts'

/** One capped page: the board and the comment list both read at most this many rows. */
export const GITHUB_PAGE_LIMIT = 100

/** Upper bound for one GitHub round trip; a write never hangs the surface. */
export const GITHUB_TIMEOUT_MS = 15_000

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

export type Json = { readonly [key: string]: unknown }

export function asRecord(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Json : undefined
}

export function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : []
}

export function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function defaultFetcher(url: string, init: {
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

export interface Transport {
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

export async function call(transport: Transport, method: string, path: string, body?: unknown): Promise<unknown> {
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

/**
 * `allowNotFound` exists for one shape of query: a lookup that asks several
 * places for the same thing and treats "not here" as an answer. GitHub reports
 * a miss as an `errors` entry of type `NOT_FOUND` while still answering the
 * fields that did resolve, so a strict read would turn a normal miss into a
 * dead surface.
 */
export async function graphql(transport: Transport, query: string, variables: Readonly<Record<string, unknown>>, options: { readonly allowNotFound?: boolean } = {}): Promise<Json> {
  const payload = asRecord(await call(transport, 'POST', '/graphql', { query, variables }))
  const errors = asArray(payload?.errors).flatMap(entry => {
    const error = asRecord(entry)
    return error === undefined ? [] : [error]
  })
  const fatal = options.allowNotFound === true
    ? errors.filter(error => asString(error.type) !== 'NOT_FOUND')
    : errors
  if (fatal.length > 0) {
    const message = fatal.map(entry => asString(entry.message, 'unknown error')).join('; ')
    throw new Error(`GitHub GraphQL failed: ${message}`)
  }
  return asRecord(payload?.data) ?? {}
}
