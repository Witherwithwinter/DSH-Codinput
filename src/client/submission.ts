/**
 * 运行中提交策略（Issue #18）：从宿主 `conversation.composer.bar` 或
 * `settings.general.item`（id: 'composer-enter'）的官方条目 inject 面读取
 * 实时 `busyEnter` 偏好（`HostObservable<'queue' | 'steer'>`），无须在插件
 * 设置里重复造开关，也不占用任何宿主私有 API。
 *
 * 注意：调用官方 `conversation.composer.bar` 条目的 `inject(undefined)` 时
 * 宿主首行即返回不依赖会话的通用字段（含 `hooks.busyEnter`），不会触发
 * `sessions`/`inputHub`/`fileIntake` 查询；旧 0.2.0 宿主缺席该 hook 时
 * 安全回退 `'queue'`。
 */

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type { HostObservable, SlotEntryLike } from './host-types';
import { useSlotEntries } from './components/slotEntry';

export type BusyEnterBehavior = 'queue' | 'steer';

export const DEFAULT_BUSY_ENTER_BEHAVIOR: BusyEnterBehavior = 'queue';

export function normalizeBusyEnter(value: unknown): BusyEnterBehavior {
  return value === 'steer' ? 'steer' : 'queue';
}

export function resolveSubmitMode(
  preferred: BusyEnterBehavior,
  running: boolean,
  steeringAvailable: boolean,
): BusyEnterBehavior {
  if (!running || !steeringAvailable) return 'queue';
  return preferred === 'steer' ? 'steer' : 'queue';
}

function isCodinputEntry(entry: SlotEntryLike): boolean {
  return entry.registrant === 'dsh-codinput' || entry.options?.registrant === 'dsh-codinput';
}

function extractBusyEnterObservable(entry: unknown): HostObservable<unknown> | null {
  const record = entry as SlotEntryLike | null | undefined;
  if (!record || typeof record !== 'object' || typeof record.inject !== 'function') return null;
  try {
    const face = record.inject(undefined) as { hooks?: { busyEnter?: unknown } } | null | undefined;
    const obs = face?.hooks?.busyEnter as HostObservable<unknown> | undefined;
    if (obs && typeof obs.getSnapshot === 'function' && typeof obs.subscribe === 'function') {
      return obs;
    }
  } catch {
    /* 宿主或第三方条目的 inject 若依赖必填 sessionId 并抛错，忽略并继续探测 */
  }
  return null;
}

export function findBusyEnterSource(
  barEntries: readonly unknown[],
  settingsEntries: readonly unknown[] = [],
): HostObservable<unknown> | null {
  const candidates: SlotEntryLike[] = [];
  for (const raw of barEntries) {
    const entry = raw as SlotEntryLike | null | undefined;
    if (!entry || typeof entry !== 'object' || isCodinputEntry(entry)) continue;
    candidates.push(entry);
  }
  // 优先检查官方默认条目（priority >= 0），再检查其他非本插件条目。
  for (const entry of candidates) {
    if ((entry.options?.priority ?? 0) < 0) continue;
    const obs = extractBusyEnterObservable(entry);
    if (obs) return obs;
  }
  for (const entry of candidates) {
    if ((entry.options?.priority ?? 0) >= 0) continue;
    const obs = extractBusyEnterObservable(entry);
    if (obs) return obs;
  }
  // 退路：官方设置条目 settings.general.item (id: 'composer-enter') 同样暴露 hooks.busyEnter。
  for (const raw of settingsEntries) {
    const entry = raw as SlotEntryLike | null | undefined;
    if (!entry || typeof entry !== 'object' || entry.options?.id !== 'composer-enter') continue;
    const obs = extractBusyEnterObservable(entry);
    if (obs) return obs;
  }
  return null;
}

export function useBusyEnterBehavior(): BusyEnterBehavior {
  const barEntries = useSlotEntries('conversation.composer.bar');
  const settingsEntries = useSlotEntries('settings.general.item');
  const source = useMemo(() => findBusyEnterSource(barEntries, settingsEntries), [barEntries, settingsEntries]);

  const subscribe = useCallback(
    (fn: () => void) => {
      if (!source) return () => {};
      try {
        return source.subscribe(fn) ?? (() => {});
      } catch {
        return () => {};
      }
    },
    [source],
  );
  const getSnapshot = useCallback((): BusyEnterBehavior => {
    if (!source) return DEFAULT_BUSY_ENTER_BEHAVIOR;
    try {
      return normalizeBusyEnter(source.getSnapshot());
    } catch {
      return DEFAULT_BUSY_ENTER_BEHAVIOR;
    }
  }, [source]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
