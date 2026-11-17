/**
 * Browser-side helper snapshot installed into the isolated host page as
 * window.__dci. All geometry is read from live getBoundingClientRect().
 * Exposed as a plain source string so the probe can page.eval() it after every
 * navigation (the page context is wiped by reload).
 */
export const HELPERS = `window.__dci = (() => {
  if (window.__dci) return window.__dci
  const rect = el => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }
  }
  const overlapping = (a, b) => a && b &&
    Math.min(a.r, b.r) - Math.max(a.l, b.l) > 1 &&
    Math.min(a.b, b.b) - Math.max(a.t, b.t) > 1
  const relation = (menu, card) => {
    if (!menu || !card) return "none"
    if (overlapping(menu, card)) return "overlap"
    if (menu.b <= card.t + 1) return "top"
    if (menu.t >= card.b - 1) return "bottom"
    if (menu.r <= card.l + 1) return "left"
    if (menu.l >= card.r - 1) return "right"
    return "unknown"
  }
  const gap = (menu, card, side) => {
    if (!menu || !card) return null
    if (side === "top") return card.t - menu.b
    if (side === "bottom") return menu.t - card.b
    if (side === "left") return card.l - menu.r
    if (side === "right") return menu.l - card.r
    return null
  }
  const editorText = () => {
    const root = document.querySelector(".dci-surface .cm-content")
    if (!root) return null
    const ph = root.querySelector(".cm-placeholder") ? root.querySelector(".cm-placeholder").textContent : ""
    return (root.innerText || "").replace(ph, "").trim()
  }
  const sessionId = () => {
    try { return JSON.parse(localStorage["dsh.sessions.current"] || "{}").sessionId } catch (e) { return undefined }
  }
  const hostDraft = () => {
    const sid = sessionId()
    if (!sid) return null
    try { return JSON.parse(localStorage["dsh.conversation." + sid] || "{}").draft.text } catch (e) { return null }
  }
  /** Nearest right-sidebar dock pane: widest (>300px) ancestor whose class names it a pane/panel. */
  const findPane = surface => {
    let pane = null
    let el = surface ? surface.parentElement : null
    while (el && el !== document.body) {
      const cls = String(el.className || "")
      const r = rect(el)
      if (/pane|panel/i.test(cls) && r && r.w > 300) pane = el
      el = el.parentElement
    }
    return pane
  }
  const base = () => {
    const surface = document.querySelector(".dci-surface")
    const card = document.querySelector(".dci-card")
    const anchor = document.querySelector(".dci-overlay-anchor")
    const pane = findPane(surface)
    return {
      surface: rect(surface), card: rect(card), pane: rect(pane),
      side: surface ? surface.getAttribute("data-side") : null,
      float: surface ? surface.getAttribute("data-float") : null,
      inSidebar: !!surface && !!surface.closest("[data-sidebar-right-tab]"),
      adaptive: anchor ? anchor.hasAttribute("data-adaptive") : null,
      overlayMode: anchor ? anchor.getAttribute("data-mode") : null,
      placement: anchor ? anchor.getAttribute("data-placement") : null,
      anchorStyle: anchor ? anchor.getAttribute("style") : null,
      anchor: rect(anchor),
      errs: window.__dshCodinputErrs ? window.__dshCodinputErrs.length : -1,
      shell: window.__dshCodinputShell || null,
      vm: { w: innerWidth, h: innerHeight },
    }
  }
  const menuInfo = () => {
    const menu = document.querySelector("[data-trigger-menu]")
    const card = document.querySelector(".dci-card")
    const info = Object.assign(base(), {
      menu: rect(menu),
      items: menu ? menu.querySelectorAll("[role=option]").length : 0,
      inAnchor: !!menu && !!menu.closest(".dci-overlay-anchor"),
      relation: relation(rect(menu), rect(card)),
      gap: null,
      hitInside: null,
    })
    if (menu) info.gap = gap(rect(menu), rect(card), info.relation)
    if (menu) {
      const r = rect(menu)
      const hit = document.elementFromPoint((r.l + r.r) / 2, (r.t + r.b) / 2)
      info.hitInside = !!hit && menu.contains(hit)
    }
    return info
  }
  const popupInfo = () => {
    const anchor = document.querySelector(".dci-overlay-anchor")
    const info = base()
    if (!anchor) return Object.assign({ found: false }, info)
    const isDropdown = el => {
      const cs = getComputedStyle(el)
      return cs.position === "absolute" && cs.bottom !== "auto" && cs.left === "0px" && cs.right === "0px"
    }
    const kids = Array.prototype.slice.call(anchor.children)
    const entry = kids.find(isDropdown) || null
    if (!entry) {
      return Object.assign({ found: false, kids: kids.map(k => ({ cls: String(k.className).slice(0, 80), rect: rect(k) })) }, info)
    }
    const listbox = entry.querySelector("[role=listbox], [role=dialog]")
    const relationValue = relation(rect(entry), info.card)
    return Object.assign({
      found: true,
      rect: rect(entry),
      cls: String(entry.className).slice(0, 120),
      aria: entry.getAttribute("aria-label"),
      listboxAria: listbox ? listbox.getAttribute("aria-label") : null,
      relation: relationValue,
      gap: gap(rect(entry), info.card, relationValue),
    }, info)
  }
  window.__dci = { rect, overlapping, relation, gap, editorText, sessionId, hostDraft, sidebarInfo: base, menuInfo, popupInfo }
  return window.__dci
})()`
