// Serves the in-memory mock WebDAV over HTTP (with CORS) for the browser e2e test.
// Run: node test-support/webdav-server.ts [port]   — user "me", password "secret", mounted at /dav/
import { createServer } from 'node:http'
import { createMockDav } from './webdav-mock.ts'

const port = Number(process.argv[2] ?? 5300)
const dav = createMockDav('me', 'secret')

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, PUT, PROPFIND, MKCOL, MOVE, DELETE, OPTIONS',
  'access-control-allow-headers': 'Authorization, Depth, Content-Type, Destination, Overwrite',
  'access-control-expose-headers': 'ETag',
}

createServer((req, res) => {
  const chunks: Buffer[] = []
  req.on('data', (chunk: Buffer) => chunks.push(chunk))
  req.on('end', () => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors).end()
      return
    }
    const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, String(v)]))
    const url = new URL(req.url ?? '/', 'http://localhost')
    const reply = dav.handle({
      method: req.method ?? 'GET',
      path: decodeURIComponent(url.pathname),
      headers,
      body: chunks.length ? new Uint8Array(Buffer.concat(chunks)) : undefined,
    })
    res.writeHead(reply.status, { ...cors, ...reply.headers }).end(Buffer.from(reply.body))
  })
}).listen(port, '127.0.0.1')
