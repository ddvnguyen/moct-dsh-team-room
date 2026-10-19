// Screenshot the dsh-x sidebar: the top-level menu, the Extensions group and
// the Teams tab's body (the Channel section and the Agents section).
//
// Usage: PLAYWRIGHT_DIR=<dir with node_modules/playwright> node scripts/codex-ui-sidebar-patch/sidebar-screenshot.mjs [url] [outDir]
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const roots = [process.env.PLAYWRIGHT_DIR, '/home/ddv/nmroot', process.cwd()].filter(Boolean)
let chromium
for (const root of roots) {
  try {
    chromium = require(join(root, 'node_modules/playwright')).chromium
    break
  } catch { /* try the next root */ }
}
if (chromium === undefined) {
  console.error('playwright not found; set PLAYWRIGHT_DIR')
  process.exit(2)
}

const url = process.argv[2] ?? 'http://127.0.0.1:3181/'
const outDir = process.argv[3] ?? '/tmp/dsh-x-sidebar'
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const errors = []
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
page.on('pageerror', error => errors.push(String(error)))
await page.goto(url, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('nav.dcu-menu', { timeout: 30000 })
await page.waitForTimeout(3000)

// The Extensions group starts collapsed in a fresh profile; open it so the
// screenshot shows the whole menu the way an operator sees it.
const extensionsToggle = page.locator('.dcu-extensions-toggle').first()
if (await extensionsToggle.count() > 0 && await extensionsToggle.getAttribute('aria-expanded') !== 'true') {
  await extensionsToggle.click()
  await page.waitForTimeout(800)
}

const sidebar = page.locator('nav.dcu-menu').locator('xpath=ancestor::aside[1]')
await page.screenshot({ path: join(outDir, 'sidebar.png') })
await sidebar.screenshot({ path: join(outDir, 'sidebar-only.png') })

const menu = await page.locator('nav.dcu-menu').evaluate(node => node.innerText)
const tabs = await page.locator('.dcu-im-tabs').evaluate(node => node.innerText).catch(() => '')

// The Teams tab: click it and read what the body carries.
const teams = page.getByRole('tab', { name: 'Teams' }).first()
let teamsBody = ''
if (await teams.count() > 0) {
  await teams.click()
  await page.waitForTimeout(2500)
  await page.screenshot({ path: join(outDir, 'teams-tab.png') })
  const panel = page.locator('.dcu-native-workspaces').first()
  teamsBody = await panel.evaluate(node => node.innerText).catch(() => '')
  await panel.screenshot({ path: join(outDir, 'teams-body.png') }).catch(() => {})
}

console.log(JSON.stringify({ menu, tabs, teamsBody, errors: errors.slice(0, 10) }, null, 2))
await browser.close()
