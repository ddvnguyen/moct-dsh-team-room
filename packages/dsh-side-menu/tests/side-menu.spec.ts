// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { apply } from '../src/client/index.ts'

// The markup @michengai/dsh-codex-ui 1.1.43 renders with the sidebar patch
// applied: the panels the patch lists as top-level sit next to "New task", the
// Extensions group owns the panel with the built-in entries and the plugin
// panels that stay inside it, and the group is the menu's last child.
const MENU = `
  <nav class="dcu-menu">
    <button type="button">New task</button>
    <button type="button" class="dcu-global-panel">Context Insights</button>
    <button type="button" class="dcu-global-panel">Team Settings</button>
    <div class="dcu-extensions-group">
      <button type="button" class="dcu-extensions-toggle" aria-expanded="true">Extensions</button>
      <div class="dcu-extension-panel" data-open="true">
        <div class="dcu-extension-panel-inner">
          <div class="dcu-extension-items">
            <button type="button">Experts</button>
            <button type="button">Skills</button>
            <button type="button">Plugin manager</button>
            <button type="button">Connectors</button>
            <button type="button">Scheduled tasks</button>
            <button type="button">IM Assistant</button>
            <button type="button" class="dcu-global-panel">Plugin Market</button>
            <button type="button" class="dcu-global-panel">Automation tasks</button>
          </div>
        </div>
      </div>
    </div>
  </nav>`

// The markup codex-ui rendered before 1.1.39: the plugin panels were direct
// children of the menu, before "New task" and after the Extensions group. The
// plugin still folds those into the group, so the layout survives a host that
// did not take the patch.
const LEGACY_MENU = `
  <nav class="dcu-menu">
    <button type="button" class="dcu-global-panel" aria-label="Plugin Market">Plugin Market</button>
    <button type="button" class="dcu-global-panel" aria-label="Automation tasks">Automation tasks</button>
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
            <button type="button">Plugin manager</button>
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
  it('publishes the top-level panel ids for the patched host', () => {
    const { stop } = mount(MENU)
    const store = (globalThis as unknown as Record<string, { ids: Set<string> }>).__dshTopPanels
    expect(store).toBeDefined()
    expect([...store!.ids].sort()).toEqual(['agent-team-board', 'agent-team-settings', 'dsh-context'])
    stop()
  })

  it('keeps New task, Context Insights and Team Settings at the top level', async () => {
    const { nav, stop } = mount(MENU)
    await settle()

    const expected = ['New task', 'Context Insights', 'Team Settings']
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

    expect(group(nav).style.order).toBe('3')
    expect(group(nav).style.marginLeft).toBe('')

    stop()
  })

  it('leaves the Extensions panel and its own entries alone', async () => {
    const { nav, stop } = mount(MENU)
    await settle()

    const panel = nav.querySelector('.dcu-extension-items') as HTMLElement
    expect(panel.style.display).toBe('')
    for (const label of ['Experts', 'Skills', 'Plugin manager', 'Connectors', 'Plugin Market', 'Automation tasks']) {
      expect(byLabel(nav, label).style.marginLeft).toBe('')
      expect(byLabel(nav, label).style.order).toBe('')
    }

    stop()
  })

  it('never moves React-owned nodes out of the menu', async () => {
    const { nav, stop } = mount(MENU)
    await settle()

    expect(nav.querySelectorAll(':scope > button')).toHaveLength(3)
    expect(nav.querySelector(':scope > .dcu-extensions-group')).not.toBeNull()
    expect(group(nav).querySelectorAll('button')).toHaveLength(9)

    stop()
  })

  it('folds a host without the patch: the panels outside the group are indented and hidden with it', async () => {
    const { nav, stop } = mount(LEGACY_MENU)
    await settle()

    for (const label of ['Plugin Market', 'Automation tasks', 'Scheduled tasks', 'IM Assistant']) {
      const el = byLabel(nav, label)
      expect(el.style.marginLeft).toBe('28px')
      expect(Number(el.style.order)).toBeGreaterThanOrEqual(100)
      expect(el.style.display).toBe('')
    }

    byLabel(nav, 'Extensions').setAttribute('aria-expanded', 'false')
    await settle()

    expect(byLabel(nav, 'Plugin Market').style.display).toBe('none')
    expect(byLabel(nav, 'IM Assistant').style.display).toBe('none')
    expect(byLabel(nav, 'New task').style.display).toBe('')
    expect(group(nav).style.display).toBe('')

    stop()
  })

  it('leaves a display write owned by another plugin in place', async () => {
    const { nav, stop } = mount(LEGACY_MENU)
    await settle()

    // @ddvnguyen/dsh-hide-im-assistant hides IM Assistant with an inline
    // display:none. Re-applying the layout must not reveal it.
    const hidden = byLabel(nav, 'IM Assistant')
    hidden.style.display = 'none'
    await settle()

    expect(hidden.style.display).toBe('none')

    stop()
  })

  it('re-applies after the sidebar re-renders', async () => {
    const { stop } = mount(MENU)
    await settle()

    document.body.innerHTML = MENU
    await settle()

    const nav = document.querySelector('nav.dcu-menu') as HTMLElement
    expect(byLabel(nav, 'Context Insights').style.order).toBe('1')
    expect(group(nav).style.order).toBe('3')

    stop()
  })
})
