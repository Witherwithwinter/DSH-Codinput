#!/usr/bin/env node
/**
 * DSH-Codinput runtime acceptance probe (headless Edge + CDP, zero npm deps).
 *
 * Boots (or attaches to) an isolated DSH web host 0.2.2-rc.3 whose web profile
 * link-installs this repo as the dsh-codinput plugin, then verifies against the
 * real runtime:
 *
 *   H*  load health (__dshCodinputErrs / __dshCodinputShell / single surface)
 *   N*  normal form: official slash-menu geometry, /model popup, Escape close
 *   F*  float form: adaptive overlay host (data-mode=dd + data-placement) for a
 *       card near top/bottom/left, /model popup, menu follows a live drag
 *   S*  side form: surface inside the right sidebar tab, draft retained on the
 *       live normal -> side switch, slash menu + /model popup to the LEFT of the
 *       sidebar pane (message area), draft retained on the live side -> normal
 *   D*  draft retention: normal -> float -> normal (reload switches) and the
 *       fast normal -> float drag (<500ms after typing, live remount)
 *
 * Usage:
 *   node scripts/verify/probe.mjs                 # spawn own isolated host (:3099)
 *   node scripts/verify/probe.mjs --url <URL>     # attach to a running host
 *   node scripts/verify/probe.mjs --keep-open     # keep browser/host for debugging
 *   node scripts/verify/probe.mjs --headful       # visible browser window
 *
 * Env: DCI_HOST_DIR, DCI_HOST_HOME, DCI_HOST_PORT, CDP_PORT, CODINPUT_EDGE
 * Exit: 0 all checks passed, 1 some check failed, 3 harness setup problem.
 *
 * Report: scripts/verify/out/latest.json ; screenshots: scripts/verify/out/*.png
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchBrowser, Page } from './lib/cdp.mjs'
import { prepareHost, startHost } from './lib/probe-host.mjs'
import { Probe, TIMEOUTS, assertMenu, assertPopup, sleep } from './lib/probe-core.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..', '..')
const OUT = join(HERE, 'out')

const CLI = parseArgs(process.argv.slice(2))
if (CLI.help) {
  console.log('node scripts/verify/probe.mjs [--url <host-url>] [--keep-open] [--headful]')
  process.exit(0)
}

function parseArgs(argv) {
  const args = { url: process.env.DCI_URL || '', keepOpen: false, headful: false, help: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--url') args.url = argv[++i] || ''
    else if (a === '--keep-open') args.keepOpen = true
    else if (a === '--headful') args.headful = true
    else if (a === '--help' || a === '-h') args.help = true
  }
  return args
}

function clientFingerprint() {
  const path = join(REPO, 'lib', 'client.js')
  if (!existsSync(path)) return { bytes: 0, sha256: 'missing', mtime: 'missing' }
  const bytes = readFileSync(path)
  return {
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    mtime: new Date(statSync(path).mtimeMs).toISOString(),
  }
}

async function safeEval(page, expr) {
  try { return await page.eval(expr) } catch (e) { void e; return null }
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const artifact = clientFingerprint()
  console.log('== DSH-Codinput runtime probe ==')
  console.log('repo:     ' + REPO)
  console.log('artifact: lib/client.js ' + artifact.bytes + ' B sha256=' + artifact.sha256 + ' mtime=' + artifact.mtime)

  let host
  let hostStarted = false
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
  page.cdp.on(msg => {
    if (msg.sessionId !== page.sessionId) return
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails || {}
      probe.consoleErrors.push({ type: 'pageerror', text: String((d.exception && d.exception.description) || d.text || '') })
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      const args = msg.params.args || []
      probe.consoleErrors.push({ type: 'console.error', text: String(args.map(a => (a.value !== undefined ? a.value : (a.description || a.type))).join(' ')).slice(0, 400) })
    }
  })

  const finish = async code => {
    await probe.shot('probe-last')
    const summary = { pass: 0, fail: 0 }
    for (const r of probe.results) summary[r.pass ? 'pass' : 'fail'] += 1
    const report = {
      generatedAt: new Date().toISOString(),
      host: host.url,
      artifact: artifact,
      browser: { headless: !CLI.headful, cdpPort: browser.port },
      viewport: await safeEval(page, '(function () { return { w: innerWidth, h: innerHeight } })()'),
      summary: summary,
      checks: probe.results,
      consoleErrors: probe.consoleErrors.slice(0, 30),
      screenshots: probe.shots,
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    writeFileSync(join(OUT, 'probe-' + stamp + '.json'), JSON.stringify(report, null, 2))
    writeFileSync(join(OUT, 'latest.json'), JSON.stringify(report, null, 2))
    console.log('')
    console.log('== summary: ' + summary.pass + ' passed, ' + summary.fail + ' failed ==')
    for (const r of probe.results) if (!r.pass) console.log('  FAIL ' + r.id + ' ' + r.name + ' :: ' + JSON.stringify(r.detail).slice(0, 700))
    console.log('report:      scripts/verify/out/latest.json')
    console.log('screenshots: scripts/verify/out/')
    if (!CLI.keepOpen) {
      await browser.close().catch(() => {})
      if (hostStarted && host.child) { try { host.child.kill() } catch (e) { void e } }
    }
    process.exit(code)
  }

  try {
    await page.navigate(host.url)
    await probe.waitReady('initial load')
    await probe.resetEnvironment()

    // ------------------------------------------------------------- health
    await probe.check('H1', 'no plugin errors on isolated load', async () => {
      const info = await probe.ev('(function () { return window.__dci.sidebarInfo() })()')
      probe.assert(info.errs === 0, 'plugin errors recorded', { errsLength: info.errs })
      return { pluginErrors: info.errs }
    })
    await probe.check('H2', 'shell declares all seats', async () => {
      const shell = await probe.ev('(function () { return window.__dshCodinputShell })()')
      const required = ['apply', 'bar', 'settings', 'sidebar.body', 'sidebar.title', 'command']
      const missing = required.filter(k => !shell || !shell[k])
      probe.assert(missing.length === 0, 'missing shell keys ' + JSON.stringify(missing), shell)
      const sessionKeys = Object.keys(shell || {}).filter(k => k.indexOf('session-') === 0)
      probe.assert(sessionKeys.length === 1, 'expected exactly one session entry', sessionKeys)
      probe.assert(shell[sessionKeys[0]].surface === true, 'session surface not mounted', shell[sessionKeys[0]])
      return { shell: shell, sessionId: sessionKeys[0] }
    })
    await probe.check('H3', 'single takeover surface and single CodeMirror', async () => {
      const info = await probe.ev('(function () { return { surfaces: document.querySelectorAll(".dci-surface").length, cards: document.querySelectorAll(".dci-card").length, cm: window.__dci.countCmEditors() } })()')
      probe.assert(info.surfaces === 1 && info.cards === 1 && info.cm === 1, 'not single-instance', info)
      return info
    })

    // -------------------------------------------------------- normal form
    await probe.check('N1', 'normal: slash menu opens inside the in-card overlay anchor', async () => {
      const info = await probe.typeSlash()
      probe.assert(info.inAnchor === true, 'menu not inside .dci-overlay-anchor', { inAnchor: info.inAnchor })
      probe.assert(info.items > 0, 'no candidates', { items: info.items })
      return { items: info.items, inAnchor: info.inAnchor, adaptive: info.adaptive }
    })
    await probe.check('N2', 'normal: official geometry (bottom = card top - 4, width = card width, not adaptive)', async () => {
      const info = await probe.ev('(function () { return window.__dci.menuInfo() })()')
      return assertMenu(probe, info, { relation: 'top', widthEqualsCard: true, minHeight: 80, adaptive: false }, 'normal menu geometry')
    })
    await probe.shot('form-normal')
    await probe.check('N3', 'normal: Escape closes the menu', async () => {
      await probe.closeOverlays()
      const still = await probe.ev('(function () { return !!document.querySelector("[data-trigger-menu]") })()')
      probe.assert(still === false, 'menu still present after Escape')
      return { closed: true }
    })
    await probe.check('N4', 'normal: /model command opens the official popup in the overlay anchor', async () => {
      const result = await probe.openModelPopup()
      return assertPopup(probe, result.popup, 'normal /model popup', { relationIn: ['top'] })
    })
    await probe.check('N5', 'normal: Escape closes /model popup', async () => {
      await probe.closeOverlays()
      const found = await probe.ev('(function () { return window.__dci.popupInfo().found })()')
      probe.assert(found === false, 'popup still open')
      return { closed: true }
    })

    const vm = await probe.ev('(function () { return { w: innerWidth, h: innerHeight } })()')
    const floatH = 138

    // --------------------------------------------------------- float form
    await probe.check('F1', 'float: card mounts as floating shell near viewport top (floatY=16)', async () => {
      const info = await probe.setFloat(60, 16)
      probe.assert(info.side !== 'true', 'side form active while expecting float', info)
      probe.assert(!!(await probe.ev('(function () { return !!document.querySelector(".dci-float") })()')), 'missing .dci-float shell')
      probe.assert(info.card && Math.abs(info.card.t - 16) <= 2, 'float card not at floatY=16', info.card)
      return { card: info.card, viewport: info.vm }
    })
    await probe.check('F2', 'float near top: adaptive menu (data-mode=dd + data-placement) visible, no overlap, non-zero height', async () => {
      const info = await probe.typeSlash()
      probe.assert(info.adaptive === true, 'anchor not adaptive in float form', info)
      return assertMenu(probe, info, { relationIn: ['bottom', 'left', 'right'], minHeight: 120, adaptive: true }, 'float-top menu geometry')
    })
    await probe.shot('form-float-top')
    await probe.check('F3', 'float near bottom: menu opens above/beside card', async () => {
      await probe.closeOverlays()
      await probe.setFloat(60, vm.h - floatH - 12)
      const info = await probe.typeSlash()
      return assertMenu(probe, info, { relationIn: ['top', 'left', 'right'], minHeight: 120, adaptive: true }, 'float-bottom menu geometry')
    })
    await probe.shot('form-float-bottom')
    await probe.check('F4', 'float near left: menu stays fully inside the viewport', async () => {
      await probe.closeOverlays()
      await probe.setFloat(12, 300)
      const info = await probe.typeSlash()
      return assertMenu(probe, info, { relationIn: ['right', 'top', 'bottom'], minHeight: 120, adaptive: true }, 'float-left menu geometry')
    })
    await probe.check('F5', 'float: /model popup visible, inside viewport, not overlapping card', async () => {
      await probe.closeOverlays()
      await probe.setFloat(60, 16)
      const result = await probe.openModelPopup()
      return assertPopup(probe, result.popup, 'float /model popup', { relationIn: ['bottom', 'left', 'right'], adaptive: true })
    })
    await probe.shot('form-float-popup')
    await probe.check('F6', 'float: open menu follows a live card drag', async () => {
      await probe.closeOverlays()
      await probe.setFloat(120, 200)
      const before = await probe.typeSlash()
      await probe.drag('.dci-float .dci-float-dragzone', 240, 100)
      const stillOpen = await probe.ev('(function () { return !!document.querySelector("[data-trigger-menu]") })()')
      probe.assert(stillOpen === true, 'menu closed during drag')
      const after = await probe.ev('(function () { return window.__dci.menuInfo() })()')
      const geometry = assertMenu(probe, after, { relationIn: ['top', 'bottom', 'left', 'right'], minHeight: 60, adaptive: true }, 'float drag-follow menu geometry')
      probe.assert(Math.abs(after.card.t - before.card.t) > 5 || Math.abs(after.card.l - before.card.l) > 5, 'card did not move during drag', { before: before.card, after: after.card })
      return { before: { card: before.card, menu: before.menu }, after: geometry }
    })
    await probe.closeOverlays()

    // ------------------------------------ draft across reload form switches
    const MARK = 'DCI-DRAFT-' + Date.now().toString(36)
    await probe.check('D1', 'draft: normal -> float -> normal keeps editor text and host draft', async () => {
      await probe.setFloat(60, 120)
      await probe.clearDraft()
      await probe.typeIntoEditor(MARK)
      await sleep(600)
      const typed = await probe.ev('(function () { return window.__dci.editorText() })()')
      const host0 = await probe.ev('(function () { return window.__dci.hostDraft() })()')
      probe.assert(typed === MARK, 'typing failed', { typed: typed })
      probe.assert(host0 === MARK, 'host draft not updated after typing', { host0: host0 })
      await probe.setFloat(60, 240, 'float again')
      const inFloat = await probe.ev('(function () { return { text: window.__dci.editorText(), host: window.__dci.hostDraft() } })()')
      probe.assert(inFloat.text === MARK, 'draft lost on normal -> float', inFloat)
      probe.assert(inFloat.host === MARK, 'host draft diverged in float', inFloat)
      await probe.setPrefs({ mode: 'normal' }, { label: 'back to normal' })
      const inNormal = await probe.ev('(function () { return { text: window.__dci.editorText(), host: window.__dci.hostDraft() } })()')
      probe.assert(inNormal.text === MARK, 'draft lost on float -> normal', inNormal)
      probe.assert(inNormal.host === MARK, 'host draft diverged after float -> normal', inNormal)
      return { typed: typed, host0: host0, inFloat: inFloat, inNormal: inNormal }
    })

    // ----------------------------------------------------------- side form
    await probe.check('S1', 'side: Codinput tab hosts the surface inside the right sidebar and keeps the draft', async () => {
      const info = await probe.openSidebarGuide()
      probe.assert(info.side === 'true', 'side attribute not set', { side: info.side })
      probe.assert(info.inSidebar === true, 'surface not inside sidebar tab body', { inSidebar: info.inSidebar })
      probe.assert(info.float !== 'true', 'float also active in side form', { float: info.float })
      const count = await probe.ev('(function () { return window.__dci.countCmEditors() })()')
      probe.assert(count === 1, 'expected one editor in side form', { count: count })
      const text = await probe.ev('(function () { return window.__dci.editorText() })()')
      probe.assert(text === MARK, 'draft lost on live normal -> side switch', { text: text, MARK: MARK })
      const shell = await probe.ev('(function () { return window.__dshCodinputShell })()')
      const sessionKeys = Object.keys(shell || {}).filter(k => k.indexOf('session-') === 0)
      probe.assert(sessionKeys.length === 1 && shell[sessionKeys[0]].side === true, 'shell not reporting side form', { session: shell[sessionKeys[0]] })
      return { side: info.side, inSidebar: info.inSidebar, card: info.card, pane: info.pane, draft: text }
    })
    await probe.check('S2', 'draft: typing in side form is written to the host draft', async () => {
      await probe.focusEditor('[data-sidebar-right-tab] .cm-content')
      await probe.press('End', 'End', 35, 0)
      await probe.page.insertText('-SIDE')
      await sleep(700)
      const text = await probe.ev('(function () { return window.__dci.editorText() })()')
      const host = await probe.ev('(function () { return window.__dci.hostDraft() })()')
      probe.assert(text === MARK + '-SIDE', 'side typing not in editor', { text: text })
      probe.assert(host === MARK + '-SIDE', 'side typing not synced to host draft', { host: host })
      return { text: text, host: host }
    })
    await probe.check('S3', 'draft: closing the Codinput tab returns to normal form with draft intact', async () => {
      const info = await probe.closeSidebarTab()
      probe.assert(info.side !== 'true', 'side form still active after tab close', { side: info.side })
      const after = await probe.ev('(function () { return { text: window.__dci.editorText(), host: window.__dci.hostDraft() } })()')
      probe.assert(after.text === MARK + '-SIDE', 'draft lost on live side -> normal switch', after)
      probe.assert(after.host === MARK + '-SIDE', 'host draft diverged on side -> normal', after)
      return { form: info.float === 'true' ? 'float' : 'normal', after: after }
    })
    await probe.check('S4', 'side: slash menu renders left of the sidebar pane, fully visible, data-placement=left', async () => {
      await probe.openSidebarGuide()
      await probe.clearDraft()
      const info = await probe.typeSlash()
      probe.assert(info.pane && info.card, 'missing pane/card rect', { pane: info.pane, card: info.card })
      const paneLeft = info.pane ? info.pane.l : info.card.l
      return assertMenu(probe, info, { relationIn: ['left'], minHeight: 120, adaptive: true, maxRight: paneLeft, expectedPlacement: 'left' }, 'side menu geometry')
    })
    await probe.shot('form-side')
    await probe.check('S5', 'side: /model popup visible left of the sidebar pane', async () => {
      await probe.closeOverlays()
      await probe.clearDraft()
      const result = await probe.openModelPopup()
      const popup = result.popup
      const paneLeft = popup.pane ? popup.pane.l : (popup.card ? popup.card.l : undefined)
      probe.assert(popup.found === true, 'popup not found', popup)
      return assertPopup(probe, popup, 'side /model popup', { relationIn: ['left', 'top', 'bottom'], adaptive: true })
    })
    await probe.shot('form-side-popup')
    await probe.closeOverlays()

    // ----------------------------------------- fast in-page form switch
    await probe.check('D2', 'draft: fast normal -> float drag (<500ms after typing) keeps live doc', async () => {
      const sideNow = await probe.ev('(function () { var s = document.querySelector(".dci-surface"); return !!s && s.getAttribute("data-side") === "true" })()')
      if (sideNow) await probe.closeSidebarTab()
      await probe.setPrefs({ mode: 'normal' }, { label: 'normal before fast switch' })
      await probe.waitDraftSettled(5000)
      await probe.clearDraft()
      const marker = 'FAST-' + Date.now().toString(36)
      await probe.typeIntoEditor(marker)
      const typedAt = Date.now()
      const dragInfo = await probe.drag('.dci-surface:not([data-side]) .dci-float-dragzone', 300, 240)
      const elapsed = dragInfo.startedAt - typedAt
      await probe.page.waitFor('(function () { var s = document.querySelector(".dci-surface"); return !!s && s.getAttribute("data-float") === "true" })()', v => v === true, { label: 'float after drag', timeoutMs: TIMEOUTS.switch })
      const mountLatency = Date.now() - typedAt
      await probe.helpers()
      await sleep(500)
      const editor = await probe.ev('(function () { return window.__dci.editorText() })()')
      const host = await probe.ev('(function () { return window.__dci.hostDraft() })()')
      probe.assert(elapsed < 500, 'drag started ' + elapsed + 'ms after typing (expected <500ms)')
      probe.assert(editor === marker, 'draft lost on fast normal -> float switch', { editor: editor, marker: marker, elapsed: elapsed })
      probe.assert(host === marker, 'host draft lost on fast switch', { host: host, marker: marker })
      return { dragStartedAfterTypingMs: elapsed, floatMountLatencyMs: mountLatency, editor: editor, host: host }
    })
    await probe.check('D3', 'draft: float -> normal by dragging back into the dock zone', async () => {
      const isFloat = await probe.ev('(function () { var s = document.querySelector(".dci-surface"); return !!s && s.getAttribute("data-float") === "true" })()')
      if (!isFloat) {
        await probe.setFloat(60, 120)
        await probe.clearDraft()
        await probe.typeIntoEditor('DOCK-' + Date.now().toString(36))
        await sleep(400)
      }
      const before = await probe.ev('(function () { return window.__dci.editorText() })()')
      const zone = await probe.ev('(function () { var seat = document.querySelector("[data-composer-seat]"); var r = seat ? seat.getBoundingClientRect() : null; var ih = innerHeight; var iw = innerWidth; var bottom = Math.min(ih, (r ? r.bottom : ih) + 120); var top = Math.max(0, bottom - 300); var left = (r ? r.left : 0) - 40; var right = (r ? r.right : iw) + 40; return { x: Math.round((Math.max(0, left) + Math.min(iw, right)) / 2), y: Math.round((top + bottom) / 2), zone: { left: left, right: right, top: top, bottom: bottom }, seat: r ? { l: r.left, t: r.top, w: r.width, h: r.height } : null } })()')
      await probe.drag('.dci-float .dci-float-dragzone', zone.x, zone.y)
      await probe.page.waitFor('(function () { var s = document.querySelector(".dci-surface"); return !!s && s.getAttribute("data-float") !== "true" })()', v => v === true, { label: 'normal after drag', timeoutMs: TIMEOUTS.switch })
      await probe.helpers()
      await sleep(500)
      const after = await probe.ev('(function () { return { text: window.__dci.editorText(), host: window.__dci.hostDraft() } })()')
      probe.assert(after.text === before, 'draft lost on float -> normal drag', { before: before, after: after })
      probe.assert(after.host === before, 'host draft lost on float -> normal drag', { before: before, after: after })
      return { before: before, after: after }
    })

    // ---------------------------------------------------------- final health
    await probe.check('H4', 'no plugin errors and no plugin-related console/page errors after full run', async () => {
      const errs = await probe.ev('(function () { return window.__dshCodinputErrs || [] })()')
      const relevant = probe.consoleErrors.filter(e => /codinput|dci-/i.test(String(e.text || '')))
      probe.assert(errs.length === 0, 'plugin errors recorded', { errs: errs.slice(0, 5) })
      probe.assert(relevant.length === 0, 'console/page errors mentioning the plugin', { relevant: relevant.slice(0, 5) })
      return { pluginErrors: errs.length, consoleErrors: probe.consoleErrors.length }
    })

    const failed = probe.results.filter(r => !r.pass).length
    await finish(failed === 0 ? 0 : 1)
  } catch (error) {
    console.error('HARNESS ERROR: ' + (error instanceof Error ? error.stack : String(error)))
    try {
      const snap = await probe.ev('(function () { return window.__dci ? window.__dci.sidebarInfo() : null })()')
      console.error('state at failure: ' + JSON.stringify(snap))
      await probe.shot('probe-error')
    } catch (e) { void e }
    probe.record('X0', 'harness completed without uncaught error', false, String(error))
    await finish(3)
  }
}

main().catch(error => {
  console.error(error)
  process.exit(3)
})
