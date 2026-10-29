// Drives the THREAD WebView inside the emulator over the raw DevTools
// protocol (Android's WebView doesn't support Playwright's browser-level
// commands). Steps run as small scripts in the page; console output, page
// errors and whether the page is still there are logged.
const scenario = process.argv[2]
const log = (...a) => console.log(`[${scenario}]`, ...a)
const targets = await (await fetch('http://127.0.0.1:9222/json')).json()
const target = targets.find((t) => t.type === 'page')
if (!target) throw new Error('no WebView page: ' + JSON.stringify(targets))
log('page', target.url)
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)))
let id = 0
const pending = new Map()
let closed = false
ws.onclose = () => {
  closed = true
  log('DEVTOOLS CONNECTION CLOSED (page or app went away)')
  for (const [, p] of pending) p.reject(new Error('closed'))
}
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data)
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id).resolve(msg)
    pending.delete(msg.id)
  } else if (msg.method === 'Runtime.consoleAPICalled') {
    log('console.' + msg.params.type, msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 400))
  } else if (msg.method === 'Runtime.exceptionThrown') {
    log('PAGE ERROR', JSON.stringify(msg.params.exceptionDetails).slice(0, 600))
  } else if (msg.method === 'Inspector.targetCrashed') {
    log('RENDERER CRASHED')
  }
}
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const n = ++id
    pending.set(n, { resolve, reject })
    ws.send(JSON.stringify({ id: n, method, params }))
  })
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300))
  return r.result?.result?.value
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const waitFor = async (selector, ms = 30000) => {
  for (let t = 0; t < ms; t += 500) {
    if (await evaluate(`!!document.querySelector(${JSON.stringify(selector)})`)) return true
    await wait(500)
  }
  throw new Error('timed out waiting for ' + selector)
}
const clickText = (text, sel = 'button, a, [role=button]') =>
  evaluate(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.textContent.includes(${JSON.stringify(text)})); if (!el) return false; el.click(); return true })()`)
const fill = (selector, value) =>
  evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
const step = async (name, fn) => {
  try {
    const r = await fn()
    log('step', r === false ? 'NOT FOUND:' : 'ok:', name)
  } catch (e) {
    log('STEP FAILED:', name, String(e.message).split('\n')[0])
  }
}
await send('Runtime.enable')
await send('Inspector.enable').catch(() => {})
await step('app rendered', () => waitFor('.welcome, .app', 60000))
log('first screen:', await evaluate(`document.querySelector('.welcome') ? 'welcome' : document.querySelector('.app') ? 'app' : 'blank'`))
if (scenario === 'newvault') {
  await step('tap Start a new vault', () => clickText('Start a new vault'))
  await wait(800)
  await step('name it', () => fill('input[aria-label="Vault name"]', 'Phone Vault'))
  await step('tap Create', () => clickText('Create', 'button[type=submit]'))
  await step('vault opened', () => waitFor('.app', 30000))
  await wait(3000)
  await step('new Thread', async () => {
    await evaluate(`document.querySelector('[aria-label="Spool"]')?.click()`)
    await wait(800)
    return clickText('Thread', '.spool__actions .key')
  })
  await wait(4000)
  await step('editor shown', () => waitFor('.thread-editor', 15000))
}
if (scenario === 'sample') {
  await step('tap Explore the sample world', () => clickText('Explore the sample world'))
  await step('vault opened', () => waitFor('.home', 90000))
  await wait(8000)
  await step('open a Thread', async () => {
    await evaluate(`document.querySelector('[aria-label="Search"]')?.click()`)
    await wait(600)
    await fill('.palette input', 'Emberfall')
    await wait(600)
    return evaluate(`(() => { const b = document.querySelector('.palette__item'); b?.click(); return !!b })()`)
  })
  await step('editor shown', () => waitFor('.thread-editor', 20000))
  await step('open the sample PDF beside it', async () => {
    await evaluate(`document.querySelector('[aria-label="Search"]')?.click()`)
    await wait(600)
    await fill('.palette input', 'Field Notes')
    await wait(600)
    return evaluate(`(() => { const b = [...document.querySelectorAll('.palette__item')].find((x) => x.textContent.includes('.pdf')); b?.click(); return !!b })()`)
  })
  await step('PDF pages render', () => waitFor('.pdf-page canvas', 30000))
  await wait(3000)
  await step('PDF text layer', () => waitFor('.pdf-page .textLayer span', 20000))
}
if (scenario === 'loom') {
  await step('open Loom form', () => clickText('Connect to a Loom'))
  await wait(500)
  await step('fill URL', () => fill('.welcome form input', 'http://10.0.2.2:7878'))
  await step('submit', () => clickText('Become a Satellite', 'button[type=submit]'))
  await wait(12000)
}
if (!closed) log('final screen:', await evaluate(`document.querySelector('.welcome') ? 'welcome' : document.querySelector('.app') ? 'app' : 'blank'`).catch((e) => 'unknown: ' + e.message))
ws.close()
