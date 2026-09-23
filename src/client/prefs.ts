/** 偏好存储：localStorage 持久化（技术决策：无宿主往返，升级宿主不影响）。 */

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
  /** 显示行号（当前行与行号高亮常开）。 */
  lineNumbers: boolean;
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
  lineNumbers: true,
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
const KEY = 'dsh-codinput.prefs.v2';
const PERM_KEY = 'dsh-codinput.permission-applied';

const listeners = new Set<() => void>();

export function loadPrefs(): CodinputPrefs {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw);
    const merged: CodinputPrefs = { ...DEFAULT_PREFS, ...(parsed && typeof parsed === 'object' ? parsed : null) };
    const legacy = parsed as { sendKey?: string; lineBreakKey?: string; mode?: unknown; floating?: boolean };
    // 旧字段迁移：sendKey('mod-enter'|'enter') → sendHotkey/lineBreakHotkey。
    if (legacy.sendKey === 'enter') {
      merged.sendHotkey = 'enter';
      merged.lineBreakHotkey = 'shift-enter';
    }
    // 旧字段迁移：两态模型时代的 floating:true → mode:'float'。
    merged.mode =
      legacy.mode === 'float' || legacy.mode === 'normal'
        ? legacy.mode
        : legacy.floating === true
          ? 'float'
          : 'normal';
    return merged;
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(patch: Partial<CodinputPrefs>): CodinputPrefs {
  const next = { ...loadPrefs(), ...patch };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* 存储不可用时仅内存生效 */
  }
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
