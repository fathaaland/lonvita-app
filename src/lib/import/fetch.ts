import { lookup as dnsLookup, type LookupAddress } from 'node:dns'
import { BlockList, isIP } from 'node:net'

import { Agent, fetch as undiciFetch } from 'undici'

import { logger, serializeError } from '@/lib/logger'

import {
  IMPORT_LIMITS,
  IMPORT_ROBOTS_TOKEN,
  IMPORT_USER_AGENT,
  type ImportFileType,
} from './contracts'

/**
 * Fetching a page somebody typed into the app, from our own servers — a request the app makes on a
 * stranger's say-so. So it only ever reaches the public internet: http(s) on the standard ports, no
 * credentials in the URL, and never an address inside our network or the cloud provider's (the
 * metadata service, the database, Redis). The check runs on the address the connection actually
 * goes to (undici's own DNS lookup), not just on the name, so a name that resolves to something
 * public when checked and private when connected (DNS rebinding) gets nowhere either. Every redirect
 * is checked the same way. The site's robots.txt is respected.
 */

export class ImportFetchError extends Error {
  constructor(
    message: string,
    /** Machine-readable, for logs and tests. */
    readonly code:
      | 'invalid_url'
      | 'blocked_address'
      | 'robots_disallowed'
      | 'robots_unavailable'
      | 'http_error'
      | 'too_large'
      | 'timeout'
      | 'unsupported_type'
      | 'network',
    /** The HTTP status, for an `http_error`. */
    readonly status?: number,
  ) {
    super(message)
    this.name = 'ImportFetchError'
  }
}

const BLOCKED = new BlockList()
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  BLOCKED.addSubnet(network, prefix, 'ipv4')
}
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
  ['2001:db8::', 32],
  ['100::', 64],
] as const) {
  BLOCKED.addSubnet(network, prefix, 'ipv6')
}

/** An IPv4 address carried inside an IPv6 one — mapped (::ffff:a.b.c.d) or NAT64 (64:ff9b::a.b.c.d). */
function embeddedIpv4(address: string): string | null {
  const lower = address.toLowerCase()
  const dotted = lower.match(/^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/)
  if (dotted) return dotted[1]
  const hex = lower.match(/^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
  if (hex) {
    const high = parseInt(hex[1], 16)
    const low = parseInt(hex[2], 16)
    return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`
  }
  return null
}

/** Whether connecting to `address` would reach the public internet. Anything unparseable isn't. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return !BLOCKED.check(address, 'ipv4')
  if (family === 6) {
    const v4 = embeddedIpv4(address)
    if (v4) return isPublicAddress(v4)
    return !BLOCKED.check(address, 'ipv6')
  }
  return false
}

/**
 * The URL as we'll fetch it — or why not. Accepts what people type ("obec.cz/akce"), turns webcal://
 * into https:// (what calendar apps use for a subscribable iCal feed).
 */
export function normalizeSourceUrl(raw: string): URL {
  let value = raw.trim()
  if (/^webcals?:\/\//i.test(value)) value = value.replace(/^webcals?:\/\//i, 'https://')
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = `https://${value}`
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new ImportFetchError('Neplatná adresa.', 'invalid_url')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ImportFetchError('Adresa musí začínat http:// nebo https://.', 'invalid_url')
  }
  if (url.username || url.password)
    throw new ImportFetchError('Adresa nesmí obsahovat přihlašovací údaje.', 'invalid_url')
  if (url.port && url.port !== '80' && url.port !== '443') {
    throw new ImportFetchError('Adresa musí používat standardní port.', 'invalid_url')
  }
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (isIP(host) && !isPublicAddress(host))
    throw new ImportFetchError('Tahle adresa není veřejná.', 'blocked_address')
  if (
    !isIP(host) &&
    (!host.includes('.') || /\.(local|localhost|internal|lan|home|corp)$/i.test(host))
  ) {
    throw new ImportFetchError('Tahle adresa není veřejná.', 'blocked_address')
  }
  url.hash = ''
  return url
}

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void

/** undici's DNS lookup, refusing a name that resolves to anything but public addresses. */
function publicOnlyLookup(
  hostname: string,
  options: { all?: boolean } & object,
  callback: LookupCallback,
): void {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, [])
    const list = addresses as LookupAddress[]
    if (list.length === 0 || list.some((a) => !isPublicAddress(a.address))) {
      const blocked = Object.assign(new Error(`Blocked address for ${hostname}`), {
        code: 'EBLOCKED',
      })
      return callback(blocked, [])
    }
    if (options.all) return callback(null, list)
    callback(null, list[0].address, list[0].family)
  })
}

