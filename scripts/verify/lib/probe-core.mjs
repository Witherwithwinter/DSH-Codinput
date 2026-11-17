/**
 * Probe driver + geometry assertions for the DSH-Codinput runtime probe.
 * Browser-side snippets are plain single-quoted strings (no template literals).
 */
import { join } from 'node:path'
import { HELPERS } from './page-helpers.mjs'

export const TIMEOUTS = { shell: 30000, menu: 6000, popup: 6000, switch: 6000 }
export const sleep = ms => new Promise(r => setTimeout(r, ms))
export const round = n => Math.round(n * 10) / 10
export const safe = value => {
  try { return JSON.parse(JSON.stringify(value)) } catch { return String(value) }
}

export class Probe {
  constructor(page, outDir) {
    this.page = page
    this.outDir = outDir
    this.url = ''
    this.results = []
    this.consoleErrors = []
    this.shots = []
  }

  record(id, name, pass, detail) {
    const entry = { id, name, pass: pass === true, detail: safe(detail === undefined ? '' : detail) }
    this.results.push(entry)
    console.log('[' + (entry.pass ? 'PASS' : 'FAIL') + '] ' + id + ' ' + name + (detail === undefined || detail === '' ? '' : ' :: ' + JSON.stringify(safe(detail)).slice(0, 900)))
    return entry
  }

  async check(id, name, fn) {
    try { return this.record(id, name, true, await fn()) }
    catch (error) { return this.record(id, name, false, { error: error instanceof Error ? error.message : String(error) }) }
  }

  assert(condition, message, detail) {
    if (!condition) throw new Error(message + (detail === undefined ? '' : ' :: ' + JSON.stringify(safe(detail)).slice(0, 1200)))
    return detail
  }

  ev(expr) { return this.page.eval(expr) }
  helpers() { return this.page.eval(HELPERS) }

  async dismissDialogs() {
    for (let i = 0; i < 4; i++) {
      const found = await this.ev('(function () { var dlg = document.querySelector("[role=dialog]"); if (!dlg) return false; var buttons = Array.prototype.slice.call(dlg.querySelectorAll("button")); var close = buttons.find(function (b) { return !(b.innerText || "").trim() }) || buttons.find(function (b) { return /继续|稍后|关闭/.test(b.innerText || "") }) || buttons[0]; if (close) close.click(); return true })()')
      if (!found) return
      await sleep(450)
    }
  }

  async waitReady(label) {
    await this.page.waitFor('window.__dshCodinputShell && window.__dshCodinputShell.apply === "done" && !!document.querySelector(".dci-surface")', v => v === true, { label: label || 'page ready', timeoutMs: TIMEOUTS.shell })
    await this.helpers()
    await sleep(600)
    await this.dismissDialogs()
    await this.helpers()
  }

  /** Wait until the editor DOM and the official host draft agree (post-reload restore settled). */
  async waitDraftSettled(timeoutMs) {
    try {
      await this.page.waitFor('(function () { return { text: window.__dci.editorText(), host: window.__dci.hostDraft() } })()', v => v && v.text === v.host, { label: 'draft settled', timeoutMs: timeoutMs || 5000, interval: 120 })
      return true
    } catch (e) { void e; return false }
  }

  async reload(label) {
    await this.page.navigate(this.url)
    await this.waitReady(label || 'reload')
    await this.waitDraftSettled(5000)
  }

  async setPrefs(partial, opts) {
    const options = opts || {}
    const patch = JSON.stringify(partial)
    await this.ev('(function () { var p = JSON.parse(localStorage["dsh-codinput.prefs.v3"] || "{}"); Object.assign(p, ' + patch + '); localStorage["dsh-codinput.prefs.v3"] = JSON.stringify(p) })()')
    if (options.reload !== false) await this.reload(options.label || 'set prefs')
  }

  async resetEnvironment() {
    const sid = await this.ev('(function () { return window.__dci.sessionId() })()')
    await this.ev('(function () { localStorage.removeItem("dsh.sidebar-right.v1." + ' + JSON.stringify(sid) + '); localStorage["dsh-codinput.prefs.v3"] = JSON.stringify({ mode: "normal" }) })()')
    await this.reload('clean normal baseline')
  }

