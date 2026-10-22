/**
 * 官方 Menu 容器复刻：fixed 定位、锚点上方弹出、r20 卡片、视口约束。
 *
 * 定位复刻官方 ModelSelect 的 place()：
 *   y = anchor.top - 8 - h（side=top）/ anchor.bottom + 4（side=bottom），
 *   x/y 各夹进 [12, innerWidth - w - 12] / [12, innerHeight - h - 12]。
 * place 随**内容尺寸每次变化**重跑（ResizeObserver 挂卡片本体）+ 页面
 * scroll/resize 重跑——官方同款监听。旧实现只在打开瞬间定位一次，钻入
 * 更长的子页（模型/推理强度列表）时卡片保持小菜单的 top 向下生长，
 * 表现为「向下弹出」且列表伸出视口外够不着。
 *
 * 滚动复刻官方两级结构：卡片 overflow:hidden +
 * max-height: min(360px, 100vh - 96px)，列表在 .dci-viewport 内滚，
 * 细滚动条由卡片注入的 --dsh-scrollbar-thumb(l2) 变量着色（官方
 * ModelSelect .menu 同款）。
 */

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export interface MenuSurfaceProps {
  /** 触发器矩形（getBoundingClientRect 快照）。 */
  anchor: { left: number; top: number; right: number; bottom: number };
  onClose(): void;
  children: ReactNode;
  /** 右对齐锚点（trailing 控件用）。 */
  alignEnd?: boolean;
  minWidth?: number;
  /** 弹出方向：top = 锚点上方（默认，官方 ModelSelect/Menu 同款），bottom = 锚点下方（设置区下拉）。 */
  side?: 'top' | 'bottom';
}

/** 官方 place() 的视口留距。 */
const MARGIN = 12;

export function MenuSurface(props: MenuSurfaceProps): JSX.Element {
  const { anchor, onClose, children, alignEnd, minWidth = 218, side = 'top' } = props;
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const place = (): void => {
      // 尺寸取 offset*（官方同款）：不受自身 top/left 变更反馈影响。
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      let x = alignEnd ? anchor.right - w : anchor.left;
      let y = side === 'top' ? anchor.top - 8 - h : anchor.bottom + 4;
      if (w > 0) x = Math.min(Math.max(x, MARGIN), window.innerWidth - w - MARGIN);
      if (h > 0) y = Math.min(Math.max(y, MARGIN), window.innerHeight - h - MARGIN);
      setPos((prev) => (prev && prev.left === x && prev.top === y ? prev : { left: x, top: y }));
    };
    place();
    // 内容换页/目录热更/滚动/视口变化都重定位——官方 place 的三路监听。
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(place) : null;
    observer?.observe(el);
    return () => {
      observer?.disconnect();
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [anchor, alignEnd, side]);

  useEffect(() => {
    const onDown = (event: PointerEvent): void => {
      if (ref.current && event.target instanceof Node && ref.current.contains(event.target)) return;
      onClose();
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [onClose]);

  // 未定位的首帧隐藏但仍参与布局（官方 unplaced card 同款）——place() 在
  // layout effect 里同步测得尺寸后即落位，无闪烁。
  return (
    <div
      ref={ref}
      className="dci-menu"
      style={{
        left: pos?.left ?? 0,
        top: pos?.top ?? 0,
        bottom: 'auto',
        right: 'auto',
        minWidth,
        ...(pos ? null : { visibility: 'hidden' }),
      }}
    >
      <div className="dci-viewport">{children}</div>
    </div>
  );
}

/** 官方菜单项选中勾（描边勾，14-16）。 */
export function MenuCheck({ size = 16 }: { size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 8.5L6.5 12L13 4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
