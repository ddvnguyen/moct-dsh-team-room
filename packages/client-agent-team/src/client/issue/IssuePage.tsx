// Derived from multica-x packages/views/issues/components/issue-detail.tsx @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
//
// Rendering adapted: the page presentation of the issue view — the whole
// column, the issue's read model in one snapshot, and the Human's writes
// through the Host's own paths. The regions themselves live in the shared
// tree (`IssueView`) and the surface that reads them lives in
// `IssueSurface`; this host is the arrangement around them, and the slice
// dialog (M-38) is the other arrangement over the same surface.
//
// The writes are not optimistic: the Remote commits, the change-wake refetches,
// and only then does the field settle. A rejected write leaves the field where
// it was and says why; a stale revision is a business outcome, not an error.

import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import look from '../multica-look.module.css'
import { IssueSurface, type IssueSurfaceProps } from './IssueSurface.tsx'
import css from './issue-view.module.css'

export interface IssuePageProps extends IssueSurfaceProps {
  /** Closes the issue surface; the face behind it stays where it was. */
  readonly closeIssue: () => void
  /**
   * Puts the issue back into its slice presentation: the same slot, the same
   * Task, the dialog over the face the reader came from. The variant switch
   * runs both ways, so a reader who maximized the slice can go back to it.
   */
  readonly showSlice: () => void
}

/**
 * The issue page: the whole column shows one issue, its seven regions and the
 * Human's writes. The page is one presentation of the shared surface — the
 * slice dialog is the other, and both read the same value.
 */
export function IssuePage(props: IssuePageProps) {
  return (
    <main className={`${look.multicaLook} ${css.pageSurface}`} data-team-issue-page>
      <IssueSurface {...props} />
      <div className={css.pageFoot}>
        <Button size="sm" variant="outline" onClick={props.showSlice}>{props.t('issueBackToSlice')}</Button>
        <Button size="sm" variant="outline" onClick={props.closeIssue}>{props.t('issueClose')}</Button>
      </div>
    </main>
  )
}
