/**
 * 模式切换（normal ↔ float / side）全场景 GPU 合成层丝滑过渡引擎：
 *
 * 为什么不能动画化底部占位槽的 CSS `height`：
 * 逐帧改 `height` 会在每一帧触发整页回流与宿主 ResizeObserver，在长对话
 * （上百轮消息）下会造成明显掉帧与顿感；同时形态切换会重挂载 CodeMirror 6，
 * 若首帧同步起播 CSS 过渡，动画前段会被主线程吞掉。
 *
 * 零回流全场景协同编排（全部运行在 GPU 合成层，零 Layout / 零 Paint）：
 * 1. 准确锁定宿主聊天根层（`.root`，跳过 `display: contents` 的 slot 锚点并避开
 *    内部 `overflow-y: clip` 对正向位移的裁切，且不包裹 `TurnNavigator` / 回底按钮）；
 * 2. 切换前（`captureChatFlip`）记录可见锚点消息、底部输入座、悬浮卡片与回底按钮的
 *    实时屏幕几何（含进行中动画的当前中间位，保证中途折返 0px 跳变）；
 * 3. 切换后（`playChatFlip`）在 `useLayoutEffect` 中立即定格首帧，并挂一次性
 *    `ResizeObserver` 紧随宿主 `ChatViewport` / `seatObserver` 之后、首帧绘制之前
 *    捕获异步 `scrollTop` 跟随与 `--dsh-composer-height` 更新，彻底消除 `float/side → normal`
 *    的 1 帧上跳闪动；
 * 4. 下一帧主线程空闲后，以同一条距离自适应 Expo-Out 曲线同步起播：
 *    - 聊天内容层（`translate`）：丝滑补位/让位；
 *    - 宿主 `composerSeat::before` 渐变底板（进入 normal 时 `scaleY` 同步抬升，
 *      `transform-origin: bottom` 不撑大 `scrollHeight`，防止首帧底板直接盖死消息）；
 *    - 退出 normal 且底部有被遮消息露出时，固定裁切盒内 GPU 幕布同步向下拉开；
 *    - 归位输入卡片：悬浮归位按松手实时位置磁吸 FLIP 入座，侧栏归位柔和上浮入座；
 *    - 回底浮动按钮（若可见）：随底栏高度同步平滑升降。
 */

const MIN_FLIP_DELTA_PX = 2;
const DEFAULT_MAX_FLIP_DELTA_PX = 520;
const SNAPSHOT_TTL_MS = 600;
const FLIP_MIN_DURATION_MS = 240;
const FLIP_MAX_DURATION_MS = 380;
/** Expo-Out（Apple/Linear 同款）：起手跟手无迟滞，末段超长柔刹，彻底消除急停顿挫。 */
const FLIP_EASING = 'cubic-bezier(0.16, 1, 0.3, 1)';
const SEAT_ENTERING_ATTR = 'data-dci-seat-entering';
const SEAT_SCALE_VAR = '--dci-seat-scale';

export type TransitionMode = 'normal' | 'float' | 'side';

export interface RectBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface DockCardDelta {
  dx: number;
  dy: number;
  scale: number;
}

interface ChatFlipSnapshot {
  anchor: HTMLElement;
  target: HTMLElement;
  scroller: HTMLElement | null;
  seat: HTMLElement;
  beforeTop: number;
  beforeSeatRect: RectBox;
  beforeToBottomEl: HTMLElement | null;
  beforeToBottomTop: number | null;
  floatingCardRect: RectBox | null;
  capturedAt: number;
}

interface ActiveTransition {
  epoch: number;
  rafId: number;
  observer: ResizeObserver | null;
  anims: Animation[];
  chatTarget: HTMLElement | null;
  toBottomEl: HTMLElement | null;
  seatEl: HTMLElement | null;
  cardEl: HTMLElement | null;
  veilEl: HTMLElement | null;
}

