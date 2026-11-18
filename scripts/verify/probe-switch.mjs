#!/usr/bin/env node
/**
 * Session-switch regression probe for DSH-Codinput.
 *
 * Reproduces the reported bug: with takeover enabled, switch conversations
 * A -> B -> A and type "/" — the slash candidate panel must appear every time.
 *
 * Guarded regression (fixed in 0.5.2): mirror-seat inject results used to be cached
 * by sessionId alone. When the host re-retains a Session it rebuilds that session's
 * scope/binding, so the official trigger controller changes generation; the cached
 * inject face kept MenuView subscribed to the PREVIOUS (closed) controller while the
 * editor tracked the NEW one. The menu store reported "open" but nothing rendered —
 * no console error, and a page reload was the only recovery.
 *
 * The probe seeds two non-blank Sessions itself (blank sessions are hidden from the
 * host's sidebar list): a local mock Messages endpoint answers one `dsh headless`
 * turn per Session, so no credential or network access is required.
 *
 * Usage:
 *   node scripts/verify/probe-switch.mjs           # isolated host + auto-seeded sessions
 *   node scripts/verify/probe-switch.mjs --url URL # attach to a host that already lists >= 2 Sessions
 *   node scripts/verify/probe-switch.mjs --keep-open --headful
 * Exit codes: 0 all checks passed, 1 some check failed, 3 harness/setup problem.
 *
 * Env: DCI_HOST_DIR, DCI_HOST_HOME, DCI_HOST_PORT (default 3098), CDP_PORT, CODINPUT_EDGE
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchBrowser, Page } from './lib/cdp.mjs'
import { prepareHost, startHost } from './lib/probe-host.mjs'
import { Probe, TIMEOUTS, sleep } from './lib/probe-core.mjs'
import { seedSessions } from './lib/seed-sessions.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..', '..')
const OUT = join(HERE, 'out')

// The three-form probe (probe.mjs) owns 3099; keep the two probes runnable back to back.
if (!process.env.DCI_HOST_PORT) process.env.DCI_HOST_PORT = '3098'
// Own isolated home: seeding real Sessions must not pollute probe.mjs's single-session
// baseline (blank Sessions are hidden from the sidebar, so mixing them in changes it).
if (!process.env.DCI_HOST_HOME) process.env.DCI_HOST_HOME = join(tmpdir(), 'dsh-verify-switch', 'home')

const CLI = parseArgs(process.argv.slice(2))
if (CLI.help) {
  console.log('node scripts/verify/probe-switch.mjs [--url <host-url>] [--keep-open] [--headful]')
  process.exit(0)
}

/**
 * @param {string[]} argv - raw argv tail.
 * @returns {{url: string, keepOpen: boolean, headful: boolean, help: boolean}}
 */
function parseArgs(argv) {
  const args = { url: process.env.DCI_URL || '', keepOpen: false, headful: false, help: false }
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index]
    if (current === '--url') args.url = argv[++index] || ''
    else if (current === '--keep-open') args.keepOpen = true
    else if (current === '--headful') args.headful = true
    else if (current === '--help' || current === '-h') args.help = true
  }
  return args
}