  async editorScope() {
    const side = await this.ev('(function () { return !!document.querySelector(".dci-surface[data-side] .cm-content") })()')
    return side ? '[data-sidebar-right-tab] .cm-content' : '.dci-surface .cm-content'
  }

  async focusEditor(scope) {
    const point = await this.ev('(function () { var el = document.querySelector(' + JSON.stringify(scope) + '); if (!el) return null; var r = el.getBoundingClientRect(); return { x: r.left + Math.min(30, r.width / 2), y: r.top + Math.min(12, r.height / 2) } })()')
    if (!point) throw new Error('editor not found: ' + scope)
    await this.page.click(point.x, point.y)
    await sleep(140)
  }

  async press(key, code, vk, modifiers) {
    const base = { key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: modifiers || 0 }
    await this.page.send('Input.dispatchKeyEvent', Object.assign({ type: 'rawKeyDown' }, base))
    await this.page.send('Input.dispatchKeyEvent', Object.assign({ type: 'keyUp' }, base))
  }

  async typeIntoEditor(text, opts) {
    const options = opts || {}
    const scope = await this.editorScope()
    for (let attempt = 0; attempt < 2; attempt++) {
      await this.focusEditor(scope)
      if (options.clear !== false) await this.press('a', 'KeyA', 65, 2)
      if (text === '') {
        await this.press('Backspace', 'Backspace', 8, 0)
      } else {
        await this.page.insertText(text)
      }
      await sleep(200)
      const got = await this.ev('(function () { return window.__dci.editorText() })()')
      if (got !== null && (text === '' ? got === '' : got.indexOf(text) >= 0)) return got
      if (attempt === 1) throw new Error('typing failed: wanted ' + JSON.stringify(text) + ' got ' + JSON.stringify(got))
    }
    return null
  }

  async clearDraft() {
    await this.typeIntoEditor('')
    await sleep(350)
    const text = await this.ev('(function () { return window.__dci.editorText() })()')
    this.assert(text === '', 'draft not cleared', { text: text })
    return text
  }

  /** Type a slash and wait for the official trigger menu; retries once for first-mount flake. */
  async typeSlash() {
    const tryOnce = async () => {
      await this.typeIntoEditor('/', { clear: true })
      return this.page.waitFor('(function () { return window.__dci.menuInfo() })()', info => info && info.menu && info.menu.h > 0, { label: 'slash menu', timeoutMs: TIMEOUTS.menu, interval: 100 })
    }
    try {
      return await tryOnce()
    } catch (first) {
      await sleep(500)
      try { return await tryOnce() } catch (second) { void second; throw first }
    }
  }

  async pickMenuRow(pattern) {
    const picked = await this.ev('(function () { var rows = Array.prototype.slice.call(document.querySelectorAll("[data-trigger-menu] [role=option]")); var re = new RegExp(' + JSON.stringify(pattern) + ', "i"); var target = rows.find(function (el) { return re.test(el.innerText || "") }); if (!target) return { ok: false, rows: rows.slice(0, 8).map(function (el) { return (el.innerText || "").trim().slice(0, 60) }) }; target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true })); return { ok: true, text: (target.innerText || "").trim().slice(0, 80) } })()')
    if (!picked.ok) throw new Error('menu row not found for ' + pattern + ' :: ' + JSON.stringify(picked.rows))
    return picked
  }

  async openModelPopup() {
    await this.typeIntoEditor('/model', { clear: true })
    const menu = await this.page.waitFor('(function () { return window.__dci.menuInfo() })()', info => info && info.menu && info.menu.h > 0, { label: '/model menu', timeoutMs: TIMEOUTS.menu, interval: 100 })
    this.assert(menu.items > 0, 'no /model candidates', menu)
    const picked = await this.pickMenuRow('模型|/model|model')
    const popup = await this.page.waitFor('(function () { return window.__dci.popupInfo() })()', info => info && info.found === true && info.rect && info.rect.h > 0, { label: '/model popup', timeoutMs: TIMEOUTS.popup, interval: 100 })
    return { menu, picked, popup }
  }

  async closeOverlays() {
    await this.press('Escape', 'Escape', 27, 0)
    await sleep(250)
  }

