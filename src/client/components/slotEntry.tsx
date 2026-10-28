/**
 * 槽位条目渲染的共享件：检视任意槽位的条目快照（检测即兼容）、按条目 locale
 * 绑定官方词典、快照 store 的选择器钩子合成、条目崩溃兜底边界，以及宿主 kit
 * 减去 owner props 的 standard 面（座位镜像 InputSlotSeat 与语音/模型标签
 * 共用同一套合成公式，抽到这里避免多份漂移）。
 */

import { createElement, useCallback, useSyncExternalStore, Component } from 'react';
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

/**
 * React 可作为元素类型使用的「组件包装」符号（memo / forwardRef / lazy）。
 * 只认这三类，不做「任意 symbol `$$typeof`」放行——element / context / 伪造
 * 对象都不是可渲染组件类型：放行后 React 会在为子元素创建 Fiber 时抛 #130，
 * 而该错误发生在 EntryBoundary 自身的工作单元内（边界只捕获后代错误），会
 * 冒泡到宿主的 SlotErrorBoundary 并废黜 conversation.composer.bar（接管整体
 * 退回官方输入框）。收紧后这类坏条目回到静默跳过，与 v0.3.5 行为一致。
 */
const RENDERABLE_OBJECT_TYPES: readonly symbol[] = [
  Symbol.for('react.memo'),
  Symbol.for('react.forward_ref'),
  Symbol.for('react.lazy'),
];

/** 组件位是否为 React 可渲染类型（函数组件 / memo / forwardRef / lazy 包装）。 */
export function isRenderableComponent(value: unknown): boolean {
  if (typeof value === 'function') return true;
  if (value === null || typeof value !== 'object') return false;
  const type = (value as { $$typeof?: unknown }).$$typeof;
  return typeof type === 'symbol' && RENDERABLE_OBJECT_TYPES.includes(type);
}

