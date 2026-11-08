import { toBase64, type HttpResponse, type HttpTransport } from './http'

export interface WebDavConfig {
  url: string // server root, e.g. https://dav.example.com/remote.php/dav/files/me/
  username: string
  password: string
  directory: string // folder under the root, created when missing
}

export class WebDavError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const PROPFIND_BODY = new TextEncoder().encode(
  '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop>'
  + '<d:getetag/><d:getlastmodified/><d:getcontentlength/><d:resourcetype/></d:prop></d:propfind>',
)

function prop(xml: string, name: string): string | undefined {
  const match = new RegExp(`<(?:[\\w-]+:)?${name}[^>]*>([^<]*)</`, 'i').exec(xml)
  return match?.[1].trim()
}

export function createWebDav(config: WebDavConfig, transport: HttpTransport) {
  const root = config.url.trim().replace(/\/*$/, '/')
  const segments = config.directory.split('/').map((s) => s.trim()).filter(Boolean)
  const dirUrl = (count: number) => root + segments.slice(0, count).map(encodeURIComponent).map((s) => `${s}/`).join('')
  const authorization = `Basic ${toBase64(new TextEncoder().encode(`${config.username}:${config.password}`))}`

  async function request(method: string, url: string, expected: number[], headers: Record<string, string> = {},
    body?: Uint8Array): Promise<HttpResponse> {
    const res = await transport({ method, url, headers: { Authorization: authorization, ...headers }, body })
    if (res.status === 401 || res.status === 403) throw new WebDavError(res.status, 'authentication failed')
    if (!expected.includes(res.status)) throw new WebDavError(res.status, `${method} ${url} → HTTP ${res.status}`)
    return res
  }

  // A version token for a file: its ETag, or modification time + size when the server has no ETag.
  // null when the file does not exist.
  async function version(url: string): Promise<string | null> {
    const res = await request('PROPFIND', url, [207, 404], { Depth: '0', 'Content-Type': 'application/xml; charset=utf-8' }, PROPFIND_BODY)
    if (res.status === 404) return null
    const xml = new TextDecoder().decode(res.body)
    return prop(xml, 'getetag') || `${prop(xml, 'getlastmodified') ?? ''}|${prop(xml, 'getcontentlength') ?? ''}`
  }

  return {
    fileUrl: (name: string) => dirUrl(segments.length) + encodeURIComponent(name),

    // Also proves the credentials work against the server root.
    async ensureDirectory(): Promise<void> {
      await version(root).then((v) => {
        if (v === null) throw new WebDavError(404, `server root not found: ${root}`)
      })
      for (let i = 1; i <= segments.length; i++) {
        if (await version(dirUrl(i)) === null) await request('MKCOL', dirUrl(i), [201, 405])
      }
    },

    version,

    async get(url: string): Promise<Uint8Array> {
      return (await request('GET', url, [200])).body
    },

    async put(url: string, body: Uint8Array): Promise<void> {
      await request('PUT', url, [200, 201, 204], { 'Content-Type': 'application/vnd.sqlite3' }, body)
    },

    // Succeeds when the file is already gone.
    async remove(url: string): Promise<void> {
      await request('DELETE', url, [200, 204, 404])
    },
  }
}

export type WebDav = ReturnType<typeof createWebDav>
