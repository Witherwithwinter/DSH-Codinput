/**
 * 悬浮模式：跨重挂载的拖拽会话 + 悬浮壳（移动 + 八向缩放 + 视口变化自动夹取）。
 *
 * 从普通模式拖出时卡片会重挂载（inline → portal），拖拽会话保存在模块级以跨过
 * 重挂载继续跟手；位置通知走模块级订阅，只更新包裹层几何而不触碰 children 引用，
 * React 对子树 bail-out，拖动/缩放期间零重渲染。
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { loadPrefs, savePrefs } from '../prefs';

const FLOAT_MARGIN = 12;
const DETACH_THRESHOLD = 6;
/** 悬浮默认宽（未手动缩放时）；手动缩放后取 prefs.floatW。 */
const FLOAT_DEFAULT_W = 720;
/** 缩放下限/上限：与窗口一致的最小可用尺寸。 */
const FLOAT_MIN_W = 360;
const FLOAT_MIN_H = 140;
/** 缩放把手厚度（角落方块边长；边条厚度）。 */
const GRIP_EDGE = 6;
const GRIP_CORNER = 12;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** 悬浮宽/高上限：视口内留边；小窗自适应。 */
function maxFloatW(): number {
  return Math.max(FLOAT_MIN_W, window.innerWidth - FLOAT_MARGIN * 2);
}
function maxFloatH(): number {
  return Math.max(FLOAT_MIN_H, window.innerHeight - FLOAT_MARGIN * 2);
}

/** 悬浮尺寸（视口坐标 + px）。`h === null` = 高度随内容。 */
interface FloatGeom {
  x: number;
  y: number;
  w: number;
  h: number | null;
}

function initialFloatGeom(): FloatGeom {
  const prefs = loadPrefs();
  return {
    x: prefs.floatX ?? Math.round((window.innerWidth - Math.min(prefs.floatW ?? FLOAT_DEFAULT_W, maxFloatW())) / 2),
    y: prefs.floatY ?? Math.round(window.innerHeight * 0.16),
    w: prefs.floatW ?? FLOAT_DEFAULT_W,
    h: prefs.floatH,
  };
}

interface FloatDragSession {
  grabDX: number;
  grabDY: number;
  /** 已脱出为悬浮（越过起拖阈值）。 */
  detached: boolean;
  /** 从悬浮态开始拖（此时无脱出判定，直接跟手）。 */
  fromFloat: boolean;
  lastX: number;
  lastY: number;
}

let floatDrag: FloatDragSession | null = null;
const floatDragListeners = new Set<(x: number, y: number) => void>();

function notifyFloatDrag(x: number, y: number): void {
  for (const fn of floatDragListeners) fn(x, y);
}

/** 底部输入区（松手落点在其中 → 回普通模式）。 */
function dockZone(): { left: number; right: number; top: number; bottom: number } {
  const seat = document.querySelector('[data-composer-seat]');
  const r = seat?.getBoundingClientRect();
  const bottom = Math.min(window.innerHeight, (r?.bottom ?? window.innerHeight) + 120);
  const top = Math.max(0, bottom - 300);
  return {
    left: (r?.left ?? 0) - 40,
    right: (r?.right ?? window.innerWidth) + 40,
    top,
    bottom,
  };
}

