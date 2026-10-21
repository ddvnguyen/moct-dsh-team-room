// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { MARKER } from '../src/hide.ts'
import { apply } from '../src/client/index.ts'

// The markup @michengai/dsh-codex-ui 1.1.43 renders with the sidebar patch
// applied: the panels the patch lists as top-level sit next to "New task", the
// Extensions group owns the panel with the built-in entries, and the group is
// the menu's last child.
const MENU = `
  <nav class="dcu-menu">
    <button type="button">New task</button>
    <button type="button" class="dcu-global-panel">Context Insights</button>
    <button type="button" class="dcu-global-panel">Team Detail</button>
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
    <button type="button" class="dcu-global-panel" aria-label="Team Detail">Team Detail</button>
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

const disposers: (() => void)[] = []

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose()
  document.body.innerHTML = ''
})

/** Mount the client half over a sidebar fixture; returns the disposer. */
function mount(html: string): () => void {
  document.body.innerHTML = html
  let dispose = (): void => {}
  apply({
    effect: (fn) => {
      dispose = fn()
    },
  })
  disposers.push(() => dispose())
  return () => dispose()
}

const byLabel = (label: string): HTMLElement => {
  const match = Array.from(document.querySelectorAll<HTMLElement>('button'))
    .find(el => (el.getAttribute('aria-label') ?? el.textContent ?? '').trim() === label)
  if (match === undefined) throw new Error(`missing button: ${label}`)
  return match
}

const group = (): HTMLElement => {
  const found = document.querySelector<HTMLElement>('nav.dcu-menu > .dcu-extensions-group')
  if (found === null) throw new Error('missing Extensions group')
  return found
}

/** The store the plugin publishes for the patched codex-ui. */
const topPanels = (): { ids: Set<string> } => {
  const scope: Record<string, unknown> = globalThis as unknown as Record<string, unknown>
  const store = scope['__dshTopPanels']
  if (typeof store !== 'object' || store === null) throw new Error('the plugin published no panel policy')
  if (!('ids' in store) || !(store.ids instanceof Set)) {
    throw new Error('the published panel policy carries no id set')
  }
  return { ids: store.ids }
}

/** Let the MutationObserver callback and the scheduled animation frame run. */
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

describe('dsh-sidebar', () => {
  it('publishes the top-level panel ids for the patched host', () => {
    mount(MENU)
    expect([...topPanels().ids].sort()).toEqual(['agent-team-board', 'agent-team-settings', 'dsh-context'])
  })

  it('keeps New task, Context Insights and Team Detail at the top level', async () => {
    mount(MENU)
    await settle()
    const expected = ['New task', 'Context Insights', 'Team Detail']
    for (const [index, label] of expected.entries()) {
      const el = byLabel(label)
      expect(el.style.order).toBe(String(index))
      expect(el.style.marginLeft).toBe('')
      expect(el.style.display).toBe('')
    }
    expect(group().style.order).toBe('3')
    expect(group().style.marginLeft).toBe('')
  })

  it('leaves the Extensions panel and its own entries alone', async () => {
    mount(MENU)
    await settle()
    for (const label of ['Experts', 'Skills', 'Plugin manager', 'Connectors', 'Plugin Market', 'Automation tasks']) {
      expect(byLabel(label).style.marginLeft).toBe('')
      expect(byLabel(label).style.order).toBe('')
    }
  })

  it('hides the IM Assistant entry in the patched menu and marks it', async () => {
    mount(MENU)
    await settle()
    const el = byLabel('IM Assistant')
    expect(el.style.display).toBe('none')
    expect(el.hasAttribute(MARKER)).toBe(true)
  })

  it('hides the Chinese IM Assistant entry too', async () => {
    mount(MENU.replace('IM Assistant', 'IM助理'))
    await settle()
    const el = byLabel('IM助理')
    expect(el.style.display).toBe('none')
    expect(el.hasAttribute(MARKER)).toBe(true)
  })

  it('folds a host without the patch: the panels outside the group are indented and hidden with it', async () => {
    mount(LEGACY_MENU)
    await settle()
    for (const label of ['Plugin Market', 'Automation tasks', 'Scheduled tasks']) {
      const el = byLabel(label)
      expect(el.style.marginLeft).toBe('28px')
      expect(Number(el.style.order)).toBeGreaterThanOrEqual(100)
      expect(el.style.display).toBe('')
    }

    byLabel('Extensions').setAttribute('aria-expanded', 'false')
    await settle()
    expect(byLabel('Plugin Market').style.display).toBe('none')
    expect(byLabel('New task').style.display).toBe('')
    expect(group().style.display).toBe('')
  })

  it('keeps the IM Assistant entry hidden when the Extensions group expands again', async () => {
    mount(LEGACY_MENU)
    await settle()
    expect(byLabel('IM Assistant').style.display).toBe('none')

    byLabel('Extensions').setAttribute('aria-expanded', 'false')
    await settle()
    expect(byLabel('IM Assistant').style.display).toBe('none')

    byLabel('Extensions').setAttribute('aria-expanded', 'true')
    await settle()
    // The layout releases the entries it hid itself ...
    expect(byLabel('Scheduled tasks').style.display).toBe('')
    // ... but the IM-assistant rule owns its own `display` write, so the
    // entry stays hidden.
    expect(byLabel('IM Assistant').style.display).toBe('none')
    expect(byLabel('IM Assistant').hasAttribute(MARKER)).toBe(true)
  })

  it('keeps the entry hidden when its label arrives after the layout hid it', async () => {
    const late = LEGACY_MENU.replace('<button type="button">IM Assistant</button>', '<button type="button"><span class="dcu-entry-label"></span></button>')
    mount(late)
    await settle()
    const label = document.querySelector<HTMLElement>('.dcu-entry-label')
    if (label === null) throw new Error('no late entry label in the fixture')
    const entry = label.parentElement
    if (entry === null) throw new Error('no late entry in the fixture')

    // The label is empty, so the IM-assistant rule does not match the entry
    // yet and the layout hides it as one of the collapsed entries.
    byLabel('Extensions').setAttribute('aria-expanded', 'false')
    await settle()
    expect(entry.style.display).toBe('none')
    expect(entry.hasAttribute(MARKER)).toBe(false)

    // The label arrives late: the rule owns the entry from now on.
    label.textContent = 'IM Assistant'
    await settle()
    expect(entry.hasAttribute(MARKER)).toBe(true)

    // Expanding the group releases the entries the layout hid itself, but
    // not the one the IM-assistant rule owns.
    byLabel('Extensions').setAttribute('aria-expanded', 'true')
    await settle()
    expect(entry.style.display).toBe('none')
  })

  it('writes nothing when the sidebar is re-rendered unchanged', async () => {
    mount(MENU)
    await settle()
    const before = Array.from(document.querySelectorAll<HTMLElement>('nav.dcu-menu > button'))
      .map(el => el.getAttribute('style'))
    document.body.insertAdjacentHTML('beforeend', '<span></span>')
    await settle()
    const after = Array.from(document.querySelectorAll<HTMLElement>('nav.dcu-menu > button'))
      .map(el => el.getAttribute('style'))
    expect(after).toEqual(before)
  })
})