let agent: Agent | undefined
const getAgent = () => {
  agent ??= new Agent({
    connect: { lookup: publicOnlyLookup as never, timeout: 10_000 },
    headersTimeout: 15_000,
    bodyTimeout: 15_000,
  })
  return agent
}

const MAX_REDIRECTS = 5
const REQUEST_TIMEOUT_MS = 25_000

export type FetchedResource = {
  /** Where it ended up, after redirects. */
  url: string
  contentType: string
  body: Buffer
  /** The server's word that the version asked about (`validators`) is still current — no body. */
  notModified?: boolean
  /** What identifies this version — asked back next time (HTTP ETag, Last-Modified). */
  validators?: HttpValidators
}

export type HttpValidators = { etag: string | null; lastModified: string | null }

const isBlockedCause = (error: unknown): boolean => {
  let current: unknown = error
  for (let depth = 0; current && depth < 5; depth++) {
    if ((current as { code?: string }).code === 'EBLOCKED') return true
    current = (current as { cause?: unknown }).cause
  }
  return false
}

async function readCapped(
  response: Awaited<ReturnType<typeof undiciFetch>>,
  maxBytes: number,
): Promise<Buffer> {
  const declared = Number(response.headers.get('content-length'))
  if (declared > maxBytes) throw new ImportFetchError('Stránka je příliš velká.', 'too_large')
  if (!response.body) return Buffer.alloc(0)
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of response.body) {
    total += chunk.length
    if (total > maxBytes) throw new ImportFetchError('Stránka je příliš velká.', 'too_large')
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

/** GET over the public internet only (see the module comment), following up to five redirects —
 * each one asked about first (`beforeRedirect`: the robots.txt of where it leads). */
export async function fetchPublic(
  rawUrl: string,
  {
    maxBytes = IMPORT_LIMITS.fetchMaxBytes,
    accept = '*/*',
    validators,
    beforeRedirect,
  }: {
    maxBytes?: number
    accept?: string
    validators?: HttpValidators | null
    beforeRedirect?: (url: string) => Promise<void>
  } = {},
): Promise<FetchedResource> {
  let url = normalizeSourceUrl(rawUrl)
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let response: Awaited<ReturnType<typeof undiciFetch>>
    try {
      response = await undiciFetch(url, {
        dispatcher: getAgent(),
        redirect: 'manual',
        headers: {
          'User-Agent': IMPORT_USER_AGENT,
          Accept: accept,
          'Accept-Language': 'cs,en;q=0.5',
          ...(validators?.etag ? { 'If-None-Match': validators.etag } : {}),
          ...(validators?.lastModified ? { 'If-Modified-Since': validators.lastModified } : {}),
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    } catch (error) {
      if (isBlockedCause(error))
        throw new ImportFetchError('Tahle adresa není veřejná.', 'blocked_address')
      if ((error as Error).name === 'TimeoutError')
        throw new ImportFetchError('Stránka neodpověděla včas.', 'timeout')
      // What the owner sees is generic; what actually broke goes to the log.
      logger.warn('Import fetch failed', {
        event: 'import.fetch_failed',
        host: url.host,
        ...serializeError(error),
        cause: (error as { cause?: { code?: string; message?: string } }).cause?.code ??
          (error as { cause?: { message?: string } }).cause?.message,
      })
      throw new ImportFetchError('Stránku se nepodařilo načíst.', 'network')
    }

    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      await response.body?.cancel().catch(() => {})
      url = normalizeSourceUrl(new URL(response.headers.get('location')!, url).toString())
      await beforeRedirect?.(url.toString())
      continue
    }
    const current: HttpValidators = {
      etag: response.headers.get('etag'),
      lastModified: response.headers.get('last-modified'),
    }
    if (response.status === 304 && validators) {
      await response.body?.cancel().catch(() => {})
      return {
        url: url.toString(),
        contentType: '',
        body: Buffer.alloc(0),
        notModified: true,
        validators: {
          etag: current.etag ?? validators.etag,
          lastModified: current.lastModified ?? validators.lastModified,
        },
      }
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {})
      throw new ImportFetchError(
        `Stránka vrátila chybu ${response.status}.`,
        'http_error',
        response.status,
      )
    }
    const body = await readCapped(response, maxBytes)
    return {
      url: url.toString(),
      contentType: (response.headers.get('content-type') ?? '').toLowerCase(),
      body,
      validators: current,
    }
  }
  throw new ImportFetchError('Stránka přesměrovává příliš mnohokrát.', 'network')
}

// --- robots.txt --------------------------------------------------------------------------

type RobotsRule = { allow: boolean; pattern: string }

/** The rules that apply to us: the group naming our token, else the "*" group. */
export function parseRobots(text: string, token = IMPORT_ROBOTS_TOKEN): RobotsRule[] {
  const groups: { agents: string[]; rules: RobotsRule[] }[] = []
  let current: { agents: string[]; rules: RobotsRule[] } | null = null
  let lastWasAgent = false
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim()
    const match = line.match(/^([a-z-]+)\s*:\s*(.*)$/i)
    if (!match) continue
    const field = match[1].toLowerCase()
    const value = match[2].trim()
    if (field === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] }
        groups.push(current)
      }
      current.agents.push(value.toLowerCase())
      lastWasAgent = true
      continue
    }
    lastWasAgent = false
    if (!current) continue
    if (field === 'disallow' && value) current.rules.push({ allow: false, pattern: value })
    if (field === 'allow' && value) current.rules.push({ allow: true, pattern: value })
  }
  // A group names us by our product token — "LonvitaBot", "lonvitabot/1.0" — not by any part of it.
  const ours = groups.filter((g) => g.agents.some((a) => a.split('/')[0].trim() === token))
  const chosen = ours.length > 0 ? ours : groups.filter((g) => g.agents.includes('*'))
  return chosen.flatMap((g) => g.rules)
}