/** 拖动区 pointerdown 入口：普通模式一拖脱出悬浮，悬浮模式拖回底部回普通。 */
export function beginFloatDrag(event: React.PointerEvent<HTMLDivElement>): void {
  if (event.button !== 0) return;
  const zone = event.currentTarget;
  const card = zone.closest('[data-composer-card]');
  const fromFloat = !!zone.closest('.dci-float');
  const cardRect = card?.getBoundingClientRect();
  const cardLeft = cardRect?.left ?? event.clientX;
  const cardTop = cardRect?.top ?? event.clientY;
  const width = cardRect?.width || Math.min(loadPrefs().floatW ?? FLOAT_DEFAULT_W, maxFloatW());
  const height = cardRect?.height || FLOAT_MIN_H;
  // clampX/clampY 约束的是「卡片在视口里的坐标」；grabDX/grabDY 是「指针相对卡片
  // 左上角的局部偏移」，两者坐标系不同，局部偏移必须按卡片尺寸夹取，否则抓右侧
  // 空白区起拖会让卡片瞬间跳偏。
  const clampX = (x: number): number => clamp(x, FLOAT_MARGIN, Math.max(FLOAT_MARGIN, window.innerWidth - width - FLOAT_MARGIN));
  const clampY = (y: number): number => clamp(y, FLOAT_MARGIN, Math.max(FLOAT_MARGIN, window.innerHeight - 96));
  const grabDX = clamp(event.clientX - cardLeft, 0, width);
  const grabDY = clamp(event.clientY - cardTop, 0, height);
  event.preventDefault();
  zone.dataset.dragging = 'true';
  const startX = event.clientX;
  const startY = event.clientY;
  const session: FloatDragSession = {
    grabDX,
    grabDY,
    detached: fromFloat,
    fromFloat,
    lastX: clampX(event.clientX - grabDX),
    lastY: clampY(event.clientY - grabDY),
  };
  const onMove = (e: PointerEvent): void => {
    if (!floatDrag) return;
    if (!session.detached) {
      if (Math.abs(e.clientX - startX) < DETACH_THRESHOLD && Math.abs(e.clientY - startY) < DETACH_THRESHOLD) return;
      session.detached = true;
      // 脱出：悬浮卡片以当前抓取偏移出现在指针下（prefs 驱动重挂载）。
      session.lastX = clampX(e.clientX - session.grabDX);
      session.lastY = clampY(e.clientY - session.grabDY);
      savePrefs({ mode: 'float', floatX: session.lastX, floatY: session.lastY });
      notifyFloatDrag(session.lastX, session.lastY);
      return;
    }
    session.lastX = clampX(e.clientX - session.grabDX);
    session.lastY = clampY(e.clientY - session.grabDY);
    notifyFloatDrag(session.lastX, session.lastY);
  };
  const onUp = (e: PointerEvent): void => {
    delete zone.dataset.dragging;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    floatDrag = null;
    if (!session.detached) return; // 原地轻点：无事发生
    const z = dockZone();
    if (e.clientX >= z.left && e.clientX <= z.right && e.clientY >= z.top && e.clientY <= z.bottom) {
      savePrefs({ mode: 'normal' }); // 拖回底部输入区：回普通模式（悬浮位置/尺寸保留）
      return;
    }
    savePrefs({ floatX: session.lastX, floatY: session.lastY });
  };
  floatDrag = session;
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
}

/** 缩放方向：边（n/s/e/w）与角落（组合）。 */
type GripDir = 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se';

const GRIP_DIRS: readonly GripDir[] = ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se'];

/**
 * 悬浮壳：portal 到 body 的固定定位卡片容器。挂载时若拖拽会话进行中
 * （刚从普通模式脱出）则订阅会话位置实时跟手；否则用 prefs 记忆的位置
 * 与尺寸。窗口缩放时自动重夹取，卸载时清掉任何进行中的缩放监听。
 */
