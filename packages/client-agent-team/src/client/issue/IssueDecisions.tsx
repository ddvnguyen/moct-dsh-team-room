// Derived from multica-x packages/views/issues/components/issue-detail.tsx @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
//
// Rendering adapted: Multica's decision list on the issue page — the ask cards
// and the recorded decisions — ported as the issue view's decisions region.
// The Host's region carries both row kinds (A5): a `card` row is an ask that
// has no decision yet, a `decision` row is a recorded decision, with the card
// it came from when the source was an ask. One decision, one row: the ask
// card renders in this region, never again in the comment region.

import type { AgentTeamDecisionAnswer, AgentTeamDecisionView, AgentTeamIssueDecision, AgentTeamMemberId } from '@ddvnguyen/moct-dsh-team-room/types'
import { TeamDecisionCard } from '../TeamDecisionCard.tsx'
import { formatMessageTime } from '../team-formatters.ts'
import type { TeamConversationProps } from '../slots.ts'
import css from './issue-view.module.css'

export interface IssueDecisionsProps {
  /** The Host's decisions region: the ask cards and the recorded decisions, oldest first. */
  readonly decisions: readonly AgentTeamIssueDecision[]
  /** The display name of one Member. */
  readonly nameOf: (memberId: AgentTeamMemberId) => string
  /**
   * Answers an open ask card. Resolves with the failure message, or undefined
   * when the Host committed the answer; the card then re-reads.
   */
  readonly onAnswer: (decision: AgentTeamDecisionView, answers: readonly AgentTeamDecisionAnswer[]) => Promise<string | undefined>
  readonly t: TeamConversationProps['t']
}

/**
 * The issue's decisions: what was asked, and what was decided. The Host
 * assembles the rows, so an ask that was decided appears once — as the
 * decision, with the card it came from.
 */
export function IssueDecisions({ decisions, nameOf, onAnswer, t }: IssueDecisionsProps) {
  return (
    <section className={css.region} aria-label={t('issueDecisionsLabel')} data-testid="issue-decisions">
      <h2 className={css.regionHeading}>{t('issueDecisionsLabel')}</h2>
      {decisions.length === 0
        ? <p className={css.empty}>{t('issueDecisionsEmpty')}</p>
        : <div className={css.decisionList}>
            {decisions.map(row => {
              if (row.kind === 'card') {
                return <TeamDecisionCard key={row.card.decisionRef} decision={row.card} nameOf={nameOf}
                  answer={answers => onAnswer(row.card, answers)} t={t} />
              }
              return (
                <article className={css.decisionRow} data-testid="issue-decision" key={row.record.recordRef}>
                  <p className={css.decisionHead}>{row.record.decided}</p>
                  {row.record.rationale !== '' && <p className={css.description}>{row.record.rationale}</p>}
                  <p className={css.decisionMeta}>
                    {nameOf(row.record.decidedBy)} · {formatMessageTime(row.record.decidedAt)}
                    {row.card !== undefined ? ` · ${t('issueDecisionFromAsk')}` : ''}
                  </p>
                </article>
              )
            })}
          </div>}
    </section>
  )
}
