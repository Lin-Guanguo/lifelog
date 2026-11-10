import { contentType, type MediaFiles } from './files'
import type { PhotoRef } from './content'
import { exifTaken, isoWithOffset } from './exif'
import type { PhotoPlatform } from './platform'

// Browser version (development, tests): originals in IndexedDB, files chosen with <input type=file>; "export" and
// "share" download the file.

const DB = 'lifelog-media'
const STORE = 'files'

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function tx<T>(mode: IDBTransactionMode, body: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await idb()
  return new Promise((resolve, reject) => {
    const req = body(db.transaction(STORE, mode).objectStore(STORE))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

const urls = new Map<string, string>()
type Stored = { bytes: ArrayBuffer; modified: number }
const get = (name: string) => tx<Stored | undefined>('readonly', (s) => s.get(name))

const files: MediaFiles & { url(name: string): Promise<string | null> } = {
  async list() {
    const [keys, values] = await Promise.all([tx('readonly', (s) => s.getAllKeys()), tx<Stored[]>('readonly', (s) => s.getAll())])
    return keys.map((key, i) => ({ name: String(key), modified: values[i].modified }))
  },
  read: async (name) => new Uint8Array((await get(name))!.bytes),
  write: async (name, bytes) => {
    await tx('readwrite', (s) => s.put({ bytes: bytes.slice().buffer, modified: Date.now() } satisfies Stored, name))
  },
  async remove(name, keepSince) {
    if (keepSince !== undefined && ((await get(name))?.modified ?? 0) >= keepSince) return
    await tx('readwrite', (s) => s.delete(name))
    if (urls.has(name)) URL.revokeObjectURL(urls.get(name)!)
    urls.delete(name)
  },
  async url(name) {
    if (!urls.has(name)) {
      const stored = await get(name)
      if (!stored) return null
      urls.set(name, URL.createObjectURL(new Blob([stored.bytes], { type: contentType(name) })))
    }
    return urls.get(name)!
  },
}

function choose(options: { multiple?: boolean; capture?: boolean }): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.multiple = !!options.multiple
    if (options.capture) input.setAttribute('capture', 'environment')
    input.hidden = true
    const done = (chosen: File[]) => {
      input.remove()
      resolve(chosen)
    }
    input.addEventListener('change', () => done([...(input.files ?? [])]))
    input.addEventListener('cancel', () => done([]))
    document.body.append(input)
    input.click()
  })
}

const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('')

// The image type from the file's first bytes, as PhotoImport.java decides it.
function extension(b: Uint8Array): string | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to))
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg'
  if (b[0] === 0x89 && ascii(1, 4) === 'PNG') return 'png'
  if (ascii(0, 4) === 'GIF8') return 'gif'
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp'
  if (ascii(4, 8) === 'ftyp') {
    // The major brand, then the compatible ones: an AVIF may declare "mif1" first and "avif" among the others.
    const box = Math.min(b.length, new DataView(b.buffer, b.byteOffset).getUint32(0))
    if (/avi[fs]/.test(ascii(8, Math.max(12, box)))) return 'avif'
    if (/^(hei[cmsx]|hev[cmsx]|mif1|msf1)$/.test(ascii(8, 12))) return 'heic'
  }
  return null
}

async function keep(file: File): Promise<PhotoRef> {
  const original = new Uint8Array(await file.arrayBuffer())
  const ext = extension(original)
  if (!ext) throw new Error(`not a supported image: ${file.name}`)
  const name = `${hex(await crypto.subtle.digest('SHA-256', original)).slice(0, 32)}.${ext}`
  await files.write(name, original)
  const photo: PhotoRef = { file: name, taken: exifTaken(original) ?? isoWithOffset(file.lastModified) }
  const bitmap = await createImageBitmap(file).catch(() => null) // applies the EXIF orientation
  if (bitmap) {
    photo.width = bitmap.width
    photo.height = bitmap.height
  }
  photo.meta = { format: ext === 'jpg' ? 'jpeg' : ext, bytes: String(original.length) }
  return photo
}

function download(name: string, url: string) {
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
}

const exported = new Set<string>()

export const webPlatform: PhotoPlatform = {
  files,
  async usage() {
    const list = await files.list()
    let bytes = 0
    for (const { name } of list) bytes += (await files.read(name)).length
    return { count: list.length, bytes }
  },
  pick: async () => Promise.all((await choose({ multiple: true })).map(keep)),
  capture: async () => Promise.all((await choose({ capture: true })).map(keep)),
  takeShared: async () => [],
  onShared: () => {},
  has: async (file) => !!(await get(file)),
  preview: (file) => files.url(file),
  original: (file) => files.url(file),
  async open(photo) {
    const url = await files.url(photo.file)
    if (url) window.open(url, '_blank')
  },
  async share(photo) {
    const bytes = await files.read(photo.file)
    const shared = new File([bytes.slice().buffer], photo.file, { type: contentType(photo.file) })
    if (navigator.canShare?.({ files: [shared] })) await navigator.share({ files: [shared] })
    else download(photo.file, (await files.url(photo.file))!)
  },
  isExported: async (photo) => exported.has(photo.file),
  async export(photo) {
    if (exported.has(photo.file)) return 'existed'
    download(photo.file, (await files.url(photo.file))!)
    exported.add(photo.file)
    return 'saved'
  },
}
