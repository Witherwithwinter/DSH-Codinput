/**
 * 悬浮 ↔ 普通模式切换的归位区几何与反馈状态机（纯逻辑，零 DOM 依赖）。
 *
 * 把「底部归位区命中判定」「底部归位提示框可见几何」「拖动中的三态提示
 * （pulling / idle / armed）」以及「松手结果判定」收敛在一处，确保命中边界与
 * 视觉反馈完全同源，同时便于在单测里直接覆盖所有边界情形。
 */

export interface DockRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface DockVisualBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * 拖动期间底部归位区的视觉状态：
 * - `pulling`：刚从普通模式向上起拖、指针尚未离开归位区（提示「继续向上拖出以悬浮 · 松手取消」）；
 * - `idle`：指针已在悬浮区（底部淡淡标出可归位位置，不喧宾夺主）；
 * - `armed`：指针进入底部归位区且松手即回普通模式（高亮吸附轮廓 + 卡片边缘联动提示）。
 */
export type DockHintPhase = 'pulling' | 'idle' | 'armed';

/** 松手后的明确归类：仅 `enter-float` 与 `dock` 属于真正的模式切换。 */
export type DragReleaseOutcome = 'enter-float' | 'dock' | 'cancel-detach' | 'move-float';

const DOCK_ZONE_HEIGHT = 300;
const DOCK_BOTTOM_PAD = 120;
const DOCK_SIDE_SLOP = 40;
const VISUAL_MARGIN = 12;
/** 底部状态栏（StatsRow）固定留原位时，虚框底缘与状态栏顶缘之间预留的视觉缝隙（防 armed 外发光环压字）。 */
const VISUAL_STATS_GAP = 2;
const VISUAL_MAX_WIDTH = 760;
const VISUAL_MIN_WIDTH = 220;
const VISUAL_HEIGHT = 124;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * 底部归位命中区（与既有悬浮归位及探针 D3 契约逐值一致）：
 * - 纵向：底部向上 300px；
 * - 横向：以 `[data-composer-seat]` 为基准左右各扩 40px（缺失时取整视口）。
 */
export function computeDockZone(seatRect: DockRect | null, vw: number, vh: number): DockRect {
  const safeW = Math.max(1, vw);
  const safeH = Math.max(1, vh);
  const bottom = Math.min(safeH, (seatRect?.bottom ?? safeH) + DOCK_BOTTOM_PAD);
  const top = Math.max(0, bottom - DOCK_ZONE_HEIGHT);
  return {
    left: (seatRect?.left ?? 0) - DOCK_SIDE_SLOP,
    right: (seatRect?.right ?? safeW) + DOCK_SIDE_SLOP,
    top,
    bottom,
  };
}

/** 指针落点是否位于归位命中区内。 */
export function isPointInDockZone(x: number, y: number, zone: DockRect): boolean {
  return x >= zone.left && x <= zone.right && y >= zone.top && y <= zone.bottom;
}

/**
 * 底部归位区视觉轮廓盒：对齐主输入卡片的水平居中位置与实际落点；
 * 当底部状态栏（StatsRow）固定留在原位时，轮廓盒底缘抬升至状态栏上方（`statsTop`），
 * 避免虚框盖住状态栏，同时与卡片归位后的真实落位一致。
 */
export function computeDockVisualBox(
  seatRect: DockRect | null,
  zone: DockRect,
  vw: number,
  vh: number,
  statsTop?: number | null,
): DockVisualBox {
  const safeW = Math.max(1, vw);
  const safeH = Math.max(1, vh);
  const colLeft = seatRect ? clamp(seatRect.left, 0, safeW) : 0;
  const colRight = seatRect ? clamp(seatRect.right, colLeft, safeW) : safeW;
  const colWidth = Math.max(0, colRight - colLeft);
  const maxAllowedW = Math.max(1, safeW - VISUAL_MARGIN * 2);
  const preferredW = colWidth > 0 ? Math.min(VISUAL_MAX_WIDTH, Math.max(VISUAL_MIN_WIDTH, colWidth - VISUAL_MARGIN * 2)) : VISUAL_MAX_WIDTH;
  const width = Math.round(Math.min(preferredW, maxAllowedW));
  const centerX = colWidth > 0 ? (colLeft + colRight) / 2 : safeW / 2;
  const left = Math.round(clamp(centerX - width / 2, VISUAL_MARGIN, Math.max(VISUAL_MARGIN, safeW - width - VISUAL_MARGIN)));
  const height = Math.round(clamp(Math.min(VISUAL_HEIGHT, zone.bottom - zone.top), 64, Math.max(64, safeH - VISUAL_MARGIN * 2)));
  const defaultBottom = zone.bottom - VISUAL_MARGIN;
  const anchorBottom =
    typeof statsTop === 'number' && Number.isFinite(statsTop)
      ? Math.min(defaultBottom, statsTop - VISUAL_STATS_GAP)
      : defaultBottom;
  const top = Math.round(clamp(anchorBottom - height, VISUAL_MARGIN, Math.max(VISUAL_MARGIN, safeH - height - VISUAL_MARGIN)));
  return { left, top, width, height };
}

/** 根据起拖来源与指针是否曾离开过归位区，推导当前底部提示区状态。 */
export function resolveDockHintPhase(fromFloat: boolean, inDock: boolean, leftDockOnce: boolean): DockHintPhase {
  if (!inDock) return 'idle';
  if (fromFloat || leftDockOnce) return 'armed';
  return 'pulling';
}

/** 松手结果判定：区分真正切换（enter-float / dock）与取消/普通挪动。 */
export function resolveReleaseOutcome(fromFloat: boolean, inDock: boolean): DragReleaseOutcome {
  if (inDock) return fromFloat ? 'dock' : 'cancel-detach';
  return fromFloat ? 'move-float' : 'enter-float';
}
