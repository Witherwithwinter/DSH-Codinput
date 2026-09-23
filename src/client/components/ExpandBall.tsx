/**
 * 小球：侧栏收起后的 Codinput 唤出入口。
 *
 * 场景：输入入口在侧栏（形态 = side），用户把右侧栏收起——此时界面上
 * 没有任何输入入口。小球出现在**标题栏（会话头部）下方**的右上角空余处：
 * 与官方角落按钮同内缩（右侧 12px）右对齐，垂直贴着头部底边下沿 8px；
 * 头部尺寸/窗口变化时重测（左栏展开、分屏、窗口缩放都会带动）。点击 →
 * 展开右侧栏并聚焦 Codinput 标签，小球随承载态消失。
 *
 * 不占用官方任何槽位（早前版本接管 `conversation.session.header.corner`
 * 会顶掉官方侧栏展开按钮——已废弃）：小球由接管条目 portal 到 body，
 * 只在「侧栏承载且已收起」时存在，官方标题栏按钮原样保留。
 */

import { useEffect, useState, type JSX } from 'react';
import { createPortal } from 'react-dom';
import { stash } from '../services';
import { diagError } from '../diag';
import { useSidebarCarry } from '../sideinput';
import { SIDEBAR_TAB_KIND } from '../sidebar';
import { IconBrand } from '../icons';
import { t, useT } from '../i18n';

/** 球径（比官方角落按钮的 28px 大一档，置于内容之上需更显眼）。 */
const BALL_SIZE = 36;
/** 球内图标边长。 */
const BALL_ICON = 18;
/** 距标题栏右边缘的内缩（官方角落按钮为 12px，取同一值以对齐视觉基线）。 */
const HEADER_INSET = 12;
/** 与标题栏底边的间距。 */
const HEADER_GAP = 8;

/**
 * 标题栏元素：会话头部（`<header>` 带 role=banner）。优先语义角色，
 * 类名是构建哈希（wSkVaW_*）不可依赖。
 */
function headerElement(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="banner"]') ?? document.querySelector<HTMLElement>('header');
}

export function CodinputBall(props: { sessionId?: string }): JSX.Element | null {
  const { sessionId } = props;
  useT();
  const { carried, collapsed } = useSidebarCarry(sessionId);
  const active = carried && collapsed;
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    if (!active) {
      setPos(null);
      return;
    }
    const measure = (): void => {
      const rect = headerElement()?.getBoundingClientRect();
      if (!rect || rect.height === 0) return;
      const next = {
        left: Math.round(rect.right - HEADER_INSET - BALL_SIZE),
        top: Math.round(rect.bottom + HEADER_GAP),
      };
      setPos((prev) => (prev && prev.left === next.left && prev.top === next.top ? prev : next));
    };
    measure();
    const header = headerElement();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    if (header && observer) observer.observe(header);
    window.addEventListener('resize', measure);
    // 头部尚未挂载（会话切换/重挂载）时短轮询兜底，量到即停。
    const timer = window.setInterval(() => {
      if (!headerElement()) return;
      measure();
      window.clearInterval(timer);
    }, 250);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      window.clearInterval(timer);
    };
  }, [active]);

  if (!active || !pos) return null;
  return createPortal(
    <button
      type="button"
      className="dci-ball"
      data-codinput-expand="true"
      style={{ left: pos.left, top: pos.top }}
      aria-label={t("ball.label")}
      title={t("ball.title")}
      onClick={() => summonSidebarCodinput(sessionId)}
    >
      <IconBrand size={BALL_ICON} />
    </button>,
    document.body,
  );
}

/**
 * 唤回侧栏里的 Codinput：展开右侧栏 + 聚焦该标签。openTabIn 是语义路径
 * （放置/去重/聚焦/展开一次完成）；缺席时退回「仅展开」——侧栏上次激活
 * 的就是 Codinput，展开即露出。
 */
function summonSidebarCodinput(sessionId: string | undefined): void {
  const sidebar = stash.sidebarRight;
  if (!sidebar) return;
  try {
    if (sessionId && typeof sidebar.openTabIn === 'function') {
      sidebar.openTabIn(sessionId, SIDEBAR_TAB_KIND);
      return;
    }
    if (typeof sidebar.openTab === 'function') {
      sidebar.openTab(SIDEBAR_TAB_KIND);
      return;
    }
  } catch (error) {
    diagError('ball.openTab', error);
  }
  try {
    if (typeof sidebar.isExpanded === 'function' && !sidebar.isExpanded()) sidebar.toggleExpanded?.();
  } catch (error) {
    diagError('ball.expand', error);
  }
}
