import { expect, test } from '@playwright/test'
import { choose, jpeg } from './images'

// Photos in entries, in the browser build (files chosen with <input type=file>, copies in IndexedDB).
const DAV = 'http://127.0.0.1:5300/dav/'
const AUTH = `Basic ${Buffer.from('me:secret').toString('base64')}`
const FOLDER = 'photos-e2e' // separate from sync.spec.ts on the shared mock server

const pad = (n: number) => String(n).padStart(2, '0')
const hm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`

test('photos: add, choose the time, lay out, view, sync', async ({ page, browser }) => {
  await page.goto('/')
  const older = new Date(Date.now() - 3 * 3600_000)
  older.setSeconds(0, 0)
  const recent = new Date(Date.now() - 60_000)
  const red = await jpeg(page, '#c33', older)
  const blue = await jpeg(page, '#36c', recent)

  // Two photos from the gallery; one is hours old, so the time step opens with each photo's time.
  await choose(page, '从相册选择', [{ name: 'IMG_red.jpg', buffer: red }, { name: 'IMG_blue.jpg', buffer: blue }])
  const step = page.getByRole('dialog', { name: '记录时间' })
  await expect(step).toBeVisible()
  await expect(step.locator('.option')).toHaveCount(2)
  await expect(step.locator('.option').first()).toContainText(hm(older))
  await expect(step.locator('.option').first()).toHaveAttribute('aria-pressed', 'true')
  await expect(step.getByRole('button', { name: /^记在/ })).toContainText(hm(older))
  await step.getByRole('button', { name: /^记在/ }).click()
  await expect(step).toBeHidden()

  // The tray shows both, the older with its time; the chip shows the chosen time.
  await expect(page.locator('.tray-photo')).toHaveCount(2)
  await expect(page.locator('.tray-photo .badge')).toHaveText([hm(older)])
  await expect(page.locator('.timechip')).toContainText(hm(older))
  await page.getByRole('textbox', { name: '新记录' }).fill('湖边走了一圈')
  await page.getByRole('button', { name: '发送' }).click()
  await expect(page.locator('.tray-photo')).toHaveCount(0)
  await expect(page.locator('.timechip')).toHaveCount(0)

  // Logged at the photo's time, with both thumbnails.
  const entry = page.locator('.stream .entry', { hasText: '湖边走了一圈' })
  await expect(entry.locator('time')).toHaveText(hm(older)) // hours ago: no seconds
  // A recent entry shows seconds without widening the time column.
  await page.getByRole('textbox', { name: '新记录' }).fill('刚刚')
  await page.getByRole('button', { name: '发送' }).click()
  const fresh = page.locator('.stream .entry', { hasText: '刚刚' }).locator('time')
  await expect(fresh.locator('.sec')).toHaveText(/^:\d{2}$/)
  expect((await fresh.boundingBox())!.width).toBe((await entry.locator('time').boundingBox())!.width)
  await expect(entry.locator('.strip .thumb img')).toHaveCount(2)

  // Search matches the words, not the photo lines (file name, path, time).
  await page.getByRole('button', { name: '搜索' }).click()
  await page.getByRole('searchbox', { name: '搜索记录' }).fill('IMG_red')
  await expect(page.getByText('没有匹配的记录。')).toBeVisible()
  await page.getByRole('searchbox', { name: '搜索记录' }).fill('湖边')
  await expect(page.locator('.result')).toContainText('2 张照片')
  await page.getByRole('button', { name: '返回' }).click()

  // The sheet lays out text and the two photos as one group; the viewer shows the synced copy.
  // Tapping a thumbnail in the list opens the viewer right away, on that photo.
  await entry.locator('.strip .thumb').nth(1).click()
  const quick = page.getByRole('dialog', { name: '查看照片' })
  await expect(quick).toContainText('2 / 2')
  await quick.getByRole('button', { name: '关闭' }).click()
  await expect(quick).toBeHidden()

  // Tapping the entry elsewhere opens its sheet.
  await entry.locator('.text').click()
  const sheet = page.getByRole('dialog', { name: '记录详情' })
  await expect(sheet.locator('.photo-group.two .tile')).toHaveCount(2)
  await sheet.locator('.tile').nth(1).click()
  const viewer = page.getByRole('dialog', { name: '查看照片' })
  await expect(viewer).toContainText('2 / 2')
  // LifeLog keeps the original: its format and size, byte for byte.
  await expect(viewer).toContainText(`JPEG · `)
  // ⓘ: what the photo line records.
  await viewer.getByRole('button', { name: '照片信息' }).click()
  const info = page.getByRole('dialog', { name: '照片信息' })
  await expect(info).toContainText('拍摄时间')
  await expect(info).toContainText('JPEG')
  await expect(info).toContainText('2400 × 1800')
  await page.locator('.details-scrim').click({ position: { x: 10, y: 10 } })
  await expect(info).toHaveCount(0)

  // Double-tap zooms in at that point and, as the 2400 px original is larger than the 1600 px display, loads it.
  const current = viewer.locator('.slide').nth(1)
  const box = (await current.boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await expect(current.locator('.zoom')).toHaveAttribute('style', /scale\(2\.5\)/)
  await expect(current.locator('img.original')).toHaveCount(1)
  await expect(viewer.getByRole('button', { name: '查看原图' })).toContainText('已是原图')
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await expect(current.locator('.zoom')).toHaveAttribute('style', /scale\(1\)/)

  // A two-finger pinch zooms too.
  const cdp = await page.context().newCDPSession(page)
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  const touch = (type: string, d: number) => cdp.send('Input.dispatchTouchEvent', {
    type, touchPoints: type === 'touchEnd' ? [] : [{ x: cx - d, y: cy, id: 1 }, { x: cx + d, y: cy, id: 2 }],
  })
  await touch('touchStart', 40)
  for (const d of [60, 90, 120]) await touch('touchMove', d)
  await touch('touchEnd', 0)
  await expect(current.locator('.zoom')).toHaveAttribute('style', /scale\(3\)/)

  // On the other photo, 原图 loads the original without zooming.
  await viewer.locator('.track').evaluate((el) => el.scrollTo({ left: 0 }))
  await expect(viewer).toContainText('1 / 2')
  await viewer.getByRole('button', { name: '查看原图' }).click()
  await expect(viewer.locator('.slide').first().locator('img.original')).toHaveCount(1)
  await expect(viewer.getByRole('button', { name: '查看原图' })).toBeDisabled()
  await expect(viewer.getByRole('button', { name: '查看原图' })).toContainText('已是原图')
  await expect(viewer.getByRole('button', { name: '用其他应用打开' })).toBeVisible()
  // Saving once, then it says it is there.
  const download = page.waitForEvent('download')
  await viewer.getByRole('button', { name: '保存到相册' }).click()
  expect((await download).suggestedFilename()).toMatch(/^[0-9a-f]{32}\.jpg$/)
  await expect(viewer.getByRole('button', { name: '保存到相册' })).toBeDisabled()
  await expect(viewer).toContainText('已在相册')
  await viewer.getByRole('button', { name: '关闭' }).click()
  await expect(viewer).toBeHidden()

  // Edit: the photos sit after the text. Picking one up and putting it back changes nothing.
  await sheet.getByRole('button', { name: '编辑' }).click()
  const editor = page.locator('.editor')
  await expect(editor.locator('.thumb')).toHaveCount(2)
  const first = (await editor.locator('.thumb').first().boundingBox())!
  await page.mouse.move(first.x + 30, first.y + 30)
  await page.mouse.down()
  await page.mouse.move(first.x + 34, first.y + 34)
  await expect(editor).toHaveClass(/arranging/)
  const resting = (await editor.locator('.slot').boundingBox())!
  await page.mouse.move(resting.x + resting.width / 2, resting.y + resting.height / 2, { steps: 2 })
  await page.mouse.up()
  await expect(editor).not.toHaveClass(/arranging/)
  await expect(page.getByRole('button', { name: '保存' })).toBeDisabled()
  // Now drag the second one before the text.
  const second = (await editor.locator('.thumb').nth(1).boundingBox())!
  await page.mouse.move(second.x + 30, second.y + 30)
  await page.mouse.down()
  await page.mouse.move(second.x + 40, second.y + 40, { steps: 3 })
  await expect(editor).toHaveClass(/arranging/)
  const line = (await editor.locator('.line').first().boundingBox())!
  await page.mouse.move(line.x + 20, line.y + 2, { steps: 8 })
  await page.mouse.up()
  await expect(editor).not.toHaveClass(/arranging/)
  await page.getByRole('button', { name: '保存' }).click()
  await entry.locator('.text').click()
  await expect(sheet.locator('.entry-content > *').first()).toHaveClass(/photo-group/)
  await expect(sheet.locator('.photo-group')).toHaveCount(2)
  await page.locator('.scrim').click({ position: { x: 10, y: 10 } })
  await expect(sheet).toBeHidden()

  // Layout editor for a new entry: a photo inserted at the cursor splits the paragraph; drag to remove another.
  await page.getByRole('textbox', { name: '新记录' }).fill('上午\n下午')
  await page.getByRole('button', { name: '排版' }).click()
  const compose = page.locator('.editor')
  const text = compose.getByRole('textbox', { name: '内容' })
  await text.click()
  await text.press('Control+Home')
  await text.press('End')
  await choose(page, '从相册选择', [{ name: 'IMG_green.jpg', buffer: await jpeg(page, '#3a3') }, { name: 'IMG_x.jpg', buffer: await jpeg(page, '#999') }])
  await expect(compose.locator('.thumb')).toHaveCount(2)
  await expect(compose.getByRole('textbox', { name: '内容' })).toHaveCount(2)
  const extra = (await compose.locator('.thumb').nth(1).boundingBox())!
  await page.mouse.move(extra.x + 30, extra.y + 30)
  await page.mouse.down()
  await page.mouse.move(extra.x + 40, extra.y + 40, { steps: 3 })
  const zone = (await page.locator('.dropzone').boundingBox())!
  await page.mouse.move(zone.x + zone.width / 2, zone.y + zone.height / 2, { steps: 8 })
  await expect(page.locator('.dropzone')).toHaveText('松手移除')
  await page.mouse.up()
  await expect(compose.locator('.thumb')).toHaveCount(1)
  await page.getByRole('button', { name: '发送' }).last().click()
  await page.locator('.stream .entry', { hasText: '上午' }).locator('.text').click()
  await expect(sheet.locator('.entry-content > *')).toHaveCount(3) // 上午, photo, 下午
  await expect(sheet.locator('.entry-content > *').nth(1)).toHaveClass(/photo-group one/)
  await page.locator('.scrim').click({ position: { x: 10, y: 10 } })

  // From the list, the viewer spans the photos of every entry: swiping on goes into the next entry's photos.
  await page.locator('.stream .entry', { hasText: '湖边走了一圈' }).locator('.strip .thumb').first().click()
  const all = page.getByRole('dialog', { name: '查看照片' })
  await expect(all).toContainText('1 / 3')
  await expect(all.getByRole('button', { name: '查看这条记录' })).toContainText('湖边走了一圈')
  await all.locator('.track').evaluate((el) => el.scrollTo({ left: el.clientWidth * 2 }))
  await expect(all).toContainText('3 / 3')
  await expect(all.getByRole('button', { name: '查看这条记录' })).toContainText('上午')

  // Swipe down: a short drag springs back, a long one closes.
  const stageBox = (await all.locator('.slide').nth(2).boundingBox())!
  const drag = async (dy: number) => {
    await page.mouse.move(stageBox.x + stageBox.width / 2, stageBox.y + 100)
    await page.mouse.down()
    await page.mouse.move(stageBox.x + stageBox.width / 2, stageBox.y + 100 + dy, { steps: 8 })
    await page.mouse.up()
  }
  await drag(60)
  await expect(all).toBeVisible()
  await drag(220)
  await expect(all).toBeHidden()

  // The entry line under the time opens that entry's sheet over the viewer; closing it returns to the viewer.
  await page.locator('.stream .entry', { hasText: '湖边走了一圈' }).locator('.strip .thumb').first().click()
  await all.getByRole('button', { name: '查看这条记录' }).click()
  const over = page.getByRole('dialog', { name: '记录详情' })
  await expect(over).toContainText('湖边走了一圈')
  await expect(over).toBeInViewport()
  await page.locator('.scrim').click({ position: { x: 10, y: 10 } })
  await expect(over).toBeHidden()
  await expect(all).toBeVisible()
  // ⌖ in that sheet closes everything and marks the entry in the timeline.
  await all.getByRole('button', { name: '查看这条记录' }).click()
  await over.getByRole('button', { name: '在时间线中定位' }).click()
  await expect(all).toBeHidden()
  await expect(over).toBeHidden()
  await expect(page.locator('.stream .entry', { hasText: '湖边走了一圈' })).toHaveClass(/located/)

  // Leaving the layout editor keeps paragraphs apart; the photos wait in the tray after the text.
  await page.getByRole('textbox', { name: '新记录' }).fill('甲\n乙')
  await page.getByRole('button', { name: '排版' }).click()
  await page.locator('.editor textarea').click()
  await page.locator('.editor textarea').press('Control+Home')
  await page.locator('.editor textarea').press('End')
  await choose(page, '从相册选择', [{ name: 'IMG_y.jpg', buffer: await jpeg(page, '#c9c') }])
  await expect(page.locator('.editor .thumb')).toHaveCount(1)
  await page.getByRole('button', { name: '返回' }).last().click()
  await expect(page.locator('.editor')).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: '新记录' })).toHaveValue('甲\n\n乙')
  await expect(page.locator('.tray-photo')).toHaveCount(1)

  // Removing a tray photo leaves the right thumbnails.
  await choose(page, '从相册选择', [{ name: 'IMG_z.jpg', buffer: await jpeg(page, '#cc3') }])
  await expect(page.locator('.tray-photo img')).toHaveCount(2)
  const kept = await page.locator('.tray-photo img').nth(1).getAttribute('src')
  await page.locator('.tray-photo').first().getByRole('button', { name: '移除照片' }).click()
  await expect(page.locator('.tray-photo img')).toHaveCount(1)
  await expect(page.locator('.tray-photo img')).toHaveAttribute('src', kept!)
  await page.locator('.tray-photo').first().getByRole('button', { name: '移除照片' }).click()
  await page.getByRole('textbox', { name: '新记录' }).fill('')

  // Custom time from the clock: yesterday.
  await expect(page.locator('.editor')).toHaveCount(0)
  await page.getByRole('button', { name: '记录时间' }).click()
  const picker = page.getByRole('dialog', { name: '记录时间' })
  await picker.getByRole('button', { name: /^昨天/ }).click()
  await expect(picker.locator('.preview')).toContainText('记在')
  await picker.getByRole('button', { name: '确定' }).click()
  await expect(page.locator('.timechip')).toContainText('记在昨天')
  await page.getByRole('button', { name: '改回现在' }).click()
  await expect(page.locator('.timechip')).toHaveCount(0)

  // Sync: copies go up before the database; another device fetches them when it shows the entry.
  await page.getByRole('button', { name: 'LifeLog，打开设置' }).click()
  await expect(page.getByText(/^\d+ 张 · /)).toBeVisible()
  await page.getByLabel('服务器地址').fill(DAV)
  await page.getByLabel('用户名').fill('me')
  await page.getByLabel('密码 / 应用密码').fill('secret')
  await page.getByLabel('远端目录').fill(FOLDER)
  await page.getByRole('button', { name: '保存并测试连接' }).click()
  await expect(page.getByRole('status')).toContainText('上次同步')
  const listing = await (await fetch(`${DAV}${FOLDER}/media/`, { method: 'PROPFIND', headers: { Authorization: AUTH, Depth: '1' } })).text()
  // The three photos in entries; the one removed in the layout editor was never sent.
  expect(new Set(listing.match(/[0-9a-f]{32}\.jpg/g)).size).toBe(3)

  // What the server has is the original, byte for byte.
  const original = listing.match(/[0-9a-f]{32}\.jpg/)![0]
  const remoteBytes = new Uint8Array(await (await fetch(`${DAV}${FOLDER}/media/${original}`, { headers: { Authorization: AUTH } })).arrayBuffer())
  const sha = Buffer.from(await crypto.subtle.digest('SHA-256', remoteBytes)).toString('hex')
  expect(original.startsWith(sha.slice(0, 32))).toBe(true)

  const laptop = await browser.newContext({ locale: 'zh-CN', viewport: { width: 412, height: 915 } })
  const other = await laptop.newPage()
  await other.goto('/')
  await other.getByRole('button', { name: 'LifeLog，打开设置' }).click()
  await other.getByLabel('服务器地址').fill(DAV)
  await other.getByLabel('用户名').fill('me')
  await other.getByLabel('密码 / 应用密码').fill('secret')
  await other.getByLabel('远端目录').fill(FOLDER)
  await other.getByRole('button', { name: '保存并测试连接' }).click()
  await expect(other.getByRole('status')).toContainText('上次同步')
  await other.getByRole('button', { name: '返回' }).click()
  await expect(other.locator('.stream .entry', { hasText: '湖边走了一圈' }).locator('.strip img')).toHaveCount(2)
  await laptop.close()
})
