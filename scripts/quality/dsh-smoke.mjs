// Install smoke: prove the PACKED tarball works inside a real DSH host, which no
// unit or browser test can — they all run against the source tree.
//
//   1. pack the already-built tree (`npm pack --ignore-scripts`, like check-artifact)
//   2. `dsh plugin add <tarball>` into a fresh profile under a fresh DSH_HOME
//   3. `--dump-config` lists this bundle
//   4. boot on port 0; the agentTeam Remote answers
//   5. one Channel + one Message survive a restart of the host
//
// Usage:  npm run smoke:install      (builds first)   or   node scripts/quality/dsh-smoke.mjs
// Exit:   0 = the tarball installs, boots, answers and persists; 1 = it does not.
import { mkdirSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  bootProfile, createSmokeRoot, packTarball, redact, runDsh, writePortZeroOverlay,
} from './dsh-fixture.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const BUNDLE = '@ddvnguyen/moct-dsh-team-room'
const PROFILE = 'smoke'
const MESSAGE_BODY = 'install smoke hello'

function step(label) { console.log(`smoke: ${label}`) }
function assert(condition, message) { if (!condition) throw new Error(message) }

const smoke = createSmokeRoot()
let host
try {
  step('pack')
  const packDir = join(smoke.root, 'pack')
  mkdirSync(packDir)
  const packed = packTarball(repoRoot, packDir)
  assert(packed.name === BUNDLE, `packed ${packed.name}, expected ${BUNDLE}`)
  step(`packed ${String(packed.fileCount)} files`)

  step('init profile + plugin add')
  const init = runDsh(smoke, ['--profile', PROFILE, '--from-default-profile', 'web', '--dump-config'])
  assert(init.status === 0, `profile init exited ${String(init.status)}:\n${init.stderr.slice(-1500)}`)
  const add = runDsh(smoke, ['plugin', '--profile', PROFILE, 'add', packed.tarball])
  assert(add.status === 0, `plugin add exited ${String(add.status)}:\n${add.stderr.slice(-1500)}`)

  step('dump-config lists the bundle')
  const dump = runDsh(smoke, ['--profile', PROFILE, '--dump-config'])
  assert(dump.status === 0, `--dump-config exited ${String(dump.status)}:\n${dump.stderr.slice(-1500)}`)
  assert(dump.stdout.includes(`# == ${BUNDLE}`), `--dump-config has no '${BUNDLE}' layer`)

  const overlay = writePortZeroOverlay(smoke)

  step('boot 1 on port 0')
  host = await bootProfile(smoke, PROFILE, overlay)
  const created = await host.rpc('workspace/create', { request: { path: smoke.workspaceDir } })
  const workspaceId = created.workspace.workspaceId
  const channel = await host.rpc('agentTeam/createChannel', {
    request: { requestId: 'smoke-channel', workspaceId, name: 'smoke', description: 'install smoke' },
  })
  const channelRef = channel.channel.channelRef
  const sent = await host.rpc('agentTeam/sendMessage', {
    request: { requestId: 'smoke-message', workspaceId, channelRef, body: MESSAGE_BODY },
  })
  assert(sent.kind === 'committed', `sendMessage answered ${String(sent.kind)}`)
  await host.stop()

  step('boot 2 on port 0 (restart)')
  host = await bootProfile(smoke, PROFILE, overlay)
  const again = await host.rpc('workspace/create', { request: { path: smoke.workspaceDir } })
  assert(again.workspace.workspaceId === workspaceId, 'the Workspace did not survive the restart')
  const view = await host.rpc('agentTeam/view', { request: { workspaceId, channelRef } })
  assert(view.channels.some(item => item.channelRef === channelRef && item.name === 'smoke'), 'the Channel did not survive the restart')
  assert(view.items.some(item => item.message?.body === MESSAGE_BODY), 'the Message did not survive the restart')
  await host.stop()
  host = undefined

  console.log('smoke: PASS')
} catch (error) {
  console.error(`smoke: FAIL\n${redact(error instanceof Error ? error.message : error)}`)
  process.exitCode = 1
} finally {
  await host?.stop().catch(() => undefined)
  smoke.cleanup()
}
