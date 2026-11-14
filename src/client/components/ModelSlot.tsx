/**
 * 模型座：`conversation.input.model`（single, session）——**镜像官方条目本体**。
 *
 * 0.5.0 起的口径（「能不复刻就不复刻」）：该座由官方 client-ui-model-selection
 * 注册的 `ModelSelect` 占用，插件不再自绘模型/推理等级芯片，而是把官方条目
 * 原样渲染进自绘工具行的同一位置——模型菜单、搜索、推理等级下钻、键盘/焦点、
 * CSS 锚点跟随、Toast 全部是宿主同一份实现，行为与官方输入框逐像素一致。
 *
 * 为什么以前不自绘不行：ModelSelect 组件签名里带 `renderSlot`（它声明了
 * `conversation.input.model.label` / `.options` 两个子槽），而宿主发给本插件
 * bar 条目的 renderSlot 只能渲染本插件自己的子槽。这里用
 * `useModelChildSlotRenderer` 复刻官方 renderer 的子座合成（见 slotEntry.renderChildSlot）
 * 并以 ownerProps 覆盖注入给 ModelSelect。
 *
 * 让位语义保持不变：single 槽赢家（第三方遮蔽者 priority<0 或出厂 ModelSelect）
 * 由 `firstComponentEntry` 取到谁就渲染谁——第三方替换类插件照常接管；条目
 * inject 面不可复现（依赖宿主 fiber 服务面）或组件崩溃时回退自绘芯片
 * `fallback`，而不是让输入面消失。
 *
 * 官方 owner props：`locked`（`InputControlOwnerProps`，会话拒绝交互时置灰；
 * 官方语义 modelSeatLocked = removed || inert || !live，不含 blocked）。
 */

import { memo, useCallback } from 'react';
import type { ReactNode } from 'react';
import type { SlotEntryLike } from '../host-types';
import {
  entryId,
  entryInjectFailed,
  firstComponentEntry,
  renderChildSlot,
  renderSlotEntry,
  useSlotEntries,
} from './slotEntry';

const MODEL_SLOT = 'conversation.input.model';
const LABEL_SLOT = 'conversation.input.model.label';
const OPTIONS_SLOT = 'conversation.input.model.options';

export interface ModelSlotProps {
  sessionId: string | undefined;
  /** 宿主下发给本插件条目的 standard props 原样面（见 InputSlotSeat）。 */
  standard: Record<string, unknown> | undefined;
  /** 官方 owner prop locked。 */
  locked: boolean;
  /** 条目缺失 / inject 不可复现 / 组件崩溃时的兜底（自绘芯片）。 */
  fallback: ReactNode;
}

/**
 * 官方 `renderSlot` 的插件侧等价：ModelSelect 通过它渲染模型名徽章条目
 * （`.label`）与根菜单里追加的第三方选项（`.options`）。两个子槽各自订阅，
 * 变更时本组件重渲染，回调里同步读最新条目快照。
 */
function useModelChildSlotRenderer(
  sessionId: string | undefined,
  standard: Record<string, unknown> | undefined,
): (key: string, owner: Record<string, unknown>, options?: { fallback?: ReactNode }) => ReactNode {
  const labelEntries = useSlotEntries(LABEL_SLOT);
  const optionEntries = useSlotEntries(OPTIONS_SLOT);
  return useCallback(
    (key, owner, options) => {
      if (sessionId === undefined) return options?.fallback ?? null;
      const ctx = { sessionId, standard };
      if (key === LABEL_SLOT) return renderChildSlot('single-inline', labelEntries, owner, options, ctx);
      if (key === OPTIONS_SLOT) return renderChildSlot('list', optionEntries, owner, options, ctx);
      return options?.fallback ?? null;
    },
    [labelEntries, optionEntries, sessionId, standard],
  );
}

/** 模型座当前的赢家条目（第三方遮蔽者或出厂 ModelSelect；无则 null）。 */
export function useModelSeatOccupant(): SlotEntryLike | null {
  const entries = useSlotEntries(MODEL_SLOT);
  return firstComponentEntry(entries);
}

export const ModelSlot = memo(function ModelSlot(props: ModelSlotProps): JSX.Element {
  const { sessionId, standard, locked, fallback } = props;
  const occupant = useModelSeatOccupant();
  const renderSlot = useModelChildSlotRenderer(sessionId, standard);

  // 官方门槛：无会话不画模型座（官方 InputBar 的 sessionId 三元）。hero 态本插件
  // 仍保留自绘入口（旧 UX），因此这里回退而不是留空。
  if (sessionId === undefined || occupant === null) return <>{fallback}</>;

  // 让位可行性：条目 inject 在插件 fiber 里不可复现时（依赖宿主服务面的注入），
  // 回退自绘芯片，而不是下发必然崩溃的 props。
  if (entryInjectFailed(occupant, sessionId)) return <>{fallback}</>;

  return renderSlotEntry(occupant, `model:${entryId(occupant, 0)}`, {
    sessionId,
    standard,
    ownerProps: { locked, renderSlot },
    fallback,
  });
});

