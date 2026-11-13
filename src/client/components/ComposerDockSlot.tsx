/**
 * 数据行的 `conversation.composer.dock` 座位薄壳（issue #8；引擎见
 * InputSlotSeat，与左右座共用同一套 list 合成）。
 *
 * 官方口径（0.2.2-rc.1 `InputBar.tsx`）：卡片下方 `.dock` 容器内
 * `[renderSlot("conversation.composer.dock", {}), ContextMeter]`——list 座、
 * owner props 为空，且只在 `variant === "composer" && input && sessionId` 时渲染。
 * bar 被遮蔽后这个渲染点随官方输入框一起消失：注册在这里的第三方条目
 * （dsh-cost-meter 默认 `position="dock"`、dsh-quota-meter 等）整块 UI 静默不见。
 *
 * 本组件在复刻数据行（StatsRow）的胶囊组之前把条目按官方 list 语义渲染回来。
 * 门槛与官方同款：sessionId 缺省不渲染；槽位未声明/无条目 → 零残留。
 *
 * 只镜像**第三方**条目：官方宿主自己也在这个座位注册了 ActivityPill(id
 * `activity`, order 0) 与 UsagePill(id `usage`, order 1)（client-ui-chat；
 * slot catalog `occupants` 与隔离宿主运行时 dump 双证），而 Codinput 数据行的
 * 自绘胶囊正是它们的替代品——整座镜像会与自绘件重复（issue #8 运行时验证：
 * 数据行 3 项 → 5 项）。因此镜像时跳过 `SHIPPED_DOCK_IDS`，官方 stats 仍由
 * 自绘数据行承担；`ContextMeter` 等价物同样由自绘上下文小圈承担。
 */

import { InputSlotSeat } from './InputSlotSeat';

export const COMPOSER_DOCK_SLOT = 'conversation.composer.dock';

/**
 * 宿主自带的 composer.dock 条目 id（0.2.2-rc.1 `client-ui-chat` 注册，
 * slot catalog `occupants: ["client-ui-chat ActivityPill id 'activity'",
 * "client-ui-chat UsagePill id 'usage'"]`）。宿主升级后按新 catalog 复核：
 * 失配的表现是「数据行重新出现重复胶囊」，属于可见回归。
 */
export const SHIPPED_DOCK_IDS: readonly string[] = ['activity', 'usage'];

export interface ComposerDockSlotProps {
  sessionId: string | undefined;
  /** 宿主下发给 bar 条目的 standard props 原样面（见 InputSlotSeat）。 */
  standard: Record<string, unknown> | undefined;
}

export function ComposerDockSlot(props: ComposerDockSlotProps): JSX.Element | null {
  return (
    <InputSlotSeat
      slot={COMPOSER_DOCK_SLOT}
      sessionId={props.sessionId}
      standard={props.standard}
      excludeIds={SHIPPED_DOCK_IDS}
    />
  );
}
