/**
 * 快捷键：彻底自定义——设置里按键录入任意组合，规范化存储为
 * `ctrl+alt+shift+meta+key` 顺序的串（`mod` 特例表示 Cmd/Ctrl 任一），
 * 编辑器按键时以同一规范化结果精确匹配。
 */

const MODIFIERS = new Set(['ctrl', 'alt', 'shift', 'meta', 'mod']);

/** 规范化输出时修饰键的固定顺序（与 comboFromEvent 一致）。 */
const MODIFIER_ORDER = ['ctrl', 'alt', 'shift', 'meta'] as const;

/** 命名键（enter/escape/arrowup/f12…）：字母开头、字母数字组成。 */
const NAMED_KEY = /^[a-z][a-z0-9]{0,15}$/;

const PRETTY_TOKENS: Readonly<Record<string, string>> = {
  ctrl: 'Ctrl',
  alt: 'Alt',
  shift: 'Shift',
  meta: 'Cmd',
  mod: 'Ctrl/Cmd',
  enter: 'Enter',
  tab: 'Tab',
  space: 'Space',
  escape: 'Esc',
};

interface ParsedCombo {
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
  readonly meta: boolean;
  readonly mod: boolean;
  readonly key: string;
}

const parsedCache = new Map<string, ParsedCombo>();

function normalizeKeyName(raw: string): string {
  return raw === ' ' ? 'space' : raw.toLowerCase();
}

/** 主键 token 是否可解析：单字符（非空白/加号）或命名键。 */
function isKeyToken(token: string): boolean {
  return token.length === 1 ? /[^\s+]/.test(token) : NAMED_KEY.test(token);
}

/**
 * 存储的组合串是否基本合法：非空字符串，恰好一个可解析主键，无空/重复
 * token；`mod` 不与 ctrl/meta 混用（否则 matchEvent 语义有歧义）。
 */
export function isValidHotkey(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value.length === 0 || value.length > 64) return false;
  const tokens = value.toLowerCase().split('+');
  if (tokens.some((token) => token.length === 0)) return false;
  const unique = new Set(tokens);
  if (unique.size !== tokens.length) return false;
  const keys = tokens.filter((token) => !MODIFIERS.has(token));
  if (keys.length !== 1 || keys[0] === undefined || !isKeyToken(keys[0])) return false;
  return !(unique.has('mod') && (unique.has('ctrl') || unique.has('meta')));
}

/**
 * 组合串规范化：小写 + 修饰键固定顺序（ctrl+alt+shift+meta，mod 收尾）+ 主键。
 * 调用方应先用 isValidHotkey 校验；非法输入按原 token 尽力拼接。
 */
export function normalizeHotkey(combo: string): string {
  const tokens = combo.toLowerCase().split('+').filter(Boolean);
  const modifiers = MODIFIER_ORDER.filter((token) => tokens.includes(token));
  const key = tokens.find((token) => !MODIFIERS.has(token));
  return [...modifiers, ...(tokens.includes('mod') ? ['mod'] : []), ...(key === undefined ? [] : [key])].join('+');
}

/** 按事件实际按下的修饰键构造等价组合（录制用）。 */
export function comboFromEventLike(
  flags: { ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean },
  key: string,
): string {
  const parts: string[] = [];
  if (flags.ctrlKey) parts.push('ctrl');
  if (flags.altKey) parts.push('alt');
  if (flags.shiftKey) parts.push('shift');
  if (flags.metaKey) parts.push('meta');
  parts.push(normalizeKeyName(key));
  return parts.join('+');
}

/** 事件 → 规范化组合串（如 "ctrl+shift+enter"）；纯修饰键按下返回 null。 */
export function comboFromEvent(event: KeyboardEvent): string | null {
  const raw = event.key;
  if (raw === 'Shift' || raw === 'Control' || raw === 'Alt' || raw === 'Meta') return null;
  return comboFromEventLike(event, raw);
}

function parseCombo(combo: string): ParsedCombo {
  const cached = parsedCache.get(combo);
  if (cached !== undefined) return cached;
  const tokens = new Set(combo.toLowerCase().split('+').filter(Boolean));
  const key = [...tokens].filter((t) => !MODIFIERS.has(t)).join('+');
  const parsed: ParsedCombo = {
    ctrl: tokens.has('ctrl'),
    alt: tokens.has('alt'),
    shift: tokens.has('shift'),
    meta: tokens.has('meta'),
    mod: tokens.has('mod'),
    key,
  };
  if (parsedCache.size > 64) parsedCache.clear();
  parsedCache.set(combo, parsed);
  return parsed;
}

/** 存储的组合串是否与这次按键事件完全等价（mod 视作 Ctrl 或 Cmd 任一）。 */
export function matchEvent(combo: string, event: KeyboardEvent): boolean {
  const c = parseCombo(combo);
  if (!c.key || c.key !== normalizeKeyName(event.key)) return false;
  if (c.mod) {
    if (!(event.ctrlKey || event.metaKey)) return false;
    return event.altKey === c.alt && event.shiftKey === c.shift;
  }
  return event.ctrlKey === c.ctrl && event.altKey === c.alt && event.shiftKey === c.shift && event.metaKey === c.meta;
}

/**
 * 两个快捷键组合是否存在重合按键（用于发送与换行快捷键互斥校验）：
 * 例如 `mod+enter` 与 `ctrl+enter` / `meta+enter` 会匹配同一物理按键。
 */
export function hotkeysConflict(a: string, b: string): boolean {
  const pa = parseCombo(a);
  const pb = parseCombo(b);
  if (!pa.key || pa.key !== pb.key) return false;
  if (pa.alt !== pb.alt || pa.shift !== pb.shift) return false;
  if (pa.mod && pb.mod) return true;
  if (pa.mod) return (pb.ctrl || pb.meta);
  if (pb.mod) return (pa.ctrl || pa.meta);
  return pa.ctrl === pb.ctrl && pa.meta === pb.meta;
}

/** 组合串 → 展示文案。 */
export function formatCombo(combo: string): string {
  return combo
    .split('+')
    .filter(Boolean)
    .map(
      (token) =>
        PRETTY_TOKENS[token] ?? (token.length === 1 ? token.toUpperCase() : token.charAt(0).toUpperCase() + token.slice(1)),
    )
    .join(' + ');
}
