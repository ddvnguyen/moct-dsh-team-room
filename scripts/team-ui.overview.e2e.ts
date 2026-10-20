/**
 * The Overview evidence lane (Board 7/10).
 *
 * It boots the real Web composition with the local Team bundle staged as a
 * profile package, seeds one Workspace with a Channel, three seats, Messages,
 * an open decision card, a failed Turn and recorded Turns — so the live strip,
 * the needs-attention list, the event feed and the spend chart all have
 * something true to draw — then opens the Overview face and captures it at
 * desktop width and at 390×844.
 *
 * The lane runs model-free: no LLM call is made, the Turns are recorded
 * directly the way the Host's turn recorder records them, so the screenshots
 * show the page's own rendering rather than a model's timing.
 *
 * This file is rendered into the adjacent harness checkout and runs from there,
 * where the harness's own `scaffold.ts` and `support.ts` resolve.
 */
import { cp, mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { launchWebScaffold, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspaceZh } from './support.ts'

const TEAM_ROOT = '__TEAM_ROOT__'
const HOME = '__HOME__'
const CHROME = '__CHROME__'
const STAGED_BUNDLE = join(HOME, 'profiles', 'node_modules', '@ddvnguyen/moct-dsh-team-room')
const BROWSER_ARTIFACTS = join(TEAM_ROOT, 'artifacts/browser')
const OVERVIEW_SHOTS = join(BROWSER_ARTIFACTS, 'overview')

let scaffold: WebScaffold | undefined
let browser: Browser | undefined

afterEach(async () => {
  await browser?.close(); browser = undefined
  await scaffold?.close(); scaffold = undefined
})

/**
 * Wait until no finite animation is still running: the sidebar collapse and
 * its rail-in crossfade are 150ms each, and a screenshot taken mid-flight
 * captures the frozen expanded column instead of the settled page.
 */
async function settleAnimations(page: Page): Promise<void> {
  await page.waitForFunction(() => document.getAnimations().every(animation => {
    const timing = animation.effect?.getTiming()
    return timing === undefined || timing.iterations === Infinity || animation.playState !== 'running'
  }))
}

/**
 * Stage the local bundle the way a profile install does: the package tree
 * without its sources, plus the regular dependencies the boot-time bare
 * imports resolve through.
 */
async function installLocalBundle(): Promise<void> {
  await rm(HOME, { recursive: true, force: true })
  await rm(OVERVIEW_SHOTS, { recursive: true, force: true })
  const scope = `${HOME}/profiles/node_modules/@ddvnguyen`
  await mkdir(scope, { recursive: true })
  await mkdir(OVERVIEW_SHOTS, { recursive: true })
  await cp(TEAM_ROOT, `${scope}/moct-dsh-team-room`, {
    recursive: true,
    filter: source => {
      const normalized = source.replaceAll('\\', '/')
      return !normalized.includes('/node_modules') && !normalized.includes('/src') && !normalized.includes('/artifacts') && !normalized.includes('/.hoplite')
    },
  })
  const { dependencies } = JSON.parse(await readFile(join(TEAM_ROOT, 'package.json'), 'utf8')) as { dependencies: Record<string, string> }
  const bundleModules = join(scope, 'moct-dsh-team-room', 'node_modules')
  for (const name of Object.keys(dependencies)) {
    await cp(join(TEAM_ROOT, 'node_modules', name), join(bundleModules, ...name.split('/')), { recursive: true, dereference: true })
  }
}

/**
 * The Host's own ledger, reached the way the Host reaches it. The lane seeds
 * durable facts — recorded Turns, a failed Turn, a decision card — without
 * running a model: those are the same records the turn recorder writes.
 */
interface SeedLedger {
  recordSessionTurn(request: Record<string, unknown>): Promise<unknown>
  recordTurnFailureNotice(request: Record<string, unknown>): Promise<unknown>
  askDecision(request: Record<string, unknown>): Promise<unknown>
}

function ledgerOf(host: unknown): SeedLedger {
  // The Host service holds its ledger in a private field; the lane seeds the
  // same durable records the turn recorder writes.
  const service = host as { readonly ledger: SeedLedger }
  return service.ledger
}

/**
 * The running-Turn feed of the Host, seeded with the session events a live
 * agent emits while a tool runs. The feed is in-memory and never persisted,
 * exactly as it is in production.
 */
interface ActivityFeed {
  onSessionEvent(memberId: string, event: { readonly type: string; readonly data: Record<string, unknown>; readonly time: number }): void
}

function activityFeedOf(host: unknown): ActivityFeed {
  // The running-Turn feed is the Host's own in-memory projection, private by
  // design: the lane drives it with the session events a live agent emits.
  const service = host as { readonly activityFeed: ActivityFeed }
  return service.activityFeed
}

it('captures the Team Overview face at desktop width and at 390x844', async () => {
  await installLocalBundle()
  scaffold = await launchWebScaffold({ harnessHome: HOME, profile: { packages: [{ dir: STAGED_BUNDLE, enabled: true }] } })
  browser = await chromium.launch({ headless: true, executablePath: CHROME })
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, locale: 'zh-CN' })
  await page.goto(scaffold.authenticatedUrl)
  await connectFreshWorkspaceZh(page, scaffold.workspaceCwd, 'team-workspace')

  // The Host's Team service, reached through the scaffold's context: these are
  // the same methods the Client's Remotes call over the wire.
  const team = scaffold.ctx.agentTeam as unknown as {
    createChannel(request: Record<string, unknown>): Promise<{ readonly channel: { readonly channelRef: string } }>
    addMember(request: Record<string, unknown>): Promise<{ readonly status: { readonly member: { readonly memberId: string; readonly handle: string; readonly sessionId: string } } }>
    sendMessage(request: Record<string, unknown>): Promise<{ readonly thread: { readonly threadRef: string } }>
    members(request: Record<string, unknown>): readonly { readonly member: { readonly memberId: string; readonly handle: string; readonly sessionId: string } }[]
  }
  const workspace = scaffold.ctx.workspaceRegistry.list()[0]!
  const ledger = ledgerOf(scaffold.ctx.agentTeam)
  const feed = activityFeedOf(scaffold.ctx.agentTeam)

  const channel = await team.createChannel({ requestId: 'overview-channel', workspaceId: workspace.id, name: 'engineering', description: 'Overview evidence' })
  const channelRef = channel.channel.channelRef
  const seats = []
  for (const handle of ['builder', 'reviewer', 'writer']) {
    const added = await team.addMember({ requestId: `overview-seat-${handle}`, workspaceId: workspace.id, handle, description: `${handle} seat`, presetId: 'team-member', channelRefs: [channelRef] })
    seats.push(added.status.member)
  }
  const anchor = await team.sendMessage({ requestId: 'overview-anchor', workspaceId: workspace.id, channelRef, body: 'Ship the Overview page behind the flag', asTask: true })
  const threadRef = anchor.thread.threadRef
  await team.sendMessage({ requestId: 'overview-follow-up', workspaceId: workspace.id, channelRef, body: 'The spend chart needs the per-day buckets', asTask: false })

  // Three seats with recorded Turns: the spend chart draws their shares, and
  // the per-day buckets carry their tokens.
  const startedAt = new Date(Date.now() - 3_600_000).toISOString()
  for (const [index, seat] of seats.entries()) {
    await ledger.recordSessionTurn({
      requestId: `overview-turn-${seat.handle}`,
      workspaceId: workspace.id,
      memberId: seat.memberId,
      sessionId: seat.sessionId,
      turn: 1,
      startedAt,
      endedAt: startedAt,
      threadRefs: [threadRef],
      toolCalls: 2 + index,
      runMs: 4_000 + index * 1_500,
      usage: { uncachedInputTokens: 1_200 * (index + 1), outputTokens: 320 * (index + 1), cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: null },
      actor: { kind: 'member', memberId: seat.memberId, handle: seat.handle },
    })
  }
  // One failed Turn, so the needs-attention list carries a real failure row.
  await ledger.recordTurnFailureNotice({
    requestId: 'overview-turn-failed',
    workspaceId: workspace.id,
    threadRef,
    memberId: seats[2]!.memberId,
    sessionId: seats[2]!.sessionId,
    turn: 2,
    reason: 'the model refused to answer',
    actor: { kind: 'member', memberId: seats[2]!.memberId, handle: seats[2]!.handle },
  })
  // One open decision card, so the list carries a decision row too.
  await ledger.askDecision({
    requestId: 'overview-decision',
    workspaceId: workspace.id,
    threadRef,
    context: 'Ship the Overview page now or after the freeze?',
    questions: [{ prompt: 'Ship now?', multiple: false, options: [{ label: 'Now' }, { label: 'After the freeze' }], recommended: [0] }],
    actor: { kind: 'member', memberId: seats[0]!.memberId, handle: seats[0]!.handle },
  })
  // Two seats are mid-turn: their cards show the running tool.
  const now = Date.now()
  for (const [index, seat] of seats.slice(0, 2).entries()) {
    feed.onSessionEvent(seat.memberId, { type: 'step/start', data: { turn: 1 }, time: now - 60_000 })
    feed.onSessionEvent(seat.memberId, { type: 'tool/call', data: { turn: 1, callId: `call-${index}`, name: 'Bash', arguments: JSON.stringify({ command: 'npm test' }) }, time: now - 30_000 })
  }

  // The Team's own column: the rail row enters Team mode, and the Overview
  // face is the Team page's workspace-scoped face. The face is a persisted
  // navigation fact, so the lane writes it the way the browser does and
  // reloads — the same path a reader takes when they reopen the page.
  const panelRail = page.locator('nav[class*="panelList"]')
  await panelRail.getByRole('button', { name: '团队', exact: true }).click()
  await page.evaluate((workspaceId) => {
    localStorage.setItem('dsh.agent-team.navigation', JSON.stringify({ mode: 'team', workspaceId, overview: true }))
  }, workspace.id)
  await page.reload()
  const overviewEntry = page.getByRole('button', { name: '总览' })
  await expect.poll(() => overviewEntry.count(), { timeout: 20_000 }).toBeGreaterThanOrEqual(0)

  const overview = page.locator('[data-team-overview]')
  await expect.poll(() => overview.count(), { timeout: 15_000 }).toBe(1)
  // The page answered: the strip holds the three seats, the attention list
  // holds the decision and the failed Turn, the feed holds the Messages, and
  // the spend chart holds the day's bars.
  await expect.poll(() => page.locator('[data-team-overview-agent]').count()).toBe(3)
  await expect.poll(() => page.locator('[data-attention-kind="decision"]').count()).toBe(1)
  await expect.poll(() => page.locator('[data-attention-kind="failure"]').count()).toBe(1)
  await expect.poll(() => page.locator('[data-team-overview-event]').count()).toBeGreaterThan(0)
  await expect.poll(() => page.locator('[data-team-overview-spend-agent]').count()).toBe(3)
  await settleAnimations(page)
  await page.screenshot({ path: join(OVERVIEW_SHOTS, 'overview-desktop.png'), fullPage: true })

  // The narrow width: the same page at 390×844. The shell's column folds to its
  // rail first, so the page is measured against the width a phone gives it.
  const collapse = page.getByRole('button', { name: '收起侧边栏' })
  if (await collapse.count() === 1) await collapse.click()
  await page.setViewportSize({ width: 390, height: 844 })
  await settleAnimations(page)
  await page.screenshot({ path: join(OVERVIEW_SHOTS, 'overview-390.png'), fullPage: true })
})
