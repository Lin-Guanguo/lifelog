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
  // What LifeLog's own gallery folder holds of a photo: its original (a camera photo, found by file name and checked
  // by hash) and the copy saved there earlier.
  inAlbum(photo: PhotoRef, findOriginal: boolean): Promise<{ original?: string; saved?: string }>
  openOriginal(origin: string): Promise<void>
  share(file: string, origin?: string): Promise<void>
  // To the gallery's LifeLog folder, with the capture time; resolves to where it is (and whether it was there already).
  saveCopy(photo: PhotoRef): Promise<{ uri?: string; existed: boolean }>
}

// Copies are scaled to this long side.
export const LONG_SIDE = 1600
