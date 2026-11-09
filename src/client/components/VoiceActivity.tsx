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
 *   {...standard(sessionId/inputActions), ...entry.inject()（hooks 子表的每个
 *   快照 store 按 standardHookPropName 折成 use<Name> 选择器钩子）,
 *   ...t = locale.bind(entry.locale), ...ownerProps(locked/onActiveChange)}
 * 折叠走 slotEntry.entryInjectProps（= 官方 bindInjectSources 的插件侧复刻，
 * 按条目 × 会话缓存 inject 面、按 store 身份缓存钩子）——**不能只折已知钩子**：
 * 0.2.2 的 voice-input inject 返回
 *   { openSettings, hooks: { speechReadiness, microphoneDevice, pluginNavigation },
 *     selectMicrophone, createRecording, transcribe, ... }
 * 而 VoiceInput 组件会调用 useSpeechReadiness / useMicrophoneDevice /
 * usePluginNavigation 三个钩子；旧实现只绑了 speechReadiness，另外两个未定义
 * 直接抛错，被 EntryBoundary 静默吞掉 → 麦克风整体不渲染（0.2.2 回归根因）。
 * 通用折叠后旧宿主（hooks 表只有 speechReadiness 的旧条目）同样成立。
 *
 * 宿主未就绪（slots 无检视面 / inject 不可调 / locale 缺席）一律不渲染，
 * 绝不半组装；条目崩溃仍由 EntryBoundary 隔离（只丢本座位）。
 */

import { createElement, useMemo } from 'react';
import { EntryBoundary, entryInjectProps, firstComponentEntry, translatorFor, useSlotEntries } from './slotEntry';

const ACTIVITY_SLOT = 'conversation.input.activity';
const VOICE_NS_FALLBACK = 'voice-input';

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

  // inject 面：通用 hooks→use<Name> 折叠加其余字段原样（entryInjectProps 自带
  // 条目 × 会话缓存与失败标记，这里不再自建缓存）。
  const injected = useMemo(
    () => (entry && sessionId ? entryInjectProps(entry, sessionId) : null),
    [entry, sessionId],
  );
  const translator = useMemo(() => (entry ? translatorFor(entry, VOICE_NS_FALLBACK) : null), [entry]);

  if (!entry || !sessionId || !injected || !translator) return null;

  // 官方 renderEntry 展开顺序：standard kit → inject 面 → 条目词典 t → owner props。
  // owner props 最后展开（与官方一致：条目 inject 不得覆盖 locked/onActiveChange）。
  return createElement(
    EntryBoundary,
    null,
    createElement(entry.component as React.ComponentType<Record<string, unknown>>, {
      sessionId,
      inputActions,
      ...injected,
      t: translator,
      locked,
      onActiveChange,
    }),
  );
}
