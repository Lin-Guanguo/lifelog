import { Capacitor } from '@capacitor/core'
import type { PhotoRef } from './content'
import type { MediaFiles } from './files'
import { nativePlatform } from './native'
import type { PhotoPlatform } from './platform'
import { webPlatform } from './web'

export const platform: PhotoPlatform = Capacitor.getPlatform() === 'android' ? nativePlatform : webPlatform

export type PhotoSource = 'pick' | 'capture' | 'shared'

export function addPhotos(source: PhotoSource): Promise<PhotoRef[]> {
  return source === 'pick' ? platform.pick() : source === 'capture' ? platform.capture() : platform.takeShared()
}

// Fetches a photo another device added onto this one; false without a server or when it lacks the photo
// (set by sync, which knows the server).
let download: ((file: string) => Promise<boolean>) | undefined
export function setPhotoDownload(fetch: typeof download): void {
  download = fetch
}

const urls = new Map<string, Promise<string | null>>()

// The photos kept here, for sync; removing one also forgets its cached URL.
export const photoFiles: MediaFiles = {
  ...platform.files,
  async remove(file, keepSince) {
    await platform.files.remove(file, keepSince)
    urls.delete(file)
  },
}

// A display URL that failed to load (e.g. its preview was cleared from the cache) is looked up again next time.
export function forgetPhotoUrl(file: string): void {
  urls.delete(file)
}

// Makes sure the photo's file is on this device, downloading it if needed: open, share and export need the file
// itself, not a preview. False when it cannot be had.
export async function ensurePhoto(file: string): Promise<boolean> {
  if (await platform.has(file)) return true
  return !!download && await download(file)
}

// A URL to show a photo, downloading it first when this device does not have it; null when it cannot be had.
// Open, share and export use it too, to make sure the file is here.
export function photoUrl(file: string): Promise<string | null> {
  let url = urls.get(file)
  if (!url) {
    url = (async () => {
      if (!(await ensurePhoto(file))) return null
      return platform.preview(file)
    })()
    url.then((u) => { if (!u) urls.delete(file) }, () => urls.delete(file)) // retry next time
    urls.set(file, url)
  }
  return url
}
