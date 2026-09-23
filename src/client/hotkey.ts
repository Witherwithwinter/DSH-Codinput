/**
 * 快捷键：彻底自定义——设置里按键录入任意组合，规范化存储为
 * `ctrl+alt+shift+meta+key` 顺序的串（`mod` 特例表示 Cmd/Ctrl 任一），
 * 编辑器按键时以同一规范化结果精确匹配。
 */

const MODIFIERS = new Set(['ctrl', 'alt', 'shift', 'meta', 'mod']);

/** 事件 → 规范化组合串（如 "ctrl+shift+enter"）；纯修饰键按下返回 null。 */
export function comboFromEvent(event: KeyboardEvent): string | null {
  const raw = event.key;
  if (raw === 'Shift' || raw === 'Control' || raw === 'Alt' || raw === 'Meta') return null;
  const keyName = raw === ' ' ? 'space' : raw.length === 1 ? raw.toLowerCase() : raw.toLowerCase();
  const parts: string[] = [];
  if (event.ctrlKey) parts.push('ctrl');
  if (event.altKey) parts.push('alt');
  if (event.shiftKey) parts.push('shift');
  if (event.metaKey) parts.push('meta');
  parts.push(keyName);
  return parts.join('+');
}

/** 按事件实际按下的修饰键构造等价组合（录制用，同上）。 */
export function comboFromEventLike(flags: { ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }, key: string): string {
  const keyName = key === ' ' ? 'space' : key.length === 1 ? key.toLowerCase() : key.toLowerCase();
  const parts: string[] = [];
  if (flags.ctrlKey) parts.push('ctrl');
  if (flags.altKey) parts.push('alt');
  if (flags.shiftKey) parts.push('shift');
  if (flags.metaKey) parts.push('meta');
  parts.push(keyName);
  return parts.join('+');
}

function parseCombo(combo: string): { ctrl: boolean; alt: boolean; shift: boolean; meta: boolean; mod: boolean; key: string } {
  const tokens = new Set(combo.toLowerCase().split('+').filter(Boolean));
  const key = [...tokens].filter((t) => !MODIFIERS.has(t)).join('+');
  return {
    ctrl: tokens.has('ctrl'),
    alt: tokens.has('alt'),
    shift: tokens.has('shift'),
    meta: tokens.has('meta'),
    mod: tokens.has('mod'),
    key,
  };
}

/** 存储的组合串是否与这次按键事件完全等价（mod 视作 Ctrl 或 Cmd 任一）。 */
export function matchEvent(combo: string, event: KeyboardEvent): boolean {
  const c = parseCombo(combo);
  if (!c.key || c.key !== eventKeyOf(event)) return false;
  if (c.mod) {
    if (!(event.ctrlKey || event.metaKey)) return false;
    return event.altKey === c.alt && event.shiftKey === c.shift;
  }
  return event.ctrlKey === c.ctrl && event.altKey === c.alt && event.shiftKey === c.shift && event.metaKey === c.meta;
}

function eventKeyOf(event: KeyboardEvent): string {
  const raw = event.key;
  return raw === ' ' ? 'space' : raw.toLowerCase();
}

/** 组合串 → 展示文案。 */
export function formatCombo(combo: string): string {
  const pretty: Record<string, string> = {
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
  return combo
    .split('+')
    .filter(Boolean)
    .map((token) => pretty[token] ?? (token.length === 1 ? token.toUpperCase() : token.charAt(0).toUpperCase() + token.slice(1)))
    .join(' + ');
}
