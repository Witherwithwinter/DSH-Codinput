/** 偏好存储：localStorage 持久化（技术决策：无宿主往返，升级宿主不影响）。 */

import { isValidHotkey, normalizeHotkey } from './hotkey';

/** 快捷键组合：规范化串（如 "mod+enter"、"ctrl+shift+k"），见 hotkey.ts。 */
export type Hotkey = string;

/**
 * 输入入口形态（三态，任一时刻只有一个实例）：
 * - `normal`：接管卡片在原输入位（主输入卡片）；
 * - `float`：卡片 portal 悬浮（可拖动位置、可拖边界/角落缩放）；
 * - `side`：卡片由右侧栏 Codinput 标签承载（侧栏收起时经右上角小球唤出）。
 *
 * 持久化只存 normal/float 两值——`side` 由「侧栏标签 body 是否挂载」派生
 * （挂载即侧栏承载该会话输入），避免布局丢失后草稿入口凭空消失。
 */
export type CodinputMode = 'normal' | 'float' | 'side';

export interface CodinputPrefs {
  /** 启用接管：关闭即恢复官方输入框（卸载遮蔽条目）。 */
  enabled: boolean;
  /** 用户消息 Markdown 渲染（键控座 conversation.chat.node 的 user/steering 遮蔽）。 */
  userMarkdown: boolean;
  /** 显示行号（当前行与行号高亮常开）。 */
  lineNumbers: boolean;
  /**
   * Markdown 正文等宽连字字体（方案 A）：预览与用户消息的正文改用
   * 'JetBrains Mono' 等宽连字字体，`->` / `=>` / `//` 等靠字体 calt/liga 连字
   * 显示成箭头/连字（DOM 文本仍是原文，不做字符替换）。只影响 Markdown 显示面；
   * 编辑器输入框保持字面（桌面 Chromium 152 的 CM 连字 shaping bug）。默认开。
   */
  markdownMono: boolean;
  /** 编辑器字体（默认 JetBrains Mono）。 */
  fontFamily: string;
  /** 发送快捷键（任意组合，默认 Cmd/Ctrl+Enter）。 */
  sendHotkey: Hotkey;
  /** 换行快捷键（任意组合，默认 Enter；不得与发送快捷键相同）。 */
  lineBreakHotkey: Hotkey;
  /** 默认视图：编辑开关初值。 */
  defaultEdit: boolean;
  /** 默认视图：预览开关初值。 */
  defaultPreview: boolean;
  /** 编辑区高度 px（顶边拖把调节，固定高）；null = 随内容、46vh 封顶。 */
  composerBodyHeight: number | null;
  /** 入口形态（持久化值只有 normal/float；side 由侧栏标签挂载派生）。 */
  mode: CodinputMode;
  /** 悬浮位置（视口坐标，拖动后记忆）；null = 默认居中偏上。 */
  floatX: number | null;
  floatY: number | null;
  /** 悬浮尺寸 px（拖边界/角落调节后记忆）；null = 默认宽 720、高度随内容。 */
  floatW: number | null;
  floatH: number | null;
}

export const DEFAULT_PREFS: CodinputPrefs = {
  enabled: true,
  userMarkdown: true,
  lineNumbers: true,
  markdownMono: true,
  fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  sendHotkey: 'mod+enter',
  lineBreakHotkey: 'enter',
  defaultEdit: true,
  defaultPreview: false,
  composerBodyHeight: null,
  mode: 'normal',
  floatX: null,
  floatY: null,
  floatW: null,
  floatH: null,
};

// v2：旧版（已移除的 v0.1.0）遗留的 'dsh-codinput.prefs' 形状不同且可能
// enabled:false——换键避免被旧数据劫持接管开关。
// v3：v2 清理 + 字段归一化迁移（B1/B2：坏 `shift-enter` 修复、旧字段删除）。
// 此前曾把 `fontLigatures` 默认改为 true 并在 v3 里持久化；后续
// **移除了字体连字功能**（桌面 Chromium 152 的 calt shaping bug 无法稳定规避），
// 该字段从 v3 起被忽略、下次保存时自动丢弃；此处保留 v3 键名避免无谓地
// 重放迁移。
const KEY = 'dsh-codinput.prefs.v3';
const LEGACY_KEY = 'dsh-codinput.prefs.v2';
const PERM_KEY = 'dsh-codinput.permission-applied';

/**
 * 已废弃的旧字段：迁移时只读一次，随后从存储对象删除（B2）。留着它们
 * 会让每次加载都重新迁移，把用户后来改过的快捷键覆盖回旧值。
 * - `sendKey`：两态快捷键时代的发送键（'enter' | 'mod-enter'）；
 * - `lineBreakKey`：同代换行键（当前无迁移值，仅随旧对象删除）；
 * - `floating`：两态入口时代的悬浮标记（true → mode:'float'）。
 */
