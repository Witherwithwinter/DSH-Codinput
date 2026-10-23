/**
 * 右座薄壳（v0.3.4 引入；v0.3.5 起与左座共用 InputSlotSeat 通用引擎）。
 *
 * 座位 = conversation.input.right：官方工具行 `.standardControls` 内
 * [renderSlot(input.right), renderSlot(input.model)] 的第一位——
 * 如 dsh-prompt-enhancer 的 ✨ 提示词优化与 🎤 语音识别按钮、各渠道插件的
 * 积分/余额读数。本组件在自绘工具行的同座位（`.dci-standard-controls` 内、
 * 模型选择之前）把条目原样渲染回来。
 *
 * 门槛与官方同款：`input === undefined || sessionId === undefined` 不渲染
 * （Toolbar 判断 state，组件再兜底 sessionId）；槽位未声明/无条目 → 零残留。
 */

import { InputSlotSeat } from './InputSlotSeat';

const RIGHT_SLOT = 'conversation.input.right';

export interface InputRightSlotProps {
  sessionId: string | undefined;
  /** 宿主下发给本插件条目的 standard props 原样面（见 InputSlotSeat）。 */
  standard: Record<string, unknown> | undefined;
}

export function InputRightSlot(props: InputRightSlotProps): JSX.Element | null {
  return <InputSlotSeat slot={RIGHT_SLOT} sessionId={props.sessionId} standard={props.standard} />;
}
