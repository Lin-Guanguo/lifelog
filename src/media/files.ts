// Photo originals stored on this device (media/<key>.<ext>), whatever the platform keeps them in.
export interface MediaFile {
  name: string
  modified: number // ms; when the copy was written (or last added again)
}

export interface MediaFiles {
  list(): Promise<MediaFile[]>
  read(name: string): Promise<Uint8Array>
  write(name: string, bytes: Uint8Array): Promise<void>
  // Removes the file unless it was written (or added again) at or after `keepSince` (ms).
  remove(name: string, keepSince?: number): Promise<void>
  // Where available (Android), files go to and from the server without passing through JavaScript, so large
  // originals do not have to fit in memory. Resolve to the HTTP status.
  upload?(name: string, url: string, headers: Record<string, string>): Promise<number>
  download?(name: string, url: string, headers: Record<string, string>): Promise<number>
}

const TYPES: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', avif: 'image/avif', gif: 'image/gif' }
export const contentType = (name: string) => TYPES[name.slice(name.lastIndexOf('.') + 1)] ?? 'application/octet-stream'
