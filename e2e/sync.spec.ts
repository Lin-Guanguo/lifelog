import { expect, test, type Page } from '@playwright/test'
import initSqlJs from 'sql.js'

// Runs against test-support/webdav-server.ts (started by playwright.config.ts).
const DAV = 'http://127.0.0.1:5300/dav/'
const AUTH = `Basic ${Buffer.from('me:secret').toString('base64')}`

async function remote(): Promise<{ version: number; live: string[] }> {
  const res = await fetch(`${DAV}lifelog/lifelog.sqlite`, { headers: { Authorization: AUTH } })
  expect(res.status).toBe(200)
  const SQL = await initSqlJs()
  const db = new SQL.Database(new Uint8Array(await res.arrayBuffer()))
  const version = Number(db.exec('PRAGMA user_version')[0].values[0][0])
  const live = (db.exec('SELECT content FROM records WHERE deleted_at IS NULL ORDER BY content')[0]?.values ?? [])
    .map((row) => String(row[0]))
  db.close()
  return { version, live }
}

async function send(page: Page, text: string) {
  await page.getByRole('textbox', { name: '新记录' }).fill(text)
  await page.getByRole('button', { name: '发送' }).click()
  await expect(page.locator('main .entry', { hasText: text })).toBeVisible()
}

async function configure(page: Page, password = 'secret') {
  await page.getByRole('button', { name: 'LifeLog，打开设置' }).click()
  await page.getByLabel('服务器地址').fill(DAV)
  await page.getByLabel('用户名').fill('me')
  await page.getByLabel('密码 / 应用密码').fill(password)
  await page.getByRole('button', { name: '保存并测试连接' }).click()
}

test('WebDAV sync: upload, interval auto-sync, automatic merge on a fresh install', async ({ page, browser }) => {
  await page.clock.install()
  await page.goto('/')
  await send(page, '旧手机 第一条')

  // Wrong password: nothing is saved
  await configure(page, 'wrong')
  await expect(page.getByRole('alert')).toHaveText('用户名或密码错误。')
  await expect(page.getByRole('button', { name: '立即同步' })).toHaveCount(0)

  // Correct settings: connection test, folder creation and first upload
  await page.getByLabel('密码 / 应用密码').fill('secret')
  await page.getByRole('button', { name: '保存并测试连接' }).click()
  await expect(page.getByRole('status')).toContainText('上次同步')
  await expect(page.getByText('远端文件：lifelog/lifelog.sqlite')).toBeVisible()
  expect(await remote()).toEqual({ version: 1, live: ['旧手机 第一条'] })

  // Default interval is one day; switch to 5 minutes
  const interval = page.getByRole('group', { name: '自动同步间隔' })
  await expect(interval.getByRole('button', { name: '1天' })).toHaveAttribute('aria-pressed', 'true')
  await interval.getByRole('button', { name: '5分钟' }).click()

  // A change is not uploaded right away…
  await page.getByRole('button', { name: '返回' }).click()
  await send(page, '旧手机 第二条')
  await expect(page.locator('.sync-chip')).toHaveText('待同步')
  await page.clock.fastForward('02:00')
  await expect(page.locator('.sync-chip')).toHaveText('待同步')
  expect((await remote()).live).toEqual(['旧手机 第一条'])
  // …but once 5 minutes have passed since the last sync, the periodic check uploads it
  await page.clock.fastForward('04:00')
  await expect(page.locator('.sync-chip')).toHaveText(/^已同步 \d{2}:\d{2}$/)
  expect((await remote()).live).toEqual(['旧手机 第一条', '旧手机 第二条'])

  // Manual sync from settings
  await send(page, '旧手机 第三条')
  await page.getByRole('button', { name: 'LifeLog，打开设置' }).click()
  await page.getByRole('button', { name: '立即同步' }).click()
  await expect(page.getByRole('status')).not.toContainText('有改动待同步')
  expect((await remote()).live).toEqual(['旧手机 第一条', '旧手机 第三条', '旧手机 第二条'])

  // A fresh install merges the existing backup automatically instead of overwriting it
  const fresh = await browser.newContext({ locale: 'zh-CN', viewport: { width: 412, height: 915 } })
  const phone = await fresh.newPage()
  await phone.goto('/')
  await send(phone, '新手机 第一条')
  await configure(phone)
  await expect(phone.getByRole('status')).toContainText('上次同步')
  expect((await remote()).live).toEqual(['新手机 第一条', '旧手机 第一条', '旧手机 第三条', '旧手机 第二条'])
  await phone.getByRole('button', { name: '返回' }).click()
  await expect(phone.locator('main .entry')).toHaveCount(4)

  // Custom interval: 90 minutes, then manual only
  await phone.getByRole('button', { name: 'LifeLog，打开设置' }).click()
  const phoneInterval = phone.getByRole('group', { name: '自动同步间隔' })
  await phoneInterval.getByRole('button', { name: '自定义' }).click()
  const dialog = phone.getByRole('alertdialog', { name: '自定义同步间隔' })
  await dialog.getByLabel('时长').fill('90')
  await dialog.getByRole('button', { name: '分钟' }).click()
  await dialog.getByRole('button', { name: '保存' }).click()
  await expect(phoneInterval.getByRole('button', { name: '自定义' })).toHaveAttribute('aria-pressed', 'true')
  await expect(phone.getByText('当前：90分钟')).toBeVisible()
  await phoneInterval.getByRole('button', { name: '自定义' }).click()
  await expect(dialog.getByLabel('时长')).toHaveValue('90')
  await dialog.getByLabel('仅手动同步').check()
  await dialog.getByRole('button', { name: '保存' }).click()
  await expect(phone.getByText('当前：仅手动同步')).toBeVisible()
  await phone.getByRole('button', { name: '返回' }).click()

  // Settings survive a reload
  await phone.reload()
  await expect(phone.locator('.sync-chip')).toHaveText(/^已同步/)
  await fresh.close()
})
