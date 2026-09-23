/** 触发管线对接：track 上报、键盘仲裁（仅菜单打开时路由）、指令按钮的程序化唤起。 */

import type { ComposerKeyboard, InputState, InputTriggerController, MenuState, TriggerHit } from './host-types';
import { diagDebug } from './diag';

/** 由输入机 phase 派生触发可用档：plain 全活、claimed 抑 '/'、frozen 全停。 */
export function triggerTier(phase: InputState['phase']): { readonly tier: 'plain' | 'claimed' | 'frozen' } {
  if (phase === 'plain') return { tier: 'plain' };
  if (phase === 'claimed') return { tier: 'claimed' };
  return { tier: 'frozen' };
}

export function reportTrack(
  triggers: InputTriggerController | undefined,
  draft: string,
  caret: number,
  state: InputState | undefined,
): void {
  if (!triggers || !state) return;
  try {
    triggers.track(draft, caret, triggerTier(state.phase), state.draftRev);
  } catch (error) {
    diagDebug('track failed', error);
  }
}

/** 程序化唤起 '/' 候选菜单（工具行指令按钮；同官方 toggleCommandMenu 实现）。 */
export function openCommandMenu(
  triggers: InputTriggerController | undefined,
  keyboard: ComposerKeyboard | undefined,
  caret: number,
): void {
  if (!triggers) return;
  const snapshot = keyboard?.snapshot;
  const draft = snapshot?.draft ?? '';
  const draftRev = snapshot?.draftRev ?? 0;
  keyboard?.dismissPopup();
  const hit: TriggerHit = {
    trigger: '/',
    query: '',
    quoted: false,
    position: draft.slice(0, caret).trim() === '' ? 'leading' : 'inline',
    span: { start: caret, end: caret, draftRev },
  };
  triggers.toggleSource('command', hit);
}

const ARBITRATE_KEYS: Record<string, 'up' | 'down' | 'enter' | 'escape' | 'tab'> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  Enter: 'enter',
  Escape: 'escape',
  Tab: 'tab',
};

/**
 * 键盘仲裁：只在候选菜单实际打开时路由（工程事实 #4——菜单关闭时
 * arbitrate 对 Enter 也返回 consumed，会吞换行）。
 *
 * @returns true 表示事件已被菜单消费（调用方 preventDefault）。
 */
export function arbitrateForMenu(
  triggers: InputTriggerController | undefined,
  event: KeyboardEvent,
  composing: boolean,
): boolean {
  if (!triggers) return false;
  const menu: MenuState = triggers.menu.getSnapshot();
  if (!menu.open) return false;
  const key = ARBITRATE_KEYS[event.key];
  if (!key) return false;
  const outcome = triggers.arbitrate(key, composing);
  return outcome !== 'pass';
}

/** 空格裁决：真 = 输入机已应用 claim（调用方 preventDefault）。 */
export function adjudicateSpace(triggers: InputTriggerController | undefined): boolean {
  if (!triggers) return false;
  try {
    return triggers.onSpace();
  } catch {
    return false;
  }
}
