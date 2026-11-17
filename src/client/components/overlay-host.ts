/**
 * 官方 overlay 座位的「自适应宿主」（float / side 形态）。
 *
 * 背景（0.5.0 架构）：官方 `conversation.input.overlay` 座位里的条目
 * （MenuView：`/` `@` 候选；PopupSelectView：`/model` `/permission` 等）
 * 都以「包含块顶边」为底边锚点（`position:absolute; bottom:calc(100% + 4px);
 * left:0; right:0`），并在内部用官方 `useAnchoredMaxHeight` 把最大高度
 * 钳到自身底边到视口顶之间——官方 InputBar 永远在视口底部，所以这套
 * 「向上长、只可能顶部越界」的假设成立。
 *
 * 但本插件有两处官方没有的形态：
 * - float：卡片是可拖动的悬浮窗，可以被拖到视口顶部——上方没有空间时
 *   官方钳制会把菜单压成 0 高（表现为「slash 面板不出来/位置不对」）；
 * - side：卡片铺满右侧栏 pane，官方绝对定位浮层被 pane 的 overflow 裁剪
 *   （表现为「/ 触发不了」）。
 *
 * 修法：不动官方条目的 DOM/CSS 语义，只把 overlay 锚点本身在 float/side
 * 形态下改成 `position:fixed` 的自适应宿主（仍在卡片 DOM 子树内——官方
 * 「点卡片内不关闭」的 `closest('[data-composer-card]')` 判定不受影响），
 * 由本 hook 逐帧量卡片矩形，在卡片上/下/左/右四个方向里选位：
 *
 * - 官方条目仍相对宿主「向上长」：宿主 top = 菜单底边 + 4px（CARD_GAP）。
 * - 选位规则沿用 0.4.x 自绘 SlashMenu 的验收算法：优先能完整容纳自然高度
 *   的方向、按该方向可用空间取最大；都放不下时把高度压到该侧空间
 *   （>= MIN_HEIGHT，菜单内滚动）。左/右侧位宽度 <= 360、>= 180。
 * - 内容自然高度按「宽位（卡片宽）/ 窄位（<=360）」分别测量，菜单内容
 *   （待加载 -> ready、查询过滤、钻取）变化时重测。
 * - 最终 menuTop 夹进视口（上下 margin），宽度夹进视口。
 *
 * 仅 |position:absolute| 的条目按「下拉浮层」处理；fixed/portal 类条目
 * （FeedbackDialog、RiskConfirmation 的 Modal 等）保持零尺寸宿主，不干预
 * 其自身定位。普通形态（normal）不启用本 hook，几何完全交给官方。
 *
 * 几何全部**直接写宿主 DOM 样式**（不走 React state）：悬浮卡片拖动时本
 * hook 每帧跟手，若每帧 setState 会把整个输入面重渲染一遍。
 */

import { useLayoutEffect, useRef, type RefObject } from 'react';

/** 浮层与视口边缘的最小间距（与官方 Menu portal / useAnchoredMaxHeight 同值）。 */
const VIEWPORT_MARGIN = 12;
/** 浮层与卡片的间距（官方 `.menu` `bottom: calc(100% + 4px)` 同值）。 */
const CARD_GAP = 4;
/** `/` `@` 候选菜单的设计高度上限（官方 MenuView MAX_HEIGHT）。 */
const MENU_MAX_HEIGHT = 400;
/** `/model` `/permission` 等 popupSelect 的设计高度上限（官方 PopupSelectView MAX_HEIGHT）。 */
const POPUP_MAX_HEIGHT = 320;
/** 空间不够、需要压缩时的最小高度（菜单内部滚动）。 */
const MIN_HEIGHT = 120;
/** 左/右侧位的宽度上限（与旧 SlashMenu 一致，过宽会盖住对话区大半）。 */
const SIDE_MAX_WIDTH = 360;
/** 左/右侧位可接受的最小宽度（低于此值视为该侧放不下）。 */
const SIDE_MIN_WIDTH = 180;

/** 菜单相对宿主的几何（均为视口坐标 / px）。 */
interface OverlayPlacement {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
}

