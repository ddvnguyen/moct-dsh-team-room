// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import type { AgentTeamThreadRef } from '@ddvnguyen/moct-dsh-team-room/types'
import { zh } from '../src/client/locales.ts'
import type { TeamConversationProps } from '../src/client/slots.ts'
import { TeamLanes } from '../src/client/TeamLanes.tsx'
import { clampLaneWidth, LANE_DEFAULT_WIDTH, LANE_MIN_WIDTH, LANE_WIDTH_STORAGE_KEY, readLaneWidth } from '../src/client/lane-width.ts'

const t = ((key: keyof typeof zh) => zh[key]) as TeamConversationProps['t']
const threadRef = 'thread:one' as AgentTeamThreadRef

let seatWidth = 0
beforeEach(() => {
  localStorage.clear()
  seatWidth = 0
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const width = this.dataset['teamLanes'] === undefined ? 0 : seatWidth
    return { width, height: 800, top: 0, left: 0, right: width, bottom: 800, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const channel = <main data-testid="channel"><span data-thread-entry-ref={threadRef}><button type="button">打开 Thread</button></span></main>
const thread = (ref: AgentTeamThreadRef = threadRef) => ({
  threadRef: ref,
  render: (inLane: boolean) => <div data-testid="thread" data-in-lane={String(inLane)}><textarea aria-label="draft" /></div>,
})

describe('TeamLanes', () => {
  it('shows the Thread alone on a narrow seat', () => {
    seatWidth = 700
    const view = render(<TeamLanes channel={channel} thread={thread()} closeThread={() => {}} t={t} />)
    expect(view.queryByTestId('channel')).toBeNull()
    expect(view.getByTestId('thread').dataset['inLane']).toBe('false')
    expect(view.queryByRole('separator')).toBeNull()
  })

  it('keeps the Channel beside its Thread on a wide seat, with a keyboard-resizable split it remembers', () => {
    seatWidth = 1200
    const view = render(<TeamLanes channel={channel} thread={thread()} closeThread={() => {}} t={t} />)
    expect(view.getByTestId('channel')).toBeTruthy()
    expect(view.getByTestId('thread').dataset['inLane']).toBe('true')
    const separator = view.getByRole('separator', { name: zh.resizeThreadLane })
    expect(separator.getAttribute('aria-valuenow')).toBe(String(LANE_DEFAULT_WIDTH))
    fireEvent.keyDown(separator, { key: 'ArrowLeft' })
    expect(separator.getAttribute('aria-valuenow')).toBe(String(LANE_DEFAULT_WIDTH + 24))
    expect(localStorage.getItem(LANE_WIDTH_STORAGE_KEY)).toBe(String(LANE_DEFAULT_WIDTH + 24))
  })

  it('closes on Escape from the lane, but leaves Escape to a field', () => {
    seatWidth = 1200
    const closeThread = vi.fn()
    const view = render(<TeamLanes channel={channel} thread={thread()} closeThread={closeThread} t={t} />)
    fireEvent.keyDown(view.getByRole('textbox', { name: 'draft' }), { key: 'Escape' })
    expect(closeThread).not.toHaveBeenCalled()
    fireEvent.keyDown(view.getByTestId('thread'), { key: 'Escape' })
    expect(closeThread).toHaveBeenCalledTimes(1)
  })

  it('moves focus into the lane on open and back to the Thread row on close', () => {
    seatWidth = 1200
    const view = render(<TeamLanes channel={channel} closeThread={() => {}} t={t} />)
    view.rerender(<TeamLanes channel={channel} thread={thread()} closeThread={() => {}} t={t} />)
    expect(document.activeElement?.getAttribute('data-team-lane')).toBe('thread')
    view.rerender(<TeamLanes channel={channel} closeThread={() => {}} t={t} />)
    expect(document.activeElement?.textContent).toBe('打开 Thread')
  })

  it('clamps the lane between its minimum and what leaves the Channel its minimum', () => {
    expect(clampLaneWidth(100, 1200)).toBe(LANE_MIN_WIDTH)
    expect(clampLaneWidth(2000, 1200)).toBe(800)
    localStorage.setItem(LANE_WIDTH_STORAGE_KEY, 'not a number')
    expect(readLaneWidth()).toBe(LANE_DEFAULT_WIDTH)
  })
})
