import { test, expect } from '@playwright/test'
import { ACCOUNTS, loginStaff } from './helpers.js'

// Every admin sidebar page, by its English label (an admin sees all but the desk pages).
const PAGES = [
  ['Dashboard', 'Bảng điều khiển'], ['Facilities', 'Cơ sở'], ['Storage Units', 'Kho chứa'], ['Reservations', 'Đơn đặt kho'],
  ['Staff & Shifts', 'Nhân viên & Ca làm'], ['Customers & Contracts', 'Khách hàng & Hợp đồng'], ['Maintenance', 'Bảo trì'],
  ['Support Tickets', 'Yêu cầu hỗ trợ'], ['Pricing & Policies', 'Bảng giá & Chính sách'], ['Deposit Refunds', 'Hoàn tiền cọc'],
  ['Reports & Exports', 'Báo cáo & Xuất dữ liệu'], ['Users & Roles', 'Người dùng & Vai trò'], ['Activity Log', 'Nhật ký hoạt động'],
]

test('E17 an admin switches the staff portal to Vietnamese and every page still opens', async ({ page }) => {
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))

  await loginStaff(page, ACCOUNTS.admin)
  await page.getByLabel('Language').selectOption('vi')
  await expect(page.getByRole('navigation').getByRole('link', { name: 'Bảng điều khiển' })).toBeVisible()
  // Every month has its own label: letters like J stand for three months and cannot be translated.
  await expect(page.locator('.sa-bar small')).toHaveText(Array.from({ length: 12 }, (_, i) => `T${i + 1}`))

  for (const [, vi] of PAGES) {
    await page.getByRole('navigation').getByRole('link', { name: new RegExp(`^${vi}( \\d+)?$`) }).click()
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    if (process.env.E2E_I18N_REPORT) {
      // Lines with English words and no Vietnamese letters: a list to review, not a failure.
      const lines = (await page.locator('main').innerText()).split('\n').map((l) => l.trim())
      const english = [...new Set(lines.filter((l) => /[A-Za-z]{3,} [A-Za-z]{3,}/.test(l) && !/[À-ỹ]/.test(l)))]
      if (english.length) console.log(`${vi}:`, english.slice(0, 20))
    }
  }
  expect(errors).toEqual([])

  // The permission search looks through the words on screen, not the English behind them.
  await page.getByRole('navigation').getByRole('link', { name: 'Người dùng & Vai trò' }).click()
  await page.getByRole('button', { name: 'Ai được làm gì?' }).click()
  await page.getByLabel('Tìm chức năng').fill('hoàn cọc')
  await expect(page.getByRole('cell', { name: 'Quyết toán hoàn cọc' })).toBeVisible()
  await page.getByRole('button', { name: 'Đóng' }).click()

  // The choice survives a reload, and switching back gives English again.
  await page.reload()
  await expect(page.getByRole('navigation').getByRole('link', { name: 'Bảng điều khiển' })).toBeVisible()
  await page.getByLabel('Ngôn ngữ').selectOption('en')
  await expect(page.getByRole('navigation').getByRole('link', { name: 'Dashboard' })).toBeVisible()
})