export function FloatingShell(props: { children: JSX.Element }): JSX.Element {
  const { children } = props;
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const cleanupResizeRef = useRef<(() => void) | null>(null);
  const [geom, setGeom] = useState<FloatGeom>(() => {
    if (floatDrag) {
      const base = initialFloatGeom();
      return { ...base, x: floatDrag.lastX, y: floatDrag.lastY };
    }
    return initialFloatGeom();
  });
  const [, bumpViewport] = useState(0);
  /** 最新几何：缩放/移动的实时读数（不进 React 状态，避免闭包过期）。 */
  const geomRef = useRef(geom);
  geomRef.current = geom;

  // 拖拽位置走模块级全局订阅（只碰包裹层，children 元素引用不变，子树 bail-out）。
  useLayoutEffect(() => {
    const onMove = (x: number, y: number): void => setGeom((prev) => ({ ...prev, x, y }));
    floatDragListeners.add(onMove);
    return () => {
      floatDragListeners.delete(onMove);
    };
  }, []);

  // 浏览器窗口缩放时重跑夹取，防止悬浮卡片留在视口外。
  useEffect(() => {
    const onViewportResize = (): void => bumpViewport((n) => n + 1);
    window.addEventListener('resize', onViewportResize);
    return () => {
      window.removeEventListener('resize', onViewportResize);
      cleanupResizeRef.current?.();
      cleanupResizeRef.current = null;
    };
  }, []);

  /** 窗口式缩放：按住边/角落 1:1 跟手；对边为锚点，窗口不越出视口、不小于下限。 */
  const beginResize =
    (dir: GripDir) =>
    (event: React.PointerEvent<HTMLDivElement>): void => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      cleanupResizeRef.current?.();
      const start = geomRef.current;
      const shell = wrapRef.current;
      const rect = shell?.getBoundingClientRect();
      const startW = rect?.width ?? start.w;
      const startH = rect?.height ?? start.h ?? FLOAT_MIN_H;
      const startX = start.x;
      const startY = start.y;
      const right = startX + startW;
      const bottom = startY + startH;
      const pointerX = event.clientX;
      const pointerY = event.clientY;
      const onMove = (e: PointerEvent): void => {
        const dx = e.clientX - pointerX;
        const dy = e.clientY - pointerY;
        let w = startW;
        let h = startH;
        let x = startX;
        let y = startY;
        if (dir.includes('e')) w = clamp(startW + dx, FLOAT_MIN_W, Math.max(FLOAT_MIN_W, window.innerWidth - FLOAT_MARGIN - startX));
        if (dir.includes('w')) {
          x = clamp(startX + dx, FLOAT_MARGIN, right - FLOAT_MIN_W);
          w = right - x;
        }
        if (dir.includes('s')) h = clamp(startH + dy, FLOAT_MIN_H, Math.max(FLOAT_MIN_H, window.innerHeight - FLOAT_MARGIN - startY));
        if (dir.includes('n')) {
          y = clamp(startY + dy, FLOAT_MARGIN, bottom - FLOAT_MIN_H);
          h = bottom - y;
        }
        setGeom({ x, y, w: Math.round(w), h: Math.round(h) });
      };
      const detach = (): void => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        if (cleanupResizeRef.current === detach) cleanupResizeRef.current = null;
      };
      const onUp = (): void => {
        detach();
        const g = geomRef.current;
        savePrefs({ floatX: g.x, floatY: g.y, floatW: g.w, floatH: g.h });
      };
      cleanupResizeRef.current = detach;
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        /* 合成事件无活动指针：window 监听兜底 */
      }
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    };

  // 渲染时夹取：窗口缩小后悬浮卡片不被推出视口。
  const w = Math.min(geom.w, maxFloatW());
  const h = geom.h === null ? null : Math.min(geom.h, maxFloatH());
  const left = clamp(geom.x, FLOAT_MARGIN, Math.max(FLOAT_MARGIN, window.innerWidth - w - FLOAT_MARGIN));
  const top = clamp(geom.y, FLOAT_MARGIN, Math.max(FLOAT_MARGIN, window.innerHeight - 96));

  return createPortal(
    <div
      className="dci-float"
      ref={wrapRef}
      data-sized={h !== null ? 'true' : undefined}
      style={{
        left,
        top,
        width: w,
        height: h ?? undefined,
        ['--dci-grip-edge' as string]: `${GRIP_EDGE}px`,
        ['--dci-grip-corner' as string]: `${GRIP_CORNER}px`,
      }}
    >
      {children}
      {GRIP_DIRS.map((dir) => (
        <div key={dir} className="dci-float-grip" data-dir={dir} onPointerDown={beginResize(dir)} />
      ))}
    </div>,
    document.body,
  );
}
