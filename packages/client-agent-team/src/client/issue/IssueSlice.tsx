// Derived from multica-x packages/views/issues/components/issue-peek.tsx @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
//
// Rendering adapted: the slice presentation of the issue view — a dialog over
// whatever screen the reader is on, with the face behind it live and
// interactive. The regions are M-35's shared tree; this is the chrome around
// them, and the surface that reads them is M-35's, so the slice and the page
// read the same value and write through the same paths.
//
// The panel is anchored to the right edge instead of centred: the reader keeps
// the face they were on in view, the way GitHub Projects' issue panel does,
// and the edge is theirs to drag — the width is a browser-local preference
// (`panel-width.ts`), never a Team fact. Escape closes it and the focus goes
// back to the opener; that seam is the host's (M-38), this panel only stops
// swallowing the key the way the dsh `Modal` used to.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, IconCloseOutlineRegular, IconFullscreenOutlineRegular, IconRightUpOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { IssueSurface, type IssueSurfaceProps } from './IssueSurface.tsx'
import { PANEL_KEY_STEP, PANEL_MIN_WIDTH, clampPanelWidth, persistPanelWidth, readPanelWidth } from './panel-width.ts'
import type { PeekStepKey } from './peek-order.ts'
import look from '../multica-look.module.css'
import css from './issue-slice.module.css'

export interface IssueSliceProps extends Omit<IssueSurfaceProps, 'variant'> {
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
  /**
   * One step of the walk the face behind published: the panel owns the keys
   * (J/K/H/L and their arrows), the order they walk is the host's to know.
   */
  readonly step: (key: PeekStepKey) => void
}

/** The width below which the wide overlay stops working. */
const NARROW_QUERY = '(max-width: 768px)'

/** The letter keys, by the key the browser reports with no modifier held. */
const LETTER_STEPS: Readonly<Record<string, PeekStepKey>> = { j: 'j', k: 'k', h: 'h', l: 'l' }

/** The arrows mirroring them: down/up along the column, left/right across. */
const ARROW_STEPS: Readonly<Record<string, PeekStepKey>> = { ArrowDown: 'j', ArrowUp: 'k', ArrowLeft: 'h', ArrowRight: 'l' }

/**
 * A composite widget the arrows belong to: tabs, radios, sliders and spin
 * buttons move their own value, and `select` is caught by the field guard.
 */
function isArrowWidget(target: EventTarget | null): boolean {
  return target instanceof Element
    && target.closest('[role="tab"], [role="radio"], [role="slider"], [role="spinbutton"]') !== null
}

/** A field or a menu the keys are theirs: the composer, the title editor, a picker. */
function isFieldTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    && (target.isContentEditable || target.closest('textarea, input, select, [role="menu"], [role="listbox"]') !== null)
}

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
 * The issue slice: the issue view as a panel anchored to the right edge.
 *
 * The face behind stays live — the slice is an overlay, not a place — and the
 * panel reads the same value the page reads. `Esc` closes it and returns the
 * focus to the opener, the left edge drags (Arrow keys nudge it by the same
 * 24px step the lane splitter uses), and Maximize turns it into the page over
 * the same face.
 */
