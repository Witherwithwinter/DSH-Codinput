/**
 * 槽位条目渲染的共享件：检视任意槽位的条目快照（检测即兼容）、按条目 locale
 * 绑定官方词典、快照 store 的选择器钩子合成、以及条目崩溃兜底边界。
 * 语音输入（VoiceActivity）、模型名标签（ModelLabel）与第三方输入按钮
 * （InputRightSlot）共用同一套合成公式，抽到这里避免多份漂移。
 */

import { useCallback, useSyncExternalStore, Component } from 'react';
import type { HostObservable, SlotEntryLike } from '../host-types';
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

/**
 * 列表槽位行合成：复刻官方 renderer 的 list 分支——
 * entries 已由 SlotCore 按（priority↑, order↑）排序，同 id 首个占位（去重），
 * 剩余行再按 order 升序稳定排序（官方 `[...rows].sort(a.order - b.order)`）。
 * 无组件的条目跳过（官方 deadCell 是废黜兜底，插件侧无法复现其内部状态）。
 */
export function listRows(entries: readonly unknown[]): SlotEntryLike[] {
  const byId = new Map<unknown, SlotEntryLike>();
  for (const candidate of entries) {
    const record = candidate as (SlotEntryLike & { options?: { id?: unknown } }) | null | undefined;
    if (!record || typeof record !== 'object' || typeof record.component !== 'function') continue;
    const id = (record as { options?: { id?: unknown } }).options?.id;
    if (byId.has(id)) continue;
    byId.set(id, record);
  }
  const rows = [...byId.values()];
  rows.sort((a, b) => orderOf(a) - orderOf(b));
  return rows;
}

function orderOf(entry: SlotEntryLike): number {
  const options = (entry as { options?: { order?: number } }).options;
  return options?.order ?? 0;
}

/** 条目 options.id（React key 用；官方 renderer 同轴）。 */
export function entryId(entry: SlotEntryLike, index: number): string {
  const options = (entry as { options?: { id?: string } }).options;
  return options?.id ?? `#${index}`;
}

export type SnapshotSelectorHook = <S>(sel: (s: any) => S, eq?: (a: S, b: S) => boolean) => S;

/** 快照 store → use<Name> 选择器钩子（官方 observableHook 同款，按源缓存）。 */
const snapshotHookCache = new WeakMap<object, SnapshotSelectorHook>();
export function snapshotHookFor(source: unknown): SnapshotSelectorHook | null {
  const face = source as HostObservable<unknown> | undefined;
  if (!face || typeof face.subscribe !== 'function' || typeof face.getSnapshot !== 'function') return null;
  let hook = snapshotHookCache.get(face);
  if (!hook) {
    hook = <S,>(sel: (s: unknown) => S): S =>
      useSyncExternalStore(
        (fn: () => void) => face.subscribe(fn) ?? (() => {}),
        () => sel(face.getSnapshot()),
        () => sel(face.getSnapshot()),
      );
    snapshotHookCache.set(face, hook);
  }
  return hook;
}

/** 官方 standardHookPropName：name → use<Name>（首字母大写）。 */
export function standardHookPropName(name: string): string {
  if (!name) return name;
  return `use${name.charAt(0).toUpperCase()}${name.slice(1)}`;
}

/**
 * 条目自带 inject 的 props 面（官方 runInject + bindInjectSources 的插件侧
 * 复刻）：以 sessionId 调 inject，把 hooks 子表折成 use<Name> 钩子、其余
 * 原样下传；keyedHooks 需要官方 keyed resolver 面，插件侧不可复现 → 跳过
 * （现网条目无键控钩子）。结果按（条目 × 会话）缓存——官方同款缓存轴。
 */
const entryInjectCache = new WeakMap<object, Map<string, Record<string, unknown> | null>>();
export function entryInjectProps(entry: SlotEntryLike, sessionId: string): Record<string, unknown> | null {
  if (typeof entry.inject !== 'function') return null;
  let perSession = entryInjectCache.get(entry);
  if (!perSession) {
    perSession = new Map();
    entryInjectCache.set(entry, perSession);
  }
  if (!perSession.has(sessionId)) {
    let bound: Record<string, unknown> | null = null;
    try {
      const face = entry.inject(sessionId);
      if (face && typeof face === 'object') {
        const { hooks: _hooks, keyedHooks: _keyed, ...rest } = face as Record<string, unknown> & {
          hooks?: Record<string, unknown>;
          keyedHooks?: Record<string, unknown>;
        };
        void _keyed;
        for (const [name, source] of Object.entries(_hooks ?? {})) {
          const hook = snapshotHookFor(source);
          if (hook) rest[standardHookPropName(name)] = hook;
        }
        bound = rest;
      }
    } catch (error) {
      diagError('slot.inject', error);
      bound = null;
    }
    perSession.set(sessionId, bound);
  }
  return perSession.get(sessionId) ?? null;
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
