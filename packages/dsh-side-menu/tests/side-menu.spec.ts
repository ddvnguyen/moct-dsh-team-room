// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { apply } from '../src/client/index.ts'

// The markup @michengai/dsh-codex-ui 1.1.42 renders: the Extensions entries are
// inside the group's panel, and the trailing entries are direct children after
// it. The plugin must not move any of them.
const MENU = `
  <nav class="dcu-menu">
    <button type="button" class="dcu-global-panel" aria-label="Tasks">Tasks</button>
    <button type="button" class="dcu-global-panel" aria-label="Plugin Market">Plugin Market</button>
    <button type="button" class="dcu-global-panel" aria-label="Automation tasks">Automation tasks</button>
    <button type="button" class="dcu-global-panel" aria-label="Team">Team</button>
    <button type="button" class="dcu-global-panel" aria-label="Context Insights">Context Insights</button>
    <button type="button" class="dcu-global-panel" aria-label="Team Settings">Team Settings</button>
    <button type="button">New task</button>
    <div class="dcu-extensions-group">
      <button type="button" class="dcu-extensions-toggle" aria-expanded="true">Extensions</button>
      <div class="dcu-extension-panel" data-open="true">
        <div class="dcu-extension-panel-inner">
          <div class="dcu-extension-items">
            <button type="button">Experts</button>
            <button type="button">Skills</button>
            <button type="button">Plugins</button>
            <button type="button">Connectors</button>
          </div>
        </div>
      </div>
    </div>
    <button type="button">Scheduled tasks</button>
    <button type="button">IM Assistant</button>
  </nav>`

function mount(html: string): { nav: HTMLElement; stop: () => void } {
  document.body.innerHTML = html
  const nav = document.querySelector('nav.dcu-menu') as HTMLElement
  let cleanup: () => void = () => {}
  apply({
    effect: (fn) => {
      cleanup = fn()
    },
  })
  return { nav, stop: () => cleanup() }
}

async function settle(): Promise<void> {
  // One frame for the observer callback, one for the rAF it schedules.
  for (let i = 0; i < 3; i += 1) {
    await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)))
  }
}

function byLabel(nav: HTMLElement, label: string): HTMLElement {
  const match = Array.from(nav.querySelectorAll('button')).find(
    el => (el.getAttribute('aria-label') ?? el.textContent ?? '').trim() === label,
  )
  if (!match) throw new Error(`missing button: ${label}`)
  return match as HTMLElement
}

function group(nav: HTMLElement): HTMLElement {
  return nav.querySelector(':scope > .dcu-extensions-group') as HTMLElement
}

describe('dsh-side-menu', () => {
  it('keeps New task, Team, Team Settings and Context Insights at the top level', async () => {
    const { nav, stop } = mount(MENU)
    await settle()

    const expected = ['New task', 'Team', 'Team Settings', 'Context Insights']
    expected.forEach((label, index) => {
      const el = byLabel(nav, label)
      expect(el.style.order).toBe(String(index))
      expect(el.style.marginLeft).toBe('')
      expect(el.style.display).toBe('')
    })

    stop()
  })

  it('puts the Extensions group after the kept entries', async () => {
    const { nav, stop } = mount(MENU)
    await settle()

    expect(group(nav).style.order).toBe('4')
    expect(group(nav).style.marginLeft).toBe('')

    stop()
  })

  it('indents every other entry and orders it after the group', async () => {
    const { nav, stop } = mount(MENU)
    await settle()

    for (const label of ['Tasks', 'Plugin Market', 'Automation tasks', 'Scheduled tasks', 'IM Assistant']) {
      const el = byLabel(nav, label)
      expect(el.style.marginLeft).toBe('28px')
      expect(Number(el.style.order)).toBeGreaterThanOrEqual(100)
      expect(el.style.display).toBe('')
    }

    stop()
  })

  it('leaves the Extensions panel and its own entries alone', async () => {
    const { nav, stop } = mount(MENU)
    await settle()

    const panel = nav.querySelector('.dcu-extension-items') as HTMLElement
    expect(panel.style.display).toBe('')
    for (const label of ['Experts', 'Skills', 'Plugins', 'Connectors']) {
      expect(byLabel(nav, label).style.marginLeft).toBe('')
      expect(byLabel(nav, label).style.order).toBe('')
    }

    stop()
  })

  it('hides the grouped entries when Extensions is collapsed', async () => {
    const { nav, stop } = mount(MENU)
    await settle()

    byLabel(nav, 'Extensions').setAttribute('aria-expanded', 'false')
    await settle()

    expect(byLabel(nav, 'Tasks').style.display).toBe('none')
    expect(byLabel(nav, 'IM Assistant').style.display).toBe('none')
    expect(byLabel(nav, 'Team').style.display).toBe('')
    expect(byLabel(nav, 'New task').style.display).toBe('')
    expect(group(nav).style.display).toBe('')

    stop()
  })

  it('leaves a display write owned by another plugin in place', async () => {
    const { nav, stop } = mount(MENU)
    await settle()

    // @ddvnguyen/dsh-hide-im-assistant hides IM Assistant with an inline
    // display:none. Re-applying the layout must not reveal it.
    const hidden = byLabel(nav, 'IM Assistant')
    hidden.style.display = 'none'
    await settle()

    expect(hidden.style.display).toBe('none')

    stop()
  })

  it('never moves React-owned nodes out of the menu', async () => {
    const { nav, stop } = mount(MENU)
    await settle()

    expect(nav.querySelectorAll(':scope > button')).toHaveLength(9)
    expect(nav.querySelector(':scope > .dcu-extensions-group')).not.toBeNull()
    expect(group(nav).querySelectorAll('button')).toHaveLength(5)

    stop()
  })

  it('re-applies after the sidebar re-renders', async () => {
    const { stop } = mount(MENU)
    await settle()

    document.body.innerHTML = MENU
    await settle()

    const nav = document.querySelector('nav.dcu-menu') as HTMLElement
    expect(byLabel(nav, 'Team').style.order).toBe('1')
    expect(group(nav).style.order).toBe('4')

    stop()
  })
})
