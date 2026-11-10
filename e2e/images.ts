import type { Page } from '@playwright/test'
import { withExif } from '../test-support/jpeg-exif'

// Test photos for the browser build: real JPEGs drawn by the page, optionally with an EXIF capture time.

const pad = (n: number) => String(n).padStart(2, '0')
const exifDate = (d: Date) =>
  `${d.getFullYear()}:${pad(d.getMonth() + 1)}:${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`

// `taken` is the wall-clock time in the browser's time zone (EXIF has no zone here).
export async function jpeg(page: Page, color: string, taken?: Date, size = { width: 2400, height: 1800 }): Promise<Buffer> {
  const url = await page.evaluate(({ fill, width, height }) => {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')!
    const sky = ctx.createLinearGradient(0, 0, 0, height)
    sky.addColorStop(0, fill)
    sky.addColorStop(1, '#f4e9c8')
    ctx.fillStyle = sky
    ctx.fillRect(0, 0, width, height)
    ctx.fillStyle = 'rgba(30, 50, 40, .7)'
    ctx.beginPath()
    ctx.moveTo(0, height * 0.75)
    ctx.lineTo(width * 0.3, height * 0.45)
    ctx.lineTo(width * 0.55, height * 0.68)
    ctx.lineTo(width * 0.8, height * 0.4)
    ctx.lineTo(width, height * 0.7)
    ctx.lineTo(width, height)
    ctx.lineTo(0, height)
    ctx.fill()
    return canvas.toDataURL('image/jpeg', 0.9)
  }, { fill: color, ...size })
  const bytes = new Uint8Array(Buffer.from(url.split(',')[1], 'base64'))
  return Buffer.from(taken ? withExif(bytes, exifDate(taken)) : bytes)
}

// Clicks a button that opens the file chooser (the last match: the main composer stays under other screens).
export async function choose(page: Page, button: string, files: { name: string; buffer: Buffer }[]): Promise<void> {
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: button }).last().click()
  await (await chooser).setFiles(files.map((f) => ({ ...f, mimeType: 'image/jpeg' })))
}
