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

export interface RemoteFile {
  name: string
  modified: number // ms; NaN when the server does not say
}

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

  const folderUrl = (folder?: string) => dirUrl(segments.length) + (folder ? `${encodeURIComponent(folder)}/` : '')

  return {
    // For transfers made outside this client (native photo upload and download).
    headers: (): Record<string, string> => ({ Authorization: authorization }),

    // A file in the sync folder, or in a subfolder of it (photos live in media/).
    fileUrl: (name: string, folder?: string) => folderUrl(folder) + encodeURIComponent(name),
    folderUrl,

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

    // Creates a subfolder of the sync folder when missing.
    async ensureFolder(folder: string): Promise<void> {
      if (await version(folderUrl(folder)) === null) await request('MKCOL', folderUrl(folder), [201, 405])
    },

    // Files directly in a folder; null when the folder does not exist.
    async list(url: string): Promise<RemoteFile[] | null> {
      const res = await request('PROPFIND', url, [207, 404], { Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' }, PROPFIND_BODY)
      if (res.status === 404) return null
      const xml = new TextDecoder().decode(res.body)
      const files: RemoteFile[] = []
      for (const [response] of xml.matchAll(/<(?:[\w-]+:)?response[\s>][\s\S]*?<\/(?:[\w-]+:)?response>/gi)) {
        if (/<(?:[\w-]+:)?collection\s*\/?>/i.test(response)) continue
        const href = prop(response, 'href')
        const name = href && decodeURIComponent(href.replace(/\/+$/, '').split('/').pop() ?? '')
        if (name) files.push({ name, modified: Date.parse(prop(response, 'getlastmodified') ?? '') })
      }
      return files
    },

    async get(url: string): Promise<Uint8Array> {
      return (await request('GET', url, [200])).body
    },

    async put(url: string, body: Uint8Array, contentType = 'application/vnd.sqlite3'): Promise<void> {
      await request('PUT', url, [200, 201, 204], { 'Content-Type': contentType }, body)
    },

    // Succeeds when the file is already gone.
    async remove(url: string): Promise<void> {
      await request('DELETE', url, [200, 204, 404])
    },
  }
}

export type WebDav = ReturnType<typeof createWebDav>
