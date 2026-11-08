import { expect, test, type Page } from '@playwright/test'

// One continuous run through the v1 acceptance flow, on a fresh browser profile.

async function send(page: Page, text: string) {
  await page.getByRole('textbox', { name: '新记录' }).fill(text)
  await page.getByRole('button', { name: '发送' }).click()
  await expect(page.locator('main .entry').last()).toContainText(text)
}

async function longPress(page: Page, text: string) {
  const box = (await page.locator('main .entry', { hasText: text }).boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(700)
  await page.mouse.up()
}

const entry = (page: Page, text: string) => page.locator('main .entry', { hasText: text })
const back = (page: Page) => page.getByRole('button', { name: '返回' }).last()

test('v1 acceptance flow', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('还没有记录。')).toBeVisible()

  // Record
  await send(page, '开始练胸')
  await send(page, '卧推，60 公斤，10 次')
  await send(page, '同样重量，8 词')
  await expect(page.locator('main .daypill')).toHaveText(/^今天 · /)
  await expect(page.locator('main .entry time').first()).toHaveText(/^\d{2}:\d{2}$/)
  await expect(page.getByRole('textbox', { name: '新记录' })).toHaveValue('')

  // Long text is clamped in the list
  const long = '很长的一条记录。'.repeat(30)
  await send(page, long)
  const clamp = await entry(page, '很长的一条记录').locator('.text').evaluate((el) => getComputedStyle(el).webkitLineClamp)
  expect(clamp).toBe('3')

  // Tap opens the sheet with the full text; full screen view and back
  await entry(page, '很长的一条记录').click()
  const sheet = page.getByRole('dialog', { name: '记录详情' })
  await expect(sheet).toContainText(long)
  await sheet.getByRole('button', { name: '全屏查看' }).click()
  await expect(page.locator('.screen').last().locator('.longtext')).toHaveText(long)
  await back(page).click()
  await expect(sheet).toBeHidden()

  // Edit from the sheet: leaving with changes prompts; saving keeps the time
  const timeBefore = await entry(page, '同样重量，8 词').locator('time').textContent()
  await entry(page, '同样重量，8 词').click()
  await sheet.getByRole('button', { name: '编辑' }).click()
  const editor = page.getByRole('textbox', { name: '内容' })
  await expect(editor).toHaveValue('同样重量，8 词')
  await editor.fill('同样重量，8 次')
  await back(page).click()
  const leave = page.getByRole('alertdialog', { name: '保存修改？' })
  await expect(leave).toBeVisible()
  await leave.getByRole('button', { name: '继续编辑' }).click()
  await expect(editor).toHaveValue('同样重量，8 次')
  await page.getByRole('button', { name: '保存' }).click()
  await expect(entry(page, '同样重量，8 次')).toBeVisible()
  await expect(entry(page, '同样重量，8 词')).toHaveCount(0)
  await expect(entry(page, '同样重量，8 次').locator('time')).toHaveText(timeBefore!)

  // Unchanged edit leaves without a prompt
  await entry(page, '开始练胸').click()
  await sheet.getByRole('button', { name: '编辑' }).click()
  await back(page).click()
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  await expect(editor).toBeHidden()

  // Delete from the sheet asks first
  await entry(page, '开始练胸').click()
  await sheet.getByRole('button', { name: '删除' }).click()
  const confirmDelete = page.getByRole('alertdialog', { name: '删除这条记录？' })
  await expect(confirmDelete).toContainText('7天内可以恢复')
  await confirmDelete.getByRole('button', { name: '删除' }).click()
  await expect(entry(page, '开始练胸')).toHaveCount(0)

  // Long-press multi-select delete
  await longPress(page, '卧推，60 公斤')
  await expect(page.getByRole('heading', { name: '已选 1 条' })).toBeVisible()
  await entry(page, '很长的一条记录').click()
  await expect(page.getByRole('heading', { name: '已选 2 条' })).toBeVisible()
  await page.getByRole('button', { name: '删除 2 条（移到回收站）' }).click()
  await expect(page.locator('main .entry')).toHaveCount(1)

  // Search live records with highlighting
  await send(page, '上斜卧推 20 公斤')
  await page.getByRole('button', { name: '搜索' }).click()
  await page.getByRole('searchbox', { name: '搜索记录' }).fill('卧推')
  await expect(page.getByText('1 条匹配')).toBeVisible()
  await expect(page.locator('.result mark')).toHaveText('卧推')
  await back(page).click()

  // Settings → trash
  await page.getByRole('button', { name: 'LifeLog，打开设置' }).click()
  await expect(page.getByRole('button', { name: /回收站/ })).toContainText('4 项')
  await page.getByRole('button', { name: /回收站/ }).click()
  await expect(page.locator('.group')).toHaveCount(4)
  await expect(page.locator('.group', { hasText: '同样重量，8 词' })).toContainText('有当前内容')
  await expect(page.locator('.group', { hasText: '开始练胸' })).toContainText('整条已删除')
  await expect(page.locator('.trow').first()).toContainText('还剩7天')

  // Trash search
  await page.getByRole('searchbox', { name: '搜索回收站' }).fill('8 词')
  await expect(page.locator('.group')).toHaveCount(1)

  // Restoring pre-edit text asks to overwrite; the current text moves to the trash
  await page.locator('.trow', { hasText: '同样重量，8 词' }).getByRole('checkbox').check()
  await page.getByRole('button', { name: '恢复 1 项' }).click()
  const overwrite = page.getByRole('alertdialog', { name: '覆盖当前内容？' })
  await expect(overwrite.locator('.compare')).toContainText('同样重量，8 次')
  await overwrite.getByRole('button', { name: '覆盖' }).click()
  await page.getByRole('searchbox', { name: '搜索回收站' }).fill('')
  await expect(page.locator('.trow', { hasText: '同样重量，8 次' })).toBeVisible()

  // Restore a whole deleted entry without a prompt
  await page.locator('.trow', { hasText: '开始练胸' }).getByRole('checkbox').check()
  await page.getByRole('button', { name: '恢复 1 项' }).click()
  await expect(page.locator('.trow', { hasText: '开始练胸' })).toHaveCount(0)

  // Permanent delete asks first
  await page.locator('.group', { hasText: '卧推，60 公斤' }).getByRole('checkbox', { name: '选中这条记录的全部内容' }).check()
  await page.getByRole('button', { name: '永久删除 1 项' }).click()
  await page.getByRole('alertdialog', { name: '永久删除 1 项？' }).getByRole('button', { name: '永久删除 1 项' }).click()
  await expect(page.locator('.trow', { hasText: '卧推，60 公斤' })).toHaveCount(0)

  await back(page).click()
  await back(page).click()
  await expect(entry(page, '开始练胸')).toBeVisible()
  await expect(entry(page, '同样重量，8 词')).toBeVisible()

  // Everything survives a reload (IndexedDB-backed SQLite on the web)
  await page.reload()
  await expect(entry(page, '开始练胸')).toBeVisible()
  await expect(entry(page, '同样重量，8 词')).toBeVisible()
  await expect(page.locator('main .entry')).toHaveCount(3)

  // Settings: retention and language
  await page.getByRole('button', { name: 'LifeLog，打开设置' }).click()
  const retention = page.getByRole('group', { name: '自动清除时间' })
  await retention.getByRole('button', { name: '30天' }).click()
  await expect(retention.getByRole('button', { name: '30天' })).toHaveAttribute('aria-pressed', 'true')
  // Custom: 12 hours
  await retention.getByRole('button', { name: '自定义' }).click()
  const customDialog = page.getByRole('alertdialog', { name: '自定义清除时间' })
  await customDialog.getByLabel('时长').fill('12')
  await customDialog.getByRole('button', { name: '小时' }).click()
  await customDialog.getByRole('button', { name: '保存' }).click()
  await expect(retention.getByRole('button', { name: '自定义' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText('当前：12小时')).toBeVisible()
  // Custom: never
  await retention.getByRole('button', { name: '自定义' }).click()
  await customDialog.getByLabel('永不自动清除').check()
  await customDialog.getByRole('button', { name: '保存' }).click()
  await expect(page.getByText('当前：从不')).toBeVisible()
  // About: a pop-up whose rows copy the email and link
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.getByRole('button', { name: '关于作者' }).click()
  const about = page.getByRole('alertdialog', { name: '关于作者' })
  await expect(about).toContainText('林观果')
  await about.getByRole('button', { name: '复制邮箱' }).click()
  await expect(about.getByRole('button', { name: '复制邮箱' })).toContainText('已复制')
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('lin.guanguo2000+lifelog@gmail.com')
  await about.getByRole('button', { name: '复制GitHub' }).click()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('https://github.com/Lin-Guanguo/lifelog')
  await about.getByRole('button', { name: '关闭' }).click()
  await expect(about).toBeHidden()
  await page.getByRole('button', { name: 'English' }).click()
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
  await page.getByRole('button', { name: 'Back' }).click()
  await expect(page.getByPlaceholder('Write a line…')).toBeVisible()
  await expect(page.locator('main .daypill')).toHaveText(/^Today · /)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible()
})
