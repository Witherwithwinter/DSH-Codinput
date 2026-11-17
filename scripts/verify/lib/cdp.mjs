/**
 * Minimal Chrome DevTools Protocol client for headless Edge / Chrome.
 *
 * Zero dependencies: Node >= 22 global fetch + WebSocket are used directly.
 * See scripts/verify/README.md for usage and rationale.
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const DEFAULT_EDGE =
  process.env.CODINPUT_EDGE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function fetchJson(url, opts) {
  const res = await fetch(url, opts)
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`non-JSON from ${url}: ${text.slice(0, 200)}`)
  }
}

/** Wait until the CDP HTTP endpoint answers and return its browser WebSocket URL. */
export async function waitForCdp(port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  let lastErr = ''
  while (Date.now() < deadline) {
    try {
      const info = await fetchJson(`http://127.0.0.1:${port}/json/version`)
      if (info.webSocketDebuggerUrl) return info
      lastErr = 'no webSocketDebuggerUrl'
    } catch (error) {
      lastErr = error instanceof Error ? error.message : String(error)
    }
    await sleep(200)
  }
  throw new Error(`CDP endpoint on :${port} not ready after ${timeoutMs}ms (${lastErr})`)
}

/**
 * Launch a headless Edge (or Chrome) and return a CDP connection plus lifecycle.
 * @param {{port?:number,userDataDir?:string,headless?:boolean,exe?:string,windowSize?:string,extraArgs?:string[],profileDir?:string}} options
 */
