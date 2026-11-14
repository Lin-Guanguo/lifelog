import { expect, test } from '@playwright/test'
import { MAX, WINDOW } from '../src/timeline'
import { DAV, entryName as name, putLongLog } from './longlog'

// A long log, synced in from the mock WebDAV server: the main list draws a window of it.
const FOLDER = 'timeline-e2e'
const COUNT = 800 // long enough that scrolling back to the oldest entries drops the newest

test('a long log: window, locate from search, jump to latest, scroll back', async ({ page }) => {
  await putLongLog(FOLDER, COUNT)

  await page.goto('/')
  await page.getByRole('button', { name: 'LifeLog，打开设置' }).click()
  await page.getByLabel('服务器地址').fill(DAV)
  await page.getByLabel('用户名').fill('me')
  await page.getByLabel('密码 / 应用密码').fill('secret')
  await page.getByLabel('远端目录').fill(FOLDER)
  await page.getByRole('button', { name: '保存并测试连接' }).click()
  await expect(page.getByRole('status')).toContainText('上次同步')
  await page.getByRole('button', { name: '返回' }).click()

  // Only a window is drawn, ending at the newest entry.
  const entries = page.locator('.stream .entry')
  await expect(entries.last()).toContainText(name(COUNT))
  expect(await entries.count()).toBe(WINDOW)
  await expect(page.locator('.stream .entry', { hasText: name(12) })).toHaveCount(0)

  // Select all takes every entry in the log, not only those loaded.
  const last = entries.last()
  const box0 = (await last.boundingBox())!
  await page.mouse.move(box0.x + 40, box0.y + box0.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(700) // long press
  await page.mouse.up()
  await page.getByRole('menuitem', { name: '多选' }).click()
  await expect(page.getByRole('heading', { name: '已选 1 条' })).toBeVisible()
  await page.getByRole('button', { name: '全选' }).click()
  await expect(page.getByRole('heading', { name: `已选 ${COUNT} 条` })).toBeVisible()
  await expect(page.getByRole('button', { name: '取消全选' })).toBeVisible()
  await page.getByRole('button', { name: '退出选择' }).click()

  // Search → sheet → ⌖: the old entry is drawn, centred and stays highlighted; the newest are no longer drawn.
  await page.getByRole('button', { name: '搜索' }).click()
  await page.getByRole('searchbox', { name: '搜索记录' }).fill('#0012')
  await page.locator('.result', { hasText: name(12) }).click()
  await page.getByRole('dialog', { name: '记录详情' }).getByRole('button', { name: '在时间线中定位' }).click()
  await expect(page.getByRole('searchbox', { name: '搜索记录' })).toHaveCount(0)
  const target = page.locator('.stream .entry', { hasText: name(12) })
  await expect(target).toHaveClass(/located/)
  await expect(target).toBeInViewport()
  const box = (await target.boundingBox())!
  const list = (await page.locator('.stream').boundingBox())!
  expect(Math.abs(box.y + box.height / 2 - (list.y + list.height / 2))).toBeLessThan(80) // in the middle
  await expect(page.locator('.stream .entry', { hasText: name(COUNT) })).toHaveCount(0)

  // Scrolling down a little keeps it highlighted; jump-to-latest goes back to the newest and drops it.
  await page.locator('.stream').evaluate((el) => el.scrollBy(0, 200))
  await expect(target).toHaveClass(/located/)
  await page.getByRole('button', { name: '回到最新' }).click()
  await expect(entries.last()).toContainText(name(COUNT))
  await expect(page.locator('.stream .entry.located')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '回到最新' })).toHaveCount(0)

  // A screen up (less than JUMP_PX below) the button stays hidden; further up it shows.
  await page.locator('.stream').evaluate((el) => el.scrollBy(0, -el.clientHeight))
  await page.waitForTimeout(150)
  await expect(page.getByRole('button', { name: '回到最新' })).toHaveCount(0)
  await page.locator('.stream').evaluate((el) => el.scrollBy(0, -el.clientHeight * 1.5))
  await expect(page.getByRole('button', { name: '回到最新' })).toBeVisible()

  // Scrolling back up draws older entries, never more than the window's maximum: the newest are dropped.
  for (let i = 0; i < 20 && await page.locator('.stream .entry', { hasText: name(60) }).count() === 0; i++) {
    await page.locator('.stream').evaluate((el) => el.scrollTo({ top: 0 }))
    await page.waitForTimeout(150)
  }
  await expect(page.locator('.stream .entry', { hasText: name(60) })).toHaveCount(1)
  await expect(page.locator('.stream .entry', { hasText: name(COUNT) })).toHaveCount(0)
  expect(await entries.count()).toBeLessThanOrEqual(MAX)
  await expect(page.getByRole('button', { name: '回到最新' })).toBeVisible()

  // Sending from there goes to the newest entries, the new one at the bottom, like the button.
  await page.getByRole('textbox', { name: '新记录' }).fill('刚写的')
  await page.getByRole('button', { name: '发送' }).click()
  await expect(entries.last()).toContainText('刚写的')
  await expect(entries.last()).toBeInViewport()
  await expect(page.getByRole('button', { name: '回到最新' })).toHaveCount(0)

  // At the bottom, the list stays there when it gets shorter or taller (the keyboard, the system bars' insets).
  const below = () => page.locator('.stream').evaluate((el) => Math.round(el.scrollHeight - el.scrollTop - el.clientHeight))
  for (const inset of ['40px', '300px', '0px']) {
    await page.evaluate((v) => document.documentElement.style.setProperty('--safe-area-inset-bottom', v), inset)
    await expect.poll(below).toBe(0)
  }
  const full = page.viewportSize()!
  const withKeyboard = { width: full.width, height: full.height - 300 }
  await page.setViewportSize(withKeyboard)
  await expect.poll(below).toBe(0)
  await page.setViewportSize(full)
  await expect.poll(below).toBe(0)
  // Anywhere else it keeps its position: what was at the top stays at the top.
  await page.locator('.stream').evaluate((el) => el.scrollBy(0, -400))
  const top = () => page.locator('.stream').evaluate((el) => Math.round(el.scrollTop))
  const before = await top()
  await page.setViewportSize(withKeyboard)
  await expect.poll(below).toBe(700)
  expect(await top()).toBe(before)
  await page.setViewportSize(full)
  await expect.poll(below).toBe(400)
  expect(await top()).toBe(before)
  // The keyboard closing near the bottom: the screen grows, then the bottom inset comes back. The list ends at its bottom.
  await page.setViewportSize(withKeyboard)
  await page.locator('.stream').evaluate((el) => el.scrollBy(0, 600))
  await expect.poll(below).toBe(100)
  await page.setViewportSize(full)
  await expect.poll(below).toBe(0)
  await page.evaluate(() => document.documentElement.style.setProperty('--safe-area-inset-bottom', '40px'))
  await expect.poll(below).toBe(0)
  await page.evaluate(() => document.documentElement.style.setProperty('--safe-area-inset-bottom', '0px'))

  // Sending at an earlier time locates the new entry instead, where it landed.
  await page.getByRole('button', { name: '记录时间' }).click()
  const picker = page.getByRole('dialog', { name: '记录时间' })
  await picker.getByRole('button', { name: /^昨天/ }).click()
  await picker.getByRole('button', { name: '确定' }).click()
  await page.getByRole('textbox', { name: '新记录' }).fill('补记昨天的')
  await page.getByRole('button', { name: '发送' }).click()
  const sent = page.locator('.stream .entry', { hasText: '补记昨天的' })
  await expect(sent).toHaveClass(/located/)
  await expect(sent).toBeInViewport()
})
