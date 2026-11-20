/**
 * 语音输入按钮：渲染官方 voice-input 插件注册在 conversation.input.activity
 * 槽位的**条目组件本体**（麦克风触发钮、录音波形、转写、未就绪引导弹窗全部
 * 是官方代码，其闭包自带 primitives 与样式注入）。
 *
 * 检测即兼容：官方桌面版（0.2.0-rc.2 起）挂载 experimental-client-ui-voice-input
 * 后，原生输入框工具行右侧（模型选择器与发送钮之间）出现麦克风钮；条目出现/
 * 消失经 slots.subscribe 响应式跟随（用户开关语音插件即时生效）。
 *
 * 注意：不把 `entryInjectProps` 包进 `[entry, sessionId]` 的 `useMemo`——
 * 会话切走再切回时 `sessionId` 相同但绑定代已变，`entryInjectProps` 内部自带
 * 按 `(entry × sessionId × generation)` 的 O(1) 缓存，直调即可同步换代。
 */

import { createElement, memo, useMemo } from 'react';
import { EntryBoundary, entryInjectProps, firstComponentEntry, translatorFor, useSlotEntries } from './slotEntry';

const ACTIVITY_SLOT = 'conversation.input.activity';
const VOICE_NS_FALLBACK = 'voice-input';

export interface VoiceActivityProps {
  sessionId: string | undefined;
  /** 宿主下发给本插件条目的 standard props 原样面（含 inputActions 等）。 */
  standard?: Record<string, unknown> | undefined;
  /** 官方输入机动作面（兜底透传，当 standard 缺席时仍保证 inputActions 可达）。 */
  inputActions: unknown;
  /** 输入锁定（官方 ownerProps.locked：submitting/inert 时触发钮禁用）。 */
  locked: boolean;
  /** 展开/收起上报（官方 ownerProps.onActiveChange：录音时宿主隐藏其余工具）。 */
  onActiveChange(active: boolean): void;
}

export const VoiceActivity = memo(function VoiceActivity(props: VoiceActivityProps): JSX.Element | null {
  const { sessionId, standard, inputActions, locked, onActiveChange } = props;
  const entries = useSlotEntries(ACTIVITY_SLOT);

  // single 槽位赢家 = 优先级最低者 = entries 首个（register 即按优先级排序）。
  const entry = useMemo(() => firstComponentEntry(entries), [entries]);
  // 直调 entryInjectProps（内部自带 sessionGeneration 换代缓存），避免切回会话时读到旧代。
  const injected = entry && sessionId ? entryInjectProps(entry, sessionId) : null;
  const translator = useMemo(() => (entry ? translatorFor(entry, VOICE_NS_FALLBACK) : null), [entry]);

  if (!entry || !sessionId || !injected || !translator) return null;

  // 官方 renderEntry 展开顺序：standard kit → inject 面 → 条目词典 t → owner props。
  // owner props 最后展开（与官方一致：条目 inject 不得覆盖 locked/onActiveChange）。
  return createElement(
    EntryBoundary,
    { resetKey: sessionId, entry },
    createElement(entry.component as React.ComponentType<Record<string, unknown>>, {
      ...(standard ?? {}),
      sessionId,
      inputActions,
      ...injected,
      t: translator,
      locked,
      onActiveChange,
    }),
  );
});
