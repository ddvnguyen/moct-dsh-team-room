// Derived from multica-x packages/views/issues/components/issue-peek.tsx @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
//
// Rendering adapted: the slice presentation of the issue view — a dialog over
// whatever screen the reader is on, with the face behind it live and
// interactive. The regions are M-35's shared tree; this is the chrome around
// them, and the surface that reads them is M-35's, so the slice and the page
// read the same value and write through the same paths.
//
// The width is the owner's screenshot's: a wide overlay (GitHub Projects'
// issue panel), not upstream's 520px peek — the screenshot supersedes the
// peek (the Architect's plan on M-38, 05:50:41Z).

import { useEffect, useState } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { IssueSurface, type IssueSurfaceProps } from './IssueSurface.tsx'
import look from '../multica-look.module.css'
import css from './issue-slice.module.css'

export interface IssueSliceProps extends IssueSurfaceProps {
  /** Closes the slice: the face behind it stays exactly where it was. */
  readonly closeIssue: () => void
  /** Maximize: the slice becomes the whole-column page, over the same face. */
  readonly maximize: () => void
  /**
   * Opens the Task's Thread. The board card opens the issue, so the Thread
   * the card used to open is one control away — the affordance the board
   * already had, kept.
   */
  readonly goToThread: () => void
}

/** The width below which the wide overlay stops working. */
const NARROW_QUERY = '(max-width: 768px)'

/**
 * True while the viewport is too narrow for the wide overlay. The slice asks
 * for the page variant there, so the issue is still open — it is the
 * presentation that changes, not the position.
 */
function useNarrowViewport(): boolean {
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined
    const query = window.matchMedia(NARROW_QUERY)
    const update = (): void => { setNarrow(query.matches) }
    update()
    query.addEventListener('change', update)
    return () => { query.removeEventListener('change', update) }
  }, [])
  return narrow
}

/**
 * The issue slice: the issue view as a dialog over the current screen.
 *
 * The face behind stays live — the slice is an overlay, not a place — and the
 * dialog reads the same value the page reads. `Esc` closes it and returns the
 * focus to the opener (the dsh `Modal` owns that), and Maximize turns it into
 * the page over the same face.
 */
export function IssueSlice(props: IssueSliceProps) {
  const narrow = useNarrowViewport()
  // Under the narrow width the wide overlay stops working, so the issue
  // degrades to the page variant: the slot's variant is the client's business,
  // and the page is the presentation that fits.
  useEffect(() => {
    if (narrow) props.maximize()
  }, [narrow, props])

  return (
    <Modal
      open
      onClose={props.closeIssue}
      title={props.t('issueSliceLabel')}
      headless
      className={`${css.dialog}`}
      contentClassName={`${css.content} ${look.multicaLook}`}
    >
      <div className={`${css.sliceBody} ${look.multicaLook}`} data-team-issue-slice="" data-testid="issue-slice">
        <div className={css.bar}>
          <Button size="sm" variant="outline" onClick={props.maximize} data-modal-autofocus="" data-testid="issue-maximize">
            {props.t('issueMaximize')}
          </Button>
          <Button size="sm" variant="outline" onClick={props.closeIssue} data-testid="issue-close">
            {props.t('issueClose')}
          </Button>
        </div>
        <div className={css.tree}>
          <IssueSurface {...props} onOpenLegacyThread={props.goToThread} />
        </div>
      </div>
    </Modal>
  )
}
