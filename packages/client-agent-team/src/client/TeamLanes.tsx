import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import type { AgentTeamThreadRef } from '@ddvnguyen/moct-dsh-team-room/types'
import type { TeamConversationProps } from './slots.ts'
import { clampLaneWidth, LANE_KEY_STEP, LANE_MIN_WIDTH, persistLaneWidth, readLaneWidth, TWO_LANE_MIN_SEAT_WIDTH } from './lane-width.ts'
import css from './lanes.module.css'

interface TeamLanesProps {
  /** The Channel page, when a Channel is selected. */
  readonly channel?: ReactNode
  /** The open Thread; `inLane` says whether it renders beside its Channel or alone. */
  readonly thread?: { readonly threadRef: AgentTeamThreadRef; readonly render: (inLane: boolean) => ReactNode }
  /** Close the Thread and keep its Channel. */
  readonly closeThread: () => void
  readonly t: TeamConversationProps['t']
}

/** Whether a key press belongs to a field or a dialog, which keep Escape for themselves. */
function keepsEscape(target: EventTarget): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || target.closest('textarea, input, select, [role="dialog"], [role="menu"], [role="listbox"]') !== null
}

/**
 * The Team seat's two lanes: the Channel stays in the main lane and its open
 * Thread sits beside it, the way a project chat keeps a thread open next to
 * it. The Team owns this split inside its own seat: the Harness right Sidebar
 * is bound to the current Harness Session, which Team mode is not.
 *
 * A seat narrower than `TWO_LANE_MIN_SEAT_WIDTH` shows the Thread alone, as a
 * page of its own. Children keep stable keys, so crossing that width or
 * opening a Thread never remounts the Channel page or the Thread page.
 */
export function TeamLanes({ channel, thread, closeThread, t }: TeamLanesProps) {
  const seatRef = useRef<HTMLDivElement>(null)
  const laneRef = useRef<HTMLDivElement>(null)
  const [seatWidth, setSeatWidth] = useState(0)
  const [laneWidth, setLaneWidth] = useState(readLaneWidth)
  const dragging = useRef<{ readonly pointerId: number } | undefined>(undefined)

  // Measured before paint, so a wide seat never flashes the single-lane face first.
  useLayoutEffect(() => {
    const seat = seatRef.current
    if (seat === null) return
    setSeatWidth(seat.getBoundingClientRect().width)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(entries => {
      const entry = entries[0]
      if (entry !== undefined) setSeatWidth(entry.contentRect.width)
    })
    observer.observe(seat)
    return () => { observer.disconnect() }
  }, [])

  const twoLanes = channel !== undefined && thread !== undefined && seatWidth >= TWO_LANE_MIN_SEAT_WIDTH
  const width = clampLaneWidth(laneWidth, seatWidth)

  // Focus follows the Thread: into the lane when one opens beside the Channel,
  // and back to that Thread's entry row when the lane closes. A first render
  // (a reload restoring both lanes) moves nothing.
  const openThreadRef = thread?.threadRef
  const previousThread = useRef(openThreadRef)
  useEffect(() => {
    const previous = previousThread.current
    previousThread.current = openThreadRef
    if (previous === openThreadRef) return
    if (openThreadRef !== undefined && twoLanes) laneRef.current?.focus({ preventScroll: true })
    else if (openThreadRef === undefined && previous !== undefined) {
      seatRef.current?.querySelector<HTMLElement>(`[data-thread-entry-ref="${CSS.escape(previous)}"] button`)?.focus({ preventScroll: true })
    }
  }, [openThreadRef, twoLanes])

  const resizeTo = (next: number): void => {
    const clamped = clampLaneWidth(next, seatWidth)
    setLaneWidth(clamped)
    persistLaneWidth(clamped)
  }
  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragging.current = { pointerId: event.pointerId }
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (dragging.current?.pointerId !== event.pointerId) return
    const seat = seatRef.current?.getBoundingClientRect()
    if (seat !== undefined) setLaneWidth(clampLaneWidth(seat.right - event.clientX, seat.width))
  }
  const onPointerUp = (event: PointerEvent<HTMLDivElement>): void => {
    if (dragging.current?.pointerId !== event.pointerId) return
    dragging.current = undefined
    persistLaneWidth(width)
  }
  const onSeparatorKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'ArrowLeft') { event.preventDefault(); resizeTo(width + LANE_KEY_STEP) }
    if (event.key === 'ArrowRight') { event.preventDefault(); resizeTo(width - LANE_KEY_STEP) }
  }
  const onLaneKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Escape' || event.defaultPrevented || keepsEscape(event.target)) return
    event.preventDefault()
    closeThread()
  }

  const showChannel = channel !== undefined && (thread === undefined || twoLanes)
  return <div ref={seatRef} className={twoLanes ? `${css.seat} ${css.twoLanes}` : css.seat} data-team-lanes={twoLanes ? 'two' : 'one'}
    style={twoLanes ? { gridTemplateColumns: `minmax(0, 1fr) auto ${width}px` } : undefined}>
    {showChannel && <div key="channel" className={css.lane} data-team-lane="channel">{channel}</div>}
    {twoLanes && <div key="separator" className={css.separator} role="separator" aria-orientation="vertical" aria-label={t('resizeThreadLane')}
      aria-valuemin={LANE_MIN_WIDTH} aria-valuemax={clampLaneWidth(Number.POSITIVE_INFINITY, seatWidth)} aria-valuenow={width} tabIndex={0}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onKeyDown={onSeparatorKey} />}
    {thread !== undefined && <div key={`thread:${thread.threadRef}`} ref={laneRef} className={css.lane} data-team-lane="thread" tabIndex={-1}
      onKeyDown={twoLanes ? onLaneKey : undefined}>{thread.render(twoLanes)}</div>}
  </div>
}
