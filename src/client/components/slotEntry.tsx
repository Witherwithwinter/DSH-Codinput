/**
 * 槽位条目渲染的共享件：检视任意槽位的条目快照（检测即兼容）、按条目 locale
 * 绑定官方词典、以及条目崩溃兜底边界。语音输入（VoiceActivity）与模型名
 * 标签（ModelLabel）共用同一套合成公式，抽到这里避免两份漂移。
 */

import { useCallback, useSyncExternalStore, Component } from 'react';
import type { SlotEntryLike } from '../host-types';
import { bindForeign } from '../i18n';
import { diagError } from '../diag';
import { stash } from '../services';

export type Translator = (key: string, params?: Record<string, string | number>) => string;

const EMPTY_ENTRIES: readonly unknown[] = [];

/** 槽位条目快照：entries 引用在变更之间稳定（官方契约），直接作 uSES 源。 */
export function useSlotEntries(key: string): readonly unknown[] {
  // 服务缺席时退化为恒空快照；slots 就绪后 deps 变化自动重订。
  const slots = stash.slots;
  const subscribe = useCallback(
    (fn: () => void) => {
      if (typeof slots?.subscribe !== 'function') return () => {};
      try {
        return slots.subscribe(key, fn) ?? (() => {});
      } catch {
        return () => {};
      }
    },
    [slots, key],
  );
  const getSnapshot = useCallback(() => {
    if (typeof slots?.entries !== 'function') return EMPTY_ENTRIES;
    try {
      return slots.entries(key) ?? EMPTY_ENTRIES;
    } catch {
      // 槽位键未声明（如 web 0.1.x 没有 model.label 子槽位）按无条目处理。
      return EMPTY_ENTRIES;
    }
  }, [slots, key]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** single 槽位赢家 = entries 首个带组件的条目（register 即按优先级排序）。 */
export function firstComponentEntry(entries: readonly unknown[]): SlotEntryLike | null {
  for (const candidate of entries) {
    const record = candidate as SlotEntryLike | null | undefined;
    if (record && typeof record === 'object' && typeof record.component === 'function') return record;
  }
  return null;
}

/** 官方 renderer 的 locale 座位：locale.bind(entry.locale)，按 ns 缓存。 */
export function translatorFor(entry: SlotEntryLike, fallbackNs?: string): Translator | null {
  const ns = entry.locale ?? fallbackNs;
  if (!ns) return null;
  return bindForeign(ns);
}

/** 条目崩溃只丢本座位，不连坐 Codinput 的 bar 条目（被废黜 = 输入面消失）。 */
export class EntryBoundary extends Component<
  { children?: React.ReactNode; fallback?: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  componentDidCatch(error: unknown): void {
    diagError('slot.entry', error);
  }
  render(): React.ReactNode {
    return this.state.failed ? this.props.fallback ?? null : this.props.children;
  }
}
