import { Capacitor, registerPlugin } from '@capacitor/core'

export interface HttpRequest {
  method: string
  url: string
  headers?: Record<string, string>
  body?: Uint8Array
}

export interface HttpResponse {
  status: number
  headers: Record<string, string> // lower-case names
  body: Uint8Array
}

export type HttpTransport = (request: HttpRequest) => Promise<HttpResponse>

export const fetchTransport: HttpTransport = async ({ method, url, headers, body }) => {
  const res = await fetch(url, { method, headers, body: body as BodyInit | undefined })
  const out: Record<string, string> = {}
  res.headers.forEach((value, name) => { out[name.toLowerCase()] = value })
  return { status: res.status, headers: out, body: new Uint8Array(await res.arrayBuffer()) }
}

// Android: the WebView's fetch is subject to CORS and Capacitor's HTTP plugin cannot send
// WebDAV methods (PROPFIND, MKCOL, MOVE), so requests go through a small native plugin.
interface WebDavHttpPlugin {
  request(options: { method: string; url: string; headers: Record<string, string>; body?: string }):
    Promise<{ status: number; headers: Record<string, string>; body: string }>
}
const WebDavHttp = registerPlugin<WebDavHttpPlugin>('WebDavHttp')

const nativeTransport: HttpTransport = async ({ method, url, headers = {}, body }) => {
  const res = await WebDavHttp.request({ method, url, headers, body: body && toBase64(body) })
  return { status: res.status, headers: res.headers, body: fromBase64(res.body) }
}

export function platformTransport(): HttpTransport {
  return Capacitor.getPlatform() === 'android' ? nativeTransport : fetchTransport
}

export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

export function fromBase64(text: string): Uint8Array {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}
