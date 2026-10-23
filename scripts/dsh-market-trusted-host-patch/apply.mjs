#!/usr/bin/env node
/**
 * Apply the dsh-market trusted-authority patch to an installed `dshmarket`.
 *
 * The patch is applied by anchored edits (see `./edits.mjs`), not by a
 * line-based diff, so a market release that keeps the anchors needs no new
 * patch file. A release that moves an anchor fails here with the anchor's
 * id and the installed package is left untouched.
 *
 * Usage:
 *   node scripts/dsh-market-trusted-host-patch/apply.mjs <dshmarket-package-dir> [--check|--verify]
 *
 * `--check` reports what would happen and exits 0 without writing.
 * `--verify` asserts that the package already carries the fix — this is what
 * the deploy runs after applying, so a half-patched package fails the deploy
 * instead of shipping.
 *
 * The patched file is REPLACED, not written in place: pnpm installs a
 * package by hardlinking it out of the content-addressable store, and
 * writing into the linked inode would edit the store copy that every other
 * installation of this version shares.
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { ACCESSOR_MARKER, EDITS, PATCH_MARKER, applyMarketPatch } from './edits.mjs'

/**
 * Parse-check a patched file before it is written.
 *
 * A patch that produces a file the runtime cannot parse breaks the market's
 * privileged routes, and the failure surfaces in the browser, not here. The
 * check is a parse, not a run: it catches a malformed edit and leaves the
 * installed package untouched.
 *
 * The scratch directory sits BESIDE the file being written — never in
 * `tmpdir()` (moct#30's rule): it is on the same filesystem as the output, so
 * a host whose `/tmp` is a small shared tmpfs (or full) cannot kill the
 * install with ENOSPC, and the write stays single-device.
 */
function parses(source, name, directory) {
  const work = mkdtempSync(join(directory, '.patch-check-'))
  try {
    const file = join(work, `${name}.mjs`)
    writeFileSync(file, source)
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' })
    return undefined
  } catch (error) {
    const output = error.stderr?.toString() ?? String(error)
    return output.split('\n').slice(0, 6).join('\n')
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

/** The marker that says a file already carries the fix. */
function markerOf(file) {
  return file === 'lib/http.js' ? ACCESSOR_MARKER : PATCH_MARKER
}

function readVersion(packageDir) {
  const manifest = join(packageDir, 'package.json')
  if (!existsSync(manifest)) return 'unknown'
  try {
    return JSON.parse(readFileSync(manifest, 'utf8')).version ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

/**
 * What one file needs, decided without writing anything.
 *
 * @returns {{ state: 'fixed'|'patched'|'todo', source?: string, applied?: string[] }}
 *   `fixed` — the file already carries the fix (this patch's output, or a
 *   release that shipped the same change);
 *   `patched` — the file already is this patch's output;
 *   `todo` — the file has to be written; `source` is the content to write.
 */
function plan(file, packageDir) {
  const path = join(packageDir, file)
  if (!existsSync(path)) throw new Error(`no ${file} in ${packageDir}`)
  const current = readFileSync(path, 'utf8')
  const backup = `${path}.orig`
  const pristine = existsSync(backup) ? readFileSync(backup, 'utf8') : current
  if (current.includes(markerOf(file))) {
    // The file already carries the fix. If the pristine copy is ours and the
    // patched output is exactly what is installed, it is up to date; if it
    // differs, the installed file carries a DIFFERENT implementation (a
    // release that shipped the fix upstream) and must not be regressed.
    if (existsSync(backup)) {
      const { source } = applyMarketPatch(file, pristine)
      if (source === current) return { state: 'patched' }
    }
    return { state: 'fixed' }
  }
  const { source, applied } = applyMarketPatch(file, pristine)
  if (source === current) return { state: 'patched' }
  return { state: 'todo', source, applied }
}

function main(argv) {
  const check = argv.includes('--check')
  const verify = argv.includes('--verify')
  const target = argv.find((arg) => !arg.startsWith('--'))
  if (target === undefined) {
    console.error('usage: apply.mjs <dshmarket-package-dir> [--check|--verify]')
    return 2
  }
  const packageDir = resolve(target)
  const manifest = join(packageDir, 'package.json')
  if (!existsSync(manifest)) {
    console.error(`no package manifest at ${manifest}`)
    return 2
  }
  let name
  try {
    name = JSON.parse(readFileSync(manifest, 'utf8')).name
  } catch {
    name = undefined
  }
  if (name !== 'dshmarket') {
    console.error(`${packageDir} is not the dshmarket package (its name is ${String(name)})`)
    return 2
  }

  let plans
  try {
    plans = Object.keys(EDITS).map(file => ({ file, ...plan(file, packageDir) }))
  } catch (error) {
    console.error(String(error instanceof Error ? error.message : error))
    return 3
  }

  const pending = plans.filter(entry => entry.state === 'todo')
  if (verify) {
    const missing = plans.filter(entry => entry.state === 'todo')
    if (missing.length > 0) {
      console.error(`dshmarket ${readVersion(packageDir)} is NOT fully patched: ${missing.map(entry => entry.file).join(', ')}`)
      return 1
    }
    console.log(`dshmarket ${readVersion(packageDir)} carries the trusted-authority fix`)
    return 0
  }

  // Everything is written only after every file has been planned and every
  // patched file has been parse-checked: a package is never left half
  // patched, and a missing anchor leaves it exactly as it was.
  for (const entry of pending) {
    const parseError = parses(entry.source, basename(entry.file, '.js'), dirname(join(packageDir, entry.file)))
    if (parseError !== undefined) {
      console.error(`the patched ${entry.file} does not parse; the installed package was left untouched:\n${parseError}`)
      return 4
    }
  }

  if (check) {
    if (pending.length === 0) {
      console.log(`dshmarket ${readVersion(packageDir)} already carries the trusted-authority fix`)
      return 0
    }
    console.log(`patch applies cleanly to dshmarket ${readVersion(packageDir)} (${pending.map(entry => entry.file).join(', ')})`)
    return 0
  }

  for (const entry of pending) {
    const path = join(packageDir, entry.file)
    const backup = `${path}.orig`
    if (!existsSync(backup)) copyFileSync(path, backup)
    // Replace rather than write in place: the installed file may be a
    // hardlink into pnpm's store, and editing that inode would edit the
    // store's copy of this version for every other installation.
    const temporary = `${path}.patch-tmp`
    writeFileSync(temporary, entry.source)
    renameSync(temporary, path)
  }
  if (pending.length === 0) {
    console.log(`dshmarket ${readVersion(packageDir)} already carries the trusted-authority fix`)
    return 0
  }
  console.log(`patched dshmarket ${readVersion(packageDir)} (${pending.map(entry => entry.applied?.length ?? 0).reduce((sum, count) => sum + count, 0)} edits); originals kept next to the patched files`)
  return 0
}

process.exit(main(process.argv.slice(2)))
