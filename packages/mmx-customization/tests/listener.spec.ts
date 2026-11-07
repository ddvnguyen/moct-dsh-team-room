/** The public listener's security gate, against a plain upstream server.
 *
 *  Every case here is a refusal the card exists to prove: the browser holds no
 *  token and no cookie, the client's own credentials never reach the loopback
 *  listener, an untrusted authority reaches no loopback-only route, and the
 *  upstream's `set-cookie` never travels back. The upstream is an ordinary
 *  `node:http` server, so the gate is exercised without a Harness host — the
 *  mint and the fence verdict are the injectable seams `src/index.ts` fills
 *  from `connection`.
 */

import { createServer, request as httpRequest } from 'node:http'
import type { IncomingHttpHeaders, IncomingMessage, Server, ServerResponse } from 'node:http'
import { connect } from 'node:net'
import type { Socket } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { createPublicListener, stripToken, upstreamHeaders, type PublicListener } from '../src/proxy.ts'

/** One request the upstream actually received. */
interface Received {
  url: string
  method: string
  headers: IncomingHttpHeaders
}

interface Upstream {
  origin: string
  received: Received[]
  close: () => Promise<void>
}

const openServers: (() => Promise<void>)[] = []

afterEach(async () => {
  for (const close of openServers.splice(0).reverse()) await close()
})

/** Start one fake upstream that records what reached it. */
async function startUpstream(
  handler: (request: IncomingMessage, response: ServerResponse, body: string) => void,
): Promise<Upstream> {
  const received: Received[] = []
  const server: Server = createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => { body += chunk })
    request.on('end', () => {
      received.push({ url: request.url ?? '', method: request.method ?? 'GET', headers: request.headers })
      handler(request, response, body)
    })
  })
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (typeof address !== 'object' || address === null) throw new Error('upstream did not bind')
  const close = async (): Promise<void> => {
    await new Promise<void>(resolve => { server.close(() => { resolve() }) })
  }
  openServers.push(close)
  return { origin: `http://127.0.0.1:${String(address.port)}`, received, close }
}

/** Start one public listener in front of `upstream`. */
async function startListener(
  upstream: string,
  options: { mintCookie?: (authority: string) => string | undefined; refusal?: (request: { headers: IncomingHttpHeaders }) => number | undefined } = {},
): Promise<{ origin: string; listener: PublicListener }> {
  const listener = createPublicListener({
    upstream,
    host: '127.0.0.1',
    mintCookie: options.mintCookie ?? (() => 'dsh-auth-minted=minted-1'),
    refusal: options.refusal ?? (() => undefined),
  })
  const port = await listener.listen(0)
  openServers.push(() => listener.close())
  return { origin: `http://127.0.0.1:${String(port)}`, listener }
}

interface Answer {
  status: number
  headers: IncomingHttpHeaders
  body: string
}

/** One browser-shaped request to the public listener. */
function fetchFrom(
  origin: string,
  path: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(`${origin}${path}`, {
      method: init.method ?? 'GET',
      headers: { host: 'app.example.test:3180', ...init.headers },
    }, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk: string) => { body += chunk })
      response.on('end', () => {
        resolve({ status: response.statusCode ?? 0, headers: response.headers, body })
      })
    })
    request.once('error', reject)
    request.end(init.body)
  })
}

