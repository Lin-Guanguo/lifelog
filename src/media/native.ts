import { Capacitor, registerPlugin } from '@capacitor/core'
import { fromBase64, toBase64 } from '../sync/http'
import type { MediaFiles } from './files'
import type { ImportedPhoto, PhotoPlatform } from './platform'

// Android: PhotosPlugin.java imports photos (compressed copy, capture time, hash of the original)
// and keeps the copies in the app's files/media folder.
interface NativePhoto {
  file: string
  taken?: string
  width?: number
  height?: number
  path?: string
  meta?: Record<string, string>
  uri?: string
}

interface PhotosPlugin {
  pick(): Promise<{ photos: NativePhoto[] }>
  capture(): Promise<{ photos: NativePhoto[] }>
  takeShared(): Promise<{ photos: NativePhoto[] }>
  addListener(event: 'shared', listener: () => void): Promise<unknown>
  list(): Promise<{ files: { name: string; size: number; modified: number }[] }>
  read(options: { name: string }): Promise<{ data: string }>
  write(options: { name: string; data: string }): Promise<void>
  remove(options: { name: string }): Promise<void>
  dir(): Promise<{ path: string }>
  hasOriginal(options: { uri: string; file: string }): Promise<{ value: boolean }>
  inAlbum(options: { name: string; original?: string }): Promise<{ original?: string; saved?: string }>
  openOriginal(options: { uri: string }): Promise<void>
  share(options: { name: string; uri?: string }): Promise<void>
  saveCopy(options: { name: string; taken?: string }): Promise<{ existed: boolean; uri?: string }>
}

const Photos = registerPlugin<PhotosPlugin>('Photos')

let dir: Promise<string> | undefined
let names: Promise<Set<string>> | undefined
const known = () => (names ??= Photos.list().then(
  (r) => new Set(r.files.map((f) => f.name)),
  (error: unknown) => {
    names = undefined // try again next time
    throw error
  },
))

const files: MediaFiles = {
  list: async () => (await Photos.list()).files.map(({ name, modified }) => ({ name, modified })),
  read: async (name) => fromBase64((await Photos.read({ name })).data),
  async write(name, bytes) {
    await Photos.write({ name, data: toBase64(bytes) })
    ;(await known()).add(name)
  },
  async remove(name) {
    await Photos.remove({ name })
    ;(await known()).delete(name)
  },
  async url(name) {
    if (!(await known()).has(name)) return null
    dir ??= Photos.dir().then((r) => r.path)
    return Capacitor.convertFileSrc(`file://${await dir}/${name}`)
  },
}

async function imported(result: Promise<{ photos: NativePhoto[] }>): Promise<ImportedPhoto[]> {
  const { photos } = await result
  const set = await known()
  return photos.map(({ uri, ...photo }) => {
    set.add(photo.file)
    return { ...photo, origin: uri }
  })
}

export const nativePlatform: PhotoPlatform = {
  files,
  async usage() {
    const { files: list } = await Photos.list()
    return { count: list.length, bytes: list.reduce((n, f) => n + f.size, 0) }
  },
  pick: () => imported(Photos.pick()),
  capture: () => imported(Photos.capture()),
  takeShared: () => imported(Photos.takeShared()),
  onShared(listener) {
    void Photos.addListener('shared', listener)
  },
  hasOriginal: async (uri, file) => (await Photos.hasOriginal({ uri, file })).value,
  // A camera photo's original is in the LifeLog folder under the name its photo line records.
  inAlbum: (photo, findOriginal) => Photos.inAlbum({
    name: photo.file,
    original: findOriginal ? photo.path?.match(/^Pictures\/LifeLog\/([^/]+)$/)?.[1] : undefined,
  }),
  openOriginal: (uri) => Photos.openOriginal({ uri }),
  share: (name, uri) => Photos.share({ name, uri }),
  saveCopy: (photo) => Photos.saveCopy({ name: photo.file, taken: photo.taken }),
}
