import { devices, expect, test, type Browser, type Page } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import pkg from '../package.json' with { type: 'json' }
import { choose, jpeg } from './images'

// Renders every screen of the real app (production build) in light and dark mode and writes a
// self-contained review page: docs/design/ui.html. Run with `pnpm gallery`.

const OUT = 'docs/design/ui.html'
const DAV = 'http://127.0.0.1:5300/dav/'
const THEMES = ['light', 'dark'] as const
type Theme = (typeof THEMES)[number]

interface Shot { id: string; title: string; note: string; images: Partial<Record<Theme, string>> }
interface Flow { title: string; description: string; shots: Shot[] }
const flows: Flow[] = []
const tokens: Partial<Record<Theme, Record<string, string>>> = {}

async function capture(browser: Browser, theme: Theme) {
  const context = await browser.newContext({
    ...devices['Pixel 7'], baseURL: 'http://localhost:5199', locale: 'zh-CN', timezoneId: 'Asia/Shanghai', colorScheme: theme,
    permissions: ['clipboard-read', 'clipboard-write'],
  })
  const page = await context.newPage()
  let flowIndex = -1
  let shotIndex = 0

  function flow(title: string, description: string) {
    flowIndex++
    shotIndex = 0
    flows[flowIndex] ??= { title, description, shots: [] }
  }
  async function shot(title: string, note: string) {
    // Vue starts enter/leave transitions a frame after the change; wait for them to start and finish.
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))
    // Endless ones (a spinner, the drop slot's pulse) are left running.
    await page.waitForFunction(() => document.getAnimations().every((a) => a.effect?.getTiming().iterations === Infinity))
    const image = (await page.screenshot({ type: 'jpeg', quality: 80, animations: 'disabled' })).toString('base64')
    const list = flows[flowIndex].shots
    list[shotIndex] ??= { id: `${flowIndex + 1}.${shotIndex + 1}`, title, note, images: {} }
    list[shotIndex++].images[theme] = image
  }
  const at = (iso: string) => page.clock.setSystemTime(new Date(`${iso}+08:00`))
  async function send(text: string) {
    await page.getByRole('textbox', { name: '新记录' }).fill(text)
    await page.getByRole('button', { name: '发送' }).click()
    await expect(page.locator('main .entry', { hasText: text })).toBeVisible()
  }
  const entry = (text: string) => page.locator('main .entry', { hasText: text })
  const back = () => page.getByRole('button', { name: '返回' }).last()
  const sheet = page.getByRole('dialog', { name: '记录详情' })

  await at('2026-11-08T19:30:00')
  await page.goto('/')
  tokens[theme] = await page.evaluate(() => {
    const css = [...document.styleSheets].flatMap((s) => [...s.cssRules].map((r) => r.cssText)).join('\n')
    const names = [...new Set(css.match(/--[\w-]+(?=\s*:)/g) ?? [])].filter((n) => !n.startsWith('--safe'))
    const style = getComputedStyle(document.documentElement)
    return Object.fromEntries(names.map((n) => [n, style.getPropertyValue(n).trim()]).filter(([, v]) => v))
  })

  flow('Record', 'The main log is a chat-style stream: oldest at the top, newest above the composer, grouped by day. '
    + 'Type (or dictate with the keyboard) and send; the time is taken when sent. Long entries are clamped to three lines. '
    + 'Entries from the last hour show seconds on a small line under the time (the column keeps its width).')
  await shot('Empty log', 'First launch.')
  await send('开始练胸')
  await at('2026-11-08T19:42:00')
  await send('卧推，60 公斤，10 次')
  await at('2026-11-08T19:50:00')
  await send('同样重量，8 词')
  await at('2026-11-09T08:12:00')
  await send('早上想到：周报可以按主题而不是按天整理，CyberMnema 那边按标签聚合就行。'
    + '另外记得问一下房东下个月水电怎么算，还有车险续保的事情，别拖到月底。')
  await at('2026-11-09T09:05:00')
  await send('上斜卧推 20 公斤')
  await page.getByRole('textbox', { name: '新记录' }).fill('喝了一杯美式')
  await shot('Log with a draft', 'Day pills separate days; the header shows the sync status once sync is set up (flow 7).')
  await page.getByRole('textbox', { name: '新记录' }).fill('')

  flow('Entry details', 'Tap an entry for a half-screen sheet with the full text. Icons stacked bottom-right: '
    + 'full screen, edit, delete. Full screen expands the same sheet in place (the icons stay); the first icon, '
    + 'back, or dragging the handle down collapses it. Drag the handle up to expand, down to close.')
  await entry('早上想到').click()
  await shot('Half-screen sheet', 'Tap outside, back, or drag down to close.')
  await sheet.getByRole('button', { name: '全屏查看' }).click()
  await expect(sheet).toHaveClass(/expanded/)
  await shot('Expanded to full screen', 'Same sheet, same icons; the first icon now collapses.')
  await sheet.getByRole('button', { name: '退出全屏' }).click()
  await sheet.getByRole('button', { name: '删除' }).click()
  await shot('Delete asks first', 'Deleted entries go to the trash and are cleared after the retention period.')
  await page.getByRole('alertdialog').getByRole('button', { name: '取消' }).click()
  await page.locator('.scrim').click({ position: { x: 10, y: 10 } })
  await expect(sheet).toBeHidden()

  flow('Edit', 'Editing is only reachable from the details sheet. Save is explicit and keeps the original time; '
    + 'the previous text moves to the trash. Leaving with unsaved changes asks first.')
  await entry('同样重量，8 词').click()
  await sheet.getByRole('button', { name: '编辑' }).click()
  await page.getByRole('textbox', { name: '内容' }).fill('同样重量，8 次')
  await shot('Editor', 'Opened from the sheet’s edit icon.')
  await back().click()
  await shot('Leaving with changes', 'Save / Discard / Keep editing.')
  await page.getByRole('alertdialog').getByRole('button', { name: '保存', exact: true }).click()
  await expect(entry('同样重量，8 次')).toBeVisible()

  flow('Photos', 'Under the input: camera, gallery and entry time on the left, 排版 (layout) on the right. Photos wait '
    + 'in a tray above the input; a quick send puts the text first and the photos after it. Photos from the gallery '
    + 'that are not from just now open a step that offers each photo’s capture time. In the list an entry shows up to '
    + 'four thumbnails; the sheet lays photos out automatically by count; the viewer shows the synced copy.')
  const morning = (h: number, m: number) => new Date(`2026-11-09T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+08:00`)
  await choose(page, '从相册选择', [
    { name: 'IMG_0730.jpg', buffer: await jpeg(page, '#7fb2e5', morning(7, 30)) },
    { name: 'IMG_0741.jpg', buffer: await jpeg(page, '#e5a77f', morning(7, 41)) },
    { name: 'IMG_0802.jpg', buffer: await jpeg(page, '#8fd19e', morning(8, 2), { width: 1800, height: 2400 }) },
  ])
  const step = page.getByRole('dialog', { name: '记录时间' })
  await expect(step.locator('.option img')).toHaveCount(3)
  await shot('Older photos: choose the time', 'Opens by itself after 相册 or Share when a photo is over 30 minutes old. '
    + 'Each photo’s capture time, large; now and custom fixed at the bottom. Starts on the first photo.')
  await step.getByRole('button', { name: /自定义/ }).click()
  await shot('Custom time', 'Also from 🕑 under the input. Day chips for the last week (更早 = system date picker), '
    + 'hour and minute wheels; never later than now.')
  await page.getByRole('dialog', { name: '记录时间' }).last().getByRole('button', { name: '取消' }).click()
  await step.getByRole('button', { name: /^记在/ }).click()
  await page.getByRole('textbox', { name: '新记录' }).fill('早上去江边走了一圈')
  await shot('Tray and time chip', 'Older photos show their time; the chip shows the chosen time (✕ = now, tap = change).')
  await page.getByRole('button', { name: '发送' }).click()
  await expect(entry('早上去江边').locator('.strip img')).toHaveCount(3)
  await shot('Entry with photos', 'Logged at the first photo’s time (07:30), so it sits before 08:12.')
  await entry('早上去江边').click()
  await expect(sheet.locator('.photo-group img')).toHaveCount(3)
  await shot('Sheet', 'Text, then the photos as one group: 1 keeps its shape (≤160 px tall), 2 side by side, '
    + '3 in a row, 4 as 2×2, 5+ in rows of three.')
  await sheet.locator('.tile').first().click()
  await shot('Viewer', 'The synced copy. 打开 opens the original with another app (Android’s open-with list) when it is still on the phone; 保存 saves the copy '
    + '(or shows 已在相册); 分享 shares the original, else the copy.')
  await page.getByRole('button', { name: '关闭' }).click()
  await sheet.getByRole('button', { name: '编辑' }).click()
  await expect(page.locator('.editor .thumb img')).toHaveCount(3)
  await shot('Editor with photos', 'Plain text fields and thumbnails; 📷 / 🖼 insert at the cursor. No formatting.')
  const held = (await page.locator('.editor .thumb').nth(1).boundingBox())!
  await page.mouse.move(held.x + 30, held.y + 30)
  await page.mouse.down()
  await page.mouse.move(held.x + 40, held.y + 40, { steps: 3 })
  await expect(page.locator('.editor.arranging')).toBeVisible()
  await shot('Moving a photo', 'Long-press (or the grip): the entry shrinks to an overview, photo groups are tinted, '
    + 'a dashed box shows where it lands, the bottom bar removes it.')
  const zone = (await page.locator('.dropzone').boundingBox())!
  await page.mouse.move(zone.x + zone.width / 2, zone.y + zone.height / 2, { steps: 5 })
  await page.mouse.up()
  await back().click()
  await page.getByRole('alertdialog').getByRole('button', { name: /不保存/ }).click()
  await expect(page.locator('.editor')).toHaveCount(0)
  await page.getByRole('textbox', { name: '新记录' }).fill('午饭\n下午去了博物馆')
  await page.getByRole('button', { name: '排版' }).click()
  await shot('Layout editor', '排版 opens the draft in the same editor, to place photos between paragraphs; '
    + 'back keeps the draft (photos after the text).')
  await back().click()
  await page.getByRole('textbox', { name: '新记录' }).fill('')

  flow('Multi-select delete', 'Long-press an entry to start selecting; tap more entries; delete moves them all to the trash.')
  const box = (await entry('开始练胸').boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(700)
  await page.mouse.up()
  await entry('卧推，60 公斤').click()
  await shot('Selecting', 'Back or ✕ leaves selection.')
  await page.getByRole('button', { name: /^删除 2 条/ }).click()

  flow('Search', 'The search icon in the header. Plain substring match (LIKE) over current entries, grouped by day, '
    + 'with matches highlighted; tap a result for the details sheet.')
  await page.getByRole('button', { name: '搜索' }).click()
  await page.getByRole('searchbox', { name: '搜索记录' }).fill('卧推')
  await expect(page.locator('.result mark').first()).toBeVisible()
  await shot('Results', '')
  await back().click()

  flow('Settings', 'Tap “LifeLog ›” in the header. Sections in order: language, trash, sync, about (version, author).')
  await page.getByRole('button', { name: 'LifeLog，打开设置' }).click()
  await shot('Settings', 'Language and trash retention (presets or custom).')
  await page.getByRole('group', { name: '自动清除时间' }).getByRole('button', { name: '自定义' }).click()
  await shot('Custom retention', 'Hours or days, or never clear automatically.')
  await page.getByRole('alertdialog').getByRole('button', { name: '取消' }).click()
  await page.getByRole('button', { name: '关于作者' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: '复制邮箱' }).click()
  await shot('About the author', 'Tap a row to copy it.')
  await page.getByRole('alertdialog').getByRole('button', { name: '关闭' }).click()

  flow('Sync', 'WebDAV: server, account, app password and folder. The remote copy is one standard SQLite file. '
    + 'Sync runs at launch, on resume and while in use once the interval has passed; it uploads only when something '
    + 'changed and merges automatically when the remote is newer.')
  await page.getByLabel('服务器地址').fill(DAV)
  await page.getByLabel('用户名').fill('me')
  await page.getByLabel('密码 / 应用密码').fill('secret')
  await page.getByLabel('远端目录').fill(`gallery-${theme}`)
  await page.getByRole('button', { name: '保存并测试连接' }).click()
  await expect(page.getByRole('status')).toContainText(/^上次同步[^待]*$/)
  await page.getByRole('button', { name: '立即同步' }).scrollIntoViewIfNeeded()
  await shot('Connected', 'Status, sync now, interval presets.')
  await page.getByRole('group', { name: '自动同步间隔' }).getByRole('button', { name: '自定义' }).click()
  await shot('Custom interval', 'Minutes, hours or days, or manual only.')
  await page.getByRole('alertdialog').getByRole('button', { name: '取消' }).click()
  await back().click()
  await shot('Sync status in the header', 'Tap the chip to open settings.')

  flow('Trash', 'Settings → Trash. Rows are grouped by entry: deleted entries and pre-edit texts. Search, restore, '
    + 'or delete permanently. Restoring an old text of an entry that still has current text asks to overwrite it.')
  await page.getByRole('button', { name: 'LifeLog，打开设置' }).click()
  await page.getByRole('button', { name: /回收站/ }).click()
  await shot('Trash', 'Time left until automatic clearing is shown per row.')
  await page.getByRole('searchbox', { name: '搜索回收站' }).fill('8 词')
  await page.locator('.trow', { hasText: '同样重量，8 词' }).getByRole('checkbox').check()
  await shot('Search and select', '')
  await page.getByRole('button', { name: '恢复 1 项' }).click()
  await shot('Restore asks to overwrite', 'The current text moves to the trash instead.')
  await page.getByRole('alertdialog').getByRole('button', { name: '取消' }).click()
  await page.getByRole('searchbox', { name: '搜索回收站' }).fill('')
  await page.getByRole('button', { name: '永久删除 1 项' }).click()
  await shot('Permanent delete', '')
  await page.getByRole('alertdialog').getByRole('button', { name: '取消' }).click()
  await back().click()
  await back().click()

  flow('Updates', 'Settings → About → “检查更新”. Nothing is checked automatically. The dialog shows the current version '
    + 'and asks GitHub for the latest release. When it is newer: the release notes (from CHANGELOG.md) and three choices — '
    + '“下载更新” opens the APK in the browser, whose download notification leads to Android’s install prompt; '
    + '“查看更新” opens the GitHub release page; “以后再说” closes.')
  let latest = pkg.version
  await page.route('https://api.github.com/**', (route) => route.fulfill({ json: {
    tag_name: `v${latest}`, body: '- 检查更新：设置 → 关于\n- 详情可原地展开为全屏', html_url: 'https://github.com/x', draft: false,
    prerelease: false, assets: [{ name: `lifelog-${latest}.apk`, browser_download_url: 'https://github.com/x.apk' }] } }))
  await page.getByRole('button', { name: 'LifeLog，打开设置' }).click()
  await page.getByRole('button', { name: '检查更新' }).click()
  await expect(page.getByRole('alertdialog').getByRole('status')).toHaveText('已是最新版本。')
  await shot('Up to date', '')
  await page.getByRole('alertdialog').getByRole('button', { name: '关闭' }).click()
  latest = '9.9.9'
  await page.getByRole('button', { name: '检查更新' }).click()
  await expect(page.getByRole('link', { name: '下载更新' })).toBeVisible()
  await shot('New version found', '')
  await page.getByRole('button', { name: '以后再说' }).click()
  await back().click()

  flow('English', 'Every visible string comes from the i18n catalogs; the language follows the system or Settings.')
  await page.getByRole('button', { name: 'LifeLog，打开设置' }).click()
  await page.getByRole('button', { name: 'English' }).click()
  await page.getByRole('button', { name: 'Back' }).click()
  await shot('Main', '')
  await page.locator('main .entry', { hasText: '早上想到' }).click()
  await shot('Details sheet', '')

  await context.close()
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function render(): string {
  const icon = readFileSync('android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_round.png').toString('base64')
  const swatches = Object.keys(tokens.light ?? {}).map((name) => `<tr><td><code>${name}</code></td>${THEMES.map((theme) => {
    const value = tokens[theme]?.[name] ?? ''
    const isColor = /^(#|rgb)/.test(value)
    return `<td>${isColor ? `<span class="sw" style="background:${value}"></span>` : ''}<code>${esc(value)}</code></td>`
  }).join('')}</tr>`).join('')
  const sections = flows.map((f, i) => `<section id="flow-${i + 1}"><h2>${i + 1} · ${esc(f.title)}</h2><p class="desc">${esc(f.description)}</p>
    <div class="row">${f.shots.map((s) => `<figure>${THEMES.map((theme) => s.images[theme]
      ? `<img class="${theme}" loading="lazy" alt="${esc(s.title)} (${theme})" src="data:image/jpeg;base64,${s.images[theme]}">` : '').join('')}
      <figcaption><b>${s.id} ${esc(s.title)}</b>${s.note ? `<small>${esc(s.note)}</small>` : ''}</figcaption></figure>`).join('<span class="arrow">→</span>')}</div></section>`).join('\n')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>LifeLog UI</title><style>
:root { --bg: #F5F6F4; --fg: #1A1C1B; --muted: #5C635E; --line: #E2E5E1; color-scheme: light; }
@media (prefers-color-scheme: dark) { :root:not([data-theme=light]) { --bg: #121413; --fg: #E8EBE8; --muted: #A2AAA4; --line: #2C302E; color-scheme: dark; } }
:root[data-theme=dark] { --bg: #121413; --fg: #E8EBE8; --muted: #A2AAA4; --line: #2C302E; color-scheme: dark; }
body { margin: 0; padding: 24px 16px 64px; background: var(--bg); color: var(--fg); font: 15px/1.5 system-ui, "Noto Sans SC", sans-serif; }
header { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; max-width: 1200px; }
header img { width: 56px; height: 56px; }
h1 { margin: 0; font-size: 24px; } h2 { margin: 40px 0 4px; font-size: 19px; }
.lede, .desc { color: var(--muted); max-width: 820px; margin: 4px 0 0; }
nav { margin: 16px 0 0; display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 14px; }
nav a { color: inherit; }
.toggle { margin-left: auto; display: flex; gap: 4px; }
.toggle button { border: 1px solid var(--line); background: transparent; color: inherit; border-radius: 8px; padding: 6px 10px; font: inherit; cursor: pointer; }
.toggle button[aria-pressed=true] { background: var(--fg); color: var(--bg); }
.row { display: flex; align-items: flex-start; gap: 12px; overflow-x: auto; padding: 16px 2px 8px; }
figure { margin: 0; flex-shrink: 0; display: flex; flex-direction: column; gap: 8px; }
figure img { width: 260px; border-radius: 18px; border: 1px solid var(--line); display: block; }
body[data-show=light] img.dark, body[data-show=dark] img.light { display: none; }
body[data-show=both] figure { flex-direction: row; flex-wrap: wrap; width: 532px; }
figcaption { width: 260px; font-size: 13px; } figcaption small { display: block; color: var(--muted); }
.arrow { align-self: center; color: var(--muted); font-size: 22px; }
table { border-collapse: collapse; font-size: 13px; margin-top: 12px; } td, th { padding: 4px 14px 4px 0; text-align: left; border-bottom: 1px solid var(--line); }
.sw { display: inline-block; width: 18px; height: 18px; border-radius: 4px; vertical-align: middle; margin-right: 6px; border: 1px solid var(--line); }
@media (max-width: 600px) { figure img, figcaption { width: 200px; } body[data-show=both] figure { width: 412px; } }
</style></head><body data-show="light">
<header><img src="data:image/png;base64,${icon}" alt=""><div><h1>LifeLog UI</h1>
<p class="lede">Generated from the production build by <code>pnpm gallery</code> (e2e/gallery.spec.ts) on ${new Date().toISOString().slice(0, 10)}. Pixel 7 viewport, zh-CN.</p></div>
<div class="toggle" role="group" aria-label="Theme">${['light', 'dark', 'both'].map((v) => `<button type="button" data-v="${v}" aria-pressed="${v === 'light'}">${v}</button>`).join('')}</div></header>
<nav>${flows.map((f, i) => `<a href="#flow-${i + 1}">${i + 1} ${esc(f.title)}</a>`).join('')}<a href="#tokens">Design tokens</a></nav>
${sections}
<section id="tokens"><h2>Design tokens</h2><p class="desc">CSS custom properties from <code>src/style.css</code>, as computed in each theme.</p>
<table><tr><th>Token</th><th>Light</th><th>Dark</th></tr>${swatches}</table></section>
<script>
document.querySelectorAll('.toggle button').forEach((b) => b.addEventListener('click', () => {
  document.body.dataset.show = b.dataset.v
  document.querySelectorAll('.toggle button').forEach((o) => o.setAttribute('aria-pressed', String(o === b)))
}))
</script></body></html>`
}

test('UI gallery', async ({ browser }) => {
  test.setTimeout(180_000)
  for (const theme of THEMES) await capture(browser, theme)
  writeFileSync(OUT, render())
})
