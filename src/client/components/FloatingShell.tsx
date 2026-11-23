/**
 * 悬浮模式：跨重挂载的拖拽会话 + 悬浮壳（移动 + 八向缩放 + 视口变化自动夹取）。
 *
 * 从普通模式拖出时卡片会重挂载（inline → portal），拖拽会话保存在模块级以跨过
 * 重挂载继续跟手；位置通知走模块级订阅，只更新包裹层几何而不触碰 children 引用，
 * React 对子树 bail-out，拖动/缩放期间零重渲染。
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { loadPrefs, savePrefs, usePref, type CodinputPrefs } from '../prefs';
import { t, useT } from '../i18n';
import {
  computeDockVisualBox,
  computeDockZone,
  isPointInDockZone,
  resolveDockHintPhase,
  resolveReleaseOutcome,
  type DockHintPhase,
  type DockRect,
  type DockVisualBox,
  type DragReleaseOutcome,
} from '../float-dock';
import { captureChatFlip } from '../float-flip';
import {
  applyFloat3dPose,
  clearFloat3dPose,
  computeSphericalTarget,
  createFloat3dState,
  poseFromState,
  recordDragVelocity,
  stepFloat3dSpring,
  type Float3dBox,
  type Float3dViewport,
} from '../float3d';

const selectFloat3d = (p: CodinputPrefs): boolean => p.float3d;
/** 悬浮态起拖后移动超过该距离再显示底部归位区，避免原地轻点空白区闪烁提示。 */
const HINT_REVEAL_THRESHOLD = 3;
/** 脱出/归位卡片脉冲反馈时长（ms）。 */
const FLASH_DURATION_MS = 320;

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
  /** 指针已实际移动（悬浮态轻点不弹出归位区提示）。 */
  moved: boolean;
  /** 本次拖动是否曾离开过底部归位区（区分「刚向上拉出」与「拖回吸附」）。 */
  leftDockOnce: boolean;
  lastX: number;
  lastY: number;
}

interface DockHintSnapshot {
  phase: DockHintPhase;
  box: DockVisualBox;
}

type ModeFeedbackEvent = Exclude<DragReleaseOutcome, 'move-float'>;

let floatDrag: FloatDragSession | null = null;
let currentDockHint: DockHintSnapshot | null = null;
const floatDragListeners = new Set<(x: number, y: number) => void>();
const floatDragStateListeners = new Set<(dragging: boolean) => void>();
const dockHintListeners = new Set<(hint: DockHintSnapshot | null) => void>();
const modeFeedbackListeners = new Set<(event: ModeFeedbackEvent) => void>();

function notifyFloatDrag(x: number, y: number): void {
  for (const fn of floatDragListeners) fn(x, y);
}

function notifyFloatDragState(dragging: boolean): void {
  for (const fn of floatDragStateListeners) fn(dragging);
}

function setDockHint(next: DockHintSnapshot | null): void {
  if (
    currentDockHint === next ||
    (currentDockHint !== null &&
      next !== null &&
      currentDockHint.phase === next.phase &&
      currentDockHint.box.left === next.box.left &&
      currentDockHint.box.top === next.box.top &&
      currentDockHint.box.width === next.box.width &&
      currentDockHint.box.height === next.box.height)
  ) {
    return;
  }
  currentDockHint = next;
  for (const fn of dockHintListeners) fn(next);
}

function emitModeFeedback(event: ModeFeedbackEvent): void {
  for (const fn of modeFeedbackListeners) fn(event);
}

/** 量取底部归位命中区 + 可见落区轮廓（两者同源；虚框避让原地常驻的底部状态栏）。 */
function measureDock(): { zone: DockRect; visual: DockVisualBox } {
  const seat = document.querySelector('[data-composer-seat]');
  const r = seat?.getBoundingClientRect();
  const seatRect: DockRect | null = r ? { left: r.left, right: r.right, top: r.top, bottom: r.bottom } : null;
  const statsEl =
    seat?.querySelector<HTMLElement>('[data-composer-stats="codinput"]') ??
    document.querySelector<HTMLElement>('[data-composer-stats="codinput"]');
  const sr = statsEl?.getBoundingClientRect();
  const statsTop = sr && sr.height > 0 ? sr.top : null;
  const zone = computeDockZone(seatRect, window.innerWidth, window.innerHeight);
  const visual = computeDockVisualBox(seatRect, zone, window.innerWidth, window.innerHeight, statsTop);
  return { zone, visual };
}