/** Client artifact fingerprint of `lib/client.js` (same shape probe.mjs reports). */
function clientFingerprint() {
  const path = join(REPO, 'lib', 'client.js')
  if (!existsSync(path)) return { bytes: 0, sha256: 'missing' }
  const bytes = readFileSync(path)
  return { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
}

/**
 * Make one Session current. Click its sidebar row when the tree is expanded; when the
 * first load keeps the tree collapsed (or the row is virtualized away), drive the same
 * host navigation through the plugin's diagnostic context. Either path performs the
 * real session navigation — the mount/unmount that the regression lives in.
 * @param {Probe} probe - probe driver.
 * @param {string} sessionId - target Session id.
 */
async function openSession(probe, sessionId) {
  const rect = await probe.ev('(function () { var row = document.querySelector(\'[data-row-key="session:' + sessionId + '"]\'); if (!row) return null; var r = row.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()')
  if (rect) {
    await probe.page.click(rect.x, rect.y)
  } else {
    const opened = await probe.ev('(function () { var sid = ' + JSON.stringify(sessionId) + '; var ctx = window.__dshCodinputCtx; if (!ctx) return { ok: false, why: "no diagnostic ctx" }; var ui = null; try { ui = ctx.get("uiWorkspace") } catch (e) { return { ok: false, why: "uiWorkspace threw: " + String(e).slice(0, 120) } }; if (!ui || typeof ui.openSession !== "function") return { ok: false, why: "uiWorkspace.openSession unavailable" }; try { ui.openSession({ sessionId: sid }); return { ok: true } } catch (e) { return { ok: false, why: "openSession threw: " + String(e).slice(0, 160) } } })()')
    if (!opened || opened.ok !== true) throw new Error('cannot switch to session ' + sessionId + ' :: ' + JSON.stringify(opened))
  }
  await probe.page.waitFor('(function () { try { return JSON.parse(localStorage["dsh.sessions.current"] || "{}").sessionId } catch (e) { return undefined } })()', value => value === sessionId, { label: 'session ' + sessionId, timeoutMs: TIMEOUTS.switch })
  await probe.helpers()
  await sleep(900)
  return probe.ev('(function () { return window.__dci.sessionId() })()')
}

/**
 * Dismiss any open overlay and empty the draft, so the next slash test starts from a
 * known state (per-session drafts survive switches by design).
 * @param {Probe} probe - probe driver.
 */
async function clearDraft(probe) {
  await probe.closeOverlays()
  try {
    await probe.typeIntoEditor('', { clear: true })
  } catch {
    /* clearing is best-effort; the next typeSlash replaces the draft anyway */
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const artifact = clientFingerprint()
  console.log('== DSH-Codinput session-switch probe ==')
  console.log('repo:     ' + REPO)
  console.log('artifact: lib/client.js ' + artifact.bytes + ' B sha256=' + artifact.sha256)

  let host
  let hostStarted = false
  let seeded = { ids: [], created: [], warnings: [] }
  if (CLI.url) {
    host = { url: CLI.url, child: null }
    console.log('host:     attaching to ' + CLI.url)
  } else {
    host = prepareHost(REPO)
    if (host.error) {
      console.error('HARNESS ERROR: ' + host.error)
      if (host.setupHint) console.error('setup: ' + host.setupHint)
      process.exit(3)
    }
    seeded = await seedSessions(host, 2)
    for (const warning of seeded.warnings) console.log('seed warn: ' + warning)
    if (seeded.ids.length < 2) {
      console.error('HARNESS ERROR: could not seed two switchable Sessions: ' + JSON.stringify(seeded))
      process.exit(3)
    }
    console.log('seeded:   ' + seeded.ids.join(', '))
    console.log('host:     booting isolated DSH_HOME=' + host.hostHome + ' port=' + host.port)
    host = await startHost(host)
    if (host.error) {
      console.error('HARNESS ERROR: ' + host.error)
      process.exit(3)
    }
    hostStarted = true
    console.log('host:     ' + host.url)
  }

  let browser
  let page
  try {
    browser = await launchBrowser({ port: Number(process.env.CDP_PORT || 9342), headless: !CLI.headful })
    page = await Page.create(browser.browser)
    await page.send('Emulation.setFocusEmulationEnabled', { enabled: true })
    await page.send('Page.bringToFront')
  } catch (error) {
    console.error('HARNESS ERROR: browser launch failed: ' + (error instanceof Error ? error.stack : String(error)))
    process.exit(3)
  }
  console.log('browser:  ' + (CLI.headful ? 'headed' : 'headless') + ' Edge, CDP :' + browser.port)

  const probe = new Probe(page, OUT)
  probe.url = host.url
  page.cdp.on(message => {
    if (message.sessionId !== page.sessionId) return
    if (message.method === 'Runtime.exceptionThrown') {
      const detail = message.params.exceptionDetails || {}
      probe.consoleErrors.push({ type: 'pageerror', text: String((detail.exception && detail.exception.description) || detail.text || '') })
    } else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      const args = message.params.args || []
      probe.consoleErrors.push({ type: 'console.error', text: String(args.map(arg => (arg.value !== undefined ? arg.value : (arg.description || arg.type))).join(' ')).slice(0, 400) })
    }
  })

  const finish = async code => {
    await probe.shot('switch-last')
    const summary = { pass: 0, fail: 0 }
    for (const result of probe.results) summary[result.pass ? 'pass' : 'fail'] += 1
    const report = {
      generatedAt: new Date().toISOString(),
      host: host.url,
      artifact,
      seeded,
      summary,
      checks: probe.results,
      consoleErrors: probe.consoleErrors.slice(0, 30),
      screenshots: probe.shots,
    }
    writeFileSync(join(OUT, 'switch-latest.json'), JSON.stringify(report, null, 2))
    console.log('')
    console.log('== summary: ' + summary.pass + ' passed, ' + summary.fail + ' failed ==')
    for (const result of probe.results) if (!result.pass) console.log('  FAIL ' + result.id + ' ' + result.name + ' :: ' + JSON.stringify(result.detail).slice(0, 700))
    console.log('report:      scripts/verify/out/switch-latest.json')
    if (!CLI.keepOpen) {
      await browser.close().catch(() => {})
      if (hostStarted && host.child) {
        try {
          host.child.kill()
        } catch {
          /* host already exited */
        }
      }
    }
    process.exit(code)
  }

  try {
    await page.navigate(host.url)
    await probe.waitReady('initial load')
    await probe.resetEnvironment()

    // The two seeded fixtures are non-blank (blank Sessions are hidden from the host
    // list by design), so they are switchable regardless of sidebar chrome state.
    probe.assert(seeded.ids.length >= 2, 'seeding did not produce two switchable Sessions', seeded)
    const first = seeded.ids[0]
    const second = seeded.ids[1]
    console.log('switch:   ' + first + ' <-> ' + second)

    await probe.check('W1', 'slash menu renders in the first Session (baseline)', async () => {
      await openSession(probe, first)
      const info = await probe.typeSlash()
      probe.assert(info.items > 0, 'menu has no candidates', info)
      return { session: first, items: info.items, menu: info.menu }
    })

    await probe.check('W2', 'slash menu renders after switching to the second Session', async () => {
      await clearDraft(probe)
      await openSession(probe, second)
      const info = await probe.typeSlash()
      probe.assert(info.items > 0, 'menu has no candidates', info)
      return { session: second, items: info.items, menu: info.menu }
    })

    await probe.check('W3', 'slash menu renders after switching BACK (reported bug: A -> B -> A)', async () => {
      await clearDraft(probe)
      await openSession(probe, first)
      const info = await probe.typeSlash()
      probe.assert(info.items > 0, 'menu has no candidates', info)
      probe.assert(info.menu && info.menu.h > 0, 'menu element missing after session switch-back', info)
      return { session: first, items: info.items, menu: info.menu }
    })

    await probe.check('W4', 'slash menu renders across repeated round trips (A -> B -> A -> B -> A)', async () => {
      await clearDraft(probe)
      await openSession(probe, second)
      const inSecond = await probe.typeSlash()
      probe.assert(inSecond.items > 0, 'menu has no candidates in the second Session', inSecond)
      await clearDraft(probe)
      await openSession(probe, first)
      const inFirst = await probe.typeSlash()
      probe.assert(inFirst.items > 0, 'menu has no candidates back in the first Session', inFirst)
      return { second: inSecond.menu, first: inFirst.menu }
    })

    await probe.check('W5', 'official /model popup opens after switching back (overlay popup seat)', async () => {
      await clearDraft(probe)
      const result = await probe.openModelPopup()
      probe.assert(result.popup && result.popup.found === true, 'popup not found after session switch-back', { popup: result.popup })
      await probe.closeOverlays()
      return { rect: result.popup.rect, relation: result.popup.relation }
    })

    await probe.check('W6', 'no plugin errors and no plugin-related console/page errors', async () => {
      const errs = await probe.ev('(function () { return window.__dshCodinputErrs || [] })()')
      const relevant = probe.consoleErrors.filter(error => /codinput|dci-/iu.test(String(error.text || '')))
      probe.assert(errs.length === 0, 'plugin errors recorded', { errs: errs.slice(0, 5) })
      probe.assert(relevant.length === 0, 'console/page errors mentioning the plugin', { relevant: relevant.slice(0, 5) })
      return { pluginErrors: errs.length, consoleErrors: probe.consoleErrors.length }
    })

    const failed = probe.results.filter(result => !result.pass).length
    await finish(failed === 0 ? 0 : 1)
  } catch (error) {
    console.error('HARNESS ERROR: ' + (error instanceof Error ? error.stack : String(error)))
    probe.record('X0', 'harness completed without uncaught error', false, String(error))
    await finish(3)
  }
}

main().catch(error => {
  console.error(error)
  process.exit(3)
})