/** 内容自然高度：宽位（卡片宽）与窄位（<= 360）分别测量。 */
interface NaturalHeights {
  wide: number;
  side: number;
  wideWidth: number;
  sideWidth: number;
  cap: number;
}

interface CardRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

type Side = 'top' | 'bottom' | 'left' | 'right';

interface Candidate {
  side: Side;
  space: number;
  fits: boolean;
  menuTop: number;
  placement: OverlayPlacement;
}

function clampNumber(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/** 内容自然高度按设计上限封顶。 */
function capNatural(value: number, cap: number): number {
  return Math.round(clampNumber(value, 1, cap));
}

/** 上下位高度：够放自然高度就用自然高度；不够压到该侧空间（不低于 MIN_HEIGHT）。 */
function verticalHeight(space: number, wanted: number): number {
  if (wanted <= space) return Math.round(wanted);
  return Math.round(clampNumber(space, MIN_HEIGHT, wanted));
}

/** 官方条目自身按「包含块顶边」定位；这里按测量结果算四向候选位。 */
function buildCandidates(card: CardRect, natural: NaturalHeights): Candidate[] {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const margin = VIEWPORT_MARGIN;
  const gap = CARD_GAP;
  const wideWidth = Math.round(clampNumber(card.width, 1, Math.max(1, vw - margin * 2)));
  const alignedLeft = Math.round(clampNumber(card.left, margin, Math.max(margin, vw - margin - wideWidth)));
  const topSpace = card.top - gap - margin;
  const bottomSpace = vh - card.bottom - gap - margin;
  const sideSpace = Math.max(0, vh - margin * 2);

  const topHeight = verticalHeight(topSpace, natural.wide);
  const bottomHeight = verticalHeight(bottomSpace, natural.wide);
  const sideHeight = verticalHeight(sideSpace, natural.side);
  const sideFits = Math.min(natural.side, natural.cap) <= sideSpace;

  const sideMaxWidth = Math.min(wideWidth, SIDE_MAX_WIDTH);
  const leftSpace = card.left - gap - margin;
  const rightSpace = vw - card.right - gap - margin;
  const sideWidth = (space: number): number => {
    const preferred = Math.min(sideMaxWidth, Math.max(space, 0));
    return preferred >= SIDE_MIN_WIDTH
      ? preferred
      : Math.min(Math.max(sideMaxWidth, SIDE_MIN_WIDTH), SIDE_MIN_WIDTH);
  };
  const leftWidth = Math.round(sideWidth(leftSpace));
  const rightWidth = Math.round(sideWidth(rightSpace));
  /** 左/右侧位的顶边对齐卡片顶，再夹进视口。 */
  const sideTop = (height: number): number =>
    Math.round(clampNumber(card.top, margin, Math.max(margin, vh - margin - height)));

  return [
    {
      side: 'top',
      space: topSpace,
      fits: Math.min(natural.wide, natural.cap) <= topSpace,
      menuTop: Math.round(card.top - gap - topHeight),
      placement: { left: alignedLeft, top: 0, width: wideWidth, maxHeight: topHeight },
    },
    {
      side: 'bottom',
      space: bottomSpace,
      fits: Math.min(natural.wide, natural.cap) <= bottomSpace,
      menuTop: Math.round(card.bottom + gap),
      placement: { left: alignedLeft, top: 0, width: wideWidth, maxHeight: bottomHeight },
    },
    {
      side: 'left',
      space: leftSpace,
      fits: leftSpace >= SIDE_MIN_WIDTH && sideFits,
      menuTop: sideTop(sideHeight),
      placement: {
        left: Math.round(card.left - gap - leftWidth),
        top: 0,
        width: leftWidth,
        maxHeight: sideHeight,
      },
    },
    {
      side: 'right',
      space: rightSpace,
      fits: rightSpace >= SIDE_MIN_WIDTH && sideFits,
      menuTop: sideTop(sideHeight),
      placement: {
        left: Math.round(card.right + gap),
        top: 0,
        width: rightWidth,
        maxHeight: sideHeight,
      },
    },
  ];
}

/**
 * 四向选位：能完整容纳自然高度的方向里取可用空间最大的一侧；都放不下时
 * 退到空间最大的一侧并压缩高度。菜单最终夹进视口；宿主 top = 菜单底边 +
 * CARD_GAP（官方条目自身以宿主顶边为底边锚点向上长）。
 */
function choosePlacement(card: CardRect, natural: NaturalHeights): OverlayPlacement & { side: Side } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const margin = VIEWPORT_MARGIN;
  const candidates = buildCandidates(card, natural);
  const fitting = candidates.filter((candidate) => candidate.fits);
  const pool = fitting.length > 0 ? fitting : candidates;
  let best = pool[0];
  for (const candidate of pool) if (candidate.space > best.space) best = candidate;

  const width = Math.round(clampNumber(best.placement.width, 1, Math.max(1, vw - margin * 2)));
  const maxHeight = Math.round(clampNumber(best.placement.maxHeight, 1, Math.max(1, vh - margin * 2)));
  const left = Math.round(
    clampNumber(best.placement.left, margin, Math.max(margin, vw - margin - width)),
  );
  // 官方条目向上长：菜单顶边 = 宿主 top - CARD_GAP - maxHeight；先夹 menuTop，
  // 再反推宿主 top，保证菜单整体在视口内。
  const menuTop = Math.round(
    clampNumber(best.menuTop, margin, Math.max(margin, vh - margin - maxHeight)),
  );
  return { left, top: menuTop + maxHeight + CARD_GAP, width, maxHeight, side: best.side };
}

