/** The public listener: one HTTP front door in front of the stock loopback one.
 *
 *  dsh serves its own listener on a loopback address and answers `401` to any
 *  browser request without a session cookie. The cookie can only be minted by
 *  presenting the process launch token, which the browser must never see. This
 *  proxy terminates the public connection instead:
 *
 *  - the browser's `Host` header is preserved on the hop, so the core Host /
 *    Origin fence (and its `trustedHosts`) still decides admission;
 *  - the cookie is minted in-process for that same authority and attached to
 *    the upstream request — one per request, because the cookie audience *is*
 *    the request `Host`;
 *  - every client credential (`cookie`, `authorization`) and every hop-by-hop
 *    header is dropped, and a client-supplied `?token=` is never forwarded;
 *  - no `set-cookie` ever travels back, so the browser holds no token and no
 *    cookie at any point;
 *  - `401` from upstream is retried once with a freshly minted cookie (a
 *    restarted Host revokes nothing but re-mints by authority), then the
 *    refusal is relayed as-is: fail closed, never loop.
 *
 *  SSE bodies are piped, never buffered, and WebSocket upgrades are tunnelled
 *  with the same minted cookie. The stock listener keeps its own authentication
 *  untouched: a local process without the cookie is still `401`, so this proxy
 *  adds no loopback trust.
 *
 *  The transport is injectable — {@link PublicListenerOptions} takes the
 *  upstream origin, the mint, and the fence verdict — so the gate above is
 *  testable against a plain HTTP server with no Harness host in the way.
 */

import { createServer, request as createRequest } from 'node:http'
import type {
  IncomingHttpHeaders,
  IncomingMessage,
  OutgoingHttpHeaders,
  Server,
  ServerResponse,
} from 'node:http'
import { connect as connectSocket } from 'node:net'
import { connect as connectTls } from 'node:tls'
import type { Duplex } from 'node:stream'

/** One request's browser headers, as `node:http` hands them over. */
export type RequestHeaders = IncomingHttpHeaders

/** Request facts the fence reads. */
export interface FenceRequest {
  readonly headers: RequestHeaders
  readonly method?: string | undefined
}

/** What the listener needs from its host. */
export interface PublicListenerOptions {
  /** Origin of the stock listener to forward to, e.g. `http://127.0.0.1:3080`. */
  readonly upstream: string
  /**
   * Mint one browser-session cookie value for a request authority.
   * @param authority - the request `Host`; the cookie is audience-bound to it.
   * @returns a `Cookie` header value (`name=value`), or undefined when none can be minted.
   */
  readonly mintCookie: (authority: string) => string | undefined
  /**
   * The Host / Origin fence's verdict for a request.
   * @returns the status refusing the request, or undefined to admit it.
   */
  readonly refusal: (request: FenceRequest) => number | undefined
  /** Public bind address; the default listens on every interface. */
  readonly host?: string | undefined
}

/** One running public listener. */
export interface PublicListener {
  readonly server: Server
  /** Bind and resolve with the actual port (0 asks the OS). */
  listen: (port: number) => Promise<number>
  /** Stop accepting and drop open connections. */
  close: () => Promise<void>
}

/** Headers that belong to one hop and are never forwarded. */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

/** Client-supplied credentials and forwarding claims: never trusted upstream. */
const CLIENT_CLAIMS = new Set([
  'authorization',
  'cookie',
  'forwarded',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-real-ip',
])

/** The refusals the proxy can produce on its own; everything else is relayed. */
const NO_STORE = 'no-store'

/**
 * Drop a client-supplied `token` query parameter from the request target.
 * The browser has no business presenting a launch token; only the mint does.
 *
 *  The edit is textual on purpose. A `URLSearchParams` round-trip re-encodes
 *  the whole query as form data, which mangles targets that are not form data —
 *  notably the shell's client-combo references, `/plugins/??<id>/client.js
 *  &rev=<hash>`, whose `/`, `@` and `,` would come back percent-encoded and
 *  404 upstream. Every other byte of the target is preserved as received.
 * @param target - the request target as received.
 * @returns the same path and query, minus any `token` parameter.
 */
