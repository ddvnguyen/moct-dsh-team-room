// Install smoke for @ddvnguyen/mmx-customization: the packed tarball inside a
// real DSH host, exercised through its PUBLIC port.
//
//   1. pack the already-built mmx-customization (and, for the second boot, the
//      sidebar alias) and `dsh plugin add` each into one fresh profile
//   2. boot with the stock listener on an ephemeral loopback port and the
//      plugin's public listener on a known port
//   3. the public port serves the page to a browser that holds no token and no
//      cookie, and the response carries no `set-cookie`
//   4. an untrusted `Host` gets `403` — on the page AND on the API path — with
//      no `set-cookie`
//   5. the stock loopback port, reached directly without the cookie, still
//      answers `401`: the proxy adds no loopback trust
//   6. both client bundles are served from the public port, so a profile with
//      the alias installed beside the real package still gets a bundle (the
//      one-pass rule between the two rows is covered by the jsdom specs)
//
// The sidebar *rows* are DOM behaviour; `packages/mmx-customization/tests/
// client.spec.ts` and `packages/sidebar/tests/sidebar.spec.ts` assert them. This
// smoke proves the install, the listener gate and bundle delivery.
//
// Usage:  npm run smoke:mmx      (builds first)   or   node scripts/quality/dsh-mmx-smoke.mjs
// Exit:   0 = installs, boots, serves, and refuses exactly what it should.
import { createServer, request as httpRequest } from 'node:http'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bootProfile, createSmokeRoot, packTarball, redact, runDsh } from './dsh-fixture.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const MMX = { name: '@ddvnguyen/mmx-customization', dir: join(repoRoot, 'packages/mmx-customization') }
const SIDEBAR = { name: '@ddvnguyen/dsh-sidebar', dir: join(repoRoot, 'packages/sidebar') }
const PROFILE = 'mmx-smoke'

function step(label) { console.log(`smoke: ${label}`) }
function assert(condition, message) { if (!condition) throw new Error(message) }

/** One HTTP request with full control of `Host` (the gate reads it). */
function request(origin, path, { method = 'GET', host, headers = {} } = {}) {
  return new Promise((resolveRequest, reject) => {
    const outgoing = httpRequest(`${origin}${path}`, { method, headers: { ...headers, ...(host === undefined ? {} : { host }) } }, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => { body += chunk })
      response.on('end', () => { resolveRequest({ status: response.statusCode ?? 0, headers: response.headers, body }) })
    })
    outgoing.once('error', reject)
    outgoing.end()
  })
}

/**
 * The boot graph the shell documents, as the page embeds it.
 * @param html - the served index page.
 * @returns the entry list, or throws when the page carries no graph.
 */
function bootEntries(html) {
  const marker = 'globalThis["__DSH_BOOT__"] = '
  const from = html.indexOf(marker)
  const to = from === -1 ? -1 : html.indexOf('</script>', from)
  if (from === -1 || to === -1) throw new Error('the shell page carries no __DSH_BOOT__ graph')
  const parsed = JSON.parse(html.slice(from + marker.length, to).trim().replace(/;$/u, ''))
  if (!Array.isArray(parsed.entries)) throw new Error('the boot graph carries no entries')
  return parsed.entries
}

/**
 * Fetch the client bundle the boot graph composed for one package.
 * @returns the response and whether the graph listed the package at all.
 */
async function clientBundle(origin, html, id) {
  const entry = bootEntries(html).find(candidate => candidate.id === id)
  if (entry === undefined) return { listed: false }
  const path = `/${entry.url.replace(/^\//u, '')}`
  const response = await request(origin, path)
  return { listed: true, url: entry.url, response }
}

/** A free loopback port the public listener can own for this run. */
async function freePort() {
  const server = createServer()
  await new Promise((resolveListen) => { server.listen(0, '127.0.0.1', resolveListen) })
  const address = server.address()
  if (typeof address !== 'object' || address === null) throw new Error('port probe did not bind')
  const port = address.port
  await new Promise((resolveClose) => { server.close(() => { resolveClose() }) })
  return port
}

/**
 * The stock listener on an ephemeral loopback port, and the plugin on `publicPort`.
 * @returns the overlay file's path.
 */
function writeOverlay(root, publicPort) {
  const path = join(root, 'mmx.patch.yml')
  writeFileSync(path, [
    '- id: webserver',
    '  config: { host: 127.0.0.1, port: 0 }',
    '- id: web-runtime',
    '  config: { openBrowser: false, printUrl: true }',
    '- id: mmx-customization',
    `  config: { publicPort: ${String(publicPort)}, publicHost: 127.0.0.1 }`,
    '',
  ].join('\n'))
  return path
}

