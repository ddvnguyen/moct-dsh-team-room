#!/usr/bin/env node
/**
 * The dsh-market trusted-authority patch, checked against the REAL published
 * package.
 *
 * The patch edits an installed package's compiled files, so the properties
 * that matter are properties of what it produces, not of the edit list: the
 * patched package must answer the way the upstream change answers, the patch
 * must be idempotent, `--check` must write nothing, `--verify` must fail on
 * a package that is not patched, and a moved anchor must fail loudly and
 * leave the package untouched.
 *
 * The package is downloaded from the registry (`npm pack`), installed into a
 * throwaway directory with its own dependencies, and patched there. A
 * machine that cannot reach the registry SKIPS: this check asserts something
 * about a published artifact, and a machine without the artifact cannot
 * assert anything about it.
 *
 * Env:
 *   DSH_MARKET_VERSION   the published version to check against
 *                        default: 1.66.37 (the version the lanes run)
 *   DSH_MARKET_PACKAGE   a package directory to use instead of downloading
 */
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const APPLIER = join(SCRIPT_DIR, 'dsh-market-trusted-host-patch', 'apply.mjs')
const VERSION = process.env.DSH_MARKET_VERSION ?? '1.66.37'
const DOWNLOADED = process.env.DSH_MARKET_PACKAGE

