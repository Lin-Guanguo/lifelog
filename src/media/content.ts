// Photos live in an entry's text as lines of their own (docs/spec.md → Photos):
//   ![](media/<key>.webp "taken=2026-11-10T14:02:12+08:00 size=4032x3024 model=Pixel%208 gps=31.23,121.47 path=DCIM/Camera/IMG_1.jpg")
// <key> is a hash of the original file; the title fields are optional facts about the original: space-separated
// name=value tokens (spaces and % in values written as %20 and %25), path last and as is.

export interface PhotoRef {
  file: string // '<key>.webp' (or .jpg), under media/
  taken?: string // capture time, ISO 8601 with offset
  width?: number // the original's size
  height?: number
  // Other facts from the original's EXIF, in order: make, model, lens, focal, focal35, f, exposure, iso, flash, gps,
  // alt, format, bytes; fields this version does not know are kept as they are.
  meta?: Record<string, string>
  path?: string // where the original was found; a hint, may be gone
}

export type Block = { type: 'text'; text: string } | { type: 'photo'; photo: PhotoRef }

export const MEDIA_FILE = /^[0-9a-f]{32}\.(webp|jpg)$/
const LINE = /^!\[[^\]]*\]\(media\/([0-9a-f]{32}\.(?:webp|jpg))(?: "((?:[^"\\]|\\.)*)")?\)$/

export function parsePhotoLine(line: string): PhotoRef | null {
  const match = LINE.exec(line.trim())
  if (!match) return null
  const photo: PhotoRef = { file: match[1] }
  const title = (match[2] ?? '').replace(/\\(.)/g, '$1')
  const at = title.search(/(?:^| )path=/)
  if (at >= 0) photo.path = title.slice(at).replace(/^ ?path=/, '')
  for (const token of (at >= 0 ? title.slice(0, at) : title).split(' ')) {
    const eq = token.indexOf('=')
    if (eq <= 0) continue
    const name = token.slice(0, eq)
    const value = token.slice(eq + 1).replace(/%(20|25)/g, (_, c: string) => (c === '20' ? ' ' : '%'))
    const size = name === 'size' && /^(\d+)x(\d+)$/.exec(value)
    if (name === 'taken') photo.taken = value
    else if (size) {
      photo.width = Number(size[1])
      photo.height = Number(size[2])
    } else photo.meta = { ...photo.meta, [name]: value }
  }
  return photo
}

const encode = (value: string) => value.replace(/%/g, '%25').replace(/[\s]+/g, '%20')

export function photoLine(photo: PhotoRef): string {
  const fields = [
    photo.taken && `taken=${encode(photo.taken)}`,
    photo.width && photo.height && `size=${photo.width}x${photo.height}`,
    // Any name a line can carry back (no spaces, '=' or quotes), so fields from newer versions survive a save.
    ...Object.entries(photo.meta ?? {}).filter(([name, value]) => /^[^\s="\\]+$/.test(name) && name !== 'path' && value !== '')
      .map(([name, value]) => `${name}=${encode(value)}`),
    photo.path && `path=${photo.path.replace(/[\r\n]+/g, ' ')}`, // last and as is: folder names may contain spaces
  ].filter(Boolean).join(' ')
  const title = fields.replace(/[\\"]/g, (c) => `\\${c}`)
  return `![](media/${photo.file}${title ? ` "${title}"` : ''})`
}

const hasPhotos = (content: string) => content.includes('](media/')

// Paragraph text (blank lines at its edges dropped) and photos, in order.
export function parseContent(content: string): Block[] {
  if (!hasPhotos(content)) return content ? [{ type: 'text', text: content }] : []
  const blocks: Block[] = []
  let lines: string[] = []
  const flush = () => {
    const text = lines.join('\n').replace(/^\s*\n|\n\s*$/g, '')
    if (text.trim()) blocks.push({ type: 'text', text })
    lines = []
  }
  for (const line of content.split('\n')) {
    const photo = parsePhotoLine(line)
    if (photo) {
      flush()
      blocks.push({ type: 'photo', photo })
    } else {
      lines.push(line)
    }
  }
  flush()
  return blocks
}

// A photo line gets a blank line on each side.
export function serializeContent(blocks: Block[]): string {
  return blocks
    .map((b) => (b.type === 'photo' ? photoLine(b.photo) : b.text.replace(/^\s*\n|\n\s*$/g, '')))
    .filter((s) => s.trim())
    .join('\n\n')
}

// The words of an entry, without its photo lines: what lists show and search matches.
export function textOf(content: string): string {
  if (!hasPhotos(content)) return content
  return parseContent(content).flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n')
}

export function photosOf(content: string): PhotoRef[] {
  if (!hasPhotos(content)) return []
  return parseContent(content).flatMap((b) => (b.type === 'photo' ? [b.photo] : []))
}

// The text first, then every photo: what a quick send produces.
export function composeContent(text: string, photos: PhotoRef[]): string {
  return serializeContent([{ type: 'text', text }, ...photos.map((photo) => ({ type: 'photo' as const, photo }))])
}

// Photos in a row form one group; how a group is laid out depends only on its size.
export function groupLayout(count: number): 'one' | 'two' | 'three' | 'four' | 'grid' {
  return count === 1 ? 'one' : count === 2 ? 'two' : count === 3 ? 'three' : count === 4 ? 'four' : 'grid'
}

// A single photo keeps its shape, within 3:4 … 2:1 (cropped beyond); 4:3 when the size is unknown.
export function singleAspect(photo: PhotoRef): number {
  const ratio = photo.width && photo.height ? photo.width / photo.height : 4 / 3
  return Math.min(2, Math.max(3 / 4, ratio))
}

export function takenAt(photo: PhotoRef): number | null {
  const ms = photo.taken ? Date.parse(photo.taken) : NaN
  return Number.isFinite(ms) ? ms : null
}
