import { Capacitor, registerPlugin } from '@capacitor/core'
import { fromBase64, toBase64 } from '../sync/http'
import type { PhotoRef } from './content'
import type { MediaFiles } from './files'
import type { PhotoPlatform } from './platform'

// Android: PhotosPlugin.java keeps each photo's original in the app's files/media folder and reads its facts.
interface PhotosPlugin {
  pick(): Promise<{ photos: PhotoRef[] }>
  capture(): Promise<{ photos: PhotoRef[] }>
  takeShared(): Promise<{ photos: PhotoRef[] }>
  addListener(event: 'shared', listener: () => void): Promise<unknown>
  list(): Promise<{ files: { name: string; size: number; modified: number }[] }>
  read(options: { name: string }): Promise<{ data: string }>
  write(options: { name: string; data: string }): Promise<void>
  remove(options: { name: string; keepSince?: number }): Promise<void>
  upload(options: { name: string; url: string; headers: Record<string, string> }): Promise<{ status: number }>
  download(options: { name: string; url: string; headers: Record<string, string> }): Promise<{ status: number }>
  preview(options: { name: string }): Promise<{ path?: string }>
  open(options: { name: string }): Promise<void>
  share(options: { name: string }): Promise<void>
  isExported(options: { name: string }): Promise<{ value: boolean }>
  export(options: { name: string; taken?: string }): Promise<{ existed: boolean }>
}

const Photos = registerPlugin<PhotosPlugin>('Photos')

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
  async remove(name, keepSince) {
    await Photos.remove({ name, keepSince })
    names = undefined // it may have been kept; listed again next time
  },
  upload: async (name, url, headers) => (await Photos.upload({ name, url, headers })).status,
  async download(name, url, headers) {
    const { status } = await Photos.download({ name, url, headers })
    if (status === 200) (await known()).add(name)
    return status
  },
}

async function added(result: Promise<{ photos: PhotoRef[] }>): Promise<PhotoRef[]> {
  const { photos } = await result
  const set = await known()
  for (const photo of photos) set.add(photo.file)
  return photos
}

export const nativePlatform: PhotoPlatform = {
  files,
  async usage() {
    const { files: list } = await Photos.list()
    return { count: list.length, bytes: list.reduce((n, f) => n + f.size, 0) }
  },
  pick: () => added(Photos.pick()),
  capture: () => added(Photos.capture()),
  takeShared: () => added(Photos.takeShared()),
  onShared(listener) {
    void Photos.addListener('shared', listener)
  },
  has: async (file) => (await known()).has(file),
  async preview(file) {
    if (!(await known()).has(file)) return null
    const { path } = await Photos.preview({ name: file })
    return path ? Capacitor.convertFileSrc(`file://${path}`) : null
  },
  open: (photo) => Photos.open({ name: photo.file }),
  share: (photo) => Photos.share({ name: photo.file }),
  isExported: async (photo) => (await Photos.isExported({ name: photo.file })).value,
  export: async (photo) => ((await Photos.export({ name: photo.file, taken: photo.taken })).existed ? 'existed' : 'saved'),
}