/**
 * 官方下拉条目：绝对定位、带 bottom 锚点、且左右都贴包含块（MenuView 的
 * `.menu` 与 PopupSelectView 的 `.card` 都是 left:0; right:0）。收紧判据是
 * 为了不误伤第三方 overlay 条目里自定义绝对定位的浮层——非本形态的条目保持
 * 官方几何（宿主不接管）。
 */
function isDropdownEntry(element: Element): boolean {
  const style = window.getComputedStyle(element);
  return style.position === 'absolute'
    && style.bottom !== 'auto'
    && style.left === '0px'
    && style.right === '0px';
}

/**
 * 在指定宽度下量「可用内容高度」：把宿主的 max-height 变量设到设计上限再量——
 * 内容超过上限时结果就是上限（这正是选位需要的封顶高度），不必放开到 none；
 * 空查询的 `@` 文件列表可能上千行，放开测量会把整表拉进布局。
 */
function measureNaturalHeight(
  host: HTMLElement,
  entry: HTMLElement,
  width: number,
  cap: number,
): number {
  const previousWidth = host.style.width;
  const previousCap = host.style.getPropertyValue('--dci-overlay-maxh');
  try {
    host.style.width = `${Math.max(1, Math.round(width))}px`;
    host.style.setProperty('--dci-overlay-maxh', `${cap}px`);
    return capNatural(entry.getBoundingClientRect().height, cap);
  } finally {
    host.style.width = previousWidth;
    if (previousCap === '') host.style.removeProperty('--dci-overlay-maxh');
    else host.style.setProperty('--dci-overlay-maxh', previousCap);
  }
}

/** 设计高度上限：slash 候选菜单 400，popupSelect 320。 */
function designCap(entry: HTMLElement): number {
  return entry.hasAttribute('data-trigger-menu') ? MENU_MAX_HEIGHT : POPUP_MAX_HEIGHT;
}

/** 恢复宿主的「无浮层」状态（隐藏、零尺寸、清掉几何变量）。 */
function resetHost(host: HTMLElement): void {
  host.removeAttribute('data-mode');
  host.style.left = '0px';
  host.style.top = '0px';
  host.style.width = '0px';
  host.style.visibility = 'hidden';
  host.style.setProperty('--dci-overlay-maxh', `${MENU_MAX_HEIGHT}px`);
}

function samePlacement(a: OverlayPlacement | null, b: OverlayPlacement): boolean {
  return a !== null
    && Math.abs(a.left - b.left) < 1
    && Math.abs(a.top - b.top) < 1
    && Math.abs(a.width - b.width) < 1
    && Math.abs(a.maxHeight - b.maxHeight) < 1;
}

