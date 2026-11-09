/**
 * '/' '@' 候选菜单：官方 MenuView 复刻。两种形态：
 *
 * - normal（主输入）：卡片顶锚定的全宽浮层（absolute bottom: calc(100% + 4px)，
 *   随卡片等宽，max-height 400 随上方空间收缩）。0.3.9 已验收，几何不动。
 * - dropdown（侧栏/悬浮）：portal 到 body 的自适应 fixed 浮层。以 .dci-card 的
 *   实时矩形为不可覆盖区，在卡片上/下/左/右找空位：优先能完整容纳自然高度的
 *   一侧，按可用空间取最大；都放不下时把高度压到该侧空间（min 120 / max 400，
 *   菜单内 .dci-slash-viewport 滚动）。浮层与卡片不重叠——不遮输入区，也不
 *   挤压/重排卡片；打开期间用 rAF 复算（窗口 resize、侧栏宽度、悬浮卡拖动）。
 *
 * crumbs 导航行在滚动区外；组标题按来源本地化（指令/技能/子智能体，未知来源
 * 显示原名），item.section 生成小节标题；pending 空组出骨架屏；拾取/悬停/面包屑/
 * 钻取全部路由回控制器（combobox 语义：aria-activedescendant，焦点不离开编辑器）。
 * 卡片内指针按下不关闭（portal 后按保存的 .dci-card 元素判定，不用 DOM 祖先）。
 */

