import { expect, test } from '@playwright/test'

test('malformed favorites recover and duplicate template cards stay synchronized', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('stickerlab_fav_templates', '{"bad":true}'))
  await page.goto('/templates')
  await expect(page.getByRole('heading', { name: /Find your vibe/ })).toBeVisible()
  const add = page.getByRole('button', { name: 'Add Orbit Pop to favorites', exact: true })
  expect(await add.count()).toBeGreaterThan(1)
  await add.first().click()
  await expect(add).toHaveCount(0)
  expect(await page.getByRole('button', { name: 'Remove Orbit Pop from favorites', exact: true }).count()).toBeGreaterThan(1)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('stickerlab_fav_templates')!))).toEqual(['sample-0'])
})
