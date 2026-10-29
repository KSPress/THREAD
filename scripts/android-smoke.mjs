// Drives the THREAD WebView inside the emulator over DevTools.
import { chromium } from 'playwright-core'
const scenario = process.argv[2]
const log = (...a) => console.log(`[${scenario}]`, ...a)
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
const page = browser.contexts()[0]?.pages()[0]
if (!page) throw new Error('no WebView page found')
page.on('console', (m) => log('console.' + m.type(), m.text().slice(0, 300)))
page.on('pageerror', (e) => log('PAGEERROR', e.message))
page.on('dialog', (d) => d.accept(d.type() === 'prompt' ? 'Phone Vault' : undefined).catch(() => {}))
log('url', page.url())
await page.waitForSelector('.welcome, .app', { timeout: 60000 })
log('first screen:', await page.locator('.welcome').count() ? 'welcome' : 'app')
const step = async (name, fn) => {
  try {
    await fn()
    log('step ok:', name)
  } catch (e) {
    log('STEP FAILED:', name, String(e.message).split('\n')[0])
  }
}
if (scenario === 'newvault') {
  await step('tap Start a new vault', () => page.getByText('Start a new vault').click({ timeout: 10000 }))
  await step('name it and create', async () => {
    await page.locator('input[aria-label="Vault name"]').fill('Phone Vault')
    await page.getByRole('button', { name: 'Create' }).click()
  })
  await page.waitForTimeout(6000)
  await step('vault opened', () => page.waitForSelector('.app', { timeout: 20000 }))
  await step('create a Thread', async () => {
    await page.evaluate(() => document.querySelector('[aria-label="Spool"]')?.click())
    await page.waitForTimeout(800)
    await page.locator('.spool__actions .key').first().click()
    await page.waitForTimeout(3000)
  })
}
if (scenario === 'sample') {
  await step('tap Explore the sample world', () => page.getByText('Explore the sample world').click({ timeout: 10000 }))
  await step('vault opened', () => page.waitForSelector('.home', { timeout: 60000 }))
  await page.waitForTimeout(8000)
}
if (scenario === 'loom') {
  await step('open Loom form', () => page.getByText('Connect to a Loom').click({ timeout: 10000 }))
  await step('submit', async () => {
    await page.locator('.welcome form input').first().fill('http://10.0.2.2:7878')
    await page.locator('.welcome form button[type=submit]').click()
  })
  await page.waitForTimeout(10000)
}
log('final screen:', await page.locator('.welcome').count() ? 'welcome' : (await page.locator('.app').count()) ? 'app' : 'blank')
await browser.close().catch(() => {})
