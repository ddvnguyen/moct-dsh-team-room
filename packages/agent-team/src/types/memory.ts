import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type { TeamMemoryHome, TeamMemoryHomeKind, TeamMemoryJson, TeamMemoryRecord, TeamMemorySearchResult, TeamMemoryType } from '../team-memory.ts'

export type {
  TeamMemoryGetResult, TeamMemoryHome, TeamMemoryHomeKind, TeamMemoryJson, TeamMemoryRecord, TeamMemorySearchResult, TeamMemoryStatusFilter, TeamMemoryType,
} from '../team-memory.ts'

/**
 * Human Memory page requests. Each names only the Workspace the page browses;
 * the Host adds the Human actor from the ledger and reads with the whole
 * Workspace in scope. No request carries an actor, a Human ref or a scope.
 */
export interface AgentTeamMemoryListRequest {
  readonly workspaceId: WorkspaceId
  readonly q?: string
  readonly types?: readonly TeamMemoryType[]
  readonly homes?: readonly TeamMemoryHomeKind[]
  readonly status?: 'active' | 'pending' | 'superseded' | 'retracted' | 'expired' | 'all'
  readonly limit?: number
  readonly cursor?: string
}

export interface AgentTeamMemoryRecordRequest {
  readonly workspaceId: WorkspaceId
  readonly id: string
}

export interface AgentTeamMemoryWorkspaceRequest {
  readonly workspaceId: WorkspaceId
}

/** One version row of a record's history (the rule feed lists the same rows), as moct's `MemoryVersion` sends it. */
export interface TeamMemoryVersion {
  readonly memoryId: string
  readonly version: number
  readonly action: string
  readonly workspaceId: string | null
  readonly type: TeamMemoryType
  readonly home: TeamMemoryHome
  readonly title: string | null
  readonly body: string | null
  readonly status: string
  readonly actorKind: string
  readonly actorId: string
  readonly reason: string | null
  readonly at: string
}

/** One home's use of the always-load cap (moct `GET /memory/usage`). */
export interface TeamMemoryHomeUsage {
  readonly home: TeamMemoryHome
  readonly usedTokens: number
  readonly records: number
  readonly blockedPending: number
  readonly largest: readonly { readonly id: string; readonly type: TeamMemoryType; readonly title: string | null; readonly tokens: number; readonly pinned: boolean }[]
}

export interface TeamMemoryUsage {
  readonly workspaceId: string
  readonly capTokens: number
  readonly injectLayerTokens: { readonly min: number; readonly max: number }
  readonly homes: readonly TeamMemoryHomeUsage[]
}

export interface TeamMemorySettings {
  readonly expertApproval: 'off' | 'required'
  readonly orchestrators: readonly string[]
  readonly injectLayerTokens: number
}

/** One record with the links the page draws (decision → task, task → branch, blocks, relates). */
export type TeamMemoryRecordWithLinks = TeamMemoryRecord & {
  readonly links: readonly { readonly kind: string; readonly id: string; readonly type: TeamMemoryType; readonly title: string | null }[]
}

export interface AgentTeamMemoryRecordView {
  readonly record: TeamMemoryRecordWithLinks
  readonly versions: readonly TeamMemoryVersion[]
}

/**
 * The Human's record verbs, a closed set. Every one names the version it was
 * shown (`baseVersion`) except purge, which instead names the record back in
 * `confirm` (its title or id) and is checked against the record the Host reads.
 */
export type AgentTeamMemoryAction =
  | { readonly verb: 'approve'; readonly baseVersion: number; readonly reason?: string }
  | { readonly verb: 'retract'; readonly baseVersion: number; readonly reason?: string }
  | { readonly verb: 'restore'; readonly baseVersion: number; readonly version: number; readonly reason?: string }
  | { readonly verb: 'purge'; readonly confirm: string; readonly reason?: string }
  | { readonly verb: 'widen'; readonly baseVersion: number; readonly to: TeamMemoryHomeKind; readonly confirm: true; readonly reason?: string }
  | { readonly verb: 'edit'; readonly baseVersion: number; readonly title?: string; readonly body?: string; readonly reason?: string }
  | { readonly verb: 'pin'; readonly baseVersion: number; readonly pinned?: boolean; readonly priority?: number; readonly reason?: string }

export type AgentTeamMemoryVerb = AgentTeamMemoryAction['verb']

export interface AgentTeamMemoryActRequest {
  readonly workspaceId: WorkspaceId
  readonly id: string
  readonly action: AgentTeamMemoryAction
}

/** The settings the Human may change: a closed set, each optional. */
export interface AgentTeamMemorySettingsRequest {
  readonly workspaceId: WorkspaceId
  readonly expertApproval?: 'off' | 'required'
  readonly orchestrators?: readonly string[]
  readonly injectLayerTokens?: number
}

/**
 * Memory answers carry the backend's stable code on refusal, so the page can
 * reload on CONFLICT and say "unavailable" on BACKEND_UNAVAILABLE or
 * MEMORY_UNSUPPORTED instead of matching message text.
 */
export type AgentTeamMemoryOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: string; readonly message: string; readonly details?: TeamMemoryJson }

export type AgentTeamMemoryListResult = AgentTeamMemoryOutcome<TeamMemorySearchResult>