export async function launchBrowser(options = {}) {
  const port = options.port ?? 9222
  const exe = options.exe ?? DEFAULT_EDGE
  const headless = options.headless !== false
  const windowSize = options.windowSize ?? '1440,900'
  const userDataDir =
    options.profileDir ?? options.userDataDir ?? mkdtempSync(join(tmpdir(), 'dci-verify-edge-'))
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    `--window-size=${windowSize}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-sync',
    '--disable-translate',
    '--disable-features=Translate,OptimizationHints,MediaRouter',
    '--force-device-scale-factor=1',
    ...(headless ? ['--headless=new', '--disable-gpu', '--hide-scrollbars'] : []),
    'about:blank',
    ...(options.extraArgs ?? []),
  ]
  if (!existsSync(exe)) throw new Error(`browser executable not found: ${exe}`)
  const child = spawn(exe, args, { stdio: 'ignore', windowsHide: true })
  const version = await waitForCdp(port)
  const browser = await CDP.connect(version.webSocketDebuggerUrl)
  return {
    child,
    port,
    profileDir: userDataDir,
    version,
    browser,
    async close() {
      try {
        await browser.send('Browser.close')
      } catch {
        /* browser may already be gone */
      }
      try {
        browser.ws.close()
      } catch {
        /* ignore */
      }
      await sleep(300)
      try {
        child.kill()
      } catch {
        /* ignore */
      }
    },
  }
}

/** One CDP protocol connection (request/response + event fan-out). */
export class CDP {
  /** @param {WebSocket} ws */
  constructor(ws) {
    this.ws = ws
    this.nextId = 1
    this.pending = new Map()
    this.listeners = new Set()
    ws.addEventListener('message', ev => this.#onMessage(ev))
    ws.addEventListener('close', () => {
      for (const { reject } of this.pending.values()) reject(new Error('CDP socket closed'))
      this.pending.clear()
    })
  }

  static async connect(url, timeoutMs = 15000) {
    const ws = new WebSocket(url)
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`WebSocket open timeout: ${url}`)), timeoutMs)
      ws.addEventListener('open', () => {
        clearTimeout(timer)
        resolve()
      }, { once: true })
      ws.addEventListener('error', ev => {
        clearTimeout(timer)
        reject(new Error(`WebSocket error: ${url}`))
      }, { once: true })
    })
    return new CDP(ws)
  }

  #onMessage(ev) {
    let msg
    try {
      msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString())
    } catch {
      return
    }
    if (msg.id !== undefined) {
      const entry = this.pending.get(msg.id)
      if (!entry) return
      this.pending.delete(msg.id)
      if (msg.error) entry.reject(new Error(`CDP ${entry.method} failed: ${msg.error.message}`))
      else entry.resolve(msg.result)
      return
    }
    for (const fn of this.listeners) fn(msg)
  }

  on(fn) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++
    const payload = { id, method, params }
    if (sessionId) payload.sessionId = sessionId
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method })
      try {
        this.ws.send(JSON.stringify(payload))
      } catch (error) {
        this.pending.delete(id)
        reject(error)
      }
    })
  }
}

/** A page target driven through a flattened CDP session. */
export class Page {
  /**
   * @param {CDP} cdp browser-level connection
   * @param {string} sessionId flattened target session
   * @param {string} targetId
   */
  constructor(cdp, sessionId, targetId) {
    this.cdp = cdp
    this.sessionId = sessionId
    this.targetId = targetId
    /** @type {Array<{type:string,text:string}>} */
    this.events = []
    this.consoleLines = []
    cdp.on(msg => {
      if (msg.sessionId !== sessionId) return
      if (msg.method === 'Runtime.consoleAPICalled') {
        const text = (msg.params.args ?? [])
          .map(a => (a.value !== undefined ? String(a.value) : a.description ?? a.type))
          .join(' ')
        this.consoleLines.push({ type: msg.params.type, text })
      } else if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails
        this.consoleLines.push({
          type: 'pageerror',
          text: d.exception?.description ?? d.text ?? 'unknown exception',
        })
      } else if (msg.method === 'Page.javascriptDialogOpening') {
        this.events.push({ type: 'dialog', text: msg.params.message })
      }
    })
  }

  static async create(browser, url = 'about:blank') {
    const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true })
    const page = new Page(browser, sessionId, targetId)
    await page.send('Page.enable')
    await page.send('Runtime.enable')
    await page.send('Page.setLifecycleEventsEnabled', { enabled: true })
    if (url && url !== 'about:blank') await page.navigate(url)
    return page
  }

  send(method, params = {}) {
    return this.cdp.send(method, params, this.sessionId)
  }

  async navigate(url, { timeoutMs = 30000 } = {}) {
    await this.send('Page.navigate', { url })
    await this.waitFor(
      'document.readyState',
      v => v === 'complete',
      { timeoutMs, label: 'document.readyState=complete', interval: 100 },
    )
  }

  async eval(expression, { timeoutMs = 20000 } = {}) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
      timeout: timeoutMs,
    })
    if (result.exceptionDetails) {
      const d = result.exceptionDetails
      throw new Error(
        `evaluate threw: ${d.exception?.description ?? d.text ?? 'unknown'} :: ${expression.slice(0, 300)}`,
      )
    }
    return result.result?.value
  }

  async waitFor(expression, predicate = v => Boolean(v), opts = {}) {
    const { timeoutMs = 15000, interval = 100, label = expression } = opts
    const deadline = Date.now() + timeoutMs
    let last
    let lastErr
    while (Date.now() < deadline) {
      try {
        last = await this.eval(expression)
        if (predicate(last)) return last
      } catch (error) {
        lastErr = error
      }
      await sleep(interval)
    }
    throw new Error(
      `waitFor "${label}" timed out after ${timeoutMs}ms; last=${JSON.stringify(last)?.slice(0, 400)}${
        lastErr ? `; lastErr=${lastErr.message}` : ''
      }`,
    )
  }

  async click(x, y, { button = 'left', clickCount = 1 } = {}) {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount })
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount })
  }

  async clickSelector(selector, { timeoutMs = 10000 } = {}) {
    const rect = await this.waitFor(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; })()`,
      v => v && v.w > 0 && v.h > 0,
      { timeoutMs, label: `clickable ${selector}` },
    )
    await this.click(rect.x, rect.y)
    return rect
  }

  /** Insert text at the current DOM selection (works for CodeMirror contenteditable). */
  async insertText(text) {
    await this.send('Input.insertText', { text })
  }

  /** Press a single key with keydown/keyup (and optional char insertion). */
  async pressKey(key, opts = {}) {
    const { code = key, windowsVirtualKeyCode, text, modifiers = 0 } = opts
    const base = {
      key,
      code,
      windowsVirtualKeyCode,
      nativeVirtualKeyCode: windowsVirtualKeyCode,
      modifiers,
    }
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', ...base, ...(text ? { text } : {}) })
    if (text) await this.send('Input.dispatchKeyEvent', { type: 'char', ...base, text })
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
  }

  /** Type a literal string, one key event per character. */
  async typeText(text) {
    const special = { '/': { code: 'Slash', windowsVirtualKeyCode: 191 }, '@': { code: 'Digit2', windowsVirtualKeyCode: 50, modifiers: 8 } }
    for (const ch of text) {
      const s = special[ch]
      await this.pressKey(ch, s ? { ...s, text: ch } : { text: ch })
    }
  }

  async screenshot(path) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' })
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, Buffer.from(data, 'base64'))
    return path
  }
}