let failures = 0
function check(what, ok) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${what}`)
  if (!ok) failures += 1
}

/** Run the applier and return its exit code and output. */
function run(args) {
  try {
    const stdout = execFileSync(process.execPath, [APPLIER, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { code: 0, stdout, stderr: '' }
  } catch (error) {
    return {
      code: error.status ?? 1,
      stdout: error.stdout?.toString() ?? '',
      stderr: error.stderr?.toString() ?? String(error),
    }
  }
}

/** A throwaway copy of a package directory. */
function copyPackage(source, work, name) {
  const target = join(work, name)
  cpSync(source, target, { recursive: true })
  return target
}

function read(file) {
  return readFileSync(file, 'utf8')
}

const work = mkdtempSync(join(tmpdir(), 'dsh-market-check-'))
try {
  // --- the package under test -------------------------------------------------
  let packageDir = DOWNLOADED === undefined ? undefined : resolve(DOWNLOADED)
  if (packageDir !== undefined) {
    console.log(`using the package at ${packageDir}`)
  } else {
    console.log(`downloading dshmarket@${VERSION}`)
    let packed
    try {
      packed = execFileSync('npm', ['pack', `dshmarket@${VERSION}`, '--pack-destination', work, '--ignore-scripts'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      console.log(`skipped: the registry is not reachable (${error.status ?? 'failed'})`)
      console.log('skipped  dsh-market patch check (no package to check against)')
      process.exit(0)
    }
    const tarball = join(work, packed.trim().split('\n').pop().trim())
    // Install it with its own dependencies: the patched files import them, and
    // a behaviour check that cannot import the package asserts nothing.
    execFileSync('npm', ['install', '--no-audit', '--no-fund', '--no-save', tarball], { cwd: work, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    packageDir = join(work, 'node_modules', 'dshmarket')
    if (!existsSync(packageDir)) {
      console.log('skipped  dsh-market patch check (the package did not install)')
      process.exit(0)
    }
  }

  // --- --check writes nothing -------------------------------------------------
  const checkCopy = copyPackage(packageDir, work, 'check-copy')
  const before = read(join(checkCopy, 'lib', 'restart.js'))
  const checkRun = run([checkCopy, '--check'])
  check('--check exits 0', checkRun.code === 0)
  check('--check writes nothing', read(join(checkCopy, 'lib', 'restart.js')) === before)

  // --- the patch applies, and is idempotent ------------------------------------
  const patched = copyPackage(packageDir, work, 'patched-copy')
  const applyRun = run([patched])
  check('apply exits 0', applyRun.code === 0)
  const patchedSource = read(join(patched, 'lib', 'restart.js'))
  check('the patched file carries the shared predicate', patchedSource.includes('servedAuthority'))
  check('the patched file keeps the loopback fence', patchedSource.includes('directLoopbackRequest'))
  const again = run([patched])
  check('apply again exits 0 (idempotent)', again.code === 0)
  check('apply again changes nothing', read(join(patched, 'lib', 'restart.js')) === patchedSource)
  const verify = run([patched, '--verify'])
  check('--verify exits 0 on a patched package', verify.code === 0)

  // --- --verify fails on a package that is not patched ------------------------
  const unpatchedVerify = run([copyPackage(packageDir, work, 'unpatched-copy'), '--verify'])
  check('--verify exits non-zero on an unpatched package', unpatchedVerify.code !== 0)

  // --- a moved anchor fails loudly and changes nothing -------------------------
  const broken = copyPackage(packageDir, work, 'broken-copy')
  const brokenPath = join(broken, 'lib', 'restart.js')
  writeFileSync(brokenPath, read(brokenPath).replace('export function trustedDownloadRequest(request) {', 'export function trustedDownloadRequestXX(request) {'))
  const brokenBefore = read(brokenPath)
  const brokenRun = run([broken])
  check('a moved anchor exits non-zero', brokenRun.code !== 0)
  check('a moved anchor names the edit', brokenRun.stderr.includes('restart-trusted-download-request'))
  check('a moved anchor leaves the package untouched', read(brokenPath) === brokenBefore)

  // --- the behaviour the patch exists for --------------------------------------
  const behaviour = execFileSync(process.execPath, ['--input-type=module', '--eval', `
    import { setTrustedHostsSource } from ${JSON.stringify(join(patched, 'lib', 'http.js'))}
    import { trustedDownloadRequest, trustedRestartRequest } from ${JSON.stringify(join(patched, 'lib', 'restart.js'))}
    setTrustedHostsSource(() => ['dsh.example.com'])
    const request = (headers, remoteAddress) => ({ headers, socket: { remoteAddress } })
    const tunnel = { host: 'dsh.example.com', 'x-forwarded-for': '203.0.113.9' }
    const answers = {
      exportThroughDeclaredAuthority: trustedDownloadRequest(request(tunnel, '10.88.0.1')),
      exportFromForeignHost: trustedDownloadRequest(request({ ...tunnel, host: 'evil.example.com' }, '10.88.0.1')),
      exportFromCrossSite: trustedDownloadRequest(request({ ...tunnel, 'sec-fetch-site': 'cross-site' }, '10.88.0.1')),
      exportFromCrossOrigin: trustedDownloadRequest(request({ ...tunnel, origin: 'https://evil.example.com' }, '10.88.0.1')),
      restartThroughDeclaredAuthority: trustedRestartRequest(request({ ...tunnel, origin: 'https://dsh.example.com' }, '10.88.0.1')),
      restartFromForeignHost: trustedRestartRequest(request({ ...tunnel, host: 'evil.example.com', origin: 'https://evil.example.com' }, '10.88.0.1')),
      exportFromLoopback: trustedDownloadRequest(request({ host: '127.0.0.1:3080' }, '127.0.0.1')),
      exportFromRemotePeerOnLoopbackHost: trustedDownloadRequest(request({ host: '127.0.0.1:3080' }, '10.88.0.1')),
    }
    console.log(JSON.stringify(answers))
  `], { encoding: 'utf8' })
  const answers = JSON.parse(behaviour.trim().split('\n').pop())
  check('the export passes through a declared authority', answers.exportThroughDeclaredAuthority === true)
  check('a foreign host is still refused', answers.exportFromForeignHost === false)
  check('a cross-site request is still refused', answers.exportFromCrossSite === false)
  check('a cross-origin reader is still refused', answers.exportFromCrossOrigin === false)
  check('the restart passes through a declared authority', answers.restartThroughDeclaredAuthority === true)
  check('a foreign host cannot drive the restart', answers.restartFromForeignHost === false)
  check('a direct loopback export still passes', answers.exportFromLoopback === true)
  check('a remote peer cannot borrow a loopback host', answers.exportFromRemotePeerOnLoopbackHost === false)
} finally {
  rmSync(work, { recursive: true, force: true })
}

if (failures > 0) {
  console.error(`${failures} check(s) failed`)
  process.exit(1)
}
console.log('the dsh-market patch behaves as it must')
