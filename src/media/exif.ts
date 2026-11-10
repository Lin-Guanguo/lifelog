// Capture time from a JPEG's EXIF data (DateTimeOriginal, with OffsetTimeOriginal when present).
// Used by the browser build; on Android the native importer reads it.

const pad = (n: number) => String(n).padStart(2, '0')

// '2026-11-10T14:02:12+08:00' in the device's time zone at that moment.
export function isoWithOffset(ms: number): string {
  const d = new Date(ms)
  const offset = -d.getTimezoneOffset()
  const sign = offset < 0 ? '-' : '+'
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    + `${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`
}

export function exifTaken(bytes: Uint8Array): string | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null
  let at = 2
  while (at + 4 <= view.byteLength) {
    const marker = view.getUint16(at)
    const length = view.getUint16(at + 2)
    if (marker === 0xffe1 && length >= 8 && String.fromCharCode(...bytes.subarray(at + 4, at + 10)) === 'Exif\0\0') {
      return fromTiff(view, at + 10, at + 2 + length)
    }
    if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) return null // start of image data: no EXIF
    at += 2 + length
  }
  return null
}

function fromTiff(view: DataView, start: number, end: number): string | null {
  if (end > view.byteLength || start + 8 > end) return null
  const little = view.getUint16(start) === 0x4949
  const u16 = (o: number) => view.getUint16(start + o, little)
  const u32 = (o: number) => view.getUint32(start + o, little)
  const ascii = (o: number, n: number) => {
    let s = ''
    for (let i = 0; i < n && start + o + i < end; i++) {
      const c = view.getUint8(start + o + i)
      if (c === 0) break
      s += String.fromCharCode(c)
    }
    return s
  }
  // Tag → value offset within the IFD at `ifd` (values longer than 4 bytes are stored elsewhere).
  const entries = (ifd: number) => {
    const found = new Map<number, { count: number; value: number }>()
    if (start + ifd + 2 > end) return found
    const n = u16(ifd)
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12
      if (start + e + 12 > end) break
      const count = u32(e + 4)
      found.set(u16(e), { count, value: count > 4 ? u32(e + 8) : e + 8 })
    }
    return found
  }
  const exifIfd = entries(u32(4)).get(0x8769)
  if (!exifIfd) return null
  const exif = entries(u32(exifIfd.value))
  const date = exif.get(0x9003)
  const match = date && /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(ascii(date.value, date.count))
  if (!match) return null
  const [, y, mo, d, h, mi, s] = match.map(Number)
  const offsetTag = exif.get(0x9011)
  const offset = offsetTag && ascii(offsetTag.value, offsetTag.count)
  if (offset && /^[+-]\d{2}:\d{2}$/.test(offset)) return `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:${pad(s)}${offset}`
  return isoWithOffset(new Date(y, mo - 1, d, h, mi, s).getTime())
}