  async openSidebarGuide() {
    const alreadyOpen = await this.ev('(function () { return !!document.querySelector("[data-sidebar-right-guide-entry=codinput]") })()')
    if (!alreadyOpen) {
      await this.page.click(500, 300)
      await this.press('B', 'KeyB', 66, 10)
      await sleep(800)
    }
    let hasEntry = await this.ev('(function () { return !!document.querySelector("[data-sidebar-right-guide-entry=codinput]") })()')
    if (!hasEntry) {
      await this.ev('(function () { var b = document.querySelector("[aria-label=新标签页]"); if (b) b.click() })()')
      await sleep(900)
      hasEntry = await this.ev('(function () { return !!document.querySelector("[data-sidebar-right-guide-entry=codinput]") })()')
    }
    await this.page.waitFor('(function () { return !!document.querySelector("[data-sidebar-right-guide-entry=codinput]") })()', v => v === true, { label: 'sidebar guide', timeoutMs: 9000 })
    await this.ev('(function () { document.querySelector("[data-sidebar-right-guide-entry=codinput]").click() })()')
    await this.page.waitFor('(function () { var s = document.querySelector(".dci-surface"); return !!s && s.getAttribute("data-side") === "true" && !!s.closest("[data-sidebar-right-tab]") })()', v => v === true, { label: 'side form', timeoutMs: TIMEOUTS.switch })
    await this.helpers()
    await sleep(500)
    return this.ev('(function () { return window.__dci.sidebarInfo() })()')
  }

  async closeSidebarTab() {
    const clicked = await this.ev('(function () { var btn = document.querySelector("[data-dockkit-tab-close]"); if (!btn) return false; btn.click(); return true })()')
    if (!clicked) throw new Error('no sidebar tab close button')
    await this.page.waitFor('(function () { var s = document.querySelector(".dci-surface"); return !!s && s.getAttribute("data-side") !== "true" && document.querySelectorAll(".cm-editor").length === 1 })()', v => v === true, { label: 'side tab closed', timeoutMs: TIMEOUTS.switch })
    await this.helpers()
    await sleep(400)
    return this.ev('(function () { return window.__dci.sidebarInfo() })()')
  }

  async setFloat(x, y, label) {
    await this.setPrefs({ mode: 'float', floatX: x, floatY: y }, { label: label || 'float ' + x + ',' + y })
    const info = await this.ev('(function () { return window.__dci.sidebarInfo() })()')
    this.assert(info.float === 'true', 'float form not mounted', info)
    return info
  }

  async drag(selector, toX, toY) {
    const from = await this.ev('(function () { var el = document.querySelector(' + JSON.stringify(selector) + '); if (!el) return null; var r = el.getBoundingClientRect(); return { x: r.left + Math.min(r.width / 2, 60), y: r.top + r.height / 2 } })()')
    if (!from) throw new Error('drag source not found: ' + selector)
    await this.page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y })
    const startedAt = Date.now()
    await this.page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 })
    for (let i = 1; i <= 6; i++) {
      const x = from.x + ((toX - from.x) * i) / 6
      const y = from.y + ((toY - from.y) * i) / 6
      await this.page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 })
      await sleep(30)
    }
    await this.page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: toX, y: toY, button: 'left', buttons: 0, clickCount: 1 })
    await sleep(500)
    return { startedAt: startedAt, from: from }
  }

  async shot(name) {
    const path = join(this.outDir, name + '.png')
    try { await this.page.screenshot(path); this.shots.push(path) } catch (e) { void e }
    return path
  }
}

