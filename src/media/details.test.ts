import { beforeAll, describe, expect, it } from 'vitest'
import { localePreference, t } from '../i18n'
import type { PhotoRef } from './content'
import { photoDetails } from './details'

const KEY = '3f9a0c1d2e3f405162738495a6b7c8d9'

describe('photo details', () => {
  beforeAll(() => { localePreference.value = 'zh-CN' })

  it('lists what the photo line records, in order, leaving out what is missing', () => {
    const photo: PhotoRef = {
      file: `${KEY}.jpg`, taken: '2026-11-10T07:30:12+08:00', width: 3072, height: 4096,
      meta: { make: 'Xiaomi', model: 'Xiaomi 15', focal: '6.9', focal35: '24', f: '1.68', exposure: '1/120', iso: '100',
        ev: '-0.7', flash: '0', wb: 'auto', gps: '31.230416,121.473701', alt: '12.5', dir: '187.2', speed: '3.2K',
        format: 'jpeg', bytes: '3089805' },
    }
    const rows = photoDetails(photo, t)
    expect(rows.map((r) => r.label)).toEqual(['details.taken', 'details.camera', 'details.exposure', 'details.wb',
      'details.location', 'details.file'])
    expect(rows.map((r) => r.value)).toEqual([
      '2026-11-10 07:30:12 (UTC+08:00)',
      'Xiaomi 15', // the make is not repeated when the model starts with it
      '6.9 mm · 等效 24 mm · f/1.68 · 1/120 s · ISO 100 · -0.7 EV',
      '自动',
      '31.230416,121.473701 · 海拔 12.5 米 · 朝向 187.2° · 速度 3.2 km/h',
      'JPEG · 3.1 MB · 3072 × 4096',
    ])
  })

  it('shows a 0.4.x photo’s original location, and nothing for a bare reference', () => {
    expect(photoDetails({ file: `${KEY}.webp`, path: 'Pictures/LifeLog/IMG_1.jpg' }, t))
      .toEqual([{ label: 'details.origin', value: 'Pictures/LifeLog/IMG_1.jpg' }])
    expect(photoDetails({ file: `${KEY}.webp` }, t)).toEqual([])
  })
})
