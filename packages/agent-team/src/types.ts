/** Public domain types for the Agent Team Host, split by concern.
 *
 * - ./types/entities.ts — branded ids, actors, entities, activities, stored facts.
 * - ./types/operations.ts — durable operation records embedded in the ledger.
 * - ./types/requests-results.ts — operation receipts, requests, results, views.
 * - ./types/memory.ts — the Human Memory page's requests, records and outcomes.
 * - ./types/github.ts — the GitHub Issues/Projects mirror's reads and writes.
 *
 * This file stays the single public import path; every consumer keeps importing
 * from ./types.ts (or @ddvnguyen/moct-dsh-team-room/types) unchanged.
 */
import type { AgentTeamAttachmentId, AgentTeamChannelRef, AgentTeamThreadRef } from './types/entities.ts'

export type * from "./types/entities.ts"
export type * from "./types/operations.ts"
export type * from "./types/requests-results.ts"
export type * from "./types/memory.ts"
export type * from "./types/github.ts"

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** Read of a cached attachment whose entry is gone (expired or collected): the Client settles on the expired chip instead of retrying. */
    'team/attachment-not-found': { readonly attachmentId: AgentTeamAttachmentId }
    /** Room-activity read of a Channel or Thread that does not resolve in this Workspace, or whose Channel is archived (contract §19.1). */
    'team/room-activity-not-found': { readonly channelRef: AgentTeamChannelRef; readonly threadRef?: AgentTeamThreadRef | undefined }
    /** GitHub mirror call on a deployment with no repo or no token: the surfaces answer with setup, not with a retry. */
    'team/github-not-configured': { readonly repo?: string | undefined }
  }
}
