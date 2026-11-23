/**
 * 3D 悬浮空间引擎（纯计算 + 阻尼弹簧状态机，零 DOM 以外依赖）：
 *
 * 视觉模型：
 * 1. 固定球心环绕：以视口正中为球心投影点，悬浮卡片贴在面向用户的内凹球面上。
 *    位于视口中央时倾角严格为 0°（代码编辑最清晰）；向四周移动时按真球面
 *    `atan(offset / R)` + `tanh` 柔饱和朝向中心微倾（Y 轴封顶 ±9.5°，X 轴封顶 ±7.5°），
 *    同时附带极轻微的内凹径向 Z 位移。
 * 2. 拖动惯性浮空：抓起拖动时 Z 轴平稳抬起，并随平滑速度矢量产生迎风压边式的
 *    惯性倾摆（前进侧微微下压入 -Z）；松手后由欠阻尼弹簧自然落回球面位姿，
 *    收敛后立即停止 rAF 循环（静止零开销）。
 * 3. 动态光影与反光：基于当前位姿与球心相对位置实时输出投影偏移/模糊/透明度、
 *    内凹边缘高光方向（rim）与随倾角滑动的镜面微高光中心（glare）。
 */

/** 3D 透视视距（px，与 styles.ts 的 perspective() 一致）。 */
export const FLOAT3D_PERSPECTIVE = 1150;
/** 球面静止倾角上限（deg）：克制角度以兼顾空间感与编辑器文字清晰度。 */
export const MAX_SPHERE_ROT_Y = 9.5;
export const MAX_SPHERE_ROT_X = 7.5;
/** 球面四周相对中心的最大径向凸出（px）。 */
export const MAX_SPHERE_Z = 8;
/** 拖动抓取时的 Z 轴浮空高度（px）。 */
export const DRAG_LIFT_Z = 24;
/** 拖动速度叠加的最大惯性倾角（deg）。 */
export const MAX_INERTIA_ROT_Y = 6.5;
export const MAX_INERTIA_ROT_X = 5.5;

const RAD_TO_DEG = 180 / Math.PI;
const ROT_STIFFNESS = 210;
const ROT_DAMPING = 22;
const LIFT_STIFFNESS = 240;
const LIFT_DAMPING = 26;
const VELOCITY_DECAY_RATE = 13;
const VELOCITY_GAIN = 0.0042;
const MAX_DT_SEC = 0.05;
const MIN_DT_SEC = 0.001;

export interface Float3dBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Float3dViewport {
  vw: number;
  vh: number;
}

export interface Float3dTarget {
  rotX: number;
  rotY: number;
  z: number;
  lift: number;
}

export interface Float3dSpringState {
  rotX: number;
  rotY: number;
  z: number;
  lift: number;
  vRotX: number;
  vRotY: number;
  vZ: number;
  vLift: number;
  /** 指数平滑后的拖动速度（px/s）。 */
  velX: number;
  velY: number;
  dragging: boolean;
}

