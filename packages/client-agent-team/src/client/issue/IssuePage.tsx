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
//
// The way out of the issue is the header's, not a footer's: back to the slice,
// close, and the legacy Thread are icon controls on the fixed band, the way
// Multica's issue header carries them. The footer row M-38 shipped is gone —
// nothing pinned it below a scrolling body, so it only ever sat under the fold.

import { IssueSurface, type IssueSurfaceProps } from './IssueSurface.tsx'
import look from '../multica-look.module.css'
import css from './issue-view.module.css'

export interface IssuePageProps extends Omit<IssueSurfaceProps, 'variant'> {
  /** Closes the issue surface; the face behind it stays where it was. */
  readonly closeIssue: () => void
  /**
   * Puts the issue back into its slice presentation: the same slot, the same
   * Task, the dialog over the face the reader came from. The variant switch
   * runs both ways, so a reader who maximized the slice can go back to it.
   */
  readonly showSlice: () => void
  /**
   * Opens the Task's Thread, the legacy surface D10 froze. The page carries
   * the same control the slice does — one control, both presentations — so
   * the Thread is never more than one step from the issue.
   */
  readonly goToThread: () => void
}

/**
 * The issue page: the whole column shows one issue, its regions and the
 * Human's writes. The page is one presentation of the shared surface — the
 * slice dialog is the other, and both read the same value. The page is the
 * `page` variant: it carries the sidebar, and with it the execution-log
 * section.
 */
export function IssuePage(props: IssuePageProps) {
  return (
    <main className={`${look.multicaLook} ${css.pageSurface}`} data-team-issue-page data-testid="issue-page">
      <IssueSurface
        {...props}
        variant="page"
        onOpenLegacyThread={props.goToThread}
        onBackToPanel={props.showSlice}
        onCloseIssue={props.closeIssue}
        sidebarCollapsed={props.sidebarCollapsed}
        openSidebar={props.openSidebar}
      />
    </main>
  )
}
