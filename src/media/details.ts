import type { MessageKey } from '../i18n'
import type { PhotoRef } from './content'

export interface DetailRow {
  label: MessageKey
  value: string
}

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string

const bytesText = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} KB`)

// "3.2K" → "3.2 km/h" (EXIF speed units: K km/h, M mph, N knots).
function speedText(speed: string): string {
  const m = /^([\d.]+)([KMN])$/.exec(speed)
  return m ? `${m[1]} ${{ K: 'km/h', M: 'mph', N: 'kn' }[m[2] as 'K' | 'M' | 'N']}` : speed
}

// "2026-11-10T07:30:12+08:00" → "2026-11-10 07:30:12 (UTC+08:00)", as recorded (the place's own clock).
function takenText(taken: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})([+-]\d{2}:\d{2})?$/.exec(taken)
  return m ? `${m[1]} ${m[2]}${m[3] ? ` (UTC${m[3]})` : ''}` : taken
}

// What a photo line records, as labelled rows for the viewer's details panel; only facts that are there.
export function photoDetails(photo: PhotoRef, t: Translate): DetailRow[] {
  const m = photo.meta ?? {}
  const rows: DetailRow[] = []
  const add = (label: MessageKey, ...parts: (string | false | undefined)[]) => {
    const value = parts.filter((p): p is string => !!p).join(' · ')
    if (value) rows.push({ label, value })
  }
  add('details.taken', photo.taken && takenText(photo.taken))
  const make = m.make && m.model?.toLowerCase().startsWith(m.make.toLowerCase()) ? undefined : m.make
  add('details.camera', [make, m.model].filter(Boolean).join(' '))
  add('details.lens', [m.lensmake, m.lens].filter(Boolean).join(' '))
  add('details.exposure',
    m.focal && `${m.focal} mm`,
    m.focal35 && t('details.focal35', { mm: m.focal35 }),
    m.f && `f/${m.f}`,
    m.exposure && `${m.exposure} s`,
    m.iso && `ISO ${m.iso}`,
    m.ev && `${Number(m.ev) > 0 ? '+' : ''}${m.ev} EV`,
    m.zoom && t('details.zoom', { x: m.zoom }),
    m.flash === '1' && t('details.flashOn'))
  add('details.wb', m.wb === 'auto' ? t('details.wbAuto') : m.wb === 'manual' ? t('details.wbManual') : undefined)
  add('details.location',
    m.gps,
    m.alt && t('details.altitude', { m: m.alt }),
    m.dir && t('details.direction', { deg: m.dir }),
    m.speed && t('details.speed', { v: speedText(m.speed) }))
  add('details.file',
    m.format?.toUpperCase(),
    m.bytes && bytesText(Number(m.bytes)),
    photo.width && photo.height ? `${photo.width} × ${photo.height}` : undefined)
  add('details.software', m.software)
  add('details.origin', photo.path)
  return rows
}
