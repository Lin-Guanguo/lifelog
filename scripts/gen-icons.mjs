// Renders Android launcher icons and splash screens from resources/icon-foreground.svg.
// Usage: node scripts/gen-icons.mjs  (set PW_CHROMIUM_PATH to use a local Chromium)
import { chromium } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'

const BACKGROUND = '#F4EBDD'
const RES = 'android/app/src/main/res'
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 }
const SPLASH = {
  'drawable': [480, 320],
  'drawable-land-mdpi': [480, 320], 'drawable-land-hdpi': [800, 480], 'drawable-land-xhdpi': [1280, 720],
  'drawable-land-xxhdpi': [1600, 960], 'drawable-land-xxxhdpi': [1920, 1280],
  'drawable-port-mdpi': [320, 480], 'drawable-port-hdpi': [480, 800], 'drawable-port-xhdpi': [720, 1280],
  'drawable-port-xxhdpi': [960, 1600], 'drawable-port-xxxhdpi': [1280, 1920],
}

const svg = readFileSync('resources/icon-foreground.svg', 'utf8').replace(/<!--[\s\S]*?-->/g, '')
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined })
const page = await browser.newPage({ deviceScaleFactor: 1 })

async function render(path, width, height, body, transparent = false) {
  await page.setViewportSize({ width, height })
  await page.setContent(`<!doctype html><style>html,body{margin:0;width:${width}px;height:${height}px;overflow:hidden}
    svg{display:block}</style>${body}`)
  writeFileSync(path, await page.screenshot({ omitBackground: transparent }))
}

// Legacy (pre-Android 8) icons show the visible 72/108 center of the adaptive canvas.
const legacy = (size, radius) => `<div style="width:${size}px;height:${size}px;border-radius:${radius};overflow:hidden;background:${BACKGROUND}">
  <div style="width:${size * 1.5}px;height:${size * 1.5}px;margin:${-size / 4}px">${svg.replace('<svg', `<svg width="${size * 1.5}" height="${size * 1.5}"`)}</div></div>`

for (const [density, scale] of Object.entries(DENSITIES)) {
  const dir = `${RES}/mipmap-${density}`
  const fg = 108 * scale
  await render(`${dir}/ic_launcher_foreground.png`, fg, fg, svg.replace('<svg', `<svg width="${fg}" height="${fg}"`), true)
  const size = 48 * scale
  await render(`${dir}/ic_launcher.png`, size, size, legacy(size, '22%'), true)
  await render(`${dir}/ic_launcher_round.png`, size, size, legacy(size, '50%'), true)
}

for (const [dir, [w, h]] of Object.entries(SPLASH)) {
  const s = Math.round(Math.min(w, h) * 0.9)
  await render(`${RES}/${dir}/splash.png`, w, h, `<div style="width:${w}px;height:${h}px;background:${BACKGROUND};display:flex;align-items:center;justify-content:center">
    ${svg.replace('<svg', `<svg width="${s}" height="${s}"`)}</div>`)
}

writeFileSync(`${RES}/values/ic_launcher_background.xml`, `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">${BACKGROUND}</color>
</resources>
`)
await browser.close()