describe('public listener', () => {
  it('replaces the client credentials, drops hop-by-hop headers and never forwards a token', async () => {
    const upstream = await startUpstream((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain', 'set-cookie': ['leak=1; Path=/', 'leak=2; Path=/'] })
      response.end('ok')
    })
    const minted = 'dsh-auth-minted=minted-1'
    const { origin } = await startListener(upstream.origin, { mintCookie: () => minted })

    const answer = await fetchFrom(origin, '/index.html?token=super-secret&view=board', {
      headers: {
        cookie: 'dsh-auth-minted=client-supplied',
        authorization: 'Bearer client-supplied',
        te: 'trailers',
        'proxy-connection': 'keep-alive',
        'x-forwarded-for': '10.0.0.9',
        'x-real-ip': '10.0.0.9',
      },
    })

    expect(answer.status).toBe(200)
    expect(answer.body).toBe('ok')
    // The upstream hands the browser two cookies; neither survives the hop.
    expect(answer.headers['set-cookie']).toBeUndefined()

    const seen = upstream.received[0]
    expect(seen).toBeDefined()
    expect(seen?.url).toBe('/index.html?view=board')
    expect(seen?.headers.cookie).toBe(minted)
    expect(seen?.headers.authorization).toBeUndefined()
    expect(seen?.headers.te).toBeUndefined()
    expect(seen?.headers['proxy-connection']).toBeUndefined()
    expect(seen?.headers['x-forwarded-for']).toBeUndefined()
    expect(seen?.headers['x-real-ip']).toBeUndefined()
    // The browser's Host survives, which is what keeps the core fence deciding.
    expect(seen?.headers.host).toBe('app.example.test:3180')
  })

  it('refuses an untrusted authority without contacting the upstream or minting', async () => {
    const upstream = await startUpstream((_request, response) => { response.end('should not run') })
    let mints = 0
    const { origin } = await startListener(upstream.origin, {
      mintCookie: () => { mints += 1; return 'dsh-auth-minted=minted-1' },
      refusal: () => 403,
    })

    const answer = await fetchFrom(origin, '/')

    expect(answer.status).toBe(403)
    expect(answer.headers['set-cookie']).toBeUndefined()
    expect(mints).toBe(0)
    expect(upstream.received).toHaveLength(0)
  })

  it('keeps a loopback-only route unreachable from an untrusted authority', async () => {
    const upstream = await startUpstream((_request, response) => { response.end('loopback only') })
    // The fence refuses every authority but the loopback one; the proxy adds no
    // route knowledge of its own, so the API path below is refused by the same
    // gate that refuses the page.
    const { origin } = await startListener(upstream.origin, {
      refusal: request => request.headers.host === '127.0.0.1:3180' ? undefined : 403,
    })

    const refused = await fetchFrom(origin, '/api/private/read', { method: 'POST' })
    expect(refused.status).toBe(403)
    expect(refused.headers['set-cookie']).toBeUndefined()
    expect(upstream.received).toHaveLength(0)

    const admitted = await fetchFrom(origin, '/api/private/read', { method: 'POST', headers: { host: '127.0.0.1:3180' } })
    expect(admitted.status).toBe(200)
    expect(upstream.received).toHaveLength(1)
  })

  it('re-mints once on upstream 401, then refuses to loop', async () => {
    let calls = 0
    const upstream = await startUpstream((_request, response) => {
      calls += 1
      if (calls === 1) {
        response.writeHead(401, { 'set-cookie': 'revoked=1; Path=/' })
        response.end()
        return
      }
      response.writeHead(200, { 'content-type': 'text/plain' })
      response.end('authorized')
    })
    let mints = 0
    const { origin } = await startListener(upstream.origin, {
      mintCookie: () => { mints += 1; return `dsh-auth-minted=minted-${String(mints)}` },
    })

    const answer = await fetchFrom(origin, '/')

    expect(answer.status).toBe(200)
    expect(answer.body).toBe('authorized')
    expect(answer.headers['set-cookie']).toBeUndefined()
    expect(mints).toBe(2)
    expect(upstream.received.map(seen => seen.headers.cookie)).toEqual([
      'dsh-auth-minted=minted-1',
      'dsh-auth-minted=minted-2',
    ])
  })

  it('fails closed when the re-mint is refused again', async () => {
    const upstream = await startUpstream((_request, response) => {
      response.writeHead(401, { 'set-cookie': 'revoked=1; Path=/' })
      response.end()
    })
    let mints = 0
    const { origin } = await startListener(upstream.origin, {
      mintCookie: () => { mints += 1; return 'dsh-auth-minted=minted' },
    })

    const answer = await fetchFrom(origin, '/')

    expect(answer.status).toBe(401)
    expect(answer.headers['set-cookie']).toBeUndefined()
    expect(mints).toBe(2)
    expect(upstream.received).toHaveLength(2)
  })

  it('streams an SSE body chunk by chunk', async () => {
    const upstream = await startUpstream((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' })
      response.write('data: one\n\n')
      setTimeout(() => {
        response.write('data: two\n\n')
        response.end()
      }, 80)
    })
    const { origin } = await startListener(upstream.origin)

    const chunks: string[] = []
    let endedOnFirstChunk = false
    await new Promise<void>((resolve, reject) => {
      const request = httpRequest(`${origin}/api/events`, { headers: { host: 'app.example.test:3180' } }, (response) => {
        let ended = false
        response.setEncoding('utf8')
        response.on('data', (chunk: string) => {
          if (chunks.length === 0) endedOnFirstChunk = ended
          chunks.push(chunk)
        })
        response.on('end', () => { ended = true; resolve() })
        response.on('error', reject)
      })
      request.once('error', reject)
      request.end()
    })

    expect(chunks.join('')).toBe('data: one\n\ndata: two\n\n')
    // The first chunk arrived while the stream was still open: piped, not buffered.
    expect(chunks.length).toBeGreaterThan(1)
    expect(endedOnFirstChunk).toBe(false)
  })

  it('tunnels a WebSocket upgrade with the minted cookie and no handshake cookie', async () => {
    const server = createServer()
    const upgrades: IncomingHttpHeaders[] = []
    const sockets = new Set<Socket>()
    server.on('upgrade', (request: IncomingMessage, socket: Socket) => {
      sockets.add(socket)
      socket.once('close', () => { sockets.delete(socket) })
      upgrades.push(request.headers)
      socket.write('HTTP/1.1 101 Switching Protocols\r\nupgrade: websocket\r\nconnection: Upgrade\r\nset-cookie: leak=1; Path=/\r\n\r\n')
      socket.on('data', chunk => { socket.write(chunk) })
    })
    await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve) })
    const address = server.address()
    if (typeof address !== 'object' || address === null) throw new Error('upstream did not bind')
    openServers.push(async () => {
      for (const socket of sockets) socket.destroy()
      server.closeAllConnections()
      await new Promise<void>(resolve => { server.close(() => { resolve() }) })
    })
    const { origin } = await startListener(`http://127.0.0.1:${String(address.port)}`)

    const socket = connect(new URL(origin).port === '' ? 80 : Number(new URL(origin).port), '127.0.0.1')
    await new Promise<void>(resolve => { socket.once('connect', resolve) })
    let received = ''
    socket.setEncoding('latin1')
    socket.on('data', (chunk: string) => { received += chunk })

    socket.write([
      'GET /api/socket HTTP/1.1',
      'Host: app.example.test:3180',
      'Upgrade: websocket',
      'Connection: Upgrade',
      'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
      'Sec-WebSocket-Version: 13',
      'Cookie: dsh-auth-minted=client-supplied',
      '',
      '',
    ].join('\r\n'))

    await new Promise<void>((resolve, reject) => {
      const deadline = setTimeout(() => { reject(new Error(`no handshake: ${received}`)) }, 3000)
      const poll = setInterval(() => {
        if (!received.includes('101 Switching Protocols')) return
        clearInterval(poll)
        clearTimeout(deadline)
        resolve()
      }, 10)
    })

    expect(received).toContain('101 Switching Protocols')
    expect(received.toLowerCase()).not.toContain('set-cookie')
    expect(upgrades[0]?.cookie).toBe('dsh-auth-minted=minted-1')
    expect(upgrades[0]?.host).toBe('app.example.test:3180')

    socket.write('ping')
    await new Promise<void>((resolve, reject) => {
      const deadline = setTimeout(() => { reject(new Error(`no echo: ${received}`)) }, 3000)
      const poll = setInterval(() => {
        if (!received.includes('ping')) return
        clearInterval(poll)
        clearTimeout(deadline)
        resolve()
      }, 10)
    })
    socket.destroy()
  })

  it('refuses an upgrade from an untrusted authority on the raw socket', async () => {
    const upstream = await startUpstream((_request, response) => { response.end() })
    const { origin } = await startListener(upstream.origin, { refusal: () => 403 })
    const socket = connect(Number(new URL(origin).port), '127.0.0.1')
    await new Promise<void>(resolve => { socket.once('connect', resolve) })
    let received = ''
    socket.setEncoding('latin1')
    socket.on('data', (chunk: string) => { received += chunk })
    socket.write('GET /api/socket HTTP/1.1\r\nHost: evil.example\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n')
    await new Promise<void>((resolve, reject) => {
      const deadline = setTimeout(() => { reject(new Error('no refusal')) }, 3000)
      socket.once('close', () => { clearTimeout(deadline); resolve() })
    })
    expect(received).toContain('403')
    expect(received.toLowerCase()).not.toContain('set-cookie')
    socket.destroy()
  })
})

