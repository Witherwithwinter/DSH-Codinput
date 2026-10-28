/**
 * 模型座单值镜像（issue #4）：`conversation.input.model`。
 *
 * 座位事实（宿主 0.2.1-rc.2 取证）：
 * - `conversation.input.model` 是 `{kind:"single", scope:"session"}` 单值槽，
 *   由官方 InputBar 条目（`conversation.composer.bar` 缺省条目）声明，唯一
 *   渲染点在 InputBar 体内：`input.model → renderSlot(..., { locked })`；
 *   官方占用者是 client-ui-model-selection 的 ModelSelect（替换风险标记
 *   `shadows-shipped-ui`，生态替换类插件按契约以 priority 遮蔽它）。
 * - Codinput 以 priority 遮蔽整个 bar 后，该 renderSlot 调用点随官方条目一起
 *   消失；但「遮蔽」不是 dispose——宿主条目仍在 ledger 上，座位声明仍在，
 *   第三方对它的 `slots.inject` 照常触发、`register` 照常成功（单值槽低
 *   priority 无人竞争时静默赢）、`entries` 里它确实是赢家，只是没有任何
 *   renderSlot 会读它。表现为「插件装了、不报错、永不上屏」。
 *
 * 本组件的收敛口径（0.3.6 起）：
 * - **只镜像第三方遮蔽者**（宿主动态包：register 被强制分配负数遮蔽秩、
 *   fiber 名带 `dyn/` 前缀），见 `isShadowingOccupant`；
 * - **出厂占用的 ModelSelect 不镜像**——那个座位一直由 Codinput 自绘的模型
 *   芯片代表（模型名显示仍走官方 `conversation.input.model.label` 子座），
 *   镜像出厂条目会与自绘芯片重复成两个模型选择器；
 * - 有第三方遮蔽者时**让位**：镜像其组件、隐藏自绘芯片（同座只留一个控件，
 *   与官方「一个单值座只画一个占用者」一致）。
 *
 * 官方门槛同款复刻：`sessionId === undefined` 时该座位不渲染（此时自绘芯片
 * 保持现状）。owner prop `locked`（官方 `InputControlOwnerProps`：会话是否
 * 拒绝交互）原样下发——生态替换类插件按契约消费它（如 reasoning-slider 的
 * `props.locked === true` 置灰）。
 */

import { useMemo } from 'react';
import type { ReactNode } from 'react';
import type { SlotEntryLike } from '../host-types';
import {
  entryId,
  entryInjectFailed,
  firstComponentEntry,
  isShadowingOccupant,
  renderSlotEntry,
  useSlotEntries,
} from './slotEntry';

const MODEL_SLOT = 'conversation.input.model';

export interface ModelSlotProps {
  sessionId: string | undefined;
  /** 宿主下发给本插件条目的 standard props 原样面（见 InputSlotSeat）。 */
  standard: Record<string, unknown> | undefined;
  /** 官方 owner prop locked（会话拒绝交互时第三方座条目应置灰）。 */
  locked: boolean;
  /** 无第三方遮蔽者时的自绘模型芯片（保持既有 UX）。 */
  fallback: ReactNode;
}

/** 模型座的第三方遮蔽者（无则 null）：单值槽赢家且命中动态包判据。 */
export function useModelSeatOccupant(): SlotEntryLike | null {
  const entries = useSlotEntries(MODEL_SLOT);
  return useMemo(() => {
    const winner = firstComponentEntry(entries);
    return winner !== null && isShadowingOccupant(winner) ? winner : null;
  }, [entries]);
}

export function ModelSlot(props: ModelSlotProps): JSX.Element | null {
  const { sessionId, standard, locked, fallback } = props;
  const occupant = useModelSeatOccupant();

  // 官方门槛：无会话不画该座位；自绘芯片（fallback）保持既有行为。
  if (sessionId === undefined || occupant === null) return <>{fallback}</>;

  // 让位可行性：inject 面必须在宿主 fiber 上下文里才算数（见 slotEntry）。
  // 若该条目的 inject 依赖宿主服务面（插件侧调用会抛 without inject），
  // 让位降级——回退自绘芯片（它本就是官方模型选择的等价物），而不是留空。
  if (entryInjectFailed(occupant, sessionId)) return <>{fallback}</>;

  return renderSlotEntry(occupant, `model:${entryId(occupant, 0)}`, {
    sessionId,
    standard,
    ownerProps: { locked },
    // 组件本体崩溃同样回退自绘芯片（逐条目边界已在 renderSlotEntry 内）。
    fallback,
  });
}
