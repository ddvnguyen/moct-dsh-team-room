// Derived from multica-x packages/views/agents/presence.ts @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
//
// Visual mapping only. Multica binds Tailwind classes and lucide icons; the
// Team Room uses CSS Modules, so the tone is a stable key the component maps
// to a module class. The human-readable word always comes from `locales.ts`.

import type { AgentAvailability, Workload } from './types.ts'

export type PresenceTone = 'success' | 'warning' | 'muted' | 'brand'

export const availabilityTone: Readonly<Record<AgentAvailability, PresenceTone>> = {
  online: 'success',
  unstable: 'warning',
  offline: 'muted',
  archived: 'muted',
}

export const workloadTone: Readonly<Record<Workload, PresenceTone>> = {
  working: 'brand',
  queued: 'warning',
  idle: 'muted',
}

/** Order used by availability filter chips. */
export const AVAILABILITY_ORDER: readonly AgentAvailability[] = ['online', 'unstable', 'offline']

/** Order used by workload groups; actionable signals first. */
export const WORKLOAD_ORDER: readonly Workload[] = ['working', 'queued', 'idle']

export const AVAILABILITY_LABEL_KEY = {
  online: 'presenceOnline',
  unstable: 'presenceUnstable',
  offline: 'presenceOffline',
  archived: 'presenceArchived',
} as const satisfies Readonly<Record<AgentAvailability, string>>

export const WORKLOAD_LABEL_KEY = {
  working: 'workloadWorking',
  queued: 'workloadQueued',
  idle: 'workloadIdle',
} as const satisfies Readonly<Record<Workload, string>>
