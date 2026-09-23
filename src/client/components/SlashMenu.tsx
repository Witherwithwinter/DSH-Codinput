/**
 * '/' '@' 候选菜单：官方 MenuView 复刻。主模式为卡片顶部锚定的全宽
 * 浮层（absolute bottom calc(100%+4px)，随卡片等宽，max-height 320 随
 * 上方空间收缩）；侧栏形态（side）改为头部行下方**向下**弹出——卡片
 * 铺满面板后上方没有空间，向下弹才能留在卡片边界内不被面板裁剪；
 * crumbs 导航行在滚动区外；组标题按来源本地化（指令/技能/子智能体，
 * 未知来源显示原名），item.section 生成小节标题；pending 空组出骨架屏；
 * 拾取/悬停/面包屑/钻取全部路由回控制器（combobox 语义：
 * aria-activedescendant，焦点不离开编辑器）。卡片内指针按下不关闭。
 */

import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { t, tOptional } from '../i18n';
import type { InputTriggerController, MenuState } from '../host-types';
import { useSnapshot } from './useSnapshot';
import { IconChevronOfficial, IconFile, IconFolder, IconSearch } from '../icons';

export interface SlashMenuProps {
  triggers: InputTriggerController;
  /** 向下弹出（侧栏/悬浮形态）：菜单锚在头部行下方、留在卡片边界内。 */
  dropdown?: boolean;
}

/** 组标题按来源映射到 i18n；未知来源回退原名（与官方同语义）。 */
const MAX_HEIGHT = 320;

function sourceLabel(source: string): string {
  return tOptional(`menu.source.${source}`) ?? source;
}

function optionId(source: string, index: number): string {
  return `dsh-slash-option-${source}-${index}`;
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
  const { triggers, dropdown } = props;
  const menu = useSnapshot(triggers.menu) as MenuState | undefined;
  const headers = useSnapshot(triggers.headers);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [maxHeight, setMaxHeight] = useState(MAX_HEIGHT);
  /** 向下弹出时的菜单顶边（相对卡片顶；null = 向上弹出）。 */
  const [menuTop, setMenuTop] = useState<number | null>(null);

  const open = menu?.open === true;
  const highlight = open ? menu.highlight ?? null : null;

  // 可用空间收缩 max-height：向上弹出（主模式）菜单底边固定在卡片顶上方
  // 4px，可吃满卡片到视口顶的距离；向下弹出（侧栏/悬浮）菜单顶边固定在
  // 头部行下方，吃满卡片内头部行以下的距离——卡片靠视口顶时上方没有
  // 空间，向下弹才能留在视口与卡片边界内。
  useLayoutEffect(() => {
    if (!open) return;
    const card = rootRef.current?.closest('.dci-card');
    if (!card) return;
    if (dropdown) {
      const header = card.querySelector<HTMLElement>('.dci-accessory');
      const cardRect = card.getBoundingClientRect();
      const headerBottom = header
        ? header.getBoundingClientRect().bottom - cardRect.top
        : 36;
      setMenuTop(Math.round(headerBottom) + 2);
      // 侧栏吃满面板内剩余空间；悬浮卡可较小，吃满视口内剩余空间（可
      // 伸出卡片、不出视口）。
      const inFloat = !!rootRef.current?.closest('.dci-float');
      const budget = inFloat
        ? window.innerHeight - (cardRect.top + headerBottom) - 16
        : cardRect.height - headerBottom - 10;
      setMaxHeight(Math.max(120, Math.min(MAX_HEIGHT, budget)));
      return;
    }
    setMenuTop(null);
    const top = card.getBoundingClientRect().top;
    setMaxHeight(Math.max(120, Math.min(MAX_HEIGHT, top - 16)));
  }, [open, menu?.generation, dropdown]);

  // 高亮行滚动进视野（官方 scrollIntoView block nearest）。
  useEffect(() => {
    if (!highlight) return;
    document
      .getElementById(optionId(highlight.source, highlight.index))
      ?.scrollIntoView({ block: 'nearest' });
  }, [highlight]);

  // 外部指针按下关闭；卡片内（含工具行）不关闭（官方 dismiss 语义）。
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (!(event.target instanceof Node)) return;
      if (rootRef.current?.contains(event.target)) return;
      if (rootRef.current?.closest('[data-composer-card]')?.contains(event.target)) return;
      triggers.dismiss();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open, triggers]);

  if (!open || !menu) return null;

  const crumbsFor = (source: string) => headers?.get(source);

  return (
    <div
      ref={rootRef}
      className="dci-slash-menu"
      data-trigger-menu=""
      data-dropdown={dropdown || undefined}
      style={dropdown ? { top: menuTop ?? 38, maxHeight } : { maxHeight }}
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
}