export interface Float3dPose {
  rotX: number;
  rotY: number;
  z: number;
  lift: number;
  shadowX: number;
  shadowY: number;
  shadowBlur: number;
  shadowAlpha: number;
  rimX: number;
  rimY: number;
  glareX: number;
  glareY: number;
  glareOpacity: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function softCap(value: number, limit: number): number {
  if (limit <= 0 || value === 0) return 0;
  return limit * Math.tanh(value / limit) + 0;
}

/** 视口中心相对偏移（归一化到 [-1, 1]）。 */
function normalizedOffset(box: Float3dBox, vp: Float3dViewport): { dx: number; dy: number; nx: number; ny: number } {
  const vw = Math.max(1, vp.vw);
  const vh = Math.max(1, vp.vh);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const dx = cx - vw / 2;
  const dy = cy - vh / 2;
  return {
    dx,
    dy,
    nx: clamp(dx / Math.max(1, vw / 2), -1, 1),
    ny: clamp(dy / Math.max(1, vh / 2), -1, 1),
  };
}

/**
 * 计算以视口中心为固定球心的目标球面朝向：
 * - 卡片在左（dx < 0）→ rotY > 0（右转面向中心）；在右（dx > 0）→ rotY < 0（左转面向中心）；
 * - 卡片在上（dy < 0）→ rotX < 0（下俯面向中心）；在下（dy > 0）→ rotX > 0（上仰面向中心）；
 * - 居中（dx = 0, dy = 0）→ 严格 0°，保证居中编辑时完全平正清晰。
 */
export function computeSphericalTarget(box: Float3dBox, vp: Float3dViewport): { rotX: number; rotY: number; z: number } {
  const { dx, dy, nx, ny } = normalizedOffset(box, vp);
  const radiusX = Math.max(360, vp.vw * 0.95);
  const radiusY = Math.max(320, vp.vh * 0.95);
  const rawRotY = -Math.atan(dx / radiusX) * RAD_TO_DEG;
  const rawRotX = Math.atan(dy / radiusY) * RAD_TO_DEG;
  const r2 = Math.min(1, nx * nx + ny * ny);
  return {
    rotX: softCap(rawRotX, MAX_SPHERE_ROT_X),
    rotY: softCap(rawRotY, MAX_SPHERE_ROT_Y),
    z: MAX_SPHERE_Z * r2,
  };
}

/**
 * 拖动速度 → 惯性倾角（前进侧边缘微微下压入 -Z，松手归零）：
 * - 向右拖（velX > 0）→ rotY > 0；向左拖 → rotY < 0；
 * - 向下拖（velY > 0）→ rotX < 0；向上拖 → rotX > 0。
 */
export function computeDragInertia(velX: number, velY: number): { rotX: number; rotY: number } {
  return {
    rotX: softCap(-velY * VELOCITY_GAIN, MAX_INERTIA_ROT_X),
    rotY: softCap(velX * VELOCITY_GAIN, MAX_INERTIA_ROT_Y),
  };
}

/** 创建弹簧初始态（默认从零位起跳，开启设置时可见平滑入场；若已处于静止也可按需预置）。 */
export function createFloat3dState(initial?: Partial<Float3dTarget> & { dragging?: boolean }): Float3dSpringState {
  return {
    rotX: initial?.rotX ?? 0,
    rotY: initial?.rotY ?? 0,
    z: initial?.z ?? 0,
    lift: initial?.lift ?? 0,
    vRotX: 0,
    vRotY: 0,
    vZ: 0,
    vLift: 0,
    velX: 0,
    velY: 0,
    dragging: initial?.dragging ?? false,
  };
}

/** 注入一次拖动位移采样，指数平滑更新拖动速度（过滤鼠标采样抖动）。 */
export function recordDragVelocity(state: Float3dSpringState, dx: number, dy: number, dtSec: number): void {
  const dt = clamp(dtSec, 0.004, 0.1);
  const instX = clamp(dx / dt, -5000, 5000);
  const instY = clamp(dy / dt, -5000, 5000);
  const blend = 1 - Math.exp(-dt * 24);
  state.velX += (instX - state.velX) * blend;
  state.velY += (instY - state.velY) * blend;
}

/** 合并球面目标 + 拖动浮空与惯性倾角。 */
export function computeCombinedTarget(
  box: Float3dBox,
  vp: Float3dViewport,
  state: Pick<Float3dSpringState, 'dragging' | 'velX' | 'velY'>,
  reducedMotion: boolean,
): Float3dTarget {
  const sphere = computeSphericalTarget(box, vp);
  if (reducedMotion || !state.dragging) {
    return { rotX: sphere.rotX, rotY: sphere.rotY, z: sphere.z, lift: 0 };
  }
  const inertia = computeDragInertia(state.velX, state.velY);
  return {
    rotX: sphere.rotX + inertia.rotX,
    rotY: sphere.rotY + inertia.rotY,
    z: sphere.z + DRAG_LIFT_Z,
    lift: 1,
  };
}

function stepChannel(pos: number, vel: number, target: number, k: number, c: number, dt: number): [number, number] {
  const acc = (target - pos) * k - vel * c;
  const nextVel = vel + acc * dt;
  const nextPos = pos + nextVel * dt;
  return [nextPos, nextVel];
}

/**
 * 推进一帧弹簧物理（两子步半隐式欧拉，保证大帧间隔下绝对稳定）。
 * 返回 `true` 表示已完全收敛且无需继续调度下一帧 rAF。
 */
export function stepFloat3dSpring(
  state: Float3dSpringState,
  box: Float3dBox,
  vp: Float3dViewport,
  dtSec: number,
  reducedMotion: boolean,
): boolean {
  const dt = clamp(Number.isFinite(dtSec) ? dtSec : 1 / 60, MIN_DT_SEC, MAX_DT_SEC);
  if (reducedMotion) {
    const sphere = computeSphericalTarget(box, vp);
    state.rotX = sphere.rotX;
    state.rotY = sphere.rotY;
    state.z = sphere.z;
    state.lift = 0;
    state.vRotX = 0;
    state.vRotY = 0;
    state.vZ = 0;
    state.vLift = 0;
    state.velX = 0;
    state.velY = 0;
    return true;
  }

  // 拖动中途停手时速度指数衰减，避免悬停不动时惯性角卡住不回正。
  const decay = Math.exp(-dt * (state.dragging ? VELOCITY_DECAY_RATE : VELOCITY_DECAY_RATE * 1.8));
  state.velX *= decay;
  state.velY *= decay;
  if (Math.abs(state.velX) < 1) state.velX = 0;
  if (Math.abs(state.velY) < 1) state.velY = 0;

  const target = computeCombinedTarget(box, vp, state, false);
  const subDt = dt * 0.5;
  for (let i = 0; i < 2; i += 1) {
    [state.rotX, state.vRotX] = stepChannel(state.rotX, state.vRotX, target.rotX, ROT_STIFFNESS, ROT_DAMPING, subDt);
    [state.rotY, state.vRotY] = stepChannel(state.rotY, state.vRotY, target.rotY, ROT_STIFFNESS, ROT_DAMPING, subDt);
    [state.z, state.vZ] = stepChannel(state.z, state.vZ, target.z, LIFT_STIFFNESS, LIFT_DAMPING, subDt);
    [state.lift, state.vLift] = stepChannel(state.lift, state.vLift, target.lift, LIFT_STIFFNESS, LIFT_DAMPING, subDt);
  }
  state.lift = clamp(state.lift, 0, 1.15);

  const settled =
    !state.dragging &&
    Math.abs(state.rotX - target.rotX) < 0.015 &&
    Math.abs(state.rotY - target.rotY) < 0.015 &&
    Math.abs(state.z - target.z) < 0.04 &&
    Math.abs(state.lift - target.lift) < 0.005 &&
    Math.abs(state.vRotX) < 0.05 &&
    Math.abs(state.vRotY) < 0.05 &&
    Math.abs(state.vZ) < 0.1 &&
    Math.abs(state.vLift) < 0.02 &&
    state.velX === 0 &&
    state.velY === 0;

  if (settled) {
    state.rotX = target.rotX;
    state.rotY = target.rotY;
    state.z = target.z;
    state.lift = target.lift;
    state.vRotX = 0;
    state.vRotY = 0;
    state.vZ = 0;
    state.vLift = 0;
  }
  return settled;
}

/** 由当前弹簧状态 + 位置推导完整视觉位姿（3D 旋转/浮空 + 动态投影 + 边缘反光 + 玻璃高光）。 */
export function poseFromState(
  state: Pick<Float3dSpringState, 'rotX' | 'rotY' | 'z' | 'lift'>,
  box: Float3dBox,
  vp: Float3dViewport,
): Float3dPose {
  const { nx, ny } = normalizedOffset(box, vp);
  const lift = clamp(state.lift, 0, 1.15);
  const tiltMag = Math.hypot(state.rotX, state.rotY);

  // 动态投影：光源在视口正中偏上，卡片向四周移动时阴影向外侧偏出，浮空时拉远变柔。
  const shadowX = nx * 16 - state.rotY * 0.65;
  const shadowY = 12 + ny * 10 + state.rotX * 0.55 + lift * 16;
  const shadowBlur = 30 + lift * 24 + tiltMag * 0.7;
  const shadowAlpha = clamp(0.24 + lift * 0.08 + tiltMag * 0.003, 0.2, 0.38);

  // 边缘玻璃反光（inset 方向）：面向中心光源的一侧缘面受光更亮。
  const rimX = clamp(-state.rotY * 0.13, -1.3, 1.3);
  const rimY = clamp(0.65 + state.rotX * 0.12, -1.1, 1.35);

  // 镜面微高光中心：随 3D 倾角平滑游走，静止居中时温和停在偏上方。
  const glareX = clamp(50 + state.rotY * 3.8, 8, 92);
  const glareY = clamp(24 - state.rotX * 3.8, 6, 92);
  const glareOpacity = clamp(0.32 + tiltMag * 0.045 + lift * 0.25, 0.3, 1);

  return {
    rotX: state.rotX,
    rotY: state.rotY,
    z: state.z,
    lift,
    shadowX,
    shadowY,
    shadowBlur,
    shadowAlpha,
    rimX,
    rimY,
    glareX,
    glareY,
    glareOpacity,
  };
}

const CSS_VARS = [
  '--dci-3d-rx',
  '--dci-3d-ry',
  '--dci-3d-tz',
  '--dci-3d-sx',
  '--dci-3d-sy',
  '--dci-3d-sblur',
  '--dci-3d-salpha',
  '--dci-3d-rim-x',
  '--dci-3d-rim-y',
  '--dci-3d-gx',
  '--dci-3d-gy',
  '--dci-3d-galpha',
] as const;

/** 直接写舞台元素的 CSS 变量（零 React 重渲染）。 */
export function applyFloat3dPose(el: HTMLElement, pose: Float3dPose): void {
  const s = el.style;
  s.setProperty('--dci-3d-rx', `${pose.rotX.toFixed(2)}deg`);
  s.setProperty('--dci-3d-ry', `${pose.rotY.toFixed(2)}deg`);
  s.setProperty('--dci-3d-tz', `${pose.z.toFixed(2)}px`);
  s.setProperty('--dci-3d-sx', `${pose.shadowX.toFixed(1)}px`);
  s.setProperty('--dci-3d-sy', `${pose.shadowY.toFixed(1)}px`);
  s.setProperty('--dci-3d-sblur', `${pose.shadowBlur.toFixed(1)}px`);
  s.setProperty('--dci-3d-salpha', pose.shadowAlpha.toFixed(3));
  s.setProperty('--dci-3d-rim-x', `${pose.rimX.toFixed(2)}px`);
  s.setProperty('--dci-3d-rim-y', `${pose.rimY.toFixed(2)}px`);
  s.setProperty('--dci-3d-gx', `${pose.glareX.toFixed(1)}%`);
  s.setProperty('--dci-3d-gy', `${pose.glareY.toFixed(1)}%`);
  s.setProperty('--dci-3d-galpha', pose.glareOpacity.toFixed(3));
}

/** 关闭 3D 悬浮时清除所有内联 CSS 变量，还原纯净平面悬浮。 */
export function clearFloat3dPose(el: HTMLElement): void {
  const s = el.style;
  for (const name of CSS_VARS) s.removeProperty(name);
}
