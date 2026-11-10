import type { PhotoRef } from './content'
import type { MediaFiles } from './files'

// What the app needs from the device for photos. Android: the native Photos plugin; browser: web.ts.
// Every photo handed to LifeLog is kept as its complete original (media/<key>.<ext>), private to the app.
export interface PhotoPlatform {
  files: MediaFiles
  usage(): Promise<{ count: number; bytes: number }>
  pick(): Promise<PhotoRef[]> // system document picker, several at once
  capture(): Promise<PhotoRef[]> // system camera, one photo
  takeShared(): Promise<PhotoRef[]> // photos shared to LifeLog from another app, once
  onShared(listener: () => void): void
  has(file: string): Promise<boolean> // the photo's file is on this device
  preview(file: string): Promise<string | null> // a URL to display a photo kept here; null when it is not here
  original(file: string): Promise<string | null> // a URL of the original file itself, at full resolution
  open(photo: PhotoRef): Promise<void> // with another app
  share(photo: PhotoRef): Promise<void>
  isExported(photo: PhotoRef): Promise<boolean>
  export(photo: PhotoRef): Promise<'saved' | 'existed'> // a copy in the gallery's LifeLog album
}
