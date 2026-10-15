// Fixture for the install smoke (scripts/quality/dsh-smoke.mjs): everything that
// touches the sibling deepseek-harness CLI lives here, so the smoke itself reads
// as the sequence of claims it makes.
//
// The fixture never reaches outside its own temporary directory: HOME and
// DSH_HOME are fresh, no credentials or MOCT_* variables are forwarded, and no
// URL it handles is ever printed with its launch token (redact() below).
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { harnessDir } from '../harness-dir.mjs'

const BOOT_TIMEOUT_MS = 120_000
const STOP_GRACE_MS = 10_000
const LAUNCH_URL = /(http:\/\/127\.0\.0\.1:\d+\/\?token=[A-Za-z0-9_-]+)/u

/** Replace the one-time launch token in any text before it is logged or thrown. */
export function redact(text) {
  return String(text).replace(/token=[A-Za-z0-9_-]+/gu, 'token=<redacted>')
}

/** The environment the booted CLI sees: isolated home, nothing inherited that could carry a secret. */
function isolatedEnv(root) {
  return {
    PATH: process.env.PATH ?? '',
    HOME: join(root, 'home'),
    DSH_HOME: join(root, 'dsh-home'),
    TMPDIR: join(root, 'tmp'),
    CI: '1',
  }
}

/**
 * Create the smoke's scratch root: a fresh DSH_HOME, HOME, TMPDIR and workspace directory.
 * @param scratch - parent directory; defaults to $TMPDIR / the OS temp dir.
 */
export function createSmokeRoot(scratch = process.env.TMPDIR ?? tmpdir()) {
  const root = mkdtempSync(join(scratch, 'moct-dsh-smoke-'))
  for (const dir of ['home', 'dsh-home', 'tmp', 'workspace']) mkdirSync(join(root, dir))
  const env = isolatedEnv(root)
  return {
    root,
    env,
    workspaceDir: join(root, 'workspace'),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  }
}

/** Run `npm pack --ignore-scripts` over an already-built tree and return the tarball path. */
export function packTarball(repoRoot, destination) {
  const result = spawnSync('npm', ['pack', '--ignore-scripts', '--json', '--loglevel=error', '--pack-destination', destination], {
    cwd: repoRoot, encoding: 'utf8',
  })
  if (result.status !== 0) throw new Error(`npm pack failed (${String(result.status)}):\n${result.stderr}`)
  // npm <= 11 prints an array of results, npm 12 an object keyed by package name.
  const parsed = JSON.parse(result.stdout)
  const [packed] = Array.isArray(parsed) ? parsed : Object.values(parsed)
  return { tarball: join(destination, packed.filename), name: packed.name, fileCount: packed.files.length }
}

function cliArgs(args) {
  return ['--import', 'tsx/esm', join(harnessDir, 'apps/cli/src/bin.ts'), ...args]
}

/** Run the dsh CLI to completion (init, plugin add, --dump-config). */
export function runDsh(smoke, args, timeoutMs = 180_000) {
  const result = spawnSync(process.execPath, cliArgs(args), {
    cwd: harnessDir, env: smoke.env, encoding: 'utf8', timeout: timeoutMs,
  })
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

/** The overlay that puts the web server on an ephemeral loopback port and keeps the browser closed. */
export function writePortZeroOverlay(smoke) {
  const path = join(smoke.root, 'port0.patch.yml')
  writeFileSync(path, [
    '- id: webserver',
    '  config: { host: 127.0.0.1, port: 0 }',
    '- id: web-runtime',
    '  config: { openBrowser: false, printUrl: true }',
    '',
  ].join('\n'))
  return path
}

/**
 * Boot the profile and resolve once it prints its launch URL.
 * @returns the running host: `rpc(method, args)` calls an /api Remote, `stop()` ends it gracefully.
 */
export function bootProfile(smoke, profile, overlay) {
  const child = spawn(process.execPath, cliArgs(['--profile', profile, '--patch', overlay]), {
    cwd: harnessDir, env: smoke.env, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  const exited = new Promise(resolve => { child.once('exit', (code, signal) => { resolve({ code, signal }) }) })
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`boot did not print a launch URL in ${String(BOOT_TIMEOUT_MS)}ms:\n${redact(output).slice(-2000)}`))
    }, BOOT_TIMEOUT_MS)
    const onData = chunk => {
      output += chunk
      const match = LAUNCH_URL.exec(output)
      if (match === null) return
      clearTimeout(timer)
      resolve(match[1])
    }
    child.stdout.setEncoding('utf8').on('data', onData)
    child.stderr.setEncoding('utf8').on('data', onData)
    child.once('error', error => { clearTimeout(timer); reject(error) })
    void exited.then(({ code }) => {
      clearTimeout(timer)
      reject(new Error(`host exited (${String(code)}) before readiness:\n${redact(output).slice(-2000)}`))
    })
  })
  return ready.then(async launchUrl => {
    const exchange = await fetch(launchUrl, { redirect: 'manual' })
    const cookie = exchange.headers.get('set-cookie')?.split(';', 1)[0]
    if (exchange.status !== 303 || cookie === undefined) throw new Error(`launch URL exchange answered ${String(exchange.status)} with no session cookie`)
    const origin = new URL(launchUrl).origin
    let serial = 0
    return {
      origin,
      /** The session cookie the launch URL exchange granted, as `name=value`; a browser context adds it to act as this Human. */
      cookie,
      /** Call one /api Remote; resolves its `value`, throws its error. */
      async rpc(method, args) {
        const response = await fetch(`${origin}/api/${method}`, {
          method: 'POST',
          headers: { cookie, 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'client-request', rpcId: `smoke-${String(++serial)}`, method, payload: { args } }),
        })
        if (response.status !== 200) throw new Error(`${method} answered HTTP ${String(response.status)}`)
        const { result } = await response.json()
        if (!result.ok) throw new Error(`${method} failed: ${redact(JSON.stringify(result.error))}`)
        return result.value
      },
      async stop() {
        if (child.exitCode !== null) return
        child.kill('SIGTERM')
        const forced = setTimeout(() => { child.kill('SIGKILL') }, STOP_GRACE_MS)
        await exited
        clearTimeout(forced)
      },
    }
  })
}
