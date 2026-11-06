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
 * 锚点按元素实时读取：早期实现把 getBoundingClientRect 快照塞进 state，
 * 重算时读同一份快照，scroll/resize 监听等于空转——布局一变菜单就停在打开
 * 瞬间的位置（表现为「菜单飘到屏幕角落」）。现在每次 place 都读实时 rect，
 * 并在打开期间逐帧比对锚点位置，兜住「不触发 scroll/resize 的重排」。
 *
 * 滚动复刻官方两级结构：卡片 overflow:hidden +
 * max-height: min(360px, 100vh - 96px)，列表在 .dci-viewport 内滚，
 * 细滚动条由卡片注入的 --dsh-scrollbar-thumb(l2) 变量着色（官方
 * ModelSelect .menu 同款）。
 */

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface MenuSurfaceProps {
  /** 触发器元素：每次重算都读实时 rect，锚点移动后菜单跟随。 */
  anchor: HTMLElement | null;
  /**
   * 打开瞬间的锚点矩形。点击本身可能触发布局变化（输入框失焦、卡片换型），
   * layout effect 时读到的 rect 已不是用户点下去时看到的那个——首次定位优先
   * 用它，保证菜单位置与点击时的按钮重合。
   */
  initialRect?: { left: number; top: number; right: number; bottom: number } | null;
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

/** 锚点位移阈值（px）：小于它视为亚像素抖动，不重排菜单。 */
const SHIFT_THRESHOLD = 1;

export function MenuSurface(props: MenuSurfaceProps): JSX.Element {
  const { anchor, initialRect, onClose, children, alignEnd, minWidth = 218, side = 'top' } = props;
  const firstPlaceRef = useRef(true);
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !anchor) return;
    const place = (): void => {
      // 尺寸取 offset*（官方同款）：不受自身 top/left 变更反馈影响。
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      // 锚点尚未布局（或被隐藏）时不落位：宁可保持隐藏，也不写进一组
      // 没有视口约束的坐标（否则菜单会停在视口外，看起来「飘走」）。
      const rect = (firstPlaceRef.current && initialRect) || anchor.getBoundingClientRect();
      if (rect.right - rect.left === 0 || rect.bottom - rect.top === 0 || w === 0 || h === 0) return;
      firstPlaceRef.current = false;
      let x = alignEnd ? rect.right - w : rect.left;
      let y = side === 'top' ? rect.top - 8 - h : rect.bottom + 4;
      x = Math.min(Math.max(x, MARGIN), window.innerWidth - w - MARGIN);
      y = Math.min(Math.max(y, MARGIN), window.innerHeight - h - MARGIN);
      setPos((prev) => (prev && Math.abs(prev.left - x) < 0.5 && Math.abs(prev.top - y) < 0.5 ? prev : { left: x, top: y }));
    };
    place();
    // 内容换页/目录热更/滚动/视口变化都重定位——官方 place 的三路监听。
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(place) : null;
    observer?.observe(el);
    observer?.observe(anchor);

    // 布局重排可能既不产生 scroll 也不改窗口尺寸（输入框换型、分屏切换、
    // 会话区从空到有内容），上面的监听全都收不到信号。用低频轮询兜住这类
    // 变化：只有锚点位移超过阈值才重排——布局微抖时不跟随，否则菜单会跟着
    // 一帧帧地跳（表现为「来回跳」）。
    const start = anchor.getBoundingClientRect();
    let lastLeft = start.left;
    let lastTop = start.top;
    let raf = 0;
    const tick = (): void => {
      const r = anchor.getBoundingClientRect();
      if (Math.abs(r.left - lastLeft) > SHIFT_THRESHOLD || Math.abs(r.top - lastTop) > SHIFT_THRESHOLD) {
        lastLeft = r.left;
        lastTop = r.top;
        place();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      observer?.disconnect();
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [anchor, alignEnd, side]);

  useEffect(() => {
    const onDown = (event: PointerEvent): void => {
      if (ref.current && event.target instanceof Node && ref.current.contains(event.target)) return;
      // 落在触发器上时不要在这里关：pointerdown 先于 click，先关掉会让触发器
      // 自己的 onClick 读到 open=false 又开回来，表现为「点一次收不起来」。
      // 开合交给触发器的 onClick 统一 toggle。
      if (anchor && event.target instanceof Node && anchor.contains(event.target)) return;
      onClose();
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [anchor, onClose]);

  // 未定位的首帧隐藏但仍参与布局（官方 unplaced card 同款）——place() 在
  // layout effect 里同步测得尺寸后即落位，无闪烁。
  // 必须 portal 到 body：祖先链上的 transform / filter / backdrop-filter /
  // contain 会把 position:fixed 的包含块从视口换成该祖先，left/top 便按它的
  // 坐标系解释，菜单整体偏移到别处（实测能偏出 400px+，看起来「飘到角落」）。
  // 官方数据行面板同样走 createPortal(document.body)。
  return createPortal(
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
    </div>,
    document.body,
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