let pendingFlip: ChatFlipSnapshot | null = null;
let activeTransition: ActiveTransition | null = null;
let transitionEpoch = 0;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function readRectBox(el: Element): RectBox {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

/** 纯位移计算：忽略亚像素抖动与异常大跳变。 */
export function computeFlipDelta(
  beforeTop: number,
  afterTop: number,
  maxAbs: number = DEFAULT_MAX_FLIP_DELTA_PX,
): number {
  if (!Number.isFinite(beforeTop) || !Number.isFinite(afterTop)) return 0;
  const delta = beforeTop - afterTop;
  const abs = Math.abs(delta);
  if (abs < MIN_FLIP_DELTA_PX || abs > maxAbs) return 0;
  return delta;
}

/** 距离自适应时长（240–380ms）：小位移干脆、大位移（拉高编辑器）有充足缓冲。 */
export function computeFlipDuration(distancePx: number): number {
  if (!Number.isFinite(distancePx) || distancePx <= 0) return 260;
  return Math.round(clamp(220 + Math.sqrt(Math.abs(distancePx)) * 9, FLIP_MIN_DURATION_MS, FLIP_MAX_DURATION_MS));
}

/** 进入 normal 时 `composerSeat::before` 底板初始纵向缩放比（严格落在 (0, 1]，不产生溢出）。 */
export function computeSeatEnterScale(beforeHeight: number, afterHeight: number): number {
  if (!Number.isFinite(beforeHeight) || !Number.isFinite(afterHeight) || afterHeight <= 0) return 1;
  if (afterHeight - beforeHeight < MIN_FLIP_DELTA_PX) return 1;
  return clamp(Math.max(0, beforeHeight) / afterHeight, 0.02, 1);
}

/**
 * 悬浮归位（float → normal）卡片磁吸起止偏移：
 * 按中心 X + 顶边 Y 对齐；`dy` 上限钳至 `0`、`scale` 上限钳至 `1`（配合底缘原点），
 * 确保归位卡片动画期间绝不向下越出 `.composerSeat` 底边，避免撑大 `.scrollBody.scrollHeight`
 * 触发宿主二次跳滚。
 */
export function computeDockCardDelta(before: RectBox, after: RectBox): DockCardDelta | null {
  if (
    !Number.isFinite(before.left) ||
    !Number.isFinite(before.top) ||
    !Number.isFinite(before.width) ||
    !Number.isFinite(after.left) ||
    !Number.isFinite(after.top) ||
    !Number.isFinite(after.width) ||
    after.width <= 0
  ) {
    return null;
  }
  const beforeCx = before.left + before.width / 2;
  const afterCx = after.left + after.width / 2;
  const dx = clamp(beforeCx - afterCx, -320, 320);
  const dy = clamp(before.top - after.top, -280, 0);
  const scale = clamp(before.width / after.width, 0.92, 1);
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(scale - 1) < 0.01) return null;
  return { dx, dy, scale };
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function isScrollableY(el: HTMLElement): boolean {
  const oy = window.getComputedStyle(el).overflowY;
  return oy === 'auto' || oy === 'scroll' || oy === 'overlay';
}

function hasLayoutBox(el: HTMLElement): boolean {
  return window.getComputedStyle(el).display !== 'contents';
}

function clearActiveTransition(): void {
  const cur = activeTransition;
  if (!cur) return;
  activeTransition = null;
  if (cur.rafId !== 0) window.cancelAnimationFrame(cur.rafId);
  cur.observer?.disconnect();
  for (const anim of cur.anims) {
    try {
      anim.cancel();
    } catch {
      /* 忽略已结束动画的 cancel 异常 */
    }
  }
  if (cur.chatTarget) {
    cur.chatTarget.style.translate = '';
    cur.chatTarget.style.willChange = '';
  }
  if (cur.toBottomEl) {
    cur.toBottomEl.style.translate = '';
    cur.toBottomEl.style.willChange = '';
  }
  if (cur.seatEl) {
    cur.seatEl.removeAttribute(SEAT_ENTERING_ATTR);
    cur.seatEl.style.removeProperty(SEAT_SCALE_VAR);
  }
  if (cur.cardEl) {
    cur.cardEl.style.transform = '';
    cur.cardEl.style.transformOrigin = '';
    cur.cardEl.style.opacity = '';
    cur.cardEl.style.willChange = '';
  }
  if (cur.veilEl) {
    cur.veilEl.remove();
  }
}

/**
 * 解析聊天区 FLIP 目标容器（绝不命中 `display: contents` 的 slot 锚点）：
 * 1. 在共享滚动容器 `[data-conversation-scroll]` 下，从 `[data-chat-flow]` 向上找
 *    `overflow-y: clip` 的 `.root` 包装层——变换 `.root` 自身可避免正向位移被 `.root`
 *    裁切，同时不包裹同级 `TurnNavigator` 与回底浮动按钮（保持它们 `position: sticky`）；
 * 2. 若宿主结构不同，退回到 `[data-chat-flow]` 或独立滚动容器下第一个有盒子的内容根。
 */
function resolveFlipTarget(anchor: HTMLElement, seat: Element, scroller: HTMLElement | null): HTMLElement | null {
  if (scroller) {
    const flow = anchor.closest<HTMLElement>('[data-chat-flow]');
    const start = flow && scroller.contains(flow) && !flow.contains(seat) ? flow : anchor;
    let fallback: HTMLElement | null = hasLayoutBox(start) && !start.contains(seat) ? start : null;
    let cur: HTMLElement | null = start.parentElement;
    while (cur && cur !== scroller && cur !== document.body) {
      if (cur.contains(seat)) break;
      if (hasLayoutBox(cur)) {
        const cs = window.getComputedStyle(cur);
        // 命中宿主 ChatView `.root`（overflow-y: clip，单子包裹 .scroll）
        if (cs.overflowY === 'clip' && cur.childElementCount === 1) {
          return cur;
        }
        if (!fallback) fallback = cur;
      }
      cur = cur.parentElement;
    }
    return fallback;
  }

  // 非共享滚动容器（旧宿主/独立视图）：向上找不含 seat 的可滚容器，取其直接内容子层。
  let ownScroller: HTMLElement | null = null;
  let cur: HTMLElement | null = anchor.parentElement;
  while (cur && cur !== document.body) {
    if (!cur.contains(seat) && isScrollableY(cur)) {
      ownScroller = cur;
      break;
    }
    cur = cur.parentElement;
  }
  if (ownScroller) {
    let direct: HTMLElement | null = anchor;
    while (direct && direct.parentElement !== ownScroller) direct = direct.parentElement;
    if (direct && !direct.contains(seat) && hasLayoutBox(direct)) return direct;
  }

  // 兜底：最近一个有真实布局盒且不含 seat 的祖先。
  let parent = anchor.parentElement;
  while (parent && parent !== document.body) {
    if (!parent.contains(seat) && hasLayoutBox(parent)) return parent;
    parent = parent.parentElement;
  }
  return null;
}

/** 查找与聊天根层 `.root` 同级的回底浮动按钮容器（`.toBottomSlot`），不依赖构建哈希类名。 */
function findToBottomSlot(target: HTMLElement, seat: Element): HTMLElement | null {
  const next = target.nextElementSibling;
  if (!(next instanceof HTMLElement) || next.contains(seat)) return null;
  if (!next.querySelector('button')) return null;
  const pos = window.getComputedStyle(next).position;
  if (pos !== 'sticky' && pos !== 'absolute') return null;
  return next;
}

/** 查找与输入座同属一个会话面板、当前视口内最靠下的一条可见消息。 */
function findVisibleChatAnchor(
  seat: HTMLElement,
): { anchor: HTMLElement; scroller: HTMLElement | null } | null {
  const scroller = seat.closest<HTMLElement>('[data-conversation-scroll]');
  // Hero 新会话态或 composer overlay 视图（如 Trajectory）无常规聊天流，直接跳过。
  const contentRoot = seat.closest<HTMLElement>('[data-conversation-content]');
  if (contentRoot?.dataset.contentPhase === 'hero') return null;
  if (scroller?.querySelector('[data-conversation-composer-overlay]')) return null;

  const flow = scroller?.querySelector<HTMLElement>('[data-chat-flow]') ?? null;
  const searchRoot: ParentNode | null = flow ?? scroller ?? (() => {
    let pane: HTMLElement | null = seat.parentElement;
    for (let depth = 0; depth < 6 && pane && pane !== document.body; depth += 1) {
      if (pane.querySelector('[data-chat-flow-kind], [data-chat-group-key]')) return pane;
      pane = pane.parentElement;
    }
    return null;
  })();
  if (!searchRoot) return null;

  const items = searchRoot.querySelectorAll<HTMLElement>('[data-chat-flow-kind], [data-chat-group-key]');
  if (items.length === 0) return null;

  const vpRect = scroller?.getBoundingClientRect();
  const vpTop = vpRect ? vpRect.top : 0;
  const vpBottom = vpRect ? vpRect.bottom : window.innerHeight;
  const seatTop = seat.getBoundingClientRect().top;
  const visibleBottom = Math.min(vpBottom, seatTop > vpTop + 20 ? seatTop : vpBottom);

  let fallbackVisible: HTMLElement | null = null;
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const el = items[i];
    if (seat.contains(el) || el.hasAttribute('hidden')) continue;
    const r = el.getBoundingClientRect();
    if (r.height < 4) continue;
    if (r.bottom > vpTop && r.top < visibleBottom) {
      return { anchor: el, scroller };
    }
    if (!fallbackVisible && r.bottom > vpTop && r.top < vpBottom) {
      fallbackVisible = el;
    }
  }
  return fallbackVisible ? { anchor: fallbackVisible, scroller } : null;
}

