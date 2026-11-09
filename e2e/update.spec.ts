import { expect, test, type Page } from '@playwright/test'
import pkg from '../package.json' with { type: 'json' }

// Check for updates (Settings → About) against a stubbed GitHub API.
const [major, minor, patch] = pkg.version.split('.').map(Number)
const NEXT = `${major}.${minor}.${patch + 1}`
const PAGE = `https://github.com/Lin-Guanguo/lifelog/releases/tag/v${NEXT}`
const APK = `https://github.com/Lin-Guanguo/lifelog/releases/download/v${NEXT}/lifelog-${NEXT}.apk`

async function stubLatest(page: Page, reply: { status?: number; version?: string }) {
  await page.unroute('https://api.github.com/**')
  await page.route('https://api.github.com/repos/Lin-Guanguo/lifelog/releases/latest', (route) => route.fulfill(
    reply.status ? { status: reply.status, body: '' } : { json: {
      tag_name: `v${reply.version}`, body: '- 新功能 A\n- 修复 B', html_url: PAGE.replaceAll(NEXT, reply.version!),
      draft: false, prerelease: false,
      assets: [{ name: `lifelog-${reply.version}.apk`, browser_download_url: APK.replaceAll(NEXT, reply.version!) }],
    } }))
}

test('check for updates from Settings', async ({ page, context }) => {
  let githubCalls = 0
  page.on('request', (r) => { if (r.url().startsWith('https://api.github.com/')) githubCalls++ })
  await context.route('https://github.com/**', (route) => route.fulfill({ body: 'ok' }))
  await stubLatest(page, { version: pkg.version })
  await page.goto('/')
  await page.getByRole('button', { name: 'LifeLog，打开设置' }).click()
  expect(githubCalls).toBe(0) // nothing is checked until asked

  const check = page.getByRole('button', { name: '检查更新' })
  const dialog = page.getByRole('alertdialog')

  // Up to date: the dialog shows the current version and the result
  await check.click()
  await expect(dialog).toContainText(`当前版本 ${pkg.version}。`)
  await expect(dialog.getByRole('status')).toHaveText('已是最新版本。')
  await dialog.getByRole('button', { name: '关闭' }).click()
  await expect(dialog).toBeHidden()

  // GitHub failing is reported in the dialog
  await stubLatest(page, { status: 500 })
  await check.click()
  await expect(dialog.getByRole('alert')).toHaveText('检查失败：GitHub: HTTP 500')
  await dialog.getByRole('button', { name: '关闭' }).click()

  // A newer release: notes and three choices
  await stubLatest(page, { version: NEXT })
  await check.click()
  const offer = page.getByRole('alertdialog', { name: `发现新版本 ${NEXT}` })
  await expect(offer).toContainText('- 新功能 A\n- 修复 B')
  await expect(offer.getByRole('link', { name: '下载更新' })).toHaveAttribute('href', APK)
  await expect(offer.getByRole('link', { name: '查看更新' })).toHaveAttribute('href', PAGE)
  await offer.getByRole('button', { name: '以后再说' }).click()
  await expect(offer).toBeHidden()

  // Download and view open the browser and close the dialog
  for (const [name, url] of [['下载更新', APK], ['查看更新', PAGE]]) {
    await check.click()
    const [popup] = await Promise.all([page.waitForEvent('popup'), offer.getByRole('link', { name }).click()])
    expect(popup.url()).toBe(url)
    await popup.close()
    await expect(offer).toBeHidden()
  }
  expect(githubCalls).toBe(5)
})
