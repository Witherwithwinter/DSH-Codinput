/**
 * 第三方输入按钮转发：渲染注册在 conversation.input.right 子槽位上的**条目
 * 组件本体**（如 dsh-prompt-enhancer 的 ✨ 提示词优化与 🎤 语音识别按钮）。
 *
 * 为什么需要这里：该槽位由官方 InputBar（conversation.composer.bar 的缺省
 * 条目）声明并在其工具行内渲染——Codinput 以 priority -1 遮蔽官方条目后，
 * 槽位声明仍在（宿主按注册周期记账），但渲染点随官方输入框一起消失，第三方
 * 按钮便无处挂载。本组件在自绘工具行的同座位（.dci-standard-controls 内、
 * 模型选择之前，与官方 InputBar 的 [renderSlot(input.right), input.model]
 * 顺序一致）复刻官方 renderer 的 list 合成，把条目原样渲染回来。
 *
 * props 合成复刻官方 SessionEntry → renderEntry 的展开式：
 *   {...standard(kit), ...entryInject(entry, sessionId), ...ownerProps({}), t = locale.bind(entry.locale)}
 * standard 走 bar/session 条目已下发的原样通道（CodinputBar 与
 * SidebarCodinputBody 把宿主 kit props 减去 owner props 传下来）——第三方
 * 条目按官方契约只消费 sessionId + useSession/useInput 选择器 hook +
 * inputActions（enhancer v3.4.x 实证），绝不重新物化宿主绑定。
 *
 * 检测即兼容：无条目 → 渲染 null；单条目崩溃被 EntryBoundary 隔离，不连坐
 * 输入面；旧宿主（0.1.x）槽位未声明 → entries 空数组，同样不渲染。
 * 条目声明 store 的 useStore/actions 面插件侧不可复现（官方 host.storeOf
 * 私有），现网无此类条目；如出现则降级为无 store props 渲染。
 */

import { createElement, useMemo } from 'react';
import type { SlotEntryLike } from '../host-types';
import { diagError } from '../diag';
import { EntryBoundary, entryId, entryInjectProps, listRows, translatorFor, useSlotEntries } from './slotEntry';

const RIGHT_SLOT = 'conversation.input.right';

export interface InputRightSlotProps {
  sessionId: string | undefined;
  /** 宿主下发给本插件条目的 standard props 原样面（见组件头注释）。 */
  standard: Record<string, unknown> | undefined;
}

export function InputRightSlot(props: InputRightSlotProps): JSX.Element | null {
  const { sessionId, standard } = props;
  const entries = useSlotEntries(RIGHT_SLOT);
  // 官方 list 合成：id 首占位去重 + order 升序（entries 快照引用稳定，直接 memo）。
  const rows = useMemo(() => listRows(entries), [entries]);

  // 官方同款门槛：无会话不渲染（input.right 是 strict session 槽位）。
  if (sessionId === undefined || rows.length === 0) return null;

  return (
    <>
      {rows.map((entry, index) => {
        const Comp = entry.component as React.ComponentType<Record<string, unknown>>;
        // 条目词典的 t（官方 localeSeat 同款）；无 locale 或绑定失败 → 不下发，
        // 组件按各自回退（enhancer 回退内置中文词典）。
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
          diagError('inputRight.inject', error);
        }
        return createElement(
          EntryBoundary,
          { key: entryId(entry, index) },
          createElement(Comp, {
            ...(standard ?? {}),
            sessionId,
            ...(injected ?? {}),
            ...(t !== undefined ? { t } : {}),
          }),
        );
      })}
    </>
  );
}

/** 供 CodinputBar/SidebarCodinputBody 复用：宿主 kit 减去 owner props 的原样面。 */
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
