/**
 * 槽位条目渲染的共享件：检视任意槽位的条目快照（检测即兼容）、按条目 locale
 * 绑定官方词典、快照 store 的选择器钩子合成、条目崩溃兜底边界，以及宿主 kit
 * 减去 owner props 的 standard 面（座位镜像 InputSlotSeat 与语音/模型标签
 * 共用同一套合成公式，抽到这里避免多份漂移）。
 */

import { createElement, useCallback, useRef, useSyncExternalStore, Component } from 'react';
import type { HostObservable, SlotEntryLike } from '../host-types';
import { bindForeign } from '../i18n';
import { diagError } from '../diag';
import { stash, useService } from '../services';

export type Translator = (key: string, params?: Record<string, string | number>) => string;

const EMPTY_ENTRIES: readonly unknown[] = [];

/** 槽位条目快照：entries 引用在变更之间稳定（官方契约），直接作 uSES 源。 */
export function useSlotEntries(key: string): readonly unknown[] {
  // 通过 useService 响应式读取 slots：即使 slots 晚于组件挂载到达，
  // React.memo 隔离的座位组件也能立刻订阅并生效。
  const slots = useService('slots');
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

/**
 * 槽位声明态（官方 SlotCore 检视面可区分的三种事实）：
 * - `declared`：槽位键已声明（entries 返回数组，哪怕为空 = 已声明无占用者）；
 * - `undeclared`：槽位键未声明（entries 抛错）——旧宿主没有该子槽位；
 * - `unknown`：检视面本身缺席（更老的宿主没有 entries 方法）或读值异常。
 *
 * 与 `useSlotEntries`（无条目一律归一成空数组）分开：permission/plan 这类
 * **新槽位**要求「已声明但无人占用 → 按官方留空」，而「宿主未声明 → 回退
 * 自绘控件」，两者不能混。getSnapshot 返回字符串常量，快照身份按值稳定。
 */
export type SlotDeclaration = 'declared' | 'undeclared' | 'unknown';

export function useSlotDeclaration(key: string): SlotDeclaration {
  const slots = useService('slots');
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
  const getSnapshot = useCallback((): SlotDeclaration => {
    if (!slots || typeof slots.entries !== 'function') return 'unknown';
    try {
      slots.entries(key);
      return 'declared';
    } catch {
      return 'undeclared';
    }
  }, [slots, key]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

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
 * entries 已由 SlotCore 按（priority↑, order↑）排序，带非空 id 时同 id 首个占位
 * （去重），不带 id 的条目各自保留不被 `undefined` 误合并；剩余行再按 order
 * 升序稳定排序（官方 `[...rows].sort(a.order - b.order)`）。
 *
 * `excludeIds`：镜像时跳过宿主自带条目（如 `conversation.composer.dock` 里
 * client-ui-chat 的官方 Activity/Usage 胶囊——它们的 UI 已由 Codinput 自绘数据行
 * 顶替，整座镜像会与自绘件重复，见 issue #8 运行时验证）。
 */
export function listRows(entries: readonly unknown[], excludeIds?: readonly string[]): SlotEntryLike[] {
  const seenIds = new Set<unknown>();
  const rows: SlotEntryLike[] = [];
  for (const candidate of entries) {
    const record = candidate as (SlotEntryLike & { options?: { id?: unknown } }) | null | undefined;
    if (!record || typeof record !== 'object' || !isRenderableComponent(record.component)) continue;
    const id = record.options?.id;
    if (typeof id === 'string' && excludeIds?.includes(id)) continue;
    if (id !== undefined) {
      if (seenIds.has(id)) continue;
      seenIds.add(id);
    }
    rows.push(record);
  }
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
 * 单条目渲染（座位镜像与单值座共用）：官方 SessionEntry → renderEntry 的
 * props 展开式 `{...standard(kit), sessionId, ...entryInjectProps, ...t,
 * ...ownerProps}`——owner props 最后展开（如模型座的 `locked` 不被 kit 覆盖）。
 * 逐条目 EntryBoundary 隔离：单个条目崩溃只丢本座位，换会话或换条目时自动复位。
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
    { key, fallback, resetKey: sessionId, entry },
    createElement(Comp, {
      ...(standard ?? {}),
      sessionId,
      ...(injected ?? {}),
      ...(t !== undefined ? { t } : {}),
      ...(ownerProps ?? {}),
    }),
  );
}

/**
 * 官方 `renderSlot(key, ownerProps, opts)` 的子座渲染等价（**只**给官方组件
 * 自己声明的子槽用：模型座的 `conversation.input.model.label` / `.options`）。
 */
export function renderChildSlot(
  kind: 'single-inline' | 'list',
  entries: readonly unknown[],
  ownerProps: Record<string, unknown>,
  options: { fallback?: React.ReactNode } | undefined,
  ctx: { sessionId: string; standard: Record<string, unknown> | undefined },
): React.ReactNode {
  const { sessionId, standard } = ctx;
  if (kind === 'single-inline') {
    const entry = firstComponentEntry(entries);
    if (entry === null) return options?.fallback ?? null;
    if (entryInjectFailed(entry, sessionId)) return options?.fallback ?? null;
    return renderSlotEntry(entry, `child:${entryId(entry, 0)}`, { sessionId, standard, ownerProps });
  }
  const rows = listRows(entries);
  if (rows.length === 0) return options?.fallback ?? null;
  return rows.map((entry, index) =>
    renderSlotEntry(entry, `child:${entryId(entry, index)}`, { sessionId, standard, ownerProps }),
  );
}

export type SnapshotSelectorHook = <S>(sel: (s: any) => S, eq?: (a: S, b: S) => boolean) => S;

/**
 * 快照 store → use<Name> 选择器钩子（官方 observableHook 同款，按源缓存）。
 *
 * 工程要点：
 * 1. `subscribe` 提升到工厂级（引用恒定），避免 React 在每次渲染都反反复复
 *    卸载再重订外部 store；
 * 2. 选择器结果按 `(rawSnapshot, selector, eq)` 记忆（等价 React 官方
 *    `useSyncExternalStoreWithSelector`）：支持派生对象/数组选择器与自定义
 *    `eq`，杜绝 `getSnapshot` 每次返回新对象触发 React #185 死循环。
 */
const snapshotHookCache = new WeakMap<object, SnapshotSelectorHook>();
export function snapshotHookFor(source: unknown): SnapshotSelectorHook | null {
  const face = source as HostObservable<unknown> | undefined;
  if (!face || typeof face.subscribe !== 'function' || typeof face.getSnapshot !== 'function') return null;
  let hook = snapshotHookCache.get(face);
  if (!hook) {
    const subscribe = (fn: () => void): (() => void) => face.subscribe(fn) ?? (() => {});
    hook = <S,>(sel: (s: unknown) => S, eq?: (a: S, b: S) => boolean): S => {
      const memoRef = useRef<{
        hasValue: boolean;
        raw: unknown;
        sel: ((s: unknown) => S) | undefined;
        selected: S;
      }>({ hasValue: false, raw: undefined, sel: undefined, selected: undefined as S });

      const getSelected = (): S => {
        const raw = face.getSnapshot();
        const prev = memoRef.current;
        if (prev.hasValue && Object.is(raw, prev.raw) && Object.is(sel, prev.sel)) {
          return prev.selected;
        }
        const next = sel(raw);
        if (prev.hasValue && (eq ? eq(prev.selected, next) : Object.is(prev.selected, next))) {
          prev.raw = raw;
          prev.sel = sel;
          return prev.selected;
        }
        prev.hasValue = true;
        prev.raw = raw;
        prev.sel = sel;
        prev.selected = next;
        return next;
      };

      return useSyncExternalStore(subscribe, getSelected, getSelected);
    };
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
 * （现网条目无键控钩子）。结果按（条目 × 会话 × 绑定代）缓存，且按 LRU 上限
 * 淘汰陈旧会话，避免已释放的 SessionBinding 被强引用钉死在内存里。
 */
interface InjectBound {
  props: Record<string, unknown> | null;
  failed: boolean;
  /**
   * 本次 inject 结果所属的「会话绑定代」（Host 的 SessionBinding / Agent scope
   * 对象）。Host 在会话重新驻留时会重建 scope 与 binding——切走再切回同一会话
   * 就是最常见的触发路径。缓存必须按代失效，代变即重新 inject（失败结果同样按代重试）。
   */
  token: unknown;
}

const INJECT_CACHE_MAX = 16;
const entryInjectCache = new WeakMap<object, Map<string, InjectBound>>();

/**
 * 会话绑定代标记：同一份驻留期间引用稳定，重新驻留时换新对象。
 *
 * 优先取 `sessions.binding`（Host 侧按它缓存每会话控制器，正是 inject 面漂移
 * 的同一根轴）；服务未就绪或会话暂不可解析时退化为 `sessions.scope`，再退化
 * 为 null——null 与任何真实对象都不相等，下一次能解析出来即重新 inject。
 */
function sessionGeneration(sessionId: string): unknown {
  try {
    const sessions = stash.sessions;
    if (sessions === undefined) return null;
    const binding = sessions.binding?.(sessionId);
    if (binding !== undefined && binding !== null) return binding;
    return sessions.scope?.(sessionId) ?? null;
  } catch {
    return null;
  }
}

function boundInject(entry: SlotEntryLike, sessionId: string): InjectBound {
  let perSession = entryInjectCache.get(entry);
  if (!perSession) {
    perSession = new Map();
    entryInjectCache.set(entry, perSession);
  }
  const token = sessionGeneration(sessionId);
  const cached = perSession.get(sessionId);
  if (cached !== undefined && cached.token === token) {
    // 刷新 LRU 序
    perSession.delete(sessionId);
    perSession.set(sessionId, cached);
    return cached;
  }
  let bound: InjectBound = { props: null, failed: false, token };
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
      bound = { props: rest, failed: false, token };
    }
  } catch (error) {
    diagError('slot.inject', error);
    bound = { props: null, failed: true, token };
  }
  perSession.delete(sessionId);
  perSession.set(sessionId, bound);
  while (perSession.size > INJECT_CACHE_MAX) {
    const oldest = perSession.keys().next().value;
    if (oldest === undefined) break;
    perSession.delete(oldest);
  }
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

/**
 * 条目崩溃只丢本座位，不连坐 Codinput 的 bar 条目（被废黜 = 输入面消失）。
 * 切换会话（`resetKey` 变化）或条目实例替换（`entry` 变化）时自动复位，
 * 避免一次瞬态异常把座位永久锁死在 fallback。
 */
export class EntryBoundary extends Component<
  { children?: React.ReactNode; fallback?: React.ReactNode; resetKey?: unknown; entry?: unknown },
  { failed: boolean; lastResetKey: unknown; lastEntry: unknown }
> {
  state = { failed: false, lastResetKey: this.props.resetKey, lastEntry: this.props.entry };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  static getDerivedStateFromProps(
    props: { resetKey?: unknown; entry?: unknown },
    state: { failed: boolean; lastResetKey: unknown; lastEntry: unknown },
  ): { failed?: boolean; lastResetKey: unknown; lastEntry: unknown } | null {
    if (Object.is(props.resetKey, state.lastResetKey) && Object.is(props.entry, state.lastEntry)) {
      return null;
    }
    return {
      ...(state.failed ? { failed: false } : {}),
      lastResetKey: props.resetKey,
      lastEntry: props.entry,
    };
  }

  componentDidCatch(error: unknown): void {
    diagError('slot.entry', error);
  }

  render(): React.ReactNode {
    return this.state.failed ? this.props.fallback ?? null : this.props.children;
  }
}

/**
 * 稳定版 standard kit：先过滤掉 owner props 得到 `nextKit`，再逐键浅比较
 * `prevKit` 与 `nextKit`——被剔除的 owner prop（placeholder/blocked/disabled/
 * useTabInfo 等）变化时不再误杀 kit 引用，`React.memo` 子组件（StatsRow /
 * 各镜像座位）真正稳定 bail-out。
 */
export function useStableKit(
  props: Record<string, unknown>,
  extraOmit: readonly string[] = [],
): Record<string, unknown> {
  const cache = useRef<Record<string, unknown> | null>(null);
  const nextKit = kitFromBarProps(props, extraOmit);
  const prev = cache.current;
  if (prev !== null) {
    const prevKeys = Object.keys(prev);
    const nextKeys = Object.keys(nextKit);
    if (prevKeys.length === nextKeys.length) {
      let same = true;
      for (const key of nextKeys) {
        if (!Object.prototype.hasOwnProperty.call(prev, key) || prev[key] !== nextKit[key]) {
          same = false;
          break;
        }
      }
      if (same) return prev;
    }
  }
  cache.current = nextKit;
  return nextKit;
}

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
