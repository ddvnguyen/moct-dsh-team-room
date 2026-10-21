// Browser leg of the install smoke: the unit suite renders the Team in a jsdom
// stand-in, so a Team that rewrites the host's own sidebar (it once hid New
// Session and the panel rail while Team mode was on) passes every spec and only
// shows in a real shell. This opens the installed app and walks the Team tab.
//
// Playwright is not a dependency of this package. It is resolved from, in order:
// PLAYWRIGHT_DIR (a directory containing node_modules/playwright), the package
// root, the sibling harness checkout, then the current directory. When none has
// it the leg is SKIPPED and says so; SMOKE_REQUIRE_BROWSER=1 turns that into a failure.
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { harnessDir } from '../harness-dir.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const SETTLE_MS = 2500
const BOOT_MS = 7000

function loadPlaywright() {
  const roots = [process.env.PLAYWRIGHT_DIR, repoRoot, harnessDir, process.cwd()].filter(root => typeof root === 'string' && root !== '')
  for (const root of roots) {
    try { return createRequire(join(root, 'package.json'))('playwright') } catch { /* try the next root */ }
  }
  return undefined
}

/** The shell rows that must be visible in every state; the labels are the shell's English ones. */
const SHELL_ROWS = [
  ['New Session', /^New Session$/u],
  ['Plugins', /^Plugins$/u],
  ['Automation tasks', /^Automation tasks$/u],
  ['Context Insights', /^Context Insights$/u],
  ['Team Detail', /^Team Detail$/u],
]

/**
 * Load the installed app, then walk: base, Team tab, first Channel, second Channel.
 * Every state must keep all of SHELL_ROWS; the Team tab must show Inbox and Channels.
 * @returns `{ states, stripTab }` after a pass, or `{ skipped }` when Playwright is not installed.
 * @throws when a row disappears or the Team tab lacks Inbox / Channels.
 */