export function assertMenu(probe, info, exp, label) {
  const problems = []
  const vw = info.vm.w
  const vh = info.vm.h
  const minHeight = exp.minHeight === undefined ? 60 : exp.minHeight
  if (!info.menu) problems.push('menu element missing')
  else {
    const m = info.menu
    if (m.h < minHeight) problems.push('menu height ' + round(m.h) + ' < ' + minHeight)
    if (m.w < 120) problems.push('menu width ' + round(m.w) + ' < 120')
    if (m.l < -0.5 || m.t < -0.5 || m.r > vw + 0.5 || m.b > vh + 0.5) problems.push('menu not fully inside viewport')
    if (info.relation === 'overlap') problems.push('menu overlaps card')
    if (exp.relation && info.relation !== exp.relation) problems.push('relation ' + info.relation + ' != ' + exp.relation)
    if (exp.relationIn && exp.relationIn.indexOf(info.relation) < 0) problems.push('relation ' + info.relation + ' not in ' + JSON.stringify(exp.relationIn))
    if (info.gap !== null && Math.abs(info.gap - 4) > 2.5) problems.push('gap ' + round(info.gap) + ' != 4')
    if (exp.widthEqualsCard && Math.abs(m.w - info.card.w) > 1.5) problems.push('menu width ' + round(m.w) + ' != card width ' + round(info.card.w))
    if (exp.maxRight !== undefined && m.r > exp.maxRight + 2) problems.push('menu right ' + round(m.r) + ' > ' + round(exp.maxRight))
    if (exp.expectedPlacement && info.placement !== exp.expectedPlacement) problems.push('data-placement ' + info.placement + ' != ' + exp.expectedPlacement)
    if (exp.adaptive === true) {
      if (info.adaptive !== true) problems.push('anchor missing data-adaptive')
      if (info.overlayMode !== 'dd') problems.push('anchor data-mode ' + info.overlayMode + ' != dd')
      if (!info.placement) problems.push('anchor data-placement missing')
      if (!info.anchorStyle || info.anchorStyle.indexOf('--dci-overlay-maxh') < 0) problems.push('anchor style missing --dci-overlay-maxh')
    }
    if (exp.adaptive === false && info.adaptive === true) problems.push('normal form unexpectedly adaptive')
  }
  if (exp.expectItems !== false && !(info.items > 0)) problems.push('menu has no [role=option] rows')
  if (problems.length > 0) {
    throw new Error(label + ': ' + problems.join('; ') + ' :: ' + JSON.stringify(safe({
      menu: info.menu, card: info.card, pane: info.pane, relation: info.relation, gap: info.gap,
      items: info.items, adaptive: info.adaptive, overlayMode: info.overlayMode, placement: info.placement,
      anchorStyle: info.anchorStyle, vw: vw, vh: vh,
    })))
  }
  return {
    menu: { l: round(info.menu.l), t: round(info.menu.t), w: round(info.menu.w), h: round(info.menu.h) },
    card: info.card ? { l: round(info.card.l), t: round(info.card.t), w: round(info.card.w), h: round(info.card.h) } : null,
    pane: info.pane ? { l: round(info.pane.l), t: round(info.pane.t), w: round(info.pane.w) } : null,
    relation: info.relation,
    gap: info.gap === null ? null : round(info.gap),
    items: info.items,
    dataMode: info.overlayMode,
    dataPlacement: info.placement,
    anchorStyle: info.anchorStyle,
    viewport: info.vm,
  }
}

export function assertPopup(probe, info, label, exp) {
  const expectations = exp || {}
  const problems = []
  if (!info.found) {
    problems.push('popup entry not found in overlay slot, kids=' + JSON.stringify(info.kids || []))
  } else {
    const r = info.rect
    if (r.h < 20) problems.push('popup height ' + round(r.h))
    if (r.w < 80) problems.push('popup width ' + round(r.w))
    if (r.l < -0.5 || r.t < -0.5 || r.r > info.vm.w + 0.5 || r.b > info.vm.h + 0.5) problems.push('popup not fully inside viewport')
    if (info.relation === 'overlap') problems.push('popup overlaps card')
    if (expectations.relationIn && expectations.relationIn.indexOf(info.relation) < 0) problems.push('popup relation ' + info.relation + ' not in ' + JSON.stringify(expectations.relationIn))
    if (expectations.adaptive === true) {
      if (info.adaptive !== true) problems.push('anchor missing data-adaptive')
      if (info.overlayMode !== 'dd') problems.push('anchor data-mode ' + info.overlayMode + ' != dd')
      if (!info.placement) problems.push('anchor data-placement missing')
    }
  }
  if (problems.length > 0) throw new Error(label + ': ' + problems.join('; ') + ' :: ' + JSON.stringify(safe(info)))
  return {
    rect: { l: round(info.rect.l), t: round(info.rect.t), w: round(info.rect.w), h: round(info.rect.h) },
    relation: info.relation,
    gap: info.gap === null ? null : round(info.gap),
    aria: info.aria,
    dataMode: info.overlayMode,
    dataPlacement: info.placement,
    viewport: info.vm,
  }
}