const LEGACY_KEYS = ['sendKey', 'lineBreakKey', 'floating'] as const;

/** 数值字段允许区间：与 UI 的拖拽/缩放夹取一致，兼作脏数据兜底。 */
const BODY_HEIGHT_MIN = 96;
const BODY_HEIGHT_MAX = 4000;
const FLOAT_W_MIN = 360;
const FLOAT_H_MIN = 140;
const FLOAT_SIZE_MAX = 10000;
const FLOAT_POS_MAX = 100000;
const FONT_FAMILY_MAX = 256;

const listeners = new Set<() => void>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 布尔字段：缺失/非布尔回退默认。 */
function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** 旧版组合串分隔符 `-` → 规范 `+`（B1：'shift-enter' → 'shift+enter'）。 */
function repairHotkey(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const combo = value.trim();
  return /^[a-z0-9]+(?:-[a-z0-9]+)+$/i.test(combo) ? combo.replace(/-/g, '+') : combo;
}

/** 快捷键字段：修复旧分隔符 → basic 校验 → 规范化；不合法回退默认。 */
function readHotkey(value: unknown, fallback: Hotkey): Hotkey {
  const repaired = repairHotkey(value);
  return isValidHotkey(repaired) ? normalizeHotkey(repaired) : fallback;
}

/** 正数区间字段：非有限数/非正数、越界 → 夹取或 null。 */
function readPositive(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  if (rounded <= 0) return null;
  return Math.min(max, Math.max(min, rounded));
}

/** 视口坐标字段：非有限数/负数 → null；其余夹取上限。 */
function readPosition(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  if (rounded < 0) return null;
  return Math.min(FLOAT_POS_MAX, rounded);
}

/**
 * 任意来源（localStorage / 调用方 patch）→ 合法 CodinputPrefs（B3）：
 * 每个字段独立做类型/枚举/范围校验，缺失或脏值逐项回退默认；未知字段丢弃。
 * 任意输入都不抛错；同时是「存储只写已知字段」的唯一出口（B2）。
 */
export function normalizePrefs(input: unknown): CodinputPrefs {
  const raw = isRecord(input) ? input : {};
  const prefs: CodinputPrefs = { ...DEFAULT_PREFS };

  prefs.enabled = readBoolean(raw['enabled'], DEFAULT_PREFS.enabled);
  prefs.userMarkdown = readBoolean(raw['userMarkdown'], DEFAULT_PREFS.userMarkdown);
  prefs.lineNumbers = readBoolean(raw['lineNumbers'], DEFAULT_PREFS.lineNumbers);
  // markdownMono 新字段：老用户存储里没有该键 → 合并式读取自动落到默认 true（v3 不升键）。
  prefs.markdownMono = readBoolean(raw['markdownMono'], DEFAULT_PREFS.markdownMono);
  const fontFamily = typeof raw['fontFamily'] === 'string' ? raw['fontFamily'].trim() : '';
  if (fontFamily.length > 0 && fontFamily.length <= FONT_FAMILY_MAX) prefs.fontFamily = fontFamily;

  prefs.sendHotkey = readHotkey(raw['sendHotkey'], DEFAULT_PREFS.sendHotkey);
  prefs.lineBreakHotkey = readHotkey(raw['lineBreakHotkey'], DEFAULT_PREFS.lineBreakHotkey);
  if (prefs.sendHotkey === prefs.lineBreakHotkey) {
    // 冲突（含被写坏成同一键）：两枚都回退默认，保证 send ≠ lineBreak。
    prefs.sendHotkey = DEFAULT_PREFS.sendHotkey;
    prefs.lineBreakHotkey = DEFAULT_PREFS.lineBreakHotkey;
  }

  const defaultEdit = readBoolean(raw['defaultEdit'], DEFAULT_PREFS.defaultEdit);
  const defaultPreview = readBoolean(raw['defaultPreview'], DEFAULT_PREFS.defaultPreview);
  if (defaultEdit || defaultPreview) {
    prefs.defaultEdit = defaultEdit;
    prefs.defaultPreview = defaultPreview;
  }

  prefs.composerBodyHeight = readPositive(raw['composerBodyHeight'], BODY_HEIGHT_MIN, BODY_HEIGHT_MAX);
  const mode = raw['mode'];
  prefs.mode =
    mode === 'float' || mode === 'normal' ? mode : raw['floating'] === true ? 'float' : DEFAULT_PREFS.mode;
  prefs.floatX = readPosition(raw['floatX']);
  prefs.floatY = readPosition(raw['floatY']);
  prefs.floatW = readPositive(raw['floatW'], FLOAT_W_MIN, FLOAT_SIZE_MAX);
  prefs.floatH = readPositive(raw['floatH'], FLOAT_H_MIN, FLOAT_SIZE_MAX);
  return prefs;
}

