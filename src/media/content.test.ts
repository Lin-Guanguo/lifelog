import { describe, expect, it } from 'vitest'
import { withExif } from '../../test-support/jpeg-exif'
import {
  composeContent, groupLayout, parseContent, parsePhotoLine, photoLine, photosOf, serializeContent, singleAspect, takenAt, textOf,
  type PhotoRef,
} from './content'
import { exifTaken, isoWithOffset } from './exif'

const KEY = '3f9a0c1d2e3f405162738495a6b7c8d9'
const FULL: PhotoRef = { file: `${KEY}.webp`, taken: '2026-11-10T14:02:12+08:00', width: 4032, height: 3024, path: 'DCIM/Camera/IMG_20261110_140212.jpg' }

describe('photo lines', () => {
  it('write and read back every field', () => {
    const line = photoLine(FULL)
    expect(line).toBe(`![](media/${KEY}.webp "taken=2026-11-10T14:02:12+08:00 size=4032x3024 path=DCIM/Camera/IMG_20261110_140212.jpg")`)
    expect(parsePhotoLine(line)).toEqual(FULL)
  })

  it('keep EXIF facts, with spaces and % in values, and fields they do not know', () => {
    const rich: PhotoRef = {
      ...FULL,
      meta: { make: 'Google', model: 'Pixel 8 Pro', lens: 'Pixel 8 Pro back camera 6.9mm f/1.68', focal: '6.9', focal35: '24',
        f: '1.7', exposure: '1/120', iso: '100', flash: '0', gps: '31.230416,121.473701', alt: '12.5', format: 'jpeg',
        bytes: '4213876', ev: '-0.7', future: '50%', 'x.y-z': 'kept' },
    }
    const line = photoLine(rich)
    expect(line).toContain('model=Pixel%208%20Pro ')
    expect(line).toContain('future=50%25 ')
    expect(line).toMatch(/ path=DCIM\/Camera\/IMG_20261110_140212\.jpg"\)$/)
    expect(parsePhotoLine(line)).toEqual(rich)
    // written by 0.4.0/0.4.1: no meta
    expect(parsePhotoLine(`![](media/${KEY}.webp "taken=2026-11-10T14:02:12+08:00 size=4032x3024 path=My Album/a b.jpg")`))
      .toEqual({ file: `${KEY}.webp`, taken: '2026-11-10T14:02:12+08:00', width: 4032, height: 3024, path: 'My Album/a b.jpg' })
  })

  it('accept a bare reference and keep a path with spaces, quotes and backslashes', () => {
    expect(parsePhotoLine(`![](media/${KEY}.jpg)`)).toEqual({ file: `${KEY}.jpg` })
    const odd = { file: `${KEY}.webp`, path: 'Pictures/My "Trip" \\ 2026/a b.jpg' }
    expect(photoLine(odd)).toContain('\\"Trip\\" \\\\ 2026')
    expect(parsePhotoLine(photoLine(odd))).toEqual(odd)
  })

  it('leave anything else as text', () => {
    for (const line of ['![](media/abc.webp)', `![](media/${KEY}.png)`, `![](../media/${KEY}.webp)`, `text ![](media/${KEY}.webp)`,
      `![](media/${KEY}.webp "unterminated)`]) {
      expect(parsePhotoLine(line)).toBeNull()
    }
  })
})

describe('content', () => {
  const content = `到了山顶，风很大。\n\n${photoLine({ file: `${'a'.repeat(32)}.webp` })}\n\n${photoLine({ file: `${'b'.repeat(32)}.webp` })}`
    + `\n\n往回走\n看到一片湖。\n\n${photoLine(FULL)}`

  it('splits into paragraphs and photos and writes the same text back', () => {
    const blocks = parseContent(content)
    expect(blocks.map((b) => b.type)).toEqual(['text', 'photo', 'photo', 'text', 'photo'])
    expect(blocks[3]).toEqual({ type: 'text', text: '往回走\n看到一片湖。' })
    expect(serializeContent(blocks)).toBe(content)
  })

  it('leaves text without photos exactly as it is', () => {
    for (const text of ['  indented\n\n\nspaced  ', '![](https://example.com/a.png)', '']) {
      expect(serializeContent(parseContent(text))).toBe(text.trim() ? text.replace(/^\s*\n|\n\s*$/g, '') : '')
      expect(textOf(text)).toBe(text)
    }
  })

  it('gives lists and search the words only, and the photos in order', () => {
    expect(textOf(content)).toBe('到了山顶，风很大。\n往回走\n看到一片湖。')
    expect(photosOf(content).map((p) => p.file[0])).toEqual(['a', 'b', '3'])
    expect(textOf(photoLine(FULL))).toBe('')
  })

  it('a quick send puts the text first and the photos after it', () => {
    const photos = [{ file: `${'a'.repeat(32)}.webp` }, FULL]
    expect(composeContent('晚饭', photos)).toBe(`晚饭\n\n${photoLine(photos[0])}\n\n${photoLine(FULL)}`)
    expect(composeContent('', [FULL])).toBe(photoLine(FULL))
    expect(composeContent('只有字', [])).toBe('只有字')
  })
})

describe('layout', () => {
  it('depends only on how many photos are in a row', () => {
    expect([1, 2, 3, 4, 5, 9].map(groupLayout)).toEqual(['one', 'two', 'three', 'four', 'grid', 'grid'])
  })

  it('keeps a single photo’s shape within 3:4 … 2:1', () => {
    expect(singleAspect(FULL)).toBeCloseTo(4 / 3)
    expect(singleAspect({ file: 'x', width: 6000, height: 1000 })).toBe(2)
    expect(singleAspect({ file: 'x', width: 1000, height: 3000 })).toBe(0.75)
    expect(singleAspect({ file: 'x' })).toBeCloseTo(4 / 3)
  })
})

describe('capture time', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9])

  it('reads EXIF DateTimeOriginal with its offset', () => {
    expect(exifTaken(withExif(jpeg, '2026:11:10 14:02:12', '+08:00'))).toBe('2026-11-10T14:02:12+08:00')
    expect(takenAt({ file: 'x', taken: '2026-11-10T14:02:12+08:00' })).toBe(Date.UTC(2026, 10, 10, 6, 2, 12))
  })

  it('without an offset, takes the device time zone', () => {
    const taken = exifTaken(withExif(jpeg, '2026:11:10 14:02:12'))!
    expect(taken).toBe(isoWithOffset(new Date(2026, 10, 10, 14, 2, 12).getTime()))
    expect(Date.parse(taken)).toBe(new Date(2026, 10, 10, 14, 2, 12).getTime())
  })

  it('returns nothing for files without EXIF or broken data', () => {
    expect(exifTaken(jpeg)).toBeNull()
    expect(exifTaken(new Uint8Array([1, 2, 3]))).toBeNull()
    expect(exifTaken(withExif(jpeg, 'not a date'))).toBeNull()
    expect(exifTaken(withExif(jpeg, '2026:11:10 14:02:12').subarray(0, 30))).toBeNull()
    expect(takenAt({ file: 'x', taken: 'garbage' })).toBeNull()
  })
})