export function stripToken(target: string): string {
  const queryAt = target.indexOf('?')
  if (queryAt === -1) return target
  const hashAt = target.indexOf('#', queryAt)
  const hash = hashAt === -1 ? '' : target.slice(hashAt)
  const query = target.slice(queryAt + 1, hashAt === -1 ? undefined : hashAt)
  const kept = query.split('&').filter(part => part.split('=', 1)[0] !== 'token')
  const path = target.slice(0, queryAt)
  if (kept.length === 0) return `${path}${hash}`
  return `${path}?${kept.join('&')}${hash}`
}

/**
 * Headers to send upstream: the browser's, minus its credentials and every
 * hop-by-hop header, plus the minted cookie.
 * @param headers - the browser request headers.
 * @param cookie - the minted `Cookie` header value.
 * @returns the upstream request headers, `Host` preserved.
 */
export function upstreamHeaders(headers: RequestHeaders, cookie: string): OutgoingHttpHeaders {
  const forwarded: OutgoingHttpHeaders = {}
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue
    const lower = name.toLowerCase()
    if (HOP_BY_HOP.has(lower) || CLIENT_CLAIMS.has(lower)) continue
    forwarded[lower] = value
  }
  forwarded.cookie = cookie
  return forwarded
}

/**
 * Response headers safe to hand the browser: no `set-cookie`, no hop-by-hop.
 * @param headers - the upstream response headers.
 * @returns the client-facing headers.
 */
export function clientHeaders(headers: IncomingHttpHeaders): OutgoingHttpHeaders {
  const forwarded: OutgoingHttpHeaders = {}
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue
    const lower = name.toLowerCase()
    if (HOP_BY_HOP.has(lower) || lower === 'set-cookie') continue
    forwarded[lower] = value
  }
  return forwarded
}

/** The request authority the cookie audience and the fence both read. */
function authorityOf(request: IncomingMessage): string | undefined {
  return request.headers.host
}

/** Refuse one HTTP request without touching the upstream. */
function refuse(response: ServerResponse, status: number): void {
  response.writeHead(status, {
    'cache-control': NO_STORE,
    'content-type': 'text/plain; charset=utf-8',
  })
  response.end(status === 403 ? 'forbidden\n' : 'unauthorized\n')
}

/** Refuse one WebSocket upgrade on its raw socket. */
function refuseSocket(socket: Duplex, status: number): void {
  const reason = status === 403 ? 'Forbidden' : 'Unauthorized'
  socket.end(`HTTP/1.1 ${String(status)} ${reason}\r\nconnection: close\r\n\r\n`)
}

/** True when a refused request can be replayed without buffering a body. */
function replayable(method: string | undefined): boolean {
  return method === 'GET' || method === 'HEAD' || method === undefined
}

/** One upstream request carrying the minted cookie. */
function forward(
  request: IncomingMessage,
  target: string,
  upstream: URL,
  cookie: string,
): Promise<IncomingMessage> {
  const headers = upstreamHeaders(request.headers, cookie)
  return new Promise((resolve, reject) => {
    const client = createRequest({
      protocol: upstream.protocol,
      hostname: upstream.hostname,
      port: upstream.port,
      method: request.method,
      path: target,
      headers,
    }, resolve)
    client.once('error', reject)
    // A bodyless request is ended outright: the same readable cannot be piped
    // twice, and the re-mint below replays exactly this shape. A body-bearing
    // request still streams, because buffering it is what a proxy must not do.
    if (replayable(request.method)) client.end()
    else request.pipe(client)
  })
}

/** The upstream socket for one upgrade: plain or TLS. */
function connectUpstream(upstream: URL): Duplex {
  const port = Number(upstream.port)
  return upstream.protocol === 'https:'
    ? connectTls({ host: upstream.hostname, port, servername: upstream.hostname })
    : connectSocket({ host: upstream.hostname, port })
}

/** Serialise one header block for a raw upgrade request. */
function rawHeaders(headers: OutgoingHttpHeaders): string {
  const lines: string[] = []
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue
    for (const item of Array.isArray(value) ? value : [value]) lines.push(`${name}: ${item}`)
  }
  return lines.join('\r\n')
}

/** Drop the cookie the upstream handshake would otherwise hand the browser. */
function sanitizedHandshake(head: string): string {
  return head
    .split('\r\n')
    .filter(line => !/^set-cookie:/iu.test(line))
    .join('\r\n')
}

