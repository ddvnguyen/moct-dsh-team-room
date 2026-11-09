// The board's shared view-model: one row per card, resolved by the page from
// the `view` catalog (Tasks, task numbers, Channels, Threads and Claims).
// DOM-free, so specs can build rows by hand.

import type { AgentTeamChannelRef, AgentTeamMemberId, AgentTeamTaskPriority, AgentTeamTaskRef, AgentTeamThreadRef } from '@ddvnguyen/moct-dsh-team-room/types'
import type { TaskStatus } from '../multica/types.ts'

export interface BoardCardTask {
  readonly taskRef: AgentTeamTaskRef
  readonly channelRef: AgentTeamChannelRef
  readonly threadRef: AgentTeamThreadRef
  readonly status: TaskStatus
  /** The custom list the card is placed in; absent or `null` means its built-in column. */
  readonly statusKey?: string | null | undefined
  readonly taskNumber: number
  readonly channelName: string
  /** The Task Thread's current revision: the fence every board write sends. */
  readonly threadRevision: number
  readonly title?: string | undefined
  readonly priority?: AgentTeamTaskPriority | undefined
  readonly assignee?: AgentTeamMemberId | null | undefined
  readonly position?: number | undefined
  /** The Task's active Claim, one line under the title. */
  readonly claim?: { readonly owner: string; readonly direction: string } | undefined
}