describe('listener helpers', () => {
  it('strips a client-supplied token and keeps the rest of the query', () => {
    expect(stripToken('/?token=abc&x=1')).toBe('/?x=1')
    expect(stripToken('/a?b=2&token=abc')).toBe('/a?b=2')
    expect(stripToken('/a?token=abc&b=2')).toBe('/a?b=2')
    expect(stripToken('/plain')).toBe('/plain')
    expect(stripToken('/?token=abc')).toBe('/')
  })

  it('forwards a target that is not form data byte for byte', () => {
    // The shell composes client bundles under `/plugins/??<id>/client.js&rev=…`.
    // Re-encoding that query as form data percent-encodes `/`, `@` and `,`, and
    // the shell then answers 404 for a bundle it advertised.
    expect(stripToken('/plugins/??@ddvnguyen/mmx-customization/client.js&rev=abc123'))
      .toBe('/plugins/??@ddvnguyen/mmx-customization/client.js&rev=abc123')
    expect(stripToken('/plugins/??a/client.js,b/client.js&rev=abc&token=leak'))
      .toBe('/plugins/??a/client.js,b/client.js&rev=abc')
  })

  it('never forwards a client credential, even when it is the only header', () => {
    const forwarded = upstreamHeaders({ cookie: 'client=1', authorization: 'Bearer x', host: 'h:1' }, 'dsh-auth-minted=minted')
    expect(forwarded).toEqual({ host: 'h:1', cookie: 'dsh-auth-minted=minted' })
  })
})