const smoke = createSmokeRoot()
let host
try {
  const packDir = join(smoke.root, 'pack')
  mkdirSync(packDir)

  step('pack')
  const mmx = packTarball(MMX.dir, packDir)
  assert(mmx.name === MMX.name, `packed ${mmx.name}, expected ${MMX.name}`)
  const sidebar = packTarball(SIDEBAR.dir, packDir)
  assert(sidebar.name === SIDEBAR.name, `packed ${sidebar.name}, expected ${SIDEBAR.name}`)
  step(`packed ${String(mmx.fileCount)} mmx files and ${String(sidebar.fileCount)} sidebar files`)

  step('init profile + plugin add mmx-customization')
  const init = runDsh(smoke, ['--profile', PROFILE, '--from-default-profile', 'web', '--dump-config'])
  assert(init.status === 0, `profile init exited ${String(init.status)}:\n${init.stderr.slice(-1500)}`)
  const addMmx = runDsh(smoke, ['plugin', '--profile', PROFILE, 'add', mmx.tarball])
  assert(addMmx.status === 0, `plugin add exited ${String(addMmx.status)}:\n${addMmx.stderr.slice(-1500)}`)
  const dump = runDsh(smoke, ['--profile', PROFILE, '--dump-config'])
  assert(dump.stdout.includes(`# == ${MMX.name}`), `--dump-config has no '${MMX.name}' layer`)

  const publicPort = await freePort()
  const overlay = writeOverlay(smoke.root, publicPort)
  const publicOrigin = `http://127.0.0.1:${String(publicPort)}`

  step(`boot 1: stock listener on loopback, mmx public listener on ${String(publicPort)}`)
  host = await bootProfile(smoke, PROFILE, overlay)
  const stockOrigin = host.origin

  step('public port serves the page to a browser with no token and no cookie')
  const page = await request(publicOrigin, '/', { host: `127.0.0.1:${String(publicPort)}` })
  assert(page.status === 200, `public page answered ${String(page.status)}`)
  assert(String(page.headers['content-type'] ?? '').includes('text/html'), `public page content-type ${String(page.headers['content-type'])}`)
  assert(page.body.includes('__DSH_BOOT__'), 'public page is not the dsh shell')
  assert(page.headers['set-cookie'] === undefined, 'public page leaked a set-cookie to the browser')
  step('public page is the shell, with no set-cookie')

  step('an untrusted Host is refused, on the page and on the API path')
  const refusedPage = await request(publicOrigin, '/', { host: 'evil.example' })
  assert(refusedPage.status === 403, `untrusted page answered ${String(refusedPage.status)}`)
  assert(refusedPage.headers['set-cookie'] === undefined, 'untrusted refusal leaked a set-cookie')
  const refusedApi = await request(publicOrigin, '/api/private/read', {
    method: 'POST', host: 'evil.example', headers: { 'content-type': 'application/json' },
  })
  assert(refusedApi.status === 403, `untrusted API answered ${String(refusedApi.status)}`)
  assert(refusedApi.headers['set-cookie'] === undefined, 'untrusted API refusal leaked a set-cookie')
  step('403 on page and API, no set-cookie')

  step('the stock loopback port still refuses a request without the cookie')
  const stock = await request(stockOrigin, '/')
  assert(stock.status === 401, `stock listener answered ${String(stock.status)} without a cookie`)
  step('stock listener is still 401 without the cookie')

  step('the mmx client bundle is composed into the boot graph and served from the public port')
  const bundle = await clientBundle(publicOrigin, page.body, MMX.name)
  assert(bundle.listed, `the boot graph does not list ${MMX.name}`)
  assert(bundle.response.status === 200, `client bundle answered ${String(bundle.response.status)} for ${bundle.url}`)
  assert(bundle.response.body.includes('__ModuleLoader__.load'), 'client bundle is not the loader artifact')
  assert(bundle.response.body.includes(MMX.name), 'client bundle is not stamped with its package id')
  step('mmx client bundle delivered')

  await host.stop()
  host = undefined

  step('plugin add the sidebar alias, then boot 2')
  const addSidebar = runDsh(smoke, ['plugin', '--profile', PROFILE, 'add', sidebar.tarball])
  assert(addSidebar.status === 0, `sidebar plugin add exited ${String(addSidebar.status)}:\n${addSidebar.stderr.slice(-1500)}`)
  host = await bootProfile(smoke, PROFILE, overlay)

  const page2 = await request(publicOrigin, '/', { host: `127.0.0.1:${String(publicPort)}` })
  assert(page2.status === 200, `public page after the alias install answered ${String(page2.status)}`)
  assert(page2.headers['set-cookie'] === undefined, 'public page leaked a set-cookie after the alias install')
  const aliasBundle = await clientBundle(publicOrigin, page2.body, SIDEBAR.name)
  assert(aliasBundle.listed, `the boot graph does not list ${SIDEBAR.name}`)
  assert(aliasBundle.response.status === 200, `alias client bundle answered ${String(aliasBundle.response.status)} for ${aliasBundle.url}`)
  assert(aliasBundle.response.body.includes('__ModuleLoader__.load'), 'alias client bundle is not the loader artifact')
  assert(aliasBundle.response.body.includes('data-hide-im-assistant'), 'alias client bundle does not carry the sidebar implementation')
  // The real package's row is still composed beside the alias.
  const mmxAfterAlias = await clientBundle(publicOrigin, page2.body, MMX.name)
  assert(mmxAfterAlias.listed, `the boot graph dropped ${MMX.name} after the alias install`)
  step('the alias bundle is the same implementation, served beside the real package')

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
