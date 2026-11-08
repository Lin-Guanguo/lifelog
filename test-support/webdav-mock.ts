// In-memory WebDAV server for tests: PROPFIND (Depth 0), MKCOL, PUT, GET, MOVE, DELETE with
// Basic auth and ETags. Used directly by unit tests and over HTTP by the browser e2e test.

export interface MockRequest {
  method: string
  path: string // decoded path, starting with the mount prefix
  headers: Record<string, string> // lower-case names
  body?: Uint8Array
}

export interface MockResponse {
  status: number
  headers: Record<string, string>
  body: Uint8Array
}

const text = (s: string) => new TextEncoder().encode(s)

export function createMockDav(username: string, password: string, mount = '/dav/') {
  const dirs = new Set<string>([mount])
  const files = new Map<string, { body: Uint8Array; etag: string; modified: string }>()
  let counter = 0
  const expected = `Basic ${btoa(`${username}:${password}`)}`
  const parent = (path: string) => path.replace(/[^/]+\/?$/, '')
  const res = (status: number, body = '', headers: Record<string, string> = {}): MockResponse =>
    ({ status, headers, body: text(body) })

  function multistatus(path: string, isDir: boolean, file?: { body: Uint8Array; etag: string; modified: string }) {
    const props = isDir
      ? '<d:resourcetype><d:collection/></d:resourcetype>'
      : `<d:resourcetype/><d:getetag>"${file!.etag}"</d:getetag><d:getlastmodified>${file!.modified}</d:getlastmodified>`
        + `<d:getcontentlength>${file!.body.length}</d:getcontentlength>`
    return res(207, `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>${encodeURI(path)}</d:href>`
      + `<d:propstat><d:prop>${props}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`,
    { 'content-type': 'application/xml; charset=utf-8' })
  }

  function handle(req: MockRequest): MockResponse {
    if (req.headers.authorization !== expected) return res(401, '', { 'www-authenticate': 'Basic realm="mock"' })
    const { method, path } = req
    if (!path.startsWith(mount)) return res(404)
    const dirPath = path.endsWith('/') ? path : `${path}/`
    switch (method) {
      case 'PROPFIND':
        if (dirs.has(dirPath)) return multistatus(dirPath, true)
        if (files.has(path)) return multistatus(path, false, files.get(path))
        return res(404)
      case 'MKCOL':
        if (dirs.has(dirPath) || files.has(path)) return res(405)
        if (!dirs.has(parent(dirPath))) return res(409)
        dirs.add(dirPath)
        return res(201)
      case 'PUT': {
        if (!dirs.has(parent(path))) return res(409)
        const existed = files.has(path)
        files.set(path, { body: req.body ?? new Uint8Array(), etag: `e${++counter}`, modified: new Date().toUTCString() })
        return res(existed ? 204 : 201, '', { etag: `"e${counter}"` })
      }
      case 'GET': {
        const file = files.get(path)
        return file ? { status: 200, headers: { etag: `"${file.etag}"` }, body: file.body } : res(404)
      }
      case 'MOVE': {
        const file = files.get(path)
        const destination = req.headers.destination && decodeURIComponent(new URL(req.headers.destination).pathname)
        if (!file || !destination) return res(file ? 400 : 404)
        if (!dirs.has(parent(destination))) return res(409)
        // Like Nutstore: refuse to replace an existing file even with Overwrite: T.
        if (files.has(destination)) return res(409)
        files.delete(path)
        files.set(destination, { ...file, etag: `e${++counter}` })
        return res(201)
      }
      case 'DELETE':
        return files.delete(path) ? res(204) : res(404)
      default:
        return res(405)
    }
  }

  return { handle, files, dirs }
}