/** 拖动区 pointerdown 入口：普通模式一拖脱出悬浮，悬浮模式拖回底部回普通。 */
export function beginFloatDrag(event: React.PointerEvent<HTMLDivElement>): void {
  if (event.button !== 0) return;
  const zone = event.currentTarget;
  const card = zone.closest('[data-composer-card]');
  const shell = zone.closest('.dci-float');
  const fromFloat = !!shell;
  // 悬浮态读外层 .dci-float 的未变换几何（3D 旋转只加在内层 .dci-float-stage，
  // 若读 card 的投影外接框会导致起拖瞬间跳偏）。
  const anchorRect = (fromFloat ? shell : card)?.getBoundingClientRect();
  const cardLeft = anchorRect?.left ?? event.clientX;
  const cardTop = anchorRect?.top ?? event.clientY;
  const width = anchorRect?.width || Math.min(loadPrefs().floatW ?? FLOAT_DEFAULT_W, maxFloatW());
  const height = anchorRect?.height || FLOAT_MIN_H;
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
  const initialDock = measureDock();
  const initialInDock = isPointInDockZone(startX, startY, initialDock.zone);
  const session: FloatDragSession = {
    grabDX,
    grabDY,
    detached: fromFloat,
    fromFloat,
    moved: false,
    leftDockOnce: fromFloat ? !initialInDock : false,
    lastX: clampX(event.clientX - grabDX),
    lastY: clampY(event.clientY - grabDY),
  };
  const syncDockHint = (clientX: number, clientY: number): void => {
    const { zone: dockRect, visual } = measureDock();
    const inDock = isPointInDockZone(clientX, clientY, dockRect);
    if (!inDock) session.leftDockOnce = true;
    const phase = resolveDockHintPhase(session.fromFloat, inDock, session.leftDockOnce);
    setDockHint({ phase, box: visual });
  };
  const onMove = (e: PointerEvent): void => {
    if (!floatDrag) return;
    if (!session.detached) {
      if (Math.abs(e.clientX - startX) < DETACH_THRESHOLD && Math.abs(e.clientY - startY) < DETACH_THRESHOLD) return;
      session.detached = true;
      session.moved = true;
      // 脱出：先截取聊天锚点用于 GPU FLIP 平滑衔接，再由 prefs 驱动重挂载为悬浮窗。
      session.lastX = clampX(e.clientX - session.grabDX);
      session.lastY = clampY(e.clientY - session.grabDY);
      captureChatFlip(zone);
      savePrefs({ mode: 'float', floatX: session.lastX, floatY: session.lastY });
      notifyFloatDragState(true);
      notifyFloatDrag(session.lastX, session.lastY);
      syncDockHint(e.clientX, e.clientY);
      return;
    }
    if (!session.moved && (Math.abs(e.clientX - startX) >= HINT_REVEAL_THRESHOLD || Math.abs(e.clientY - startY) >= HINT_REVEAL_THRESHOLD)) {
      session.moved = true;
    }
    session.lastX = clampX(e.clientX - session.grabDX);
    session.lastY = clampY(e.clientY - session.grabDY);
    notifyFloatDrag(session.lastX, session.lastY);
    if (session.moved) syncDockHint(e.clientX, e.clientY);
  };
  const onUp = (e: PointerEvent): void => {
    delete zone.dataset.dragging;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    floatDrag = null;
    notifyFloatDragState(false);
    setDockHint(null);
    if (!session.detached) return; // 原地轻点：无事发生
    const { zone: dockRect } = measureDock();
    const inDock = isPointInDockZone(e.clientX, e.clientY, dockRect);
    const outcome = resolveReleaseOutcome(session.fromFloat, inDock);
    if (outcome === 'dock' || outcome === 'cancel-detach') {
      captureChatFlip();
      savePrefs({ mode: 'normal' }); // 拖回底部输入区：回普通模式（悬浮位置/尺寸保留）
      emitModeFeedback(outcome);
      return;
    }
    savePrefs({ floatX: session.lastX, floatY: session.lastY });
  };
  floatDrag = session;
  if (fromFloat) notifyFloatDragState(true);
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
  const float3d = usePref(selectFloat3d);
  useT();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const cleanupResizeRef = useRef<(() => void) | null>(null);
  const prevFloat3dRef = useRef(float3d);
  const kick3dRef = useRef<(() => void) | null>(null);
  const [dockHint, setDockHintState] = useState<DockHintSnapshot | null>(() => currentDockHint);
  const [detachFlash, setDetachFlash] = useState<boolean>(() => floatDrag !== null && !floatDrag.fromFloat);
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

  // 刚从普通模式脱出时的瞬时脉冲提示，播完即收起。
  useEffect(() => {
    if (!detachFlash) return undefined;
    const timer = window.setTimeout(() => setDetachFlash(false), FLASH_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [detachFlash]);

  // 订阅底部归位区离散状态（只在进入/离开归位区时更新，拖动热路径零额外重渲染）。
  useLayoutEffect(() => {
    const onHint = (hint: DockHintSnapshot | null): void => setDockHintState(hint);
    dockHintListeners.add(onHint);
    setDockHintState(currentDockHint);
    return () => {
      dockHintListeners.delete(onHint);
    };
  }, []);

  // 渲染时夹取：窗口缩小后悬浮卡片不被推出视口。
  const w = Math.min(geom.w, maxFloatW());
  const h = geom.h === null ? null : Math.min(geom.h, maxFloatH());
  const left = clamp(geom.x, FLOAT_MARGIN, Math.max(FLOAT_MARGIN, window.innerWidth - w - FLOAT_MARGIN));
  const top = clamp(geom.y, FLOAT_MARGIN, Math.max(FLOAT_MARGIN, window.innerHeight - 96));

  /** 夹取后的最新 2D 布局盒（3D 球面/惯性引擎每帧读取，不触碰 children）。 */
  const boxRef = useRef<{ x: number; y: number; w: number; h: number | null }>({ x: left, y: top, w, h });
  boxRef.current = { x: left, y: top, w, h };

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

  // 3D 悬浮引擎：固定视口中心球面朝向 + 拖动浮空与速度惯性 + 动态投影/边缘反光。
  // 全程直接写舞台元素 CSS 变量（零 React 重渲染），收敛后自动停掉 rAF（静止零开销）。
  useLayoutEffect(() => {
    const stage = stageRef.current;
    const toggledOn = !prevFloat3dRef.current && float3d;
    prevFloat3dRef.current = float3d;
    if (!float3d) {
      kick3dRef.current = null;
      if (stage) clearFloat3dPose(stage);
      return undefined;
    }
    if (!stage) return undefined;

    const motionQuery =
      typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    let reducedMotion = motionQuery?.matches === true;

    const readBox = (): Float3dBox => {
      const b = boxRef.current;
      const measuredH = b.h ?? (wrapRef.current && wrapRef.current.offsetHeight > 0 ? wrapRef.current.offsetHeight : FLOAT_MIN_H);
      return { x: b.x, y: b.y, w: b.w, h: measuredH };
    };
    const readViewport = (): Float3dViewport => ({ vw: window.innerWidth, vh: window.innerHeight });

    const initialBox = readBox();
    const initialVp = readViewport();
    const initialSphere = computeSphericalTarget(initialBox, initialVp);
    const activeDrag = floatDrag !== null;
    // 在设置里现场打开开关时从 0° 平滑弹簧入场；页面重载或脱出悬浮时直接落到球面基准再叠加浮空。
    const spring = createFloat3dState(
      toggledOn && !reducedMotion
        ? { rotX: 0, rotY: 0, z: 0, lift: 0, dragging: activeDrag }
        : { rotX: initialSphere.rotX, rotY: initialSphere.rotY, z: initialSphere.z, lift: 0, dragging: activeDrag },
    );

    let rafId = 0;
    let lastTs = 0;
    let lastDragX = initialBox.x;
    let lastDragY = initialBox.y;
    let lastDragTs = performance.now();

    const paint = (): void => {
      applyFloat3dPose(stage, poseFromState(spring, readBox(), readViewport()));
    };

    const tick = (ts: number): void => {
      rafId = 0;
      const dtSec = lastTs > 0 ? (ts - lastTs) / 1000 : 1 / 60;
      lastTs = ts;
      const box = readBox();
      const vp = readViewport();
      const settled = stepFloat3dSpring(spring, box, vp, dtSec, reducedMotion);
      applyFloat3dPose(stage, poseFromState(spring, box, vp));
      if (!settled) {
        rafId = window.requestAnimationFrame(tick);
      } else {
        lastTs = 0;
      }
    };

    const kick = (): void => {
      if (reducedMotion) {
        stepFloat3dSpring(spring, readBox(), readViewport(), 1 / 60, true);
        paint();
        return;
      }
      if (rafId !== 0) return;
      lastTs = performance.now();
      rafId = window.requestAnimationFrame(tick);
    };

    kick3dRef.current = kick;
    paint();
    if (toggledOn || activeDrag) kick();

    const onDragMove = (x: number, y: number): void => {
      const now = performance.now();
      const dtSec = (now - lastDragTs) / 1000;
      const dx = x - lastDragX;
      const dy = y - lastDragY;
      lastDragX = x;
      lastDragY = y;
      lastDragTs = now;
      boxRef.current = { ...boxRef.current, x, y };
      if (!reducedMotion && spring.dragging) recordDragVelocity(spring, dx, dy, dtSec);
      kick();
    };

    const onDragState = (dragging: boolean): void => {
      spring.dragging = dragging;
      const b = readBox();
      lastDragX = b.x;
      lastDragY = b.y;
      lastDragTs = performance.now();
      kick();
    };

    const onMotionChange = (e: MediaQueryListEvent): void => {
      reducedMotion = e.matches;
      kick();
    };

    floatDragListeners.add(onDragMove);
    floatDragStateListeners.add(onDragState);
    window.addEventListener('resize', kick);
    motionQuery?.addEventListener?.('change', onMotionChange);
    const resizeObserver =
      typeof ResizeObserver === 'function' && wrapRef.current ? new ResizeObserver(() => kick()) : null;
    if (resizeObserver && wrapRef.current) resizeObserver.observe(wrapRef.current);

    return () => {
      if (rafId !== 0) window.cancelAnimationFrame(rafId);
      kick3dRef.current = null;
      floatDragListeners.delete(onDragMove);
      floatDragStateListeners.delete(onDragState);
      window.removeEventListener('resize', kick);
      motionQuery?.removeEventListener?.('change', onMotionChange);
      resizeObserver?.disconnect();
    };
  }, [float3d]);

  // 手动缩放或视口变化后同步触发 3D 球面朝向平滑收敛。
  useLayoutEffect(() => {
    if (float3d) kick3dRef.current?.();
  }, [float3d, left, top, w, h]);

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
      // 优先读外层 .dci-float 的布局尺寸（未受内层 3D 变换影响），避免起缩跳变。
      const startW = (shell && shell.offsetWidth > 0 ? shell.offsetWidth : rect?.width) ?? start.w;
      const startH = (shell && shell.offsetHeight > 0 ? shell.offsetHeight : rect?.height) ?? start.h ?? FLOAT_MIN_H;
      const startX = start.x;
      const startY = start.y;
      const right = startX + startW;
      const bottom = startY + startH;
      const pointerX = event.clientX;
      const pointerY = event.clientY;
      const onMove = (e: PointerEvent): void => {
        const dx = e.clientX - pointerX;
        const dy = e.clientY - pointerY;
        let nextW = startW;
        let nextH = startH;
        let x = startX;
        let y = startY;
        if (dir.includes('e')) nextW = clamp(startW + dx, FLOAT_MIN_W, Math.max(FLOAT_MIN_W, window.innerWidth - FLOAT_MARGIN - startX));
        if (dir.includes('w')) {
          x = clamp(startX + dx, FLOAT_MARGIN, right - FLOAT_MIN_W);
          nextW = right - x;
        }
        if (dir.includes('s')) nextH = clamp(startH + dy, FLOAT_MIN_H, Math.max(FLOAT_MIN_H, window.innerHeight - FLOAT_MARGIN - startY));
        if (dir.includes('n')) {
          y = clamp(startY + dy, FLOAT_MARGIN, bottom - FLOAT_MIN_H);
          nextH = bottom - y;
        }
        setGeom({ x, y, w: Math.round(nextW), h: Math.round(nextH) });
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

  const dockLabel =
    dockHint?.phase === 'pulling'
      ? t('float.dockPulling')
      : dockHint?.phase === 'armed'
        ? t('float.dockArmed')
        : t('float.dockIdle');

  return createPortal(
    <>
      {dockHint ? (
        <div
          className="dci-dock-zone"
          data-state={dockHint.phase}
          aria-hidden="true"
          style={{
            left: dockHint.box.left,
            top: dockHint.box.top,
            width: dockHint.box.width,
            height: dockHint.box.height,
          }}
        >
          <span className="dci-dock-zone-pill">
            <DockArrowIcon up={dockHint.phase === 'pulling'} />
            <span>{dockLabel}</span>
          </span>
        </div>
      ) : null}
      <div
        className="dci-float"
        ref={wrapRef}
        data-sized={h !== null ? 'true' : undefined}
        data-float-3d={float3d ? 'true' : undefined}
        data-dragging={dockHint !== null ? 'true' : undefined}
        data-dock-armed={dockHint?.phase === 'armed' ? 'true' : undefined}
        data-detach-flash={detachFlash ? 'true' : undefined}
        style={{
          left,
          top,
          width: w,
          height: h ?? undefined,
          ['--dci-grip-edge' as string]: `${GRIP_EDGE}px`,
          ['--dci-grip-corner' as string]: `${GRIP_CORNER}px`,
        }}
      >
        <div className="dci-float-stage" ref={stageRef}>
          {children}
          {GRIP_DIRS.map((dir) => (
            <div key={dir} className="dci-float-grip" data-dir={dir} onPointerDown={beginResize(dir)} />
          ))}
        </div>
      </div>
    </>,
    document.body,
  );
}

/** 归位区 / 轻提示的小图标（纯内联 SVG，避免外部依赖）。 */
function DockArrowIcon(props: { up?: boolean }): JSX.Element {
  const { up } = props;
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      {up ? (
        <>
          <path d="M8 12.5V3.5M4.5 7L8 3.5L11.5 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M3 13.5H13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" opacity="0.55" />
        </>
      ) : (
        <>
          <path d="M8 3V10.5M4.5 7L8 10.5L11.5 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M3 13H13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

/**
 * 归位落位反馈（挂载在 CodinputBar 内，跨 normal ↔ float 重挂载存活）：
 * 仅在归位普通模式（`dock` / `cancel-detach`）时给主卡片打瞬时 `data-dock-flash`
 * 落位脉冲，不弹多余文字提示。
 */
export function FloatModeFeedback(): null {
  const flashTimerRef = useRef(0);
  const rafRef = useRef(0);
  const flashedCardRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const clearFlash = (): void => {
      if (flashTimerRef.current !== 0) {
        window.clearTimeout(flashTimerRef.current);
        flashTimerRef.current = 0;
      }
      if (flashedCardRef.current) {
        delete flashedCardRef.current.dataset.dockFlash;
        flashedCardRef.current = null;
      }
    };

    const onFeedback = (event: ModeFeedbackEvent): void => {
      if (event !== 'dock' && event !== 'cancel-detach') return;
      if (rafRef.current !== 0) window.cancelAnimationFrame(rafRef.current);
      clearFlash();
      rafRef.current = window.requestAnimationFrame(() => {
        rafRef.current = 0;
        const card = document.querySelector<HTMLElement>('[data-composer-card="codinput"]');
        if (!card) return;
        card.dataset.dockFlash = 'true';
        flashedCardRef.current = card;
        flashTimerRef.current = window.setTimeout(clearFlash, FLASH_DURATION_MS + 40);
      });
    };

    modeFeedbackListeners.add(onFeedback);
    return () => {
      modeFeedbackListeners.delete(onFeedback);
      if (rafRef.current !== 0) window.cancelAnimationFrame(rafRef.current);
      clearFlash();
    };
  }, []);

  return null;
}
