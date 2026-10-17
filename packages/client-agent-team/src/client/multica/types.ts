// Derived from multica-x packages/core/types @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
//
// The local vocabulary the ported Multica helpers work on. Multica's helpers
// are written against its server types (`Issue`, `Agent`, `AgentTask`); the
// Team Room has its own durable entities, so this file maps the subset the
// pure helpers need. Keep it DOM-free and free of React: every helper in this
// directory is imported by node-environment specs.

/** The five Task statuses the Team ledger derives (see `deriveTaskStatus`). */
export type TaskStatus = 'todo' | 'in_progress' | 'in_review' | 'done' | 'closed'

/** Multica's lifecycle categories, kept so the ported status helpers read the same. */
export type StatusCategory = 'unstarted' | 'started' | 'done' | 'closed'

/** Board priority, matching `AgentTeamTask['priority']`. */
export type TaskPriority = 'urgent' | 'high' | 'medium' | 'low' | 'none'

/** Member role label; routing is not implied. */
export type MemberRole = 'architect' | 'leader' | 'worker' | 'orchestrator'

/**
 * The projection the board, list and sort helpers need from one Task.
 * `AgentTeamTask` satisfies it structurally; tests can build it by hand.
 */
export interface BoardTaskLike {
  readonly taskRef: string
  readonly channelRef: string
  readonly threadRef: string
  readonly status: TaskStatus
  readonly priority?: TaskPriority | undefined
  readonly position?: number | undefined
  readonly title?: string | undefined
  readonly assignee?: string | null | undefined
  readonly createdAt?: string | undefined
  readonly updatedAt?: string | undefined
}

/** One actor a picker can select: a Human or an Agent Member. */
export interface BoardActor {
  readonly id: string
  readonly kind: 'member' | 'human'
  readonly handle: string
  readonly role?: MemberRole | undefined
}

/** Availability dimension of presence — reachability only. */
export type AgentAvailability = 'online' | 'unstable' | 'offline' | 'archived'

/** Workload dimension of presence — what is on the plate right now. */
export type Workload = 'working' | 'queued' | 'idle'

/** Both presence dimensions, derived independently (see `derive-presence.ts`). */
export interface AgentPresenceDetail {
  readonly availability: AgentAvailability
  readonly workload: Workload
  readonly runningCount: number
  readonly queuedCount: number
  readonly capacity: number
}

/** The presence-bearing slice of `AgentTeamClientMemberStatus`. */
export interface PresenceSource {
  readonly availability: 'active' | 'suspended' | 'inactive' | 'archived' | 'unavailable'
  readonly presence: 'available' | 'working' | 'error' | 'unavailable'
  readonly instances: readonly { readonly presence: 'available' | 'working' | 'error' | 'unavailable' }[]
  readonly member: { readonly role?: MemberRole | undefined; readonly instances?: number | undefined }
}

/** The activity-bearing slice of `AgentTeamMemberActivity`. */
export interface ActivitySource {
  readonly memberId: string
  readonly slot?: number | undefined
  readonly handle: string
  readonly threadRef?: string | undefined
  readonly turnStartedAt: string
  readonly stepCount: number
  readonly toolCount: number
  readonly current?: { readonly tool: string; readonly label: string } | undefined
  readonly updatedAt: string
}

/** Inbox severity. `action_required` is the only one that must interrupt. */
export type InboxSeverity = 'action_required' | 'attention' | 'info'

/** The local Inbox row the ported filter helpers operate on. */
export interface InboxItem {
  readonly id: string
  readonly severity: InboxSeverity
  readonly threadRef?: string | undefined
  readonly taskRef?: string | undefined
  readonly channelRef?: string | undefined
  readonly title: string
  readonly reason: string
  readonly actorId?: string | null | undefined
  readonly status?: TaskStatus | null | undefined
  readonly priority?: TaskPriority | null | undefined
  readonly read: boolean
  readonly updatedAt: string
}