/** single 槽位赢家 = entries 首个带组件的条目（register 即按优先级排序）。 */
export function firstComponentEntry(entries: readonly unknown[]): SlotEntryLike | null {
  for (const candidate of entries) {
    const record = candidate as SlotEntryLike | null | undefined;
    if (record && typeof record === 'object' && isRenderableComponent(record.component)) return record;
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
    if (!record || typeof record !== 'object' || !isRenderableComponent(record.component)) continue;
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

/**
 * 座位「第三方遮蔽者」判据（单值座让位用）。
 *
 * 宿主的动态包守卫（dsh-cordis-client-runner 的 `guardedSlots`）对非 chain
 * 槽位的 register 做两件事：① **强制**用页内遮蔽秩覆盖插件自报的 priority
 * （`--nextPriority`，负数且唯一——插件写 priority:-1 也会被覆盖成分配值）；
 * ② fiber 名取 `dyn/<pluginId>`，而条目 `registrant` = `options.registrant ??
 * fiber.name`。出厂自带占用者（如 client-ui-model-selection 的 ModelSelect）
 * 不经过该守卫：不带 priority（≡0），registrant 也没有 `dyn/` 前缀。
 *
 * 据此把「第三方遮蔽者」与「出厂占用者」分开：前者应当让位（镜像它），
 * 后者继续由 Codinput 自绘控件代表（镜像出厂条目会与自绘控件重复）。
 * 负 priority 是主判据（分配秩即遮蔽意图）；`dyn/` 前缀是兜底（防旧宿主/
 * 未来守卫变化下 priority 未落进条目 options 的形态）。
 */
export function isShadowingOccupant(entry: SlotEntryLike): boolean {
  const options = (entry as { options?: { priority?: number; registrant?: string } }).options;
  const priority = options?.priority;
  if (typeof priority === 'number' && priority < 0) return true;
  const registrant = entry.registrant ?? options?.registrant;
  return typeof registrant === 'string' && registrant.startsWith('dyn/');
}

/**
 * 单条目渲染（座位镜像与单值座共用）：官方 SessionEntry → renderEntry 的
 * props 展开式 `{...standard(kit), sessionId, ...entryInjectProps, ...t,
 * ...ownerProps}`——owner props 最后展开（如模型座的 `locked` 不被 kit 覆盖）。
 * 逐条目 EntryBoundary 隔离：单个条目崩溃只丢本座位。
 */
export function renderSlotEntry(
  entry: SlotEntryLike,
  key: string,
  options: {
    sessionId: string;
    standard: Record<string, unknown> | undefined;
    /** 官方 renderSlot 第二参数的 owner props（如模型座 { locked }）。 */
    ownerProps?: Record<string, unknown> | undefined;
    /** 条目崩溃时的兜底渲染（单值座让位用：回退自绘控件；缺省 null）。 */
    fallback?: React.ReactNode;
  },
): JSX.Element {
  const { sessionId, standard, ownerProps, fallback } = options;
  const Comp = entry.component as React.ComponentType<Record<string, unknown>>;
  // 条目词典的 t（官方 localeSeat 同款）；无 locale 或绑定失败 → 不下发，
  // 组件按各自回退（如 enhancer 回退内置中文词典）。
  let t: unknown;
  try {
    t = translatorFor(entry) ?? undefined;
  } catch {
    t = undefined;
  }
  let injected: Record<string, unknown> | null = null;
  try {
    injected = entryInjectProps(entry, sessionId);
  } catch (error) {
    diagError('slot.seat.inject', error);
  }
  return createElement(
    EntryBoundary,
    { key, fallback },
    createElement(Comp, {
      ...(standard ?? {}),
      sessionId,
      ...(injected ?? {}),
      ...(t !== undefined ? { t } : {}),
      ...(ownerProps ?? {}),
    }),
  );
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
 *
 * 为什么额外记「失败」：官方 renderer 是在**宿主自己的 fiber 上下文里**调
 * 这个 inject 闭包；插件侧从自己的 fiber 调会丢掉条目所属插件的 ctx 绑定，
 * 于是依赖宿主服务面的 inject 会抛 `cannot get property "remote.session"
 * without inject`（实测 dsh-model-accordion 0.2.1 的 `directoryFor`）。这是
 * 插件侧不可复现的边界——单值座镜像据此让位降级（回退自绘控件），而不是把
 * 空 props 下发给一个必然崩溃的组件。
 */
interface InjectBound {
  props: Record<string, unknown> | null;
  failed: boolean;
}
const entryInjectCache = new WeakMap<object, Map<string, InjectBound>>();

function boundInject(entry: SlotEntryLike, sessionId: string): InjectBound {
  let perSession = entryInjectCache.get(entry);
  if (!perSession) {
    perSession = new Map();
    entryInjectCache.set(entry, perSession);
  }
  const cached = perSession.get(sessionId);
  if (cached) return cached;
  let bound: InjectBound = { props: null, failed: false };
  try {
    const face = entry.inject?.(sessionId);
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
      bound = { props: rest, failed: false };
    }
  } catch (error) {
    diagError('slot.inject', error);
    bound = { props: null, failed: true };
  }
  perSession.set(sessionId, bound);
  return bound;
}

export function entryInjectProps(entry: SlotEntryLike, sessionId: string): Record<string, unknown> | null {
  if (typeof entry.inject !== 'function') return null;
  return boundInject(entry, sessionId).props;
}

/** 该条目 inject 是否抛错（宿主 ctx 绑定面缺失的判据，见上）。 */
export function entryInjectFailed(entry: SlotEntryLike, sessionId: string): boolean {
  if (typeof entry.inject !== 'function') return false;
  return boundInject(entry, sessionId).failed;
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

/**
 * 宿主 kit 减去 owner props 的原样面：供槽位条目按官方契约消费
 * （sessionId + 选择器 hook + inputActions 等）。bar 条目的 kit 里 owner
 * 专属字段（variant/blocked/disabled/placeholder/…）不该下发给子槽位条目；
 * 侧栏 body 再额外剔除注入的 useTabInfo。
 */
export function kitFromBarProps(
  props: Record<string, unknown>,
  extraOmit: readonly string[] = [],
): Record<string, unknown> {
  const {
    variant: _variant,
    blocked: _blocked,
    disabled: _disabled,
    placeholder: _placeholder,
    workspacePickerOpen: _workspacePickerOpen,
    onRequestWorkspace: _onRequestWorkspace,
    accessory: _accessory,
    hero: _hero,
    ...kit
  } = props;
  void _variant;
  void _blocked;
  void _disabled;
  void _placeholder;
  void _workspacePickerOpen;
  void _onRequestWorkspace;
  void _accessory;
  void _hero;
  for (const key of extraOmit) delete kit[key];
  return kit;
}
