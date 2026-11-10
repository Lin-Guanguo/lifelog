// Photo copies stored on this device (media/<key>.webp), whatever the platform keeps them in.
export interface MediaFiles {
  list(): Promise<string[]>
  read(name: string): Promise<Uint8Array>
  write(name: string, bytes: Uint8Array): Promise<void>
  // A URL an <img> can show, or null when the copy is not on this device.
  url(name: string): Promise<string | null>
}

export const contentType = (name: string) => (name.endsWith('.jpg') ? 'image/jpeg' : 'image/webp')