export async function checkTeamTabSidebar({ origin, cookie, channels }) {
  const playwright = loadPlaywright()
  if (playwright === undefined) {
    if (process.env.SMOKE_REQUIRE_BROWSER === '1') throw new Error('Playwright was not found and SMOKE_REQUIRE_BROWSER=1')
    return { skipped: 'Playwright not found (set PLAYWRIGHT_DIR, or SMOKE_REQUIRE_BROWSER=1 to fail on this)' }
  }
  const browser = await playwright.chromium.launch({ headless: true })
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-US' })
    if (cookie !== '') {
      const [name, ...value] = cookie.split('=')
      await context.addCookies([{ name, value: value.join('='), url: origin }])
    }
    const page = await context.newPage()
    const pageErrors = []
    page.on('pageerror', error => { pageErrors.push(String(error).slice(0, 200)) })
    await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await page.waitForTimeout(BOOT_MS)
    // A fresh profile opens on first-run dialogs (the preview notice, then the
    // API-key prompt); their mask would swallow every click, so dismiss them in turn.
    for (const name of ['Continue', 'Configure later', 'Continue']) {
      const dismiss = page.getByRole('button', { name, exact: true })
      if (await dismiss.count() > 0) { await dismiss.first().click(); await page.waitForTimeout(1000) }
    }

    const snapshot = () => page.evaluate(rows => {
      const sidebar = document.querySelector('[data-slot="sidebar"]')
      const visible = pattern => [...(sidebar?.querySelectorAll('button,a,[role="tab"],nav') ?? [])]
        .some(node => new RegExp(pattern).test((node.innerText || '').trim()) && node.getBoundingClientRect().height > 0 && getComputedStyle(node).display !== 'none')
      return {
        rows: Object.fromEntries(rows.map(([label, source]) => [label, visible(source)])),
        text: sidebar?.innerText ?? '',
        slotErrors: document.querySelectorAll('[data-slot-error]').length,
      }
    }, SHELL_ROWS.map(([label, pattern]) => [label, pattern.source]))

    const failures = []
    let states = 0
    // The rows the app shows before the Team is touched are the ones that must
    // survive it. A profile without the Context Insights plugin never had that
    // row; the four core rows must be there at the start in any profile.
    const base = await snapshot()
    const required = Object.entries(base.rows).filter(([, shown]) => shown).map(([row]) => row)
    for (const core of ['New Session', 'Plugins', 'Automation tasks', 'Team Detail']) {
      if (!required.includes(core)) failures.push(`base: "${core}" is not visible`)
    }
    const check = async label => {
      const state = await snapshot()
      states += 1
      for (const row of required) if (!state.rows[row]) failures.push(`${label}: "${row}" is not visible`)
      if (state.slotErrors > 0) failures.push(`${label}: ${String(state.slotErrors)} slot error(s)`)
      return state
    }
    if (process.env.SMOKE_SCREENSHOT_DIR) await page.screenshot({ path: join(process.env.SMOKE_SCREENSHOT_DIR, 'smoke-base.png') })
    await check('base')

    // The Team is entered where the shell offers it: the strip's Team tab, or the rail row when the strip has none.
    const stripTab = page.locator('[data-slot="sidebar.workspaces"] button', { hasText: /^Team$/u }).first()
    const railRow = page.locator('[data-slot="sidebar"]').getByText('Team', { exact: true }).first()
    const hasStripTab = await stripTab.count() > 0
    const entry = hasStripTab ? stripTab : railRow
    await entry.click({ timeout: 15_000 })
    await page.waitForTimeout(SETTLE_MS)
    const tab = await check('Team entered')
    if (process.env.SMOKE_SCREENSHOT_DIR) await page.screenshot({ path: join(process.env.SMOKE_SCREENSHOT_DIR, 'smoke-team.png') })
    // Inbox and Channels live in the strip's Team tab; a profile without a strip has only the rail row.
    if (hasStripTab && !/\bInbox\b/u.test(tab.text)) failures.push('Team tab: no Inbox')
    if (hasStripTab && !/\bChannels\b/u.test(tab.text)) failures.push('Team tab: no Channels')
    for (const channel of hasStripTab ? channels : []) {
      await page.locator('button', { hasText: new RegExp(`^#\\s*${channel}$`, 'u') }).first().click({ timeout: 15_000 })
      await page.waitForTimeout(SETTLE_MS)
      await check(`after Channel # ${channel}`)
    }
    // The Agents tab, when the build has one: the shell rows must survive it too.
    const agentsTab = page.locator('[data-slot="sidebar.workspaces"] button', { hasText: /^Agents$/u }).first()
    if (hasStripTab && await agentsTab.count() > 0) {
      await agentsTab.click({ timeout: 15_000 })
      await page.waitForTimeout(SETTLE_MS)
      await check('Agents tab')
    }
    if (pageErrors.length > 0) failures.push(`page errors: ${pageErrors.slice(0, 3).join(' | ')}`)
    if (failures.length > 0) throw new Error(`Team-tab sidebar check failed:\n- ${failures.join('\n- ')}`)
    return { states, stripTab: hasStripTab }
  } finally {
    await browser.close()
  }
}

// Run against an already-running host (a TEST-style profile with the strip):
//   node scripts/quality/dsh-browser-check.mjs --url http://127.0.0.1:3081 --channels moct-driver,w5-t6w5b [--cookie name=value]
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = name => { const at = process.argv.indexOf(`--${name}`); return at === -1 ? undefined : process.argv[at + 1] }
  const url = arg('url')
  if (url === undefined) { console.error('usage: --url <origin> [--channels a,b] [--cookie name=value]'); process.exit(2) }
  checkTeamTabSidebar({ origin: url, cookie: arg('cookie') ?? '', channels: (arg('channels') ?? '').split(',').filter(item => item !== '') })
    .then(result => { console.log(result.skipped === undefined ? `browser check PASS (${String(result.states)} states)` : `browser check SKIPPED: ${result.skipped}`) })
    .catch(error => { console.error(`browser check FAIL\n${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1 })
}