/** 挂载退出 normal 时的瞬时底部幕布（仅当下方有被遮消息将瞬间露出时使用）。 */
function mountExitVeil(scrollerRect: RectBox, beforeSeatRect: RectBox, afterSeatRect: RectBox): {
  root: HTMLDivElement;
  inner: HTMLDivElement;
  height: number;
} | null {
  if (typeof document === 'undefined' || !document.body) return null;
  const height = Math.round(afterSeatRect.top - beforeSeatRect.top);
  if (height < 8 || scrollerRect.width <= 0) return null;
  const root = document.createElement('div');
  root.className = 'dci-chat-veil';
  root.setAttribute('aria-hidden', 'true');
  root.style.left = `${scrollerRect.left.toFixed(1)}px`;
  root.style.top = `${beforeSeatRect.top.toFixed(1)}px`;
  root.style.width = `${scrollerRect.width.toFixed(1)}px`;
  root.style.height = `${height}px`;

  const inner = document.createElement('div');
  inner.className = 'dci-chat-veil-inner';
  root.appendChild(inner);
  document.body.appendChild(root);
  return { root, inner, height };
}

/** 按会话 id 定位对应会话面板的 composerSeat（兼容主会话与嵌套会话）。 */
function resolveSeat(seatHint?: Element | null, sessionId?: string): HTMLElement | null {
  const fromHint = seatHint?.closest<HTMLElement>('[data-composer-seat]');
  if (fromHint) return fromHint;
  if (sessionId) {
    const panels = document.querySelectorAll<HTMLElement>('[data-conversation-session]');
    for (let i = 0; i < panels.length; i += 1) {
      if (panels[i].dataset.conversationSession === sessionId) {
        const seat = panels[i].querySelector<HTMLElement>('[data-composer-seat]');
        if (seat) return seat;
      }
    }
  }
  return document.querySelector<HTMLElement>('[data-composer-seat]');
}

