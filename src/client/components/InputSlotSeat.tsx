/**
 * 座位镜像通用引擎：把注册在官方 InputBar 子槽位（conversation.input.left /
 * conversation.input.right 等，均为 list/session）上的**条目组件本体**在自绘
 * 工具行的对应座位重新渲染。
 *
 * 为什么需要这里：这些子槽位由官方 InputBar（conversation.composer.bar 的缺省
 * 条目）声明并在其工具行内渲染——Codinput 以 priority -1 遮蔽官方条目后，槽位
 * 声明仍在（宿主按注册周期记账），但渲染点随官方输入框一起消失，第三方按钮/
 * 读数便无处挂载（issue #1）。本组件复刻官方 renderer 的 list 合成，座位名与
 * standard props 面由调用方给（InputLeftSlot / InputRightSlot 两片薄壳）——
 * 一套引擎、N 个座位。
 *
 * props 合成复刻官方 SessionEntry → renderEntry 的展开式：
 *   {...standard(kit), ...entryInjectProps(entry, sessionId), ...(t)}
 * standard 走 bar/session 条目已下发的原样通道（CodinputBar 与
 * SidebarCodinputBody 把宿主 kit props 减去 owner props 传下来）——第三方
 * 条目按官方契约消费 sessionId + useSession/useInput 选择器 hook +
 * inputActions（enhancer v3.4.x 实证），有的条目还从 inject 面拿自带 props
 * （如 qoder 左座的 directory store 与 t）；这里只做原样转发，绝不重新
 * 物化宿主绑定。
 *
 * 检测即兼容：无条目 → 渲染 null；单条目崩溃被 EntryBoundary 隔离，不连坐
 * 输入面；旧宿主（无该子槽位声明）槽位未声明 → entries 空数组，同样不渲染。
 * 条目声明 store 的 useStore/actions 面插件侧不可复现（官方 host.storeOf
 * 私有），现网无此类条目；如出现则降级为无 store props 渲染。
 */

import { createElement, useMemo } from 'react';
import { diagError } from '../diag';
import { EntryBoundary, entryId, entryInjectProps, listRows, translatorFor, useSlotEntries } from './slotEntry';

export interface InputSlotSeatProps {
  /** 官方子槽位全名（如 conversation.input.left）。 */
  slot: string;
  sessionId: string | undefined;
  /** 宿主下发给本插件条目的 standard props 原样面（见组件头注释）。 */
  standard: Record<string, unknown> | undefined;
}

export function InputSlotSeat(props: InputSlotSeatProps): JSX.Element | null {
  const { slot, sessionId, standard } = props;
  const entries = useSlotEntries(slot);
  // 官方 list 合成：id 首占位去重 + order 升序（entries 快照引用稳定，直接 memo）。
  const rows = useMemo(() => listRows(entries), [entries]);

  // 官方同款门槛：无会话不渲染（input.left / input.right 都是 strict session 槽位）。
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
          diagError('slot.seat.inject', error);
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
