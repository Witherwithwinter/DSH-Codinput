/**
 * 接管条目：conversation.composer.bar（single，priority -1 遮蔽官方条目）。
 * 卸载本条目即官方输入框原样恢复（槽位体系一等机制），草稿不丢。
 * 另从 useChat 抽取轮次计时（模型用时 / TTFT），供数据行详情面板使用。
 *
 * 三态单实例（任一时刻恰好一个入口，且不与官方输入框共存）：
 * - `normal`：接管卡片在原输入位；
 * - `float`：卡片 portal 悬浮——拖工具行上方空白区移动（窗口式），
 *   拖边界/角落缩放；拖回底部输入区松手回 normal；
 * - `side`：输入由右侧栏 Codinput 标签承载（本条目渲染 null）——侧栏
 *   收起时**不让位**，入口仍是侧栏那一个（侧栏内隐藏），由右上角小球
 *   唤出（见 components/ExpandBall）。
 *
 * side 由 sideinput 总线的承载态派生（标签 body 挂载即承载），优先级
 * 高于持久化的 normal/float，因此不可能出现 side+float 并存或双实例。
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { SessionMaybeStandard, SlotRegisterOptions } from '../host-types';
import { loadPrefs, savePrefs, subscribePrefs, type CodinputPrefs } from '../prefs';
import { useSidebarInputCarried } from '../sideinput';
import { CodinputBall } from './ExpandBall';
import { CodinputSurface } from './CodinputSurface';

/** ComposerBarOwnerProps 切面（官方 bar owner）。 */
interface BarOwner {
  variant: 'hero' | 'composer';
  blocked?: { readonly reason: string };
  disabled?: boolean;
  placeholder?: string;
}

/** 槽位作用域里的 chat 会话钩子（ui-session chat 源贡献）。 */
type BarProps = BarOwner & SessionMaybeStandard & { useChat?: <S>(sel: (s: unknown) => S) => S };

export interface ChatTimings {
  /** 模型用时：全部步骤时长之和（毫秒）。 */
  modelMs?: number;
  /** 首 token 平均（TTFT）：以首步骤时长近似（毫秒）。 */
  ttftMs?: number;
}

/** 从 chat 树的节点缓存解析步骤计时（location.step.start/end）。 */
function computeTimings(valuesCache: unknown): ChatTimings {
  if (!Array.isArray(valuesCache)) return {};
  let modelMs = 0;
  let ttftSum = 0;
  let ttftCount = 0;
  for (const node of valuesCache) {
    const n = node as { kind?: string; location?: { step?: { start?: { time?: number }; end?: { time?: number } } } };
    if (n?.kind !== 'assistant-step') continue;
    const start = n.location?.step?.start?.time;
    const end = n.location?.step?.end?.time;
    if (start !== undefined && end !== undefined && end > start) {
      modelMs += end - start;
      ttftSum += end - start;
      ttftCount += 1;
    }
  }
  return { modelMs: modelMs > 0 ? modelMs : undefined, ttftMs: ttftCount > 0 ? ttftSum / ttftCount : undefined };
}

export function CodinputBar(props: BarProps): JSX.Element | null {
  const { variant, blocked, disabled, placeholder, sessionId, useInput, inputActions, useProjection, useChat } = props;
  const state = useInput((s) => s);
  // 选择器只取数组引用（稳定），计时换算放在 useMemo 里做。
  const valuesCache = useChat ? useChat((s: unknown) => (s as { nodes?: { valuesCache?: unknown } })?.nodes?.valuesCache) : undefined;
  const chatTimings = useMemo<ChatTimings>(() => computeTimings(valuesCache), [valuesCache]);
  const sideCarried = useSidebarInputCarried(sessionId);
  const [mode, setMode] = useState<CodinputPrefs['mode']>(() => loadPrefs().mode);
  useEffect(() => subscribePrefs(() => setMode(loadPrefs().mode)), []);
  // side 优先：侧栏标签承载本会话输入时，主输入（含悬浮卡片）整体让位；
  // 侧栏若已收起，则由标题栏下方的小球（portal）承担唯一入口。
  if (sideCarried) return <CodinputBall sessionId={sessionId} />;
  const floating = mode === 'float';
  const surface = (
    <CodinputSurface
      sessionId={sessionId}
      state={state}
      actions={inputActions}
      useProjection={useProjection}
      placeholder={placeholder}
      disabled={disabled === true || blocked !== undefined}
      hero={variant === 'hero'}
      chatTimings={chatTimings}
      float={floating}
      onDragZonePointerDown={beginFloatDrag}
    />
  );
  if (floating) return <FloatingShell>{surface}</FloatingShell>;
  return surface;
}

// ---------- 悬浮：跨重挂载的拖拽会话 + 悬浮壳（移动 + 八向缩放） ----------

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