/**
 * 切换前快照：在 `savePrefs` / `claimSidebarInput` / `carry.release` 之前调用。
 * 记录消息当前真实屏幕位置（若上次过渡未结束，getBoundingClientRect 自动含当前中间位，
 * 实现中途折返 0px 跳变），以及悬浮卡片、底栏、回底按钮的几何。
 */
export function captureChatFlip(seatHint?: Element | null, sessionId?: string): void {
  pendingFlip = null;
  if (typeof document === 'undefined' || prefersReducedMotion()) return;
  const seat = resolveSeat(seatHint, sessionId);
  if (!seat) return;
  const found = findVisibleChatAnchor(seat);
  if (!found) return;
  const target = resolveFlipTarget(found.anchor, seat, found.scroller);
  if (!target) return;

  const toBottomEl = findToBottomSlot(target, seat);
  // 优先读外层 .dci-float 未经 3D 透视投影的 2D 几何，保证开启 3D 悬浮时磁吸归位依然精准。
  const floatShell = document.querySelector<HTMLElement>('.dci-float');
  const floatingCard = floatShell?.querySelector('[data-composer-card="codinput"]') ? floatShell : null;

  pendingFlip = {
    anchor: found.anchor,
    target,
    scroller: found.scroller,
    seat,
    beforeTop: found.anchor.getBoundingClientRect().top,
    beforeSeatRect: readRectBox(seat),
    beforeToBottomEl: toBottomEl,
    beforeToBottomTop: toBottomEl ? toBottomEl.getBoundingClientRect().top : null,
    floatingCardRect: floatingCard ? readRectBox(floatingCard) : null,
    capturedAt: performance.now(),
  };
}