const patternToRegex = (pattern: string): RegExp => {
  const anchored = pattern.endsWith('$')
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  return new RegExp(`^${body}${anchored ? '$' : ''}`)
}

/** Whether `pathWithQuery` may be fetched: the longest matching rule wins, Allow on a tie. */
export function isAllowedByRobots(rules: RobotsRule[], pathWithQuery: string): boolean {
  let best: RobotsRule | null = null
  for (const rule of rules) {
    if (!patternToRegex(rule.pattern).test(pathWithQuery)) continue
    if (
      !best ||
      rule.pattern.length > best.pattern.length ||
      (rule.pattern.length === best.pattern.length && rule.allow)
    ) {
      best = rule
    }
  }
  return best ? best.allow : true
}

/** robots.txt per origin, for the length of one import run. */
export type RobotsCache = Map<string, RobotsRule[]>

/** What an unreachable robots.txt means (RFC 9309): one that isn't there (4xx) allows everything; a
 * server failing (5xx) or not answering allows nothing — we don't know what it says. */
const DISALLOW_ALL: RobotsRule[] = [{ allow: false, pattern: '/' }]

/** Throws when the site's robots.txt keeps us out of `url` (see DISALLOW_ALL for one that can't be
 * read). */
export async function assertRobotsAllow(
  url: string,
  cache: RobotsCache = new Map(),
): Promise<void> {
  const target = new URL(url)
  let rules = cache.get(target.origin)
  if (!rules) {
    rules = await fetchPublic(`${target.origin}/robots.txt`, {
      maxBytes: 512 * 1024,
      accept: 'text/plain',
    })
      .then((r) => parseRobots(r.body.toString('utf8')))
      .catch((error) =>
        error instanceof ImportFetchError &&
        ((error.code === 'http_error' && error.status! < 500) || error.code === 'too_large')
          ? []
          : DISALLOW_ALL,
      )
    cache.set(target.origin, rules)
  }
  if (rules === DISALLOW_ALL) {
    throw new ImportFetchError(
      'Web teď neodpovídá ani na dotaz na robots.txt — zkusíme to příště.',
      'robots_unavailable',
    )
  }
  if (!isAllowedByRobots(rules, `${target.pathname}${target.search}`)) {
    throw new ImportFetchError(
      'Web stahování téhle stránky zakazuje (robots.txt).',
      'robots_disallowed',
    )
  }
}

/** What a file is by its magic bytes — one of IMPORT_FILE_TYPES, or null. A server's or a browser's
 * declared type isn't proof: plenty of obec webs serve their zpravodaj as application/octet-stream. */
export function sniffFileType(bytes: Buffer): ImportFileType | null {
  if (bytes.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf'
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return 'image/png'
  if (
    bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
    bytes.subarray(8, 12).toString('latin1') === 'WEBP'
  )
    return 'image/webp'
  return null
}

/** The text of a fetched page — in the charset it declares (Czech sites still use windows-1250). */
export function decodeBody(resource: Pick<FetchedResource, 'body' | 'contentType'>): string {
  const fromHeader = resource.contentType.match(/charset=["']?([\w-]+)/i)?.[1]
  const head = resource.body.subarray(0, 4096).toString('latin1')
  const fromMeta =
    head.match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1] ??
    head.match(/<\?xml[^>]+encoding=["']([\w-]+)/i)?.[1]
  const charset = (fromHeader ?? fromMeta ?? 'utf-8').toLowerCase()
  try {
    return new TextDecoder(charset).decode(resource.body)
  } catch {
    return new TextDecoder('utf-8').decode(resource.body)
  }
}
