// Derived from multica-x packages/views/issues/components/inline-comment-run.tsx @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
//
// Rendering adapted: Multica's timeline draws one agent run inline between the
// comments it happened between. Here a run is one of the Thread's Session
// rows — the same rows the execution log renders — so the row is a summary
// (state, agent, duration) and the transcript is not rebuilt: "open full
// transcript" hands the run to the dsh session surface through the same
// `openMemberSession` seam the log's rows use. Steering and queueing stay in
// that surface; this row writes nothing.

import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AgentTeamSessionRun } from '@ddvnguyen/moct-dsh-team-room/types'
import { formatDuration, runDurationMs, RUN_STATE_LABEL_KEY, type RunState } from '../multica/task-run-labels.ts'
import { ActorAvatar } from '../multica-ui/ActorAvatar.tsx'
import type { TeamConversationProps } from '../slots.ts'
import css from './issue-timeline.module.css'

export interface IssueRunRowProps {
  readonly run: AgentTeamSessionRun
  /** The seat's live run: the row ticks its elapsed time and reads as running. */
  readonly running: boolean
  /** A recorded Turn of this run ended in error. */
  readonly failed: boolean
  /** The seat's handle, or its id when the roster no longer names it. */
  readonly handle: string
  /** One wall-clock instant, ticking only while a run is live. */
  readonly now: number
  readonly onOpenSession: () => void
  readonly t: TeamConversationProps['t']
}

/** The run's state as the timeline reads it: live, errored, or finished. */
export function runState(running: boolean, failed: boolean): RunState {
  if (running) return 'running'
  return failed ? 'failed' : 'completed'
}

/**
 * One agent run in the timeline: who ran, whether it is still running, and how
 * long it took. The transcript is one control away, in the dsh session.
 */
export function IssueRunRow({ run, running, failed, handle, now, onOpenSession, t }: IssueRunRowProps) {
  const state = runState(running, failed)
  const duration = running
    ? Math.max(0, now - Date.parse(run.startedAt))
    : runDurationMs({ startedAt: run.startedAt, endedAt: run.endedAt, running: false })
  return (
    <article className={css.run} data-issue-run="" data-run-state={state}>
      <ActorAvatar name={handle} kind="agent" size="sm" />
      <div className={css.runMain}>
        <span className={css.runHead}>
          <span className={css.runHandle}>{`@${handle}`}</span>
          <span className={css.runState} data-issue-run-state="">{t(RUN_STATE_LABEL_KEY[state] as Parameters<typeof t>[0])}</span>
          {duration !== null && <span className={css.runDuration} data-issue-run-duration="">{formatDuration(duration)}</span>}
        </span>
      </div>
      <Button size="sm" variant="outline" onClick={onOpenSession}>{t('issueRunOpenTranscript')}</Button>
    </article>
  )
}