/** 悬浮宽上限：视口内留边；小窗自适应。 */
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

/**
 * 拖拽会话：从普通模式拖出时卡片会重挂载（inline → portal），拖拽状态
 * 必须存模块级才能跨过那次重挂载继续跟手。位置通知走**模块级全局订阅**
 * （不挂在单次会话对象上——悬浮壳先于后续会话挂载，会话级订阅会让
 * 第二次以后的拖动收不到更新）；松手按落点 docking 或记忆悬浮位置。
 */
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
function beginFloatDrag(event: React.PointerEvent<HTMLDivElement>): void {
  if (event.button !== 0) return;
  const zone = event.currentTarget;
  const card = zone.closest('[data-composer-card]');
  const fromFloat = !!zone.closest('.dci-float');
  const cardRect = card?.getBoundingClientRect();
  const cardLeft = cardRect?.left ?? event.clientX;
  const cardTop = cardRect?.top ?? event.clientY;
  const width = cardRect?.width || Math.min(loadPrefs().floatW ?? FLOAT_DEFAULT_W, maxFloatW());
  const clampX = (x: number): number => clamp(x, FLOAT_MARGIN, Math.max(FLOAT_MARGIN, window.innerWidth - width - FLOAT_MARGIN));
  const clampY = (y: number): number => clamp(y, FLOAT_MARGIN, Math.max(FLOAT_MARGIN, window.innerHeight - 96));
  const grabDX = clampX(event.clientX - cardLeft);
  const grabDY = clampY(event.clientY - cardTop);
  event.preventDefault();
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
 * 与尺寸。八向把手 1:1 跟手缩放，缩放期间不动内容元素引用（React 对
 * 子树 bail-out，只有外壳尺寸在变）。
 */
function FloatingShell(props: { children: JSX.Element }): JSX.Element {
  const { children } = props;
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [geom, setGeom] = useState<FloatGeom>(() => {
    if (floatDrag) {
      const base = initialFloatGeom();
      return { ...base, x: floatDrag.lastX, y: floatDrag.lastY };
    }
    return initialFloatGeom();
  });
  /** 最新几何：缩放/移动的实时读数（不进 React 状态，避免闭包过期）。 */
  const geomRef = useRef(geom);
  geomRef.current = geom;

  // 拖拽位置走模块级全局订阅：悬浮壳可能先于后续拖拽会话挂载，稳定
  // 订阅保证任意一次会话的移动都能跟手（位置更新只碰包裹层，children
  // 元素引用不变，React 对子树 bail-out，不重渲染表面）。
  useLayoutEffect(() => {
    const onMove = (x: number, y: number): void => setGeom((prev) => ({ ...prev, x, y }));
    floatDragListeners.add(onMove);
    return () => {
      floatDragListeners.delete(onMove);
    };
  }, []);

  /** 窗口式缩放：按住边/角落 1:1 跟手；对边为锚点，窗口不越出视口、不小于下限。 */
  const beginResize = (dir: GripDir) =>
    (event: React.PointerEvent<HTMLDivElement>): void => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
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
      const onUp = (): void => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        const g = geomRef.current;
        savePrefs({ floatX: g.x, floatY: g.y, floatW: g.w, floatH: g.h });
      };
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        /* 合成事件无活动指针：window 监听兜底 */
      }
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    };

  // 渲染时夹取：窗口缩小后悬浮卡片不被推出视口（纵向沿用移动手势的
  // 「底部至少留 96px 在视口内」约定，不改动已验收的拖动行为）。
  const w = Math.min(geom.w, maxFloatW());
  const h = geom.h === null ? null : Math.min(geom.h, maxFloatH());
  const left = clamp(geom.x, FLOAT_MARGIN, Math.max(FLOAT_MARGIN, window.innerWidth - w - FLOAT_MARGIN));
  const top = clamp(geom.y, FLOAT_MARGIN, Math.max(FLOAT_MARGIN, window.innerHeight - 96));

  return createPortal(
    <div
      className="dci-float"
      ref={wrapRef}
      data-sized={h !== null ? 'true' : undefined}
      style={{ left, top, width: w, height: h ?? undefined, ['--dci-grip-edge' as string]: `${GRIP_EDGE}px`, ['--dci-grip-corner' as string]: `${GRIP_CORNER}px` }}
    >
      {children}
      {GRIP_DIRS.map((dir) => (
        <div key={dir} className="dci-float-grip" data-dir={dir} onPointerDown={beginResize(dir)} />
      ))}
    </div>,
    document.body,
  );
}

/** 注册选项（遮蔽条目必须 priority -1：升序最低者渲染）。 */
export function barRegistration(): { options: SlotRegisterOptions } {
  return {
    options: {
      name: 'conversation.composer.bar',
      priority: -1,
      registrant: 'dsh-codinput',
    },
  };
}