import { Fragment, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { t, tOptional } from '../i18n';
import type { InputTriggerController, MenuState } from '../host-types';
import { useSnapshot } from './useSnapshot';
import { IconChevronOfficial, IconFile, IconFolder, IconSearch } from '../icons';

export interface SlashMenuProps {
  triggers: InputTriggerController;
  /** true = 侧栏/悬浮形态：portal 到 body 的自适应浮层（卡片四周找空位）。 */
  dropdown?: boolean;
  /** 锚点卡片（.dci-card）引用：浮层定位与「卡片内按下不关闭」判定用。 */
  anchorRef?: RefObject<HTMLElement | null>;
}

/** 组标题按来源映射到 i18n；未知来源回退原名（与官方同语义）。 */
const MAX_HEIGHT = 400;
/** 放不下时压到的最小高度（菜单内滚动）。 */
const MIN_HEIGHT = 120;
/** 浮层与视口边缘的最小间距。 */
const VIEWPORT_MARGIN = 12;
/** 浮层与卡片的间距（与 normal 形态的 4px 一致）。 */
const CARD_GAP = 4;
/** 左/右侧位的宽度上限（卡片更宽时也不铺满）。 */
const SIDE_MAX_WIDTH = 360;
/** 左/右侧位可接受的最小宽度（低于此值视为该侧放不下）。 */
const SIDE_MIN_WIDTH = 180;

function sourceLabel(source: string): string {
  return tOptional(`menu.source.${source}`) ?? source;
}

function optionId(source: string, index: number): string {
  return `dsh-slash-option-${source}-${index}`;
}

function clampNumber(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/** dropdown 浮层的视口坐标（px，均为整数）。 */
interface DropdownPlacement {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
}

type PlacementSide = 'top' | 'bottom' | 'left' | 'right';

/** 一个方向的候选位；space = 该方向可用轴长（上/下=纵向，左/右=横向）。 */
interface PlacementCandidate {
  side: PlacementSide;
  space: number;
  /** 该方向能否完整容纳自然高度（左右位还要求宽度够）。 */
  fits: boolean;
  placement: DropdownPlacement;
}

/** 自然高度（内容高度，已按 MAX_HEIGHT 封顶；宽/窄两种宽度分别量）。 */
interface NaturalHeights {
  wide: number;
  side: number;
}

/**
 * 四个方向的候选位：上/下位与卡片同宽、水平对齐卡片；左/右位宽度取
 * min(卡片宽, 360) 且不超过该侧可用空间。
 */
function buildPlacementCandidates(cardRect: DOMRect, natural: NaturalHeights): PlacementCandidate[] {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const margin = VIEWPORT_MARGIN;
  const cardWidth = Math.max(0, Math.min(cardRect.width, vw - margin * 2));
  const sideMaxWidth = Math.min(cardWidth, SIDE_MAX_WIDTH);
  const alignedLeft = clampNumber(Math.round(cardRect.left), margin, Math.max(margin, vw - margin - cardWidth));
  /** 左/右位的顶边对齐卡片顶，再夹进视口。 */
  const sideTop = (height: number): number =>
    clampNumber(Math.round(cardRect.top), margin, Math.max(margin, vh - margin - height));
  /** 上/下位高度：够放自然高度就用自然高度，否则压到该侧空间（不低于 MIN_HEIGHT）。 */
  const verticalHeight = (space: number, wanted: number): number => {
    const naturalHeight = Math.min(MAX_HEIGHT, wanted);
    return naturalHeight <= space ? naturalHeight : Math.round(clampNumber(space, MIN_HEIGHT, MAX_HEIGHT));
  };
  /** 左/右位宽度：优先 min(卡片宽, 360) 与可用空间的较小者；太窄时退到最小宽度。 */
  const sideWidth = (space: number): number => {
    const preferred = Math.min(sideMaxWidth, Math.max(space, 0));
    return preferred >= SIDE_MIN_WIDTH
      ? preferred
      : Math.min(Math.max(sideMaxWidth, SIDE_MIN_WIDTH), SIDE_MIN_WIDTH);
  };

  const topSpace = cardRect.top - CARD_GAP - margin;
  const bottomSpace = vh - cardRect.bottom - CARD_GAP - margin;
  const topHeight = verticalHeight(topSpace, natural.wide);
  const bottomHeight = verticalHeight(bottomSpace, natural.wide);
  const sideSpace = vh - margin * 2;
  const sideHeight = verticalHeight(sideSpace, natural.side);
  const sideFits = Math.min(MAX_HEIGHT, natural.side) <= sideSpace;
  const leftSpace = cardRect.left - CARD_GAP - margin;
  const rightSpace = vw - cardRect.right - CARD_GAP - margin;
  const leftWidth = Math.round(sideWidth(leftSpace));
  const rightWidth = Math.round(sideWidth(rightSpace));

  return [
    {
      side: 'top',
      space: topSpace,
      fits: natural.wide <= topSpace,
      placement: {
        left: alignedLeft,
        top: Math.round(cardRect.top - CARD_GAP - topHeight),
        width: Math.round(cardWidth),
        maxHeight: topHeight,
      },
    },
    {
      side: 'bottom',
      space: bottomSpace,
      fits: natural.wide <= bottomSpace,
      placement: {
        left: alignedLeft,
        top: Math.round(cardRect.bottom + CARD_GAP),
        width: Math.round(cardWidth),
        maxHeight: bottomHeight,
      },
    },
    {
      side: 'left',
      space: leftSpace,
      fits: leftSpace >= SIDE_MIN_WIDTH && sideFits,
      placement: {
        left: Math.round(cardRect.left - CARD_GAP - leftWidth),
        top: sideTop(sideHeight),
        width: leftWidth,
        maxHeight: sideHeight,
      },
    },
    {
      side: 'right',
      space: rightSpace,
      fits: rightSpace >= SIDE_MIN_WIDTH && sideFits,
      placement: {
        left: Math.round(cardRect.right + CARD_GAP),
        top: sideTop(sideHeight),
        width: rightWidth,
        maxHeight: sideHeight,
      },
    },
  ];
}

/** 浮层整体夹进视口（左/上留 margin，右/下不出界；高度上限夹在 MAX_HEIGHT）。 */
function clampPlacementToViewport(placement: DropdownPlacement): DropdownPlacement {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const margin = VIEWPORT_MARGIN;
  const width = Math.round(clampNumber(placement.width, 0, Math.max(0, vw - margin * 2)));
  // 实际渲染高度 = min(自然高度, maxHeight)：条目少的小菜单自然高度可能 < MIN_HEIGHT，
  // 此时不能把 max-height 抬到最小高度——否则上/下位的 top 会按更大的高度夹取，
  // 反而把浮层推进卡片（MIN_HEIGHT 只在“空间不够、需要压缩”时由 verticalHeight 兼底）。
  const maxHeight = Math.round(clampNumber(placement.maxHeight, 1, MAX_HEIGHT));
  const left = Math.round(clampNumber(placement.left, margin, Math.max(margin, vw - margin - width)));
  const top = Math.round(clampNumber(placement.top, margin, Math.max(margin, vh - margin - maxHeight)));
  return { left, top, width, maxHeight };
}

/**
 * 四向选位：能完整容纳自然高度的方向里取可用空间最大的一侧（悬浮卡四周有空
 * 就选空最大且放得下的一侧；侧栏形态天然选左侧对话区）；都放不下时退最大化
 * 空间的一侧并夹进视口——极小窗口允许与卡片少量重叠，优先保住编辑区。
 */
function chooseDropdownPlacement(cardRect: DOMRect, natural: NaturalHeights): DropdownPlacement | null {
  const candidates = buildPlacementCandidates(cardRect, natural);
  if (candidates.length === 0) return null;
  const fitting = candidates.filter((candidate) => candidate.fits);
  const pool = fitting.length > 0 ? fitting : candidates;
  let best = pool[0];
  for (const candidate of pool) if (candidate.space > best.space) best = candidate;
  return clampPlacementToViewport(best.placement);
}

function candidateIcon(icon: unknown): JSX.Element | null {
  if (icon === 'file') return <IconFile size={16} />;
  if (icon === 'folder') return <IconFolder size={16} />;
  if (icon === 'session') return <IconSearch size={16} />;
  // 官方命令图标是 React 组件（primitives Icon*Outline16 同构），
  // 菜单按 <icon size={16}/> 渲染（官方 MenuView 同语义）。
  if (typeof icon === 'function') {
    const Comp = icon as React.ComponentType<{ size?: number }>;
    return <Comp size={16} />;
  }
  return null;
}

/** 右向 chevron（官方 IconChevronRightOutline14 的等价绘制）。 */
function ChevronRight({ size = 14 }: { size?: number }): JSX.Element {
  return (
    <span style={{ display: 'inline-flex', transform: 'rotate(-90deg)' }}>
      <IconChevronOfficial size={size} />
    </span>
  );
}

export function SlashMenu(props: SlashMenuProps): JSX.Element | null {
  const { triggers, dropdown, anchorRef } = props;
  const menu = useSnapshot(triggers.menu) as MenuState | undefined;
  const headers = useSnapshot(triggers.headers);
  const rootRef = useRef<HTMLDivElement | null>(null);
  /** normal 形态的 max-height（卡片上方空间）。 */
  const [maxHeight, setMaxHeight] = useState(MAX_HEIGHT);
  /** dropdown 形态的浮层几何；null = 首帧未测量（隐藏渲染，layout effect 内落位）。 */
  const [placement, setPlacement] = useState<DropdownPlacement | null>(null);
  const placementRef = useRef<DropdownPlacement | null>(null);
  /** 自然高度缓存：key = generation + 内容签名；宽度变化时重量。 */
  const naturalRef = useRef<{ key: string; wideWidth: number; sideWidth: number; wide: number; side: number } | null>(null);

  const open = menu?.open === true;
  const highlight = open ? menu.highlight ?? null : null;
  /** 内容签名：pending→ready、钻取/分组变化都按它触发重新测量。 */
  const menuKey = menu
    ? `${menu.generation}:${menu.groups.map((group) => `${group.source}:${group.status}:${group.items.length}`).join('|')}`
    : '';

  /** 定位锚点：优先外部传入的 .dci-card 引用（portal 后 DOM 祖先不可用）。 */
  const anchorCard = (): HTMLElement | null => {
    const anchored = anchorRef?.current ?? null;
    if (anchored) return anchored;
    if (!dropdown) return rootRef.current?.closest<HTMLElement>('.dci-card') ?? null;
    return document.querySelector<HTMLElement>('.dci-card');
  };

  // normal 形态：卡片顶上方浮层。0.3.9 已验收的取值原样保留
  // （max-height = min(400, 卡片顶到视口顶 - 16)）。
  useLayoutEffect(() => {
    if (!open || dropdown) return;
    const card = anchorCard();
    if (!card) return;
    const top = card.getBoundingClientRect().top;
    setMaxHeight(Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, top - 16)));
  }, [open, menu?.generation, dropdown]);

  // dropdown 形态：量自然高度 → 四向选位 → 内联几何；打开期间逐帧复算
  // （窗口 resize、侧栏宽度变化、悬浮卡拖动都会改变卡片/视口矩形）。
  useLayoutEffect(() => {
    if (!dropdown) return;
    if (!open) {
      naturalRef.current = null;
      placementRef.current = null;
      setPlacement(null);
      return;
    }
    const key = menuKey;
    let frame = 0;
    const apply = (next: DropdownPlacement | null): void => {
      const prev = placementRef.current;
      if (next === null) {
        if (prev !== null) {
          placementRef.current = null;
          setPlacement(null);
        }
        return;
      }
      if (
        prev !== null &&
        prev.left === next.left &&
        prev.top === next.top &&
        prev.width === next.width &&
        prev.maxHeight === next.maxHeight
      ) {
        return;
      }
      placementRef.current = next;
      setPlacement(next);
    };
    /** 临时放开 max-height 量自然高度；量完还原 React 托管的样式（不触发渲染）。 */
    const measureHeight = (el: HTMLElement, width: number): number => {
      const prevMaxHeight = el.style.maxHeight;
      const prevWidth = el.style.width;
      try {
        el.style.maxHeight = `${MAX_HEIGHT}px`;
        el.style.width = `${Math.max(1, Math.round(width))}px`;
        return Math.min(MAX_HEIGHT, Math.max(0, Math.round(el.getBoundingClientRect().height)));
      } finally {
        el.style.maxHeight = prevMaxHeight;
        el.style.width = prevWidth;
      }
    };
    const recalc = (): void => {
      const el = rootRef.current;
      const card = anchorCard();
      if (!el || !card) return;
      const cardRect = card.getBoundingClientRect();
      if (cardRect.width < 1 || cardRect.height < 1) {
        apply(null);
        return;
      }
      const wideWidth = Math.max(1, Math.min(cardRect.width, window.innerWidth - VIEWPORT_MARGIN * 2));
      const sideWidth = Math.max(1, Math.min(wideWidth, SIDE_MAX_WIDTH));
      const cached = naturalRef.current;
      let natural: NaturalHeights;
      if (
        cached &&
        cached.key === key &&
        Math.abs(cached.wideWidth - wideWidth) < 1 &&
        Math.abs(cached.sideWidth - sideWidth) < 1
      ) {
        natural = { wide: cached.wide, side: cached.side };
      } else {
        const wide = measureHeight(el, wideWidth);
        const side = Math.abs(sideWidth - wideWidth) < 1 ? wide : measureHeight(el, sideWidth);
        natural = { wide, side };
        naturalRef.current = { key, wideWidth, sideWidth, wide, side };
      }
      apply(chooseDropdownPlacement(cardRect, natural));
    };
    recalc();
    const tick = (): void => {
      recalc();
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [open, dropdown, menuKey]);

  // 高亮行滚动进视野（官方 scrollIntoView block nearest）。
  useEffect(() => {
    if (!highlight) return;
    document
      .getElementById(optionId(highlight.source, highlight.index))
      ?.scrollIntoView({ block: 'nearest' });
  }, [highlight]);

  // 外部指针按下关闭；卡片内（含工具行/拖动区）不关闭（官方 dismiss 语义）。
  // portal 后菜单已不在卡片 DOM 子树里，祖先查询失效——按保存的 .dci-card 元素判定。
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (!(event.target instanceof Node)) return;
      if (rootRef.current?.contains(event.target)) return;
      if (anchorCard()?.contains(event.target)) return;
      triggers.dismiss();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open, triggers]);

  if (!open || !menu) return null;

  const crumbsFor = (source: string) => headers?.get(source);
  const menuStyle: CSSProperties = dropdown
    ? placement
      ? { left: placement.left, top: placement.top, width: placement.width, maxHeight: placement.maxHeight }
      : { left: 0, top: 0, maxHeight: MAX_HEIGHT, visibility: 'hidden' }
    : { maxHeight };

  const menuNode = (
    <div
      ref={rootRef}
      className="dci-slash-menu"
      data-trigger-menu=""
      data-dropdown={dropdown || undefined}
      style={menuStyle}
    >
      {menu.groups.map((group) => {
        const trail = crumbsFor(group.source);
        if (trail === undefined || trail.length === 0) return null;
        return (
          <nav key={`${group.source}:crumbs`} className="dci-slash-crumbs" aria-label={t("menu.nav")}>
            {trail.map((crumb, index) => (
              <span key={`${index}-${crumb.value}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                {index > 0 ? (
                  <span className="dci-slash-crumbSeparator" aria-hidden="true">
                    <ChevronRight size={12} />
                  </span>
                ) : null}
                <button
                  type="button"
                  className="dci-slash-crumb"
                  data-current={crumb.current === true || undefined}
                  aria-current={crumb.current === true ? 'location' : undefined}
                  disabled={crumb.current === true}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    triggers.pickCrumb(group.source, index);
                  }}
                >
                  {crumb.label}
                </button>
              </span>
            ))}
          </nav>
        );
      })}
      <div
        className="dci-slash-viewport"
        role="listbox"
        aria-label={t("menu.triggerCandidates")}
        aria-activedescendant={highlight ? optionId(highlight.source, highlight.index) : undefined}
      >
        {menu.groups.map((group) => {
          if (group.status === 'ready' && group.items.length === 0) return null;
          const hasSections = group.items.some((item) => item.section !== undefined);
          return (
            <Fragment key={group.source}>
              {group.showGroupTitle === false || hasSections ? null : (
                <div className="dci-slash-groupTitle" role="presentation" data-source={group.source}>
                  {sourceLabel(group.source)}
                </div>
              )}
              {group.status === 'pending' && group.items.length === 0 ? (
                <div role="status" aria-label={tOptional("menu.loading")} data-source={group.source}>
                  <div className="dci-slash-skeletonRow">
                    <span className="dci-slash-skeletonBar" style={{ width: '32%' }} />
                  </div>
                  <div className="dci-slash-skeletonRow">
                    <span className="dci-slash-skeletonBar" style={{ width: '48%' }} />
                  </div>
                </div>
              ) : (
                group.items.map((item, index) => {
                  const active = highlight?.source === group.source && highlight.index === index;
                  return (
                    <Fragment key={optionId(group.source, index)}>
                      {item.section !== undefined && item.section !== group.items[index - 1]?.section ? (
                        <div className="dci-slash-sectionTitle" role="presentation">
                          {item.section}
                        </div>
                      ) : null}
                      <button
                        id={optionId(group.source, index)}
                        type="button"
                        role="option"
                        aria-selected={active}
                        className="dci-slash-item"
                        data-active={active || undefined}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          triggers.pick(group.source, index);
                        }}
                        onMouseMove={active ? undefined : () => triggers.hover(group.source, index)}
                      >
                        {item.icon !== undefined ? (
                          <span className="dci-slash-itemIcon" aria-hidden="true">
                            {candidateIcon(item.icon)}
                          </span>
                        ) : null}
                        {/* 官方语义：主名 = label ?? name；label 与 name 不同时另出灰色别名。 */}
                        <span className="dci-slash-itemName">{item.label ?? item.name}</span>
                        {item.label !== undefined && item.label.toLowerCase() !== item.name.toLowerCase() ? (
                          <span className="dci-slash-itemAlias">{item.name}</span>
                        ) : null}
                        {item.description !== undefined ? (
                          <span className="dci-slash-itemDescription">{item.description}</span>
                        ) : null}
                        {item.drill === true ? (
                          <span className="dci-slash-trailing">
                            <span className="dci-slash-drillHintText" aria-hidden="true">
                              进入目录
                            </span>
                            <kbd className="dci-slash-drillHint" aria-hidden="true">
                              Tab
                            </kbd>
                            <span
                              role="button"
                              aria-label={tOptional("menu.drill")}
                              className="dci-slash-drill"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                triggers.pick(group.source, index, 'drill');
                              }}
                            >
                              <ChevronRight size={14} />
                            </span>
                          </span>
                        ) : null}
                      </button>
                    </Fragment>
                  );
                })
              )}
            </Fragment>
          );
        })}
      </div>
    </div>
  );

  return dropdown ? createPortal(menuNode, document.body) : menuNode;
}