/**
 * 一次性迁移旧字段（B1/B2）：
 * - `sendKey === 'enter'`（旧版 Enter 发送）→ send 'enter' + 换行 'shift+enter'
 *   （旧代码错写成 'shift-enter'，分隔符不是 '+'，导致 Shift+Enter 换行失效）；
 * - `sendKey` 为 mod-enter/ctrl-enter → 即新默认（Mod+Enter 发送、Enter 换行）；
 * - 只有目标快捷键缺失/非法时才用旧值迁移：用户已经改过的新字段优先；
 * - 迁移后删除全部旧字段，存储里不再有旧键，后续加载不会再被迁移逻辑覆盖。
 */
function migrateLegacy(raw: Record<string, unknown>): Record<string, unknown> {
  if (!LEGACY_KEYS.some((key) => Object.prototype.hasOwnProperty.call(raw, key))) return raw;
  const next: Record<string, unknown> = { ...raw };
  const legacySend = typeof next['sendKey'] === 'string' ? next['sendKey'].trim().toLowerCase() : undefined;
  if (next['mode'] !== 'float' && next['mode'] !== 'normal' && next['floating'] === true) {
    next['mode'] = 'float';
  }
  if (!isValidHotkey(next['sendHotkey'])) {
    if (legacySend === 'enter') {
      next['sendHotkey'] = 'enter';
      next['lineBreakHotkey'] = 'shift+enter';
    } else if (
      legacySend === 'mod-enter' ||
      legacySend === 'mod+enter' ||
      legacySend === 'ctrl-enter' ||
      legacySend === 'ctrl+enter'
    ) {
      next['sendHotkey'] = 'mod+enter';
      next['lineBreakHotkey'] = 'enter';
    }
  }
  for (const key of LEGACY_KEYS) delete next[key];
  return next;
}

/** 存储写/删的安全包装：返回是否成功（迁移删 v2 依赖写成功判断）。 */
function safeSet(key: string, value: string): boolean {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function safeRemove(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* 删除失败无妨：新键已优先 */
  }
}

/** 存储文本 → 合法偏好（坏 JSON/未知键/旧字段一并归一化，不写回）。 */
function decodePrefs(raw: string): CodinputPrefs {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    /* 坏 JSON：按全默认处理 */
  }
  return normalizePrefs(isRecord(parsed) ? migrateLegacy(parsed) : null);
}

/**
 * 读取偏好：任何脏数据（坏 JSON、错误类型、未知键、越界值）都不抛错，
 * 全部逐字段归一化回退默认（B3）。迁移/修复/清脏后与规范化文本不一致时
 * 一次性写回（B2：旧字段删除、坏值修复、未知键不出现在存储里）；之后的
 * 加载 raw 与 canonical 相同，不再重复写入。
 *
 * v3 优先。v3 缺失而 v2 存在时做一次性升级迁移（v2 时代的坏值/旧字段在这里
 * 归一化清理）：归一化后写 v3，只有 v3 写成功才删 v2——写失败时保留 v2 兜底，
 * 下次加载重试。
 */
export function loadPrefs(): CodinputPrefs {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw !== null) {
      const prefs = decodePrefs(raw);
      const canonical = JSON.stringify(prefs);
      if (raw !== canonical) safeSet(KEY, canonical);
      return prefs;
    }
    const legacyRaw = window.localStorage.getItem(LEGACY_KEY);
    if (legacyRaw === null) return { ...DEFAULT_PREFS };
    const prefs = decodePrefs(legacyRaw);
    const canonical = JSON.stringify(prefs);
    if (safeSet(KEY, canonical)) safeRemove(LEGACY_KEY);
    return prefs;
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

/**
 * 保存偏好：先与当前值合并再做同一套归一化（B3），只序列化已知字段（B2），
 * 写入 v3。v3 写成功后再清掉可能残留的 v2（迁移写失败后由保存补上的场景；
 * 写失败则保留 v2 兜底）。
 */
export function savePrefs(patch: Partial<CodinputPrefs>): CodinputPrefs {
  const next = normalizePrefs({ ...loadPrefs(), ...(isRecord(patch) ? patch : {}) });
  if (safeSet(KEY, JSON.stringify(next))) safeRemove(LEGACY_KEY);
  for (const fn of listeners) fn();
  return next;
}

export function subscribePrefs(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 权限菜单最近一次实际应用的预设（仅本浏览器记忆，宿主无公开读取面）。 */
export function loadAppliedPermission(): string | null {
  try {
    return window.localStorage.getItem(PERM_KEY);
  } catch {
    return null;
  }
}

export function saveAppliedPermission(preset: string): void {
  try {
    window.localStorage.setItem(PERM_KEY, preset);
  } catch {
    /* 忽略 */
  }
}