export function IssueSlice(props: IssueSliceProps) {
  const narrow = useNarrowViewport()
  // Under the narrow width the wide overlay stops working, so the issue
  // degrades to the page variant: the slot's variant is the client's business,
  // and the page is the presentation that fits.
  useEffect(() => {
    if (narrow) props.maximize()
  }, [narrow, props])

  const { closeIssue } = props
  const panelRef = useRef<HTMLElement>(null)
  const [width, setWidth] = useState(() => clampPanelWidth(readPanelWidth(), typeof window === 'undefined' ? 0 : window.innerWidth))
  // The width the last change produced: the drag end persists it without
  // waiting for a render, so a fast drag writes once, on release.
  const widthRef = useRef(width)

  /** Moves the panel's edge: clamped to the viewport, tracked in the ref. */
  const applyWidth = useCallback((next: number): void => {
    const clamped = clampPanelWidth(next, window.innerWidth)
    widthRef.current = clamped
    setWidth(clamped)
  }, [])

  // The stored width is a preference, not a promise: a window narrower than it
  // clamps the panel instead of letting it hang off the screen.
  useEffect(() => {
    const onResize = (): void => { applyWidth(widthRef.current) }
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('resize', onResize) }
  }, [applyWidth])

  // The panel takes the focus when it opens, so the keyboard starts inside the
  // dialog; the host gives it back to the opener when the issue closes.
  useEffect(() => { panelRef.current?.focus({ preventScroll: true }) }, [])

  // Escape closes the slice from anywhere inside it, the way the dsh `Modal`
  // did before the panel owned its own layer — except where a control inside
  // already took the key: the title editor's Escape cancels the edit, and an
  // open menu's Escape closes the menu. Closing the panel under them would
  // swallow the edit the reader was making, so a default-prevented Escape is
  // not the panel's.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (event.defaultPrevented) return
      event.stopPropagation()
      closeIssue()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [closeIssue])

  // The panel's walk (M-69): J/K step through the order the face behind
  // published, H/L between its columns, and the arrows mirror them. The order
  // is the host's — this reads the keys and hands the host one step.
  //
  // The arrows are the reader's, though, not the walk's: the panel takes the
  // focus when it opens, and a click inside it means they are reading it, so
  // there the arrows scroll the pane they are over instead of jumping issues.
  // A composite widget keeps its arrows either way, and a field keeps its
  // keys — the composer inside the panel is a field.
  useEffect(() => {
    let readingPanel = false
    const onPointerDown = (event: PointerEvent): void => {
      readingPanel = panelRef.current?.contains(event.target as Node) ?? false
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.repeat || event.isComposing) return
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
      if (isFieldTarget(event.target)) return
      let key = LETTER_STEPS[event.key]
      if (key === undefined) {
        const arrow = ARROW_STEPS[event.key]
        if (arrow === undefined) return
        const inPanel = readingPanel || (panelRef.current?.contains(event.target as Node) ?? false)
        if (inPanel || isArrowWidget(event.target)) return
        key = arrow
      }
      event.preventDefault()
      props.step(key)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [props.step])

  const startDrag = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    const handle = event.currentTarget
    handle.setPointerCapture?.(event.pointerId)
    const onMove = (move: PointerEvent): void => { applyWidth(window.innerWidth - move.clientX) }
    const onEnd = (): void => {
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onEnd)
      handle.removeEventListener('pointercancel', onEnd)
      persistPanelWidth(widthRef.current)
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onEnd)
    handle.addEventListener('pointercancel', onEnd)
  }

  const nudgeWidth = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    applyWidth(widthRef.current + (event.key === 'ArrowLeft' ? PANEL_KEY_STEP : -PANEL_KEY_STEP))
    persistPanelWidth(widthRef.current)
  }

  const widest = clampPanelWidth(Number.MAX_SAFE_INTEGER, typeof window === 'undefined' ? 0 : window.innerWidth)

  return (
    <aside
      ref={panelRef}
      className={`${css.panel} ${look.multicaLook}`}
      role="dialog"
      aria-label={props.t('issueSliceLabel')}
      tabIndex={-1}
      style={{ width: `${width}px` }}
      data-team-issue-panel=""
    >
      <div
        className={css.handle}
        role="separator"
        aria-orientation="vertical"
        aria-label={props.t('issuePanelResize')}
        aria-valuemin={PANEL_MIN_WIDTH}
        aria-valuemax={widest}
        aria-valuenow={width}
        tabIndex={0}
        onPointerDown={startDrag}
        onKeyDown={nudgeWidth}
        data-testid="issue-panel-resize"
      />
      <div className={`${css.sliceBody} ${look.multicaLook}`} data-team-issue-slice="" data-testid="issue-slice">
        <div className={css.bar}>
          <Button size="sm" icon={<IconFullscreenOutlineRegular size={16} />} aria-label={props.t('issueMaximize')} title={props.t('issueMaximize')} onClick={props.maximize} data-testid="issue-maximize" />
          <Button size="sm" icon={<IconCloseOutlineRegular size={16} />} aria-label={props.t('issueClose')} title={props.t('issueClose')} onClick={props.closeIssue} data-testid="issue-close" />
          <Button size="sm" icon={<IconRightUpOutlineRegular size={16} />} aria-label={props.t('issueOpenLegacyThread')} title={props.t('issueOpenLegacyThread')} onClick={props.goToThread} data-testid="issue-open-legacy-thread" />
        </div>
        <div className={css.tree}>
          <IssueSurface {...props} variant="slice" onOpenLegacyThread={props.goToThread} />
        </div>
      </div>
    </aside>
  )
}
