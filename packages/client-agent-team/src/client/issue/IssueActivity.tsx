// Derived from multica-x packages/views/issues/components/issue-detail.tsx @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
//
// Rendering adapted: Multica's issue timeline — the Task's public activities,
// newest first — ported as the issue view's activity region. The Host bounds
// the region (the newest fifty) and says whether more exist; the tail
// indicator is that answer, and the client draws it rather than reading more
// on its own.

import type { AgentTeamIssueActivity, AgentTeamMemberId } from '@ddvnguyen/moct-dsh-team-room/types'
import { formatActivity } from '../team-formatters.ts'
import type { TeamConversationProps } from '../slots.ts'
import css from './issue-view.module.css'

export interface IssueActivityProps {
  /** The Host's activity region: the newest fifty activities, newest first. */
  readonly activity: AgentTeamIssueActivity
  /** The display name of one Member. */
  readonly nameOf: (memberId: AgentTeamMemberId) => string
  readonly t: TeamConversationProps['t']
}

/**
 * The issue's activity: who claimed the Task, who it was assigned to, when it
 * was accepted, closed or reopened. The order is the Host's — newest first.
 */
export function IssueActivity({ activity, nameOf, t }: IssueActivityProps) {
  return (
    <section className={css.region} aria-label={t('issueActivityLabel')}>
      <h2 className={css.regionHeading}>{t('issueActivityLabel')}</h2>
      {activity.items.length === 0
        ? <p className={css.empty}>{t('issueActivityEmpty')}</p>
        : <div className={css.activityList}>
            {activity.items.map((item, index) => (
              <p className={css.activityRow} key={`${item.kind}:${index}`}>
                <span className={css.activityMark} aria-hidden="true" />
                <span className={css.activityText}>{formatActivity(item, { t, actorName: nameOf, claims: [] })}</span>
              </p>
            ))}
          </div>}
      {activity.hasMore && <p className={css.empty}>{t('issueActivityMore')}</p>}
    </section>
  )
}