/**
 * Create the public listener.
 * @param options - upstream origin, mint, fence, and bind address.
 * @returns the listener, unbound until {@link PublicListener.listen}.
 */
export function createPublicListener(options: PublicListenerOptions): PublicListener {
  const upstream = new URL(options.upstream)
  /** Upgraded client sockets: `closeAllConnections()` does not reach them. */
  const tunnels = new Set<Duplex>()

  /** Apply the fence and mint, in that order; a refusal answers the browser. */
  const admit = (request: IncomingMessage): { cookie: string } | { refusal: number } => {
    const refusal = options.refusal({ headers: request.headers, method: request.method })
    if (refusal !== undefined) return { refusal }
    const authority = authorityOf(request)
    const cookie = authority === undefined ? undefined : options.mintCookie(authority)
    return cookie === undefined ? { refusal: 401 } : { cookie }
  }

  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const admission = admit(request)
    if ('refusal' in admission) {
      refuse(response, admission.refusal)
      return
    }
    const target = stripToken(request.url ?? '/')
    let answer: IncomingMessage
    try {
      answer = await forward(request, target, upstream, admission.cookie)
    } catch {
      refuse(response, 502)
      return
    }
    // One re-mint on a revoked cookie, then fail closed: a body-bearing request
    // cannot be replayed here, so its 401 is relayed untouched.
    if (answer.statusCode === 401 && replayable(request.method)) {
      const authority = authorityOf(request)
      const cookie = authority === undefined ? undefined : options.mintCookie(authority)
      if (cookie !== undefined) {
        try {
          answer = await forward(request, target, upstream, cookie)
        } catch {
          refuse(response, 502)
          return
        }
      }
    }
    response.writeHead(answer.statusCode ?? 502, clientHeaders(answer.headers))
    answer.pipe(response)
    answer.once('error', () => { response.destroy() })
  }

  const tunnel = (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
    tunnels.add(socket)
    socket.once('close', () => { tunnels.delete(socket) })
    const admission = admit(request)
    if ('refusal' in admission) {
      refuseSocket(socket, admission.refusal)
      return
    }
    const upstreamSocket = connectUpstream(upstream)
    const headers = upstreamHeaders(request.headers, admission.cookie)
    // The handshake's own two headers are the protocol, not hop-by-hop noise.
    headers.connection = 'Upgrade'
    headers.upgrade = request.headers.upgrade ?? 'websocket'
    const target = stripToken(request.url ?? '/')
    upstreamSocket.write(`${request.method ?? 'GET'} ${target} HTTP/1.1\r\n${rawHeaders(headers)}\r\n\r\n`)
    if (head.length > 0) upstreamSocket.write(head)

    let pending = Buffer.alloc(0)
    let open = false
    const relay = (chunk: Buffer): void => {
      pending = Buffer.concat([pending, chunk])
      const end = pending.indexOf('\r\n\r\n')
      if (end === -1) return
      socket.write(`${sanitizedHandshake(pending.subarray(0, end).toString('latin1'))}\r\n\r\n`)
      const rest = pending.subarray(end + 4)
      if (rest.length > 0) socket.write(rest)
      open = true
      pending = Buffer.alloc(0)
      upstreamSocket.removeListener('data', relay)
      upstreamSocket.pipe(socket)
    }
    upstreamSocket.on('data', relay)
    upstreamSocket.once('end', () => { if (!open) socket.end() })
    upstreamSocket.once('error', () => { socket.destroy() })
    socket.pipe(upstreamSocket)
    socket.once('error', () => { upstreamSocket.destroy() })
    socket.once('close', () => { if (!open) upstreamSocket.destroy() })
  }

  const server = createServer((request, response) => { void handle(request, response) })
  server.on('upgrade', tunnel)
  server.on('clientError', (_error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nconnection: close\r\n\r\n')
  })

  return {
    server,
    listen(port) {
      return new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(port, options.host, () => {
          server.removeListener('error', reject)
          const address = server.address()
          resolve(typeof address === 'object' && address !== null ? address.port : port)
        })
      })
    },
    close() {
      return new Promise((resolve) => {
        server.close(() => { resolve() })
        server.closeAllConnections()
        for (const socket of tunnels) socket.destroy()
        tunnels.clear()
      })
    },
  }
}
