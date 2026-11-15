// @vitest-environment jsdom
//
// `@ddvnguyen/dsh-sidebar` is now a re-export alias of the mmx-customization
// client half, kept published for one release. Two facts matter, and both are
// asserted here:
//
//  - installing this package alone still produces the sidebar rows the old
//    package produced (the implementation is the same one, not a fork of it);
//  - a profile that carries BOTH rows mounts one pass, not two — the mmx client
//    entry owns the scheduled pass per page and the second `apply` no-ops.
import { afterEach, describe, expect, it } from 'vitest'
import { MARKER, apply } from '../src/client/index.ts'
import { apply as mmxApply } from '@ddvnguyen/mmx-customization/client'

const MENU = `
  <nav class="dcu-menu">
    <button type="button">New task</button>
    <button type="button" class="dcu-global-panel">Context Insights</button>
    <button type="button" class="dcu-global-panel">Team Detail</button>
    <div class="dcu-extensions-group">
      <button type="button" class="dcu-extensions-toggle" aria-expanded="true">Extensions</button>
      <div class="dcu-extension-panel" data-open="true">
        <button type="button">Experts</button>
        <button type="button">IM Assistant</button>
      </div>
    </div>
  </nav>`

const disposers: (() => void)[] = []

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose()
  document.body.innerHTML = ''
})

const byLabel = (label: string): HTMLElement => {
  const match = Array.from(document.querySelectorAll<HTMLElement>('button'))
    .find(el => (el.getAttribute('aria-label') ?? el.textContent ?? '').trim() === label)
  if (match === undefined) throw new Error(`missing button: ${label}`)
  return match
}

const settle = async (): Promise<void> => {
  const tick = Promise.withResolvers<void>()
  setTimeout(tick.resolve, 0)
  await tick.promise
  for (let frame = 0; frame < 2; frame++) {
    const next = Promise.withResolvers<void>()
    requestAnimationFrame(() => next.resolve())
    await next.promise
  }
}

/** Mount one entry over the fixture and keep its disposer. */
function mount(entry: typeof apply): void {
  document.body.innerHTML = MENU
  entry({
    effect: (fn) => {
      disposers.push(fn())
    },
  })
}

describe('dsh-sidebar alias', () => {
  it('shows the same rows the old package showed', async () => {
    mount(apply)
    await settle()

    const expected = ['New task', 'Context Insights', 'Team Detail']
    for (const [index, label] of expected.entries()) {
      expect(byLabel(label).style.order).toBe(String(index))
      expect(byLabel(label).style.display).toBe('')
    }
    expect(byLabel('IM Assistant').style.display).toBe('none')
    expect(byLabel('IM Assistant').hasAttribute(MARKER)).toBe(true)
    expect(byLabel('Experts').style.marginLeft).toBe('')
  })

  it('runs one pass when the mmx row and this alias are both mounted', async () => {
    document.body.innerHTML = MENU
    for (const entry of [mmxApply, apply]) {
      entry({
        effect: (fn) => {
          disposers.push(fn())
        },
      })
    }
    await settle()

    // Both observers would each schedule their own pass for one mutation; one
    // pass means one animation frame.
    const win = document.defaultView
    if (win === null) throw new Error('no window')
    const original = win.requestAnimationFrame.bind(win)
    let scheduled = 0
    win.requestAnimationFrame = (callback: FrameRequestCallback): number => {
      scheduled += 1
      return original(callback)
    }
    try {
      document.body.insertAdjacentHTML('beforeend', '<span></span>')
      await new Promise<void>(resolve => { setTimeout(resolve, 10) })
    } finally {
      win.requestAnimationFrame = original
    }

    expect(scheduled).toBe(1)
    expect(byLabel('IM Assistant').style.display).toBe('none')
  })
})
