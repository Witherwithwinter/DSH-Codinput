/**
 * 语音输入按钮：渲染官方 voice-input 插件注册在 conversation.input.activity
 * 槽位的**条目组件本体**（麦克风触发钮、录音波形、转写、未就绪引导弹窗全部
 * 是官方代码，其闭包自带 primitives 与样式注入）。
 *
 * 检测即兼容：官方桌面版（0.2.0-rc.2 起）挂载 experimental-client-ui-voice-input
 * 后，原生输入框工具行右侧（模型选择器与发送钮之间）出现麦克风钮；web 宿主
 * （0.1.x）没有该插件、槽位无条目，官方输入框也没有按钮——Codinput 同样不
 * 渲染。条目出现/消失经 slots.subscribe 响应式跟随（用户开关语音插件即时生效）。
 *
 * props 组装复刻官方 renderer 的合成公式：
 *   {...standard(sessionId/inputActions), ...entry.inject()（其 hooks 子表的
 *   speechReadiness 按 standardHookPropName 变成 useSpeechReadiness 选择器钩子）,
 *   ...ownerProps(locked/onActiveChange), t = locale.bind(entry.locale)}
 * inject 结果按（条目 × 会话）缓存——官方 renderer 同款缓存轴，避免每次渲染
 * 重建对象让钩子身份漂移。宿主未就绪（slots 无检视面 / inject 不可调 /
 * locale 缺席）一律不渲染，绝不半组装。
 */

import { createElement, useMemo, useSyncExternalStore } from 'react';
import type { HostObservable, SlotEntryLike } from '../host-types';
import { diagError } from '../diag';
import { EntryBoundary, firstComponentEntry, translatorFor, useSlotEntries } from './slotEntry';

const ACTIVITY_SLOT = 'conversation.input.activity';
const VOICE_NS_FALLBACK = 'voice-input';

type ReadinessSelector = (value: unknown) => unknown;
type ReadinessHook = (selector: ReadinessSelector) => unknown;

/** observableHook 同款缓存轴：钩子身份按 readiness store 稳定，不逐渲染重订。 */
const readinessHookCache = new WeakMap<object, ReadinessHook>();
/** 官方 renderer 的 inject 缓存轴：条目 × 会话绑定。 */
const injectCache = new WeakMap<object, Map<string, Record<string, unknown> | null>>();

/** 调条目 inject 工厂取 props 面（session 槽位以 sessionId 调用，官方同参）。 */
function resolveInjected(entry: SlotEntryLike, sessionId: string): Record<string, unknown> | null {
  if (typeof entry.inject !== 'function') return null;
  let perSession = injectCache.get(entry);
  if (!perSession) {
    perSession = new Map();
    injectCache.set(entry, perSession);
  }
  if (!perSession.has(sessionId)) {
    let face: Record<string, unknown> | null = null;
    try {
      face = (entry.inject as (key: string) => Record<string, unknown>)(sessionId) ?? null;
    } catch (error) {
      diagError('voice.inject', error);
      face = null;
    }
    perSession.set(sessionId, face);
  }
  return perSession.get(sessionId) ?? null;
}

/** hooks.speechReadiness（快照 store）→ use<Name> 选择器钩子（observableHook 同款）。 */
function readinessHookFor(source: unknown): ReadinessHook | null {
  const face = source as HostObservable<unknown> | undefined;
  if (!face || typeof face.subscribe !== 'function' || typeof face.getSnapshot !== 'function') return null;
  let hook = readinessHookCache.get(face);
  if (!hook) {
    hook = (selector: ReadinessSelector): unknown =>
      useSyncExternalStore(
        (fn: () => void) => face.subscribe(fn) ?? (() => {}),
        () => selector(face.getSnapshot()),
        () => selector(face.getSnapshot()),
      );
    readinessHookCache.set(face, hook);
  }
  return hook;
}

export interface VoiceActivityProps {
  sessionId: string | undefined;
  /** 官方输入机动作面（bar 槽位 standard props 里的 inputActions 原样透传）。 */
  inputActions: unknown;
  /** 输入锁定（官方 ownerProps.locked：submitting/inert 时触发钮禁用）。 */
  locked: boolean;
  /** 展开/收起上报（官方 ownerProps.onActiveChange：录音时宿主隐藏其余工具）。 */
  onActiveChange(active: boolean): void;
}

export function VoiceActivity(props: VoiceActivityProps): JSX.Element | null {
  const { sessionId, inputActions, locked, onActiveChange } = props;
  const entries = useSlotEntries(ACTIVITY_SLOT);

  // single 槽位赢家 = 优先级最低者 = entries 首个（register 即按优先级排序）。
  const entry = useMemo(() => firstComponentEntry(entries), [entries]);

  const injected = useMemo(
    () => (entry && sessionId ? resolveInjected(entry, sessionId) : null),
    [entry, sessionId],
  );
  const translator = useMemo(() => (entry ? translatorFor(entry, VOICE_NS_FALLBACK) : null), [entry]);
  const readinessSource = (injected?.['hooks'] as { speechReadiness?: unknown } | undefined)?.speechReadiness;
  const useReadiness = useMemo(() => readinessHookFor(readinessSource), [readinessSource]);

  if (!entry || !sessionId || !injected || !translator || !useReadiness) return null;

  // hooks 子表已折成 use* 钩子（bindInjectSources 同款），其余 props 原样下传。
  const { hooks: _hooks, ...actions } = injected;
  void _hooks;
  return createElement(EntryBoundary, {
    children: createElement(entry.component as React.ComponentType<Record<string, unknown>>, {
      sessionId,
      inputActions,
      locked,
      onActiveChange,
      ...actions,
      useSpeechReadiness: useReadiness,
      t: translator,
    }),
  });
}