/**
 * 切换后编排：在 `CodinputBar` 的 `useLayoutEffect` 中调用（首帧绘制之前）。
 *
 * 1. 立即在首帧绘制前定格已知位移（退出 normal 时浏览器已同步 clamp scrollTop），
 *    并挂载一次性 `ResizeObserver` 紧跟宿主 `ChatViewport` / `seatObserver` 之后
 *    捕获异步 `scrollTop` 跟随与回底按钮位移，确保 Frame 0 零跳变、零闪动；
 * 2. 下一帧（CodeMirror 挂载与首帧绘制完毕，主线程空闲）统一用同一条 Expo-Out 曲线
 *    启动全部 GPU 合成层 WAAPI 动画。
 */
export function playChatFlip(fromMode?: TransitionMode, toMode?: TransitionMode): void {
  const snap = pendingFlip;
  pendingFlip = null;
  clearActiveTransition();
  if (!snap || typeof document === 'undefined' || prefersReducedMotion()) return;
  if (performance.now() - snap.capturedAt > SNAPSHOT_TTL_MS) return;
  if (!snap.anchor.isConnected || !snap.target.isConnected || !snap.seat.isConnected) return;

  const { anchor, target, scroller, seat, beforeTop, beforeSeatRect, beforeToBottomEl, beforeToBottomTop, floatingCardRect } = snap;
  if (window.getComputedStyle(target).translate !== 'none') return;

  const epoch = ++transitionEpoch;
  const maxAbs = Math.max(DEFAULT_MAX_FLIP_DELTA_PX, Math.round(window.innerHeight * 0.85));
  const afterSeatRect = readRectBox(seat);
  const seatDelta = afterSeatRect.height - beforeSeatRect.height;
  const enteringNormal = toMode === 'normal' || (toMode === undefined && seatDelta > MIN_FLIP_DELTA_PX);
  const leavingNormal = fromMode === 'normal' || (fromMode === undefined && seatDelta < -MIN_FLIP_DELTA_PX);

  const state: ActiveTransition = {
    epoch,
    rafId: 0,
    observer: null,
    anims: [],
    chatTarget: null,
    toBottomEl: null,
    seatEl: null,
    cardEl: null,
    veilEl: null,
  };
  activeTransition = state;

  const pinChat = (delta: number): void => {
    if (delta === 0) return;
    target.style.willChange = 'translate';
    target.style.translate = `0px ${delta.toFixed(1)}px`;
    state.chatTarget = target;
  };

  const pinToBottom = (): void => {
    if (!beforeToBottomEl || !beforeToBottomEl.isConnected || beforeToBottomTop === null) return;
    const prev = beforeToBottomEl.style.translate;
    if (prev) beforeToBottomEl.style.translate = '';
    const d = computeFlipDelta(beforeToBottomTop, beforeToBottomEl.getBoundingClientRect().top, maxAbs);
    if (d !== 0) {
      beforeToBottomEl.style.willChange = 'translate';
      beforeToBottomEl.style.translate = `0px ${d.toFixed(1)}px`;
      state.toBottomEl = beforeToBottomEl;
    } else if (prev) {
      beforeToBottomEl.style.willChange = '';
      if (state.toBottomEl === beforeToBottomEl) state.toBottomEl = null;
    }
  };

  // Frame 0 立即定格：退出 normal 时 scrollTop 已被浏览器同步钳制，此处立即钉回原位。
  const initialChatDelta = computeFlipDelta(beforeTop, anchor.getBoundingClientRect().top, maxAbs);
  pinChat(initialChatDelta);
  pinToBottom();

  // 进入 normal：底板渐变交由 ::before 从旧高度 scaleY 同步抬升，卡片按来源预置起飞位。
  // 卡片统一采用底缘原点（50% 100%）且不做正向向下位移，绝不撑大 .scrollBody.scrollHeight。
  let seatScale0 = 1;
  let cardStartTransform: string | null = null;
  let cardFadeIn = false;
  if (enteringNormal) {
    seatScale0 = computeSeatEnterScale(beforeSeatRect.height, afterSeatRect.height);
    if (seatScale0 < 0.99) {
      seat.setAttribute(SEAT_ENTERING_ATTR, 'true');
      seat.style.setProperty(SEAT_SCALE_VAR, seatScale0.toFixed(4));
      state.seatEl = seat;
    }
    const dockCard = seat.querySelector<HTMLElement>('[data-composer-card="codinput"]');
    if (dockCard) {
      if (fromMode === 'float' && floatingCardRect) {
        const cd = computeDockCardDelta(floatingCardRect, readRectBox(dockCard));
        if (cd) {
          cardStartTransform = `translate3d(${cd.dx.toFixed(1)}px, ${cd.dy.toFixed(1)}px, 0) scale(${cd.scale.toFixed(4)})`;
          dockCard.style.transformOrigin = '50% 100%';
          dockCard.style.willChange = 'transform';
          dockCard.style.transform = cardStartTransform;
          state.cardEl = dockCard;
        }
      } else if (fromMode === 'side') {
        cardStartTransform = 'scale(0.965)';
        cardFadeIn = true;
        dockCard.style.transformOrigin = '50% 100%';
        dockCard.style.willChange = 'transform, opacity';
        dockCard.style.transform = cardStartTransform;
        dockCard.style.opacity = '0';
        state.cardEl = dockCard;
      }
    }
  }

  // 退出 normal 且底部有被遮消息将直接露出（例如用户向上滚读历史，scrollTop 未被钳制）：
  // 挂载瞬时 GPU 幕布，随动画平滑向下拉开，避免底部 150px 消息生硬闪现。
  let veil: { root: HTMLDivElement; inner: HTMLDivElement; height: number } | null = null;
  if (leavingNormal && scroller) {
    const vacated = beforeSeatRect.height - afterSeatRect.height;
    if (vacated > Math.abs(initialChatDelta) + 8) {
      veil = mountExitVeil(readRectBox(scroller), beforeSeatRect, afterSeatRect);
      if (veil) state.veilEl = veil.root;
    }
  }

  let launched = false;
  const launchAnimations = (): void => {
    if (launched || activeTransition !== state) return;
    launched = true;
    if (state.rafId !== 0) {
      window.cancelAnimationFrame(state.rafId);
      state.rafId = 0;
    }
    state.observer?.disconnect();
    state.observer = null;
    if (!anchor.isConnected || !target.isConnected || !seat.isConnected) {
      clearActiveTransition();
      return;
    }

    // 临时清掉首帧定格，读取最终真实布局差值。
    target.style.translate = '';
    const chatDelta = computeFlipDelta(beforeTop, anchor.getBoundingClientRect().top, maxAbs);

    let btnDelta = 0;
    if (beforeToBottomEl && beforeToBottomEl.isConnected && beforeToBottomTop !== null) {
      beforeToBottomEl.style.translate = '';
      btnDelta = computeFlipDelta(beforeToBottomTop, beforeToBottomEl.getBoundingClientRect().top, maxAbs);
    }

    const latestSeatDelta = seat.getBoundingClientRect().height - beforeSeatRect.height;
    const distance = Math.max(Math.abs(chatDelta), Math.abs(latestSeatDelta), Math.abs(btnDelta));
    const duration = computeFlipDuration(distance);
    const timing: KeyframeAnimationOptions = { duration, easing: FLIP_EASING };

    const pushAnim = (el: Element, keyframes: Keyframe[], opts: KeyframeAnimationOptions = timing): void => {
      if (typeof el.animate !== 'function') return;
      try {
        state.anims.push(el.animate(keyframes, opts));
      } catch {
        /* 忽略不支持特定 WAAPI 选项的环境 */
      }
    };

    // 1. 聊天内容层平滑补位/让位
    if (chatDelta !== 0) {
      target.style.willChange = 'translate';
      state.chatTarget = target;
      pushAnim(target, [{ translate: `0px ${chatDelta.toFixed(1)}px` }, { translate: '0px 0px' }]);
    } else if (state.chatTarget === target) {
      target.style.willChange = '';
      state.chatTarget = null;
    }

    // 2. 回底浮动按钮同步升降
    if (beforeToBottomEl && btnDelta !== 0) {
      beforeToBottomEl.style.willChange = 'translate';
      state.toBottomEl = beforeToBottomEl;
      pushAnim(beforeToBottomEl, [{ translate: `0px ${btnDelta.toFixed(1)}px` }, { translate: '0px 0px' }]);
    } else if (state.toBottomEl) {
      state.toBottomEl.style.willChange = '';
      state.toBottomEl = null;
    }

    // 3. 进入 normal：composerSeat::before 渐变底板同步抬升
    if (state.seatEl && seatScale0 < 0.99) {
      seat.style.setProperty(SEAT_SCALE_VAR, '1');
      pushAnim(
        seat,
        [{ transform: `scaleY(${seatScale0.toFixed(4)})` }, { transform: 'scaleY(1)' }],
        { duration, easing: FLIP_EASING, pseudoElement: '::before' },
      );
    }

    // 4. 进入 normal：输入卡片磁吸 / 上浮入座
    if (state.cardEl && cardStartTransform) {
      const card = state.cardEl;
      card.style.transform = '';
      card.style.opacity = '';
      if (cardFadeIn) {
        pushAnim(card, [
          { transform: cardStartTransform, opacity: 0 },
          { transform: 'scale(1)', opacity: 1 },
        ]);
      } else {
        pushAnim(card, [
          { transform: cardStartTransform },
          { transform: 'translate3d(0px, 0px, 0px) scale(1)' },
        ]);
      }
    }

    // 5. 退出 normal：底部幕布向下拉开并淡出
    if (veil) {
      pushAnim(veil.inner, [
        { transform: 'translate3d(0px, 0px, 0px)', opacity: 1, offset: 0 },
        { transform: `translate3d(0px, ${(veil.height * 0.78).toFixed(1)}px, 0px)`, opacity: 0.72, offset: 0.65 },
        { transform: `translate3d(0px, ${veil.height.toFixed(1)}px, 0px)`, opacity: 0, offset: 1 },
      ]);
    }

    if (state.anims.length === 0) {
      clearActiveTransition();
      return;
    }

    void Promise.allSettled(state.anims.map((anim) => anim.finished)).then(() => {
      if (activeTransition === state && transitionEpoch === epoch) {
        clearActiveTransition();
      }
    });
  };

  // Frame 0/1 零闪动核心（HTML 渲染管线顺序：rAF → Layout → ResizeObserver → Paint）：
  // 本 ResizeObserver 晚于宿主 ChatViewport / seatObserver 注册，必在宿主于 Step 3
  // 跳完 scrollTop 与 --dsh-composer-height 之后、Step 4 Paint 之前触发！
  // 因此不能在首次 rAF（Step 1）提前 disconnect，必须等 ResizeObserver 先把首帧钉死
  // 再于下一帧 rAF（主线程空闲）起播全部 GPU 合成层动画。
  if (typeof ResizeObserver === 'function') {
    const ro = new ResizeObserver(() => {
      ro.disconnect();
      if (state.observer === ro) state.observer = null;
      if (launched || activeTransition !== state) return;
      if (!anchor.isConnected || !target.isConnected) {
        clearActiveTransition();
        return;
      }
      target.style.translate = '';
      const d = computeFlipDelta(beforeTop, anchor.getBoundingClientRect().top, maxAbs);
      if (d !== 0) {
        pinChat(d);
      } else if (state.chatTarget === target) {
        target.style.willChange = '';
        state.chatTarget = null;
      }
      pinToBottom();
      // 首帧已在 Paint 前钉死（0px 闪动），下一帧主线程空闲时统一起播 WAAPI。
      if (state.rafId !== 0) window.cancelAnimationFrame(state.rafId);
      state.rafId = window.requestAnimationFrame(() => {
        state.rafId = 0;
        launchAnimations();
      });
    });
    state.observer = ro;
    ro.observe(seat);
    // 兜底：若 ResizeObserver 两帧内未触发（如隐藏/无尺寸变动），第二帧自动起播不挂死。
    state.rafId = window.requestAnimationFrame(() => {
      if (launched || activeTransition !== state) return;
      state.rafId = window.requestAnimationFrame(() => {
        state.rafId = 0;
        launchAnimations();
      });
    });
  } else {
    state.rafId = window.requestAnimationFrame(() => {
      state.rafId = 0;
      launchAnimations();
    });
  }
}

/** 组件卸载或会话切换时清理残留快照与动画。 */
export function cancelChatFlip(): void {
  pendingFlip = null;
  clearActiveTransition();
}
