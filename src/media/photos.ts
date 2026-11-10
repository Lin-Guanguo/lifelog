import { Capacitor } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'
import type { PhotoRef } from './content'
import type { MediaFiles } from './files'
import { nativePlatform } from './native'
import type { PhotoPlatform } from './platform'
import { webPlatform } from './web'

export const platform: PhotoPlatform = Capacitor.getPlatform() === 'android' ? nativePlatform : webPlatform

// Where each photo's original is on this device (file → content URI). Device-specific, never synced.
const ORIGINS_KEY = 'photoOrigins'
let origins: Record<string, string> = {}

export async function loadPhotos(): Promise<void> {
  origins = JSON.parse((await Preferences.get({ key: ORIGINS_KEY })).value ?? '{}') as Record<string, string>
}

export type PhotoSource = 'pick' | 'capture' | 'shared'

export async function addPhotos(source: PhotoSource): Promise<PhotoRef[]> {
  const imported = await (source === 'pick' ? platform.pick() : source === 'capture' ? platform.capture() : platform.takeShared())
  let changed = false
  const photos = imported.map(({ origin, ...photo }) => {
    if (origin && origins[photo.file] !== origin) {
      origins[photo.file] = origin
      changed = true
    }
    return photo
  })
  if (changed) await Preferences.set({ key: ORIGINS_KEY, value: JSON.stringify(origins) })
  return photos
}

// Fetches a copy this device does not have yet; null without a server (set by sync, which knows it).
let download: ((file: string) => Promise<Uint8Array | null>) | undefined
export function setPhotoDownload(fetch: typeof download): void {
  download = fetch
}

const urls = new Map<string, Promise<string | null>>()

// The copies, for sync; removing one also forgets its cached URL.
export const photoFiles: MediaFiles = {
  ...platform.files,
  async remove(file) {
    await platform.files.remove(file)
    urls.delete(file)
  },
}

// A URL to show the copy, downloading it first when needed; null when it cannot be had.
export function photoUrl(file: string): Promise<string | null> {
  let url = urls.get(file)
  if (!url) {
    url = (async () => {
      const local = await platform.files.url(file)
      if (local || !download) return local
      const bytes = await download(file)
      if (!bytes) return null
      await platform.files.write(file, bytes)
      return platform.files.url(file)
    })()
    url.then((u) => { if (!u) urls.delete(file) }, () => urls.delete(file)) // retry next time
    urls.set(file, url)
  }
  return url
}

export interface PhotoStatus {
  original: string | null // where the original is on this device, unchanged
  saved: string | null // the copy saved to the gallery's LifeLog folder (Android)
  inGallery: boolean // the original or a saved copy is in the gallery
}

// Looked up each time the viewer shows a photo, so photos deleted from the gallery meanwhile are noticed.
export async function photoStatus(photo: PhotoRef): Promise<PhotoStatus> {
  const origin = origins[photo.file]
  let original = origin && await platform.hasOriginal(origin, photo.file).catch(() => false) ? origin : null
  // The album lookup hashes a camera original; not needed when the remembered link already found it.
  const album: { original?: string; saved?: string } = await platform.inAlbum(photo, !original).catch(() => ({}))
  if (!original && album.original) {
    original = album.original
    origins[photo.file] = original // found again (e.g. after app data was cleared): remember it
    await Preferences.set({ key: ORIGINS_KEY, value: JSON.stringify(origins) })
  }
  return { original, saved: album.saved ?? null, inGallery: !!original || !!album.saved }
}

export async function saveCopy(photo: PhotoRef, status: PhotoStatus): Promise<{ result: 'saved' | 'existed'; status: PhotoStatus }> {
  const saved = await platform.saveCopy(photo)
  return { result: saved.existed ? 'existed' : 'saved', status: { ...status, saved: saved.uri ?? status.saved, inGallery: true } }
}
