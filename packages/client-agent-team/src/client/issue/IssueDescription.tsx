// Derived from multica-x packages/views/issues/components/issue-detail.tsx @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
//
// Rendering adapted: Multica's description block — the body, its author and
// when it was written — ported as the issue view's description region. The
// body is a record, not a string: the Host resolves it and the region renders
// it as it stands. The region is read-only in this cut: the description's own
// write path (and the fence that guards it) is M-39's, so there is no editor
// and no autosave here.

import type { AgentTeamIssueDescription } from '@ddvnguyen/moct-dsh-team-room/types'
import type { TeamConversationProps } from '../slots.ts'
import css from './issue-view.module.css'

export interface IssueDescriptionProps {
  /** The Host-resolved description record: body, author, instant, provenance. */
  readonly description: AgentTeamIssueDescription
  /** The display name of the Member who wrote the body. */
  readonly authorName: string
  readonly t: TeamConversationProps['t']
}

/**
 * The issue's description: what the Task is, in the words that are already
 * durable. The body's provenance is shown, so a reader can tell an anchor body
 * from a plan's approved one and a direct edit from either.
 */
export function IssueDescription({ description, authorName, t }: IssueDescriptionProps) {
  const body = description.body.trim()
  return (
    <section className={css.region} aria-label={t('issueDescriptionLabel')} data-testid="issue-description">
      <h2 className={css.regionHeading}>{t('issueDescriptionLabel')}</h2>
      {body === ''
        ? <p className={css.empty}>{t('issueDescriptionEmpty')}</p>
        : <p className={css.description} data-testid="issue-description-body">{body}</p>}
      <p className={css.descriptionMeta}>
        {authorName}
        {description.editedAt !== undefined ? ` · ${t('issueDescriptionEdited')}` : ''}
        {description.source === 'approvedPlan' ? ` · ${t('issueDescriptionFromPlan')}` : ''}
      </p>
    </section>
  )
}
