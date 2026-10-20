// Derived from multica-x packages/views/agents/components/tabs/task-failure.ts @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
//
// Ported without Multica's i18n catalog: the Team Room's failed Turns carry a
// free-text redacted `reason` (first line, at most 200 characters) instead of
// Multica's closed `failure_reason` taxonomy, so the label is the reason
// itself. The classification sets stay, because they answer the two questions
// the Runs tab asks of a failure — was this a cancellation, and does recovery
// need a configuration change rather than a retry.

/** Wire values that record a cancellation, not an error. */
const CANCELLATION_REASONS: ReadonlySet<string> = new Set([
  'cancelled',
  'manual',
  'user_cancelled',
])

/** Failures a retry cannot fix until someone changes configuration. */
const ACTION_REQUIRED_REASONS: ReadonlySet<string> = new Set([
  'runtime_access_denied',
  'agent_error.provider_auth_or_access',
  'agent_error.provider_quota_limit',
  'agent_error.missing_config',
  'agent_error.model_not_found_or_unavailable',
  'agent_error.runtime_version_unsupported',
  'agent_error.runtime_missing_executable',
])

/** How a failed Turn reads at a glance. */
export type FailureTone = 'cancelled' | 'action' | 'failed'

/** A stopped Turn reads as cancelled even when its row carries an error. */
export function failureTone(reason: string): FailureTone {
  const normalized = reason.trim().toLowerCase()
  if (CANCELLATION_REASONS.has(normalized)) return 'cancelled'
  if (ACTION_REQUIRED_REASONS.has(normalized)) return 'action'
  return 'failed'
}

/**
 * The reason as one line: the stored text is already redacted and bounded, so
 * it is shown as-is; an empty reason yields null instead of an empty chip.
 */
export function failureReasonLabel(reason: string | null | undefined): string | null {
  if (reason === null || reason === undefined) return null
  const line = reason.trim().split('\n')[0]?.trim() ?? ''
  return line === '' ? null : line
}
