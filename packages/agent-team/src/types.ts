/** Public domain types for the Agent Team Host, split by concern.
 *
 * - ./types/entities.ts — branded ids, actors, entities, activities, stored facts.
 * - ./types/operations.ts — durable operation records embedded in the ledger.
 * - ./types/requests-results.ts — operation receipts, requests, results, views.
 * - ./types/memory.ts — the Human Memory page's requests, records and outcomes.
 *
 * This file stays the single public import path; every consumer keeps importing
 * from ./types.ts (or @ddvnguyen/moct-dsh-team-room/types) unchanged.
 */
import type { AgentTeamAttachmentId } from './types/entities.ts'

export type * from "./types/entities.ts"
export type * from "./types/operations.ts"
export type * from "./types/requests-results.ts"
export type * from "./types/memory.ts"

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** Read of a cached attachment whose entry is gone (expired or collected): the Client settles on the expired chip instead of retrying. */
    'team/attachment-not-found': { readonly attachmentId: AgentTeamAttachmentId }
  }
}
