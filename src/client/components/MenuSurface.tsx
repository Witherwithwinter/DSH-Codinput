/** 官方 Menu 容器复刻：fixed 定位、锚点上方 4px、r20 卡片、视口约束。 */

import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';

export interface MenuSurfaceProps {
  /** 触发器矩形（getBoundingClientRect 快照）。 */
  anchor: { left: number; top: number; right: number; bottom: number };
  onClose(): void;
  children: ReactNode;
  /** 右对齐锚点（trailing 控件用）。 */
  alignEnd?: boolean;
  minWidth?: number;
  /** 弹出方向：top = 锚点上方（默认），bottom = 锚点下方（设置区下拉）。 */
  side?: 'top' | 'bottom';
}

export function MenuSurface(props: MenuSurfaceProps): JSX.Element {
  const { anchor, onClose, children, alignEnd, minWidth = 218, side = 'top' } = props;
  const ref = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let top: number;
    if (side === 'top') {
      top = Math.max(12, anchor.top - rect.height - 4);
      el.style.bottom = 'auto';
    } else {
      top = Math.min(window.innerHeight - rect.height - 12, anchor.bottom + 4);
      el.style.bottom = 'auto';
    }
    el.style.top = `${top}px`;
    let left = anchor.left;
    if (alignEnd) left = anchor.right - rect.width;
    left = Math.min(Math.max(12, left), window.innerWidth - rect.width - 12);
    el.style.left = `${left}px`;
  }, [anchor, alignEnd, side]);

  useEffect(() => {
    const onDown = (event: PointerEvent): void => {
      if (ref.current && event.target instanceof Node && ref.current.contains(event.target)) return;
      onClose();
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [onClose]);

  const below = side === 'bottom';
  return (
    <div
      ref={ref}
      className="dci-menu"
      style={
        below
          ? { top: anchor.bottom + 4, bottom: 'auto', ...(alignEnd ? { left: 'auto', right: window.innerWidth - anchor.right } : { left: anchor.left }), minWidth }
          : { left: anchor.left, bottom: window.innerHeight - anchor.top + 4, top: 'auto', ...(alignEnd ? { left: 'auto', right: window.innerWidth - anchor.right } : {}), minWidth }
      }
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
