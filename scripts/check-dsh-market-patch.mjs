#!/usr/bin/env node
/**
 * The dsh-market trusted-authority patch, checked against the REAL published
 * package.
 *
 * The patch edits an installed package's compiled files, so the properties
 * that matter are properties of what it produces, not of the edit list: the
 * patched package must answer the way the upstream change answers, the patch
 * must be idempotent, `--check` must write nothing, a moved anchor must fail
 * loudly and leave the package untouched, and a package that ALREADY carries
 * the fix must be left exactly as it is.
 *
 * Two shapes of the published package are legal, and each has its own
 * expectations:
 *
 * - PRE-FIX: the release does not carry the fix yet. The patch applies, and
 *   the checks that need a package without the fix — an unpatched `--verify`,
 *   a moved anchor — apply to it.
 * - UPSTREAM-SHAPED: the release ships the upstream change (dsh-market PR
 *   #958) and already carries the fix. The patch has nothing left to do, so
 *   the expectations are the NO-OP: nothing is written and `--verify` exits 0.
 *
 * The check exercises the upstream shape whichever shape it downloaded: a
 * pre-fix package is patched and stripped of the pristine backups the applier
 * keeps next to the files it patched, which is the state a release that
 * shipped the fix is in. The applier recognises that state by its marker and
 * writes nothing, so the day the upstream release ships this check still
 * passes.
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
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ACCESSOR_MARKER, PATCH_MARKER } from './dsh-market-trusted-host-patch/edits.mjs'

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

/**
 * Whether the package already carries the trusted-authority fix.
 *
 * The markers are the ones the applier itself looks for: the accessor the
 * patch adds to the fence's own module, and the shared predicate it
 * introduces. A release that ships the upstream change carries both, because
 * upstream named them the same.
 */
function carriesTheFix(packageDir) {
  return read(join(packageDir, 'lib', 'http.js')).includes(ACCESSOR_MARKER)
    && read(join(packageDir, 'lib', 'restart.js')).includes(PATCH_MARKER)
}

/**
 * A copy of a package without the pristine backups the applier keeps next to
 * the files it patched.
 *
 * A release that ships the fix upstream carries the patched file and no
 * pristine copy: that is the shape the applier has to recognise and leave
 * alone, and it is the shape this copy reproduces.
 */
function copyWithoutBackups(source, work, name) {
  const target = copyPackage(source, work, name)
  for (const file of readdirSync(join(target, 'lib'))) {
    if (file.endsWith('.orig')) rmSync(join(target, 'lib', file), { force: true })
  }
  return target
}

/**
 * Every file of a package directory, with its content.
 *
 * Two equal snapshots mean the applier wrote nothing — not a byte, and not a
 * file either: the backups the applier keeps next to the files it patched
 * would show up as files of their own.
 */
function snapshot(packageDir) {
  const entries = []
  const walk = (directory, prefix) => {
    const items = readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of items) {
      const path = join(directory, entry.name)
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      if (entry.isDirectory()) walk(path, relative)
      else entries.push(`${relative}\n${readFileSync(path, 'utf8')}`)
    }
  }
  walk(packageDir, '')
  return entries.join('\n---\n')
}

// The scratch is a full workdir (`npm pack` + `npm install` of the published
// package, its dependencies included): it goes under the repo's own
// gitignored local scratch, never the host's shared tmpfs. `tmpdir()` on this
// generation of hosts is a small full /tmp, and a check that dies there dies
// as a misleading ENOSPC (moct#30's rule; M-66). node_modules is deliberately
// NOT the location: an `npm install` whose cwd sits inside node_modules
// confuses npm's tree resolver.
const SCRATCH = join(SCRIPT_DIR, '..', '.scratch', 'local')
mkdirSync(SCRATCH, { recursive: true })
const work = mkdtempSync(join(SCRATCH, 'dsh-market-check-'))
// Pin npm's project root to the scratch itself: without a manifest npm climbs
// to the enclosing repository, and the tarball would install into the wrong
// dependency tree instead of beside the check that reads it.
writeFileSync(join(work, 'package.json'), `${JSON.stringify({ name: 'dsh-market-patch-check', private: true, version: '0.0.0' }, null, 2)}\n`)
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
    // a behaviour check that cannot import the package asserts nothing. The
    // install runs with `--ignore-scripts`: the published package's own
    // install scripts are not part of what this check asserts, and running
    // them would put a third party's code on the check's path.
    execFileSync('npm', ['install', '--no-audit', '--no-fund', '--no-save', '--ignore-scripts', tarball], { cwd: work, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    packageDir = join(work, 'node_modules', 'dshmarket')
    if (!existsSync(packageDir)) {
      console.log('skipped  dsh-market patch check (the package did not install)')
      process.exit(0)
    }
  }

  // --- the shape of the package under test -------------------------------------
  const publishedCarriesTheFix = carriesTheFix(packageDir)
  console.log(publishedCarriesTheFix
    ? 'the published package already carries the trusted-authority fix'
    : 'the published package does not carry the trusted-authority fix yet')

  // --- --check writes nothing -------------------------------------------------
  const checkCopy = copyPackage(packageDir, work, 'check-copy')
  const before = read(join(checkCopy, 'lib', 'restart.js'))
  const checkRun = run([checkCopy, '--check'])
  check('--check exits 0', checkRun.code === 0)
  check('--check writes nothing', read(join(checkCopy, 'lib', 'restart.js')) === before)

  // --- the patch applies to a package that does not carry the fix yet ---------
  // The package the behaviour is asserted against: the published package when
  // it already carries the fix, the patched copy when the patch had to apply.
  let effective = packageDir
  if (!publishedCarriesTheFix) {
    const patched = copyPackage(packageDir, work, 'patched-copy')
    const applyRun = run([patched])
    check('apply exits 0', applyRun.code === 0)
    const patchedSource = read(join(patched, 'lib', 'restart.js'))
    check('the patched file carries the shared predicate', patchedSource.includes(PATCH_MARKER))
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

    effective = patched
  }

  // --- a package that already carries the fix is left alone -------------------
  // The upstream shape, whichever shape was published: the published package
  // itself when it already carries the fix, and otherwise the patched copy
  // without the backups the applier keeps beside the files it patched.
  const upstream = publishedCarriesTheFix
    ? copyPackage(packageDir, work, 'upstream-copy')
    : copyWithoutBackups(effective, work, 'upstream-copy')
  const upstreamBefore = snapshot(upstream)
  const upstreamApply = run([upstream])
  check('apply exits 0 on a package that already carries the fix', upstreamApply.code === 0)
  check('apply writes nothing on a package that already carries the fix', snapshot(upstream) === upstreamBefore)
  check('apply reports that the package already carries the fix', upstreamApply.stdout.includes('already carries the trusted-authority fix'))
  const upstreamVerify = run([upstream, '--verify'])
  check('--verify exits 0 on a package that already carries the fix', upstreamVerify.code === 0)
  check('the untouched package still carries the shared predicate', read(join(upstream, 'lib', 'restart.js')).includes(PATCH_MARKER))

  // --- the behaviour the patch exists for --------------------------------------
  const behaviour = execFileSync(process.execPath, ['--input-type=module', '--eval', `
    import { setTrustedHostsSource } from ${JSON.stringify(join(effective, 'lib', 'http.js'))}
    import { trustedDownloadRequest, trustedRestartRequest } from ${JSON.stringify(join(effective, 'lib', 'restart.js'))}
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
