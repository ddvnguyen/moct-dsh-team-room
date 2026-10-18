// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { apply } from '../src/client.ts'

const MENU = `
  <nav class="dcu-menu">
    <button type="button">New task</button>
    <button type="button" aria-expanded="true">Extensions</button>
    <button type="button">Experts</button>
    <button type="button">Skills</button>
    <button type="button">Plugins</button>
    <button type="button">Connectors</button>
    <button type="button">Schedule</button>
    <button type="button">IM Assistant</button>
    <button type="button">Team Settings</button>
    <button type="button">Context Insights</button>
    <button type="button">Team</button>
    <button type="button">Agents</button>
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
    el => (el.textContent ?? '').trim() === label,
  )
  if (!match) throw new Error(`missing button: ${label}`)
  return match as HTMLElement
}

describe('dsh-side-menu', () => {
  it('keeps the MOCT entries at the top level, in order', async () => {
    const { nav, stop } = mount(MENU)
    await settle()

    const expected = ['New task', 'Team', 'Agents', 'Team Settings', 'Context Insights']
    expected.forEach((label, index) => {
      expect(byLabel(nav, label).style.order).toBe(String(index))
      expect(byLabel(nav, label).style.marginLeft).toBe('')
    })

    stop()
  })

  it('presents the remaining entries as the Extensions group', async () => {
    const { nav, stop } = mount(MENU)
    await settle()

    for (const label of ['Experts', 'Skills', 'Plugins', 'Connectors', 'Schedule', 'IM Assistant']) {
      const el = byLabel(nav, label)
      expect(el.style.marginLeft).toBe('28px')
      expect(el.style.display).toBe('')
    }

    stop()
  })

  it('hides grouped entries when Extensions is collapsed', async () => {
    const { nav, stop } = mount(MENU)
    await settle()

    byLabel(nav, 'Extensions').setAttribute('aria-expanded', 'false')
    await settle()

    expect(byLabel(nav, 'Experts').style.display).toBe('none')
    expect(byLabel(nav, 'Team').style.display).toBe('')
    expect(byLabel(nav, 'New task').style.display).toBe('')

    stop()
  })

  it('hides the React panel so grouped entries are not rendered twice', async () => {
    const withPanel = MENU.replace(
      '<button type="button">Connectors</button>',
      '<div class="dcu-extension-items"><button type="button">Connectors</button></div>',
    )
    const { nav, stop } = mount(withPanel)
    await settle()

    const panel = nav.querySelector('.dcu-extension-items') as HTMLElement
    expect(panel.style.display).toBe('none')

    stop()
  })

  it('never moves React-owned nodes out of the menu', async () => {
    const { nav, stop } = mount(MENU)
    await settle()

    expect(nav.querySelectorAll(':scope > button')).toHaveLength(12)
    expect(nav.querySelector('.dcu-extension-items')).toBeNull()

    stop()
  })

  it('re-applies after the sidebar re-renders', async () => {
    const { stop } = mount(MENU)
    await settle()

    document.body.innerHTML = MENU
    await settle()

    const nav = document.querySelector('nav.dcu-menu') as HTMLElement
    expect(byLabel(nav, 'Team').style.order).toBe('1')

    stop()
  })
})
