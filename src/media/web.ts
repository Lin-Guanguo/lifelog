import { contentType, type MediaFiles } from './files'
import { exifTaken, isoWithOffset } from './exif'
import { LONG_SIDE, type ImportedPhoto, type PhotoPlatform } from './platform'

// Browser version (development, tests): copies in IndexedDB, files chosen with <input type=file>.
// There is no gallery, so originals are never found again.

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

const files: MediaFiles = {
  async list() {
    const [keys, values] = await Promise.all([tx('readonly', (s) => s.getAllKeys()), tx<Stored[]>('readonly', (s) => s.getAll())])
    return keys.map((key, i) => ({ name: String(key), modified: values[i].modified }))
  },
  read: async (name) => new Uint8Array((await get(name))!.bytes),
  write: async (name, bytes) => {
    await tx('readwrite', (s) => s.put({ bytes: bytes.slice().buffer, modified: Date.now() } satisfies Stored, name))
  },
  async remove(name) {
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

function encode(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

async function importFile(file: File): Promise<ImportedPhoto> {
  const original = new Uint8Array(await file.arrayBuffer())
  const key = hex(await crypto.subtle.digest('SHA-256', original)).slice(0, 32)
  const bitmap = await createImageBitmap(file) // applies the EXIF orientation
  const scale = Math.min(1, LONG_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  // Browsers that cannot encode WebP return a PNG instead; use JPEG there.
  let blob = await encode(canvas, 'image/webp', 0.8)
  let ext = 'webp'
  if (blob?.type !== 'image/webp') {
    blob = await encode(canvas, 'image/jpeg', 0.85)
    ext = 'jpg'
  }
  if (!blob) throw new Error(`cannot encode ${file.name}`)
  const name = `${key}.${ext}`
  await files.write(name, new Uint8Array(await blob.arrayBuffer()))
  return {
    file: name,
    taken: exifTaken(original) ?? isoWithOffset(file.lastModified),
    width: bitmap.width,
    height: bitmap.height,
    path: file.name,
  }
}

async function download(name: string, type: string, bytes: Uint8Array) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([bytes.slice().buffer], { type }))
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export const webPlatform: PhotoPlatform = {
  files,
  async usage() {
    const list = await files.list()
    let bytes = 0
    for (const { name } of list) bytes += (await files.read(name)).length
    return { count: list.length, bytes }
  },
  pick: async () => Promise.all((await choose({ multiple: true })).map(importFile)),
  capture: async () => Promise.all((await choose({ capture: true })).map(importFile)),
  takeShared: async () => [],
  onShared: () => {},
  hasOriginal: async () => false,
  inAlbum: async () => ({}),
  openOriginal: async () => {},
  async share(file) {
    const bytes = await files.read(file)
    const shared = new File([bytes.slice().buffer], file, { type: contentType(file) })
    if (navigator.canShare?.({ files: [shared] })) await navigator.share({ files: [shared] })
    else await download(file, contentType(file), bytes)
  },
  async saveCopy(photo) {
    await download(photo.file, contentType(photo.file), await files.read(photo.file))
    return { existed: false }
  },
}
