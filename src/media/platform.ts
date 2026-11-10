import type { PhotoRef } from './content'
import type { MediaFiles } from './files'

// A photo just added: the reference that goes into the text, plus where the original is on this
// device (a content URI on Android), if it can be found again.
export interface ImportedPhoto extends PhotoRef {
  origin?: string
}

// What the app needs from the device for photos. Android: the native Photos plugin; browser: web.ts.
export interface PhotoPlatform {
  files: MediaFiles
  usage(): Promise<{ count: number; bytes: number }>
  pick(): Promise<ImportedPhoto[]> // system photo picker, several at once
  capture(): Promise<ImportedPhoto[]> // system camera, one photo, saved to the gallery
  takeShared(): Promise<ImportedPhoto[]> // photos shared to LifeLog from another app, once
  onShared(listener: () => void): void
  hasOriginal(origin: string, file: string): Promise<boolean> // still there and unchanged
  openOriginal(origin: string): Promise<void>
  share(file: string, origin?: string): Promise<void>
  saveCopy(photo: PhotoRef): Promise<void> // to the gallery, with the capture time
}

// Copies are scaled to this long side.
export const LONG_SIDE = 1600
