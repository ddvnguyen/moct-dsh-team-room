/** MMX customization: the one dsh customization the MMX lanes mount.
 *
 *  Host half: the public listener that lets a browser reach the loopback dsh
 *  without a token or a cookie in the browser (see `./proxy.ts`). The stock
 *  `webServer` keeps serving on a loopback port; this row owns the public one.
 *
 *  Client half: the MOCT sidebar (see `./client/index.ts`).
 *
 *  Why a plugin and not a fork patch: the seams it uses are stock public API —
 *  `webServer.getOrigin()`, the `connection` fence and the `/` token exchange —
 *  so an upstream tag needs no `git am`. The fence stays the core's: the
 *  browser's `Host` survives the hop and `trustedHosts` still decides admission.
 *
 *  Harness generations: the mint and fence moved between the certified line
 *  (`dsh-v0.2.2-alpha.2`, exchange on `connection`) and the merged line
 *  (exchange in `host-authentication-token`, fence on `connection.admit()`).
 *  This row speaks both, probing the new shape first and falling back to the
 *  old one, so CI on the certified tag and the lane on the merge both pass.
 */

import { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import { createPublicListener, type PublicListener } from './proxy.ts'

/** Stable Cordis plugin name. */
export const name = 'mmx-customization'

/** Services required before the public listener can be built. */
export const inject = ['webServer', 'connection', 'credentials']

/** Plugin config, as the composition row spells it. */
export interface Config {
  /** Port the browser reaches. The stock listener keeps its own loopback port. */
  publicPort: number
  /**
   * Public bind address. Omitted listens on every interface, which is what a
   * tunnel or edge in front of the lane expects.
   */
  publicHost?: string
  /**
   * Optional narrowing of the authorities this listener serves. The Connection
   * fence always decides as well; a list here can only refuse more, never admit
   * an authority the fence rejects.
   */
  trustedHosts?: string[]
}

/** True when `authority` is one of the listed hosts, with or without its port. */
export function admittedAuthority(authority: string | undefined, trustedHosts: readonly string[] | undefined): boolean {
  if (authority === undefined) return false
  const host = authority.trim().toLowerCase()
  const bare = host.replace(/:\d+$/u, '')
  return (trustedHosts ?? []).some((entry) => {
    const wanted = entry.trim().toLowerCase()
    return wanted.length > 0 && (wanted === host || wanted === bare)
  })
}

/** Reject a composition row the listener cannot honour, before it binds. */
function validate(config: Config): void {
  if (!Number.isInteger(config.publicPort) || config.publicPort < 0 || config.publicPort > 65535) {
    throw new Error(`mmx-customization: publicPort must be an integer port, received ${String(config.publicPort)}`)
  }
  if (config.publicHost !== undefined && config.publicHost.trim().length === 0) {
    throw new Error('mmx-customization: publicHost must name an interface when it is present')
  }
  for (const entry of config.trustedHosts ?? []) {
    if (entry.trim().length === 0) throw new Error('mmx-customization: trustedHosts entries must not be empty')
  }
}

/** Sink response capturing the exchange's `set-cookie`; the body is never used. */
interface SinkResponse {
  writeHead(status: number, headers?: Readonly<Record<string, string>>): unknown
  end(body?: string): unknown
}

/** One request's facts, as the proxy hands them over. */
export interface FenceRequest {
  readonly headers: Record<string, string | string[] | undefined>
  readonly method?: string | undefined
}

/** The token exchange both harness generations expose under different owners. */
export interface CookieMinter {
  /** Append the process launch token to a caller-supplied base URL. */
  authenticatedUrl(baseUrl: string): string
  /** Run the `/` token-for-cookie exchange against a sink response. */
  authorizeIndex(
    req: { method?: string; url?: string; headers: Record<string, string | undefined>; [key: string]: unknown },
    res: SinkResponse,
    secure?: boolean,
  ): boolean
}

/** The fence verdict both harness generations expose: 403 for untrusted Host, else admit. */
export type FenceVerdict = (request: FenceRequest) => number | undefined

/**
 * Mint one browser-session cookie for a request authority.
 *
 * The mint runs the same in-process exchange a browser tab performs on `/`:
 * the process launch token is appended to the URL and handed to the exchange
 * against a response that is thrown away, and only the `set-cookie` value is
 * kept. The token lives only in that in-process request target — it is never
 * sent on the wire and the browser never sees it. The audience of that cookie
 * is the authority this call was made for, which is why it is minted per request.
 * @param minter - the token exchange, sharing this process's secret and launch token.
 * @param authority - the request `Host` the cookie is bound to.
 * @param secure - whether the receiving listener uses TLS; the minted cookie carries `Secure` when it does.
 * @returns the cookie as a `Cookie` header value, or undefined when the exchange failed.
 */
export function mintCookie(minter: CookieMinter, authority: string, secure = false): string | undefined {
  let token: string | null
  try {
    token = new URL(minter.authenticatedUrl('http://dsh.invalid/')).searchParams.get('token')
  } catch {
    return undefined
  }
  if (token === null || token.length === 0) return undefined
  let cookie: string | undefined
  const response: SinkResponse = {
    writeHead(_status, headers) {
      const value = headers?.['set-cookie']
      if (cookie === undefined && typeof value === 'string') cookie = value.split(';', 1)[0]
      return undefined
    },
    end() { /* the exchange's body is never used */ },
  }
  try {
    minter.authorizeIndex({
      method: 'GET',
      url: `/?token=${encodeURIComponent(token)}`,
      headers: { host: authority },
    }, response, secure)
  } catch {
    return undefined
  }
  return cookie
}

/** Old generation: the exchange lives on the connection handle itself. */
function asLegacyMinter(connection: object): CookieMinter | undefined {
  const handle = connection as Partial<CookieMinter>
  return typeof handle.authenticatedUrl === 'function' && typeof handle.authorizeIndex === 'function'
    ? handle as CookieMinter
    : undefined
}

/** Old generation: `requestRejection()` answers 403 for an untrusted Host. */
function legacyVerdict(connection: object): FenceVerdict | undefined {
  const handle = connection as {
    requestRejection?: (request: { headers: unknown }) => 401 | 403 | 503 | undefined
  }
  if (typeof handle.requestRejection !== 'function') return undefined
  return (request) => {
    const rejection = handle.requestRejection!({ headers: request.headers })
    return rejection === 403 ? 403 : undefined
  }
}

/** New generation: the fence is `connection.admit()`; 403 is untrusted Host. */
function admitVerdict(connection: HostConnectionHandle): FenceVerdict {
  return (request) => {
    const admission = connection.admit({ headers: request.headers })
    return 'rejection' in admission && admission.rejection === 403 ? 403 : undefined
  }
}
/** New generation: a `BrowserAuth` sharing this process's secret and launch token. */
async function createTokenMinter(ctx: Context, credentials: object): Promise<CookieMinter | undefined> {
  // The specifier is assembled at runtime (never a static string): on the
  // certified line the token package does not exist, so no tsconfig facade
  // maps it and a static import — even a dynamic `import('...')` literal —
  // fails the build. `Function` keeps the constructor hidden from tsc while
  // Vite still bundles the expression as an opaque runtime import.
  const specifier = ['@deepseek-ai/dsh-host-authentication-token', 'src/browser-auth.ts'].join('/')
  let module: {
    BrowserAuth?: {
      create(processOwner: object, credentials: object, maxAgeDays: number): Promise<CookieMinter>
    }
  }
  try {
    const load = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<typeof module>
    module = await load(specifier)
  } catch {
    return undefined
  }
  if (module.BrowserAuth === undefined) return undefined
  try {
    return await module.BrowserAuth.create(ctx[Context.root], credentials, 30)
  } catch {
    return undefined
  }
}

/**
 * Mount the public listener and keep it for this plugin's lifetime.
 * @param ctx - plugin context; `webServer`, `connection` and `credentials` are
 * already active. The default `host-authentication-token` row, when the lane
 * composes it, shares one secret and one launch token with the minter below.
 * @param config - the composition row's config.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  validate(config)
  const web = ctx.get('webServer')
  const connection: HostConnectionHandle | undefined = ctx.get('connection')
  const credentials = ctx.get('credentials')
  // `inject` above is the contract; failing loudly beats a silent no-listener boot.
  if (web === undefined || connection === undefined || credentials === undefined) {
    throw new Error('mmx-customization: webServer, connection and credentials must be active before this row mounts')
  }
  const secure = web.protocol === 'https:'
  // Prefer the new generation (token plugin owns the exchange); fall back to
  // the exchange on the connection handle on the certified line. `create()`
  // keeps one launch token per root context and loads the same stored secret,
  // so cookies minted here verify against the stock fence on the loopback listener.
  const minter: CookieMinter | undefined =
    await createTokenMinter(ctx, credentials) ?? asLegacyMinter(connection)
  if (minter === undefined) {
    throw new Error('mmx-customization: no token exchange available on connection or host-authentication-token')
  }
  const verdict: FenceVerdict = 'admit' in connection && typeof connection.admit === 'function'
    ? admitVerdict(connection)
    : legacyVerdict(connection) ?? admitVerdict(connection)
  const listener: PublicListener = createPublicListener({
    upstream: web.getOrigin(),
    host: config.publicHost,
    mintCookie: (authority) => mintCookie(minter, authority, secure),
    refusal: (request) => {
      // A narrowed authority list refuses before the fence is asked; the fence
      // then answers 403 for an untrusted Host, while the minted-cookie state
      // this proxy produces admits — so only a 403 refusal stops the hop.
      const authority = request.headers.host
      if ((config.trustedHosts?.length ?? 0) > 0 && !admittedAuthority(authority, config.trustedHosts)) return 403
      return verdict({ headers: request.headers, method: request.method })
    },
  })

  ctx.effect(() => {
    listener.listen(config.publicPort).catch((error: unknown) => {
      console.error(`mmx-customization: public listener failed to bind port ${String(config.publicPort)}`, error)
    })
    return () => { void listener.close() }
  }, 'mmx-customization: public listener')
}
