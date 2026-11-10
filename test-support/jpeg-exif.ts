// Adds an EXIF segment with DateTimeOriginal ('2026:11:10 14:02:12') and optionally OffsetTimeOriginal
// ('+08:00') to a JPEG, the way cameras write it. For tests of capture-time import.

export function withExif(jpeg: Uint8Array, dateTime: string, offset?: string): Uint8Array {
  const tags: [number, string][] = [[0x9003, `${dateTime}\0`]]
  if (offset) tags.push([0x9011, `${offset}\0`])
  const exifIfd = 8 + 18 // after the header and IFD0 (one entry)
  let data = exifIfd + 2 + tags.length * 12 + 4
  const tiff = new Uint8Array(data + tags.reduce((n, [, s]) => n + s.length, 0))
  const view = new DataView(tiff.buffer)
  tiff.set([0x4d, 0x4d, 0, 42, 0, 0, 0, 8]) // big-endian, IFD0 at 8
  view.setUint16(8, 1)
  view.setUint16(10, 0x8769) // pointer to the EXIF IFD
  view.setUint16(12, 4)
  view.setUint32(14, 1)
  view.setUint32(18, exifIfd)
  view.setUint16(exifIfd, tags.length)
  tags.forEach(([tag, text], i) => {
    const e = exifIfd + 2 + i * 12
    view.setUint16(e, tag)
    view.setUint16(e + 2, 2) // ASCII
    view.setUint32(e + 4, text.length)
    view.setUint32(e + 8, data)
    tiff.set([...text].map((c) => c.charCodeAt(0)), data)
    data += text.length
  })
  const app1 = new Uint8Array(4 + 6 + tiff.length)
  new DataView(app1.buffer).setUint16(0, 0xffe1)
  new DataView(app1.buffer).setUint16(2, 2 + 6 + tiff.length)
  app1.set([0x45, 0x78, 0x69, 0x66, 0, 0], 4)
  app1.set(tiff, 10)
  const out = new Uint8Array(jpeg.length + app1.length)
  out.set(jpeg.subarray(0, 2))
  out.set(app1, 2)
  out.set(jpeg.subarray(2), 2 + app1.length)
  return out
}