/**
 * 自适应 overlay 宿主（float / side 形态用，普通形态不调用/不启用）。
 *
 * 宿主打开官方 overlay 条目后逐帧量卡片矩形：卡片被拖动、窗口/侧栏尺寸变化、
 * 菜单内容变化都会重算四向选位；几何直接写宿主内联样式，不触发 React 重渲染。
 *
 * @param hostRef 官方 overlay 座位锚点（`.dci-overlay-anchor`）。
 * @param cardRef 卡片元素（`.dci-card`）：定位锚与避让区。
 * @param enabled 仅 float / side 形态启用；normal 不接管官方几何。
 */
export function useAdaptiveOverlayHost(
  hostRef: RefObject<HTMLElement | null>,
  cardRef: RefObject<HTMLElement | null>,
  enabled: boolean,
): void {
  /** 最近一次落地的几何（避免每帧重复写样式）。 */
  const appliedRef = useRef<OverlayPlacement | null>(null);
  /** 内容自然高度缓存：内容/宽度不变时复用。 */
  const naturalRef = useRef<NaturalHeights | null>(null);
  const modeRef = useRef<'dd' | 'plain' | 'idle'>('idle');

  useLayoutEffect(() => {
    // 普通形态：完全不动宿主（没有 data-adaptive，样式保持官方 in-card 几何）。
    if (!enabled) {
      appliedRef.current = null;
      naturalRef.current = null;
      modeRef.current = 'idle';
      return undefined;
    }
    const host = hostRef.current;
    if (!host) return undefined;

    let frame = 0;
    let disposed = false;
    let observer: MutationObserver | null = null;

    const setMode = (mode: 'dd' | 'plain' | 'idle'): void => {
      if (modeRef.current === mode) return;
      modeRef.current = mode;
      if (mode === 'idle') host.removeAttribute('data-mode');
      else host.dataset.mode = mode;
    };

    /** 每一次测量/落位：返回 true = 还有官方条目在渲染，需要继续逐帧跟随。 */
    const recalc = (): boolean => {
      if (disposed) return false;
      const card = cardRef.current;
      const children = Array.from(host.children) as HTMLElement[];
      const entry = children.find((child) => isDropdownEntry(child)) ?? null;
      if (entry === null) {
        if (children.length === 0) {
          // 座位为空（无官方条目/都渲染 null）：隐藏，等 MutationObserver 唤醒。
          setMode('idle');
          resetHost(host);
          delete host.dataset.placement;
          appliedRef.current = null;
          return false;
        }
        // 非下拉条目（固定/portal 弹窗，或第三方自定义绝对定位浮层）：不参与
        // 自适应选位，但宿主保持在「官方 in-card 锚点」处（卡片顶边、卡片宽），
        // 这样相对包含块解析的绝对定位条目仍按官方语义落位（不能被挪到视口原点）。
        setMode('plain');
        delete host.dataset.placement;
        let followCard = false;
        for (const child of children) {
          child.removeAttribute('data-dci-overlay-dd');
          if (window.getComputedStyle(child).position === 'absolute') followCard = true;
        }
        const plainCard = card === null ? null : card.getBoundingClientRect();
        if (plainCard !== null && plainCard.width >= 1 && plainCard.height >= 1) {
          host.style.left = `${Math.round(plainCard.left)}px`;
          host.style.top = `${Math.round(plainCard.top)}px`;
          host.style.width = `${Math.round(plainCard.width)}px`;
        } else {
          host.style.left = '0px';
          host.style.top = '0px';
          host.style.width = '0px';
        }
        host.style.visibility = 'visible';
        appliedRef.current = null;
        // 只有「相对包含块定位」的条目需要逐帧跟随卡片；纯 fixed/portal 弹窗
        // （反馈、风险确认等）不需要 60fps 循环，等 MutationObserver 唤醒即可。
        return followCard;
      }
      if (!card) {
        setMode('idle');
        resetHost(host);
        appliedRef.current = null;
        return true;
      }
      const cardRect = card.getBoundingClientRect();
      if (cardRect.width < 1 || cardRect.height < 1) {
        host.style.visibility = 'hidden';
        return true;
      }
      setMode('dd');
      // 官方 max-height 的 `!important` 覆盖只作用于下拉条目本身：给当前条目
      // 打标记，其它（如同时存在的 fixed 弹层）不被误伤。
      for (const child of children) {
        if (child === entry) child.setAttribute('data-dci-overlay-dd', '');
        else child.removeAttribute('data-dci-overlay-dd');
      }
      const cap = designCap(entry);
      const wideWidth = Math.min(cardRect.width, window.innerWidth - VIEWPORT_MARGIN * 2);
      const sideWidth = Math.min(wideWidth, SIDE_MAX_WIDTH);
      const cached = naturalRef.current;
      let natural: NaturalHeights;
      if (
        cached !== null
        && cached.cap === cap
        && Math.abs(cached.wideWidth - wideWidth) < 1
        && Math.abs(cached.sideWidth - sideWidth) < 1
      ) {
        natural = cached;
      } else {
        const wide = measureNaturalHeight(host, entry, wideWidth, cap);
        const side = Math.abs(sideWidth - wideWidth) < 1
          ? wide
          : measureNaturalHeight(host, entry, sideWidth, cap);
        natural = { wide, side, wideWidth, sideWidth, cap };
        naturalRef.current = natural;
      }
      const placement = choosePlacement(
        {
          left: cardRect.left,
          top: cardRect.top,
          right: cardRect.right,
          bottom: cardRect.bottom,
          width: cardRect.width,
          height: cardRect.height,
        },
        natural,
      );
      if (!samePlacement(appliedRef.current, placement)) {
        appliedRef.current = placement;
        // 诊断/验收口：当前选位方向（top/bottom/left/right）。
        host.dataset.placement = placement.side;
        host.style.left = `${placement.left}px`;
        host.style.top = `${placement.top}px`;
        host.style.width = `${placement.width}px`;
        host.style.setProperty('--dci-overlay-maxh', `${placement.maxHeight}px`);
        host.style.visibility = 'visible';
        // 悬浮 / 侧栏容器里若有 transform 类祖先，fixed 的包含块不再是视口；
        // 实测落点与目标视口坐标的偏差并回补（不依赖祖先结构，零配置）。
        const rect = host.getBoundingClientRect();
        const dx = Math.round(rect.left - placement.left);
        const dy = Math.round(rect.top - placement.top);
        if (Math.abs(dx) >= 1 || Math.abs(dy) >= 1) {
          host.style.left = `${placement.left - dx}px`;
          host.style.top = `${placement.top - dy}px`;
        }
      }
      return true;
    };

    const tick = (): void => {
      frame = 0;
      if (disposed) return;
      const occupied = recalc();
      if (occupied) frame = window.requestAnimationFrame(tick);
    };
    const schedule = (): void => {
      if (disposed || frame !== 0) return;
      frame = window.requestAnimationFrame(tick);
    };
    /** 内容变化（open/close、pending -> ready、查询过滤、钻取）：重测自然高度。 */
    const invalidate = (): void => {
      naturalRef.current = null;
      schedule();
    };

    observer = typeof MutationObserver === 'function'
      ? new MutationObserver(invalidate)
      : null;
    observer?.observe(host, { childList: true, subtree: true });
    window.addEventListener('resize', invalidate);
    resetHost(host);
    // 首次挂载：官方条目可能已经渲染（形态切换时菜单可能正开着），立即排一帧。
    schedule();

    return () => {
      disposed = true;
      if (frame !== 0) window.cancelAnimationFrame(frame);
      frame = 0;
      observer?.disconnect();
      window.removeEventListener('resize', invalidate);
      host.removeAttribute('data-mode');
      delete host.dataset.placement;
      appliedRef.current = null;
      naturalRef.current = null;
      modeRef.current = 'idle';
    };
  }, [enabled, hostRef, cardRef]);
}
