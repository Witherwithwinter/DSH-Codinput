/**
 * 左座薄壳（v0.3.5 新增；引擎见 InputSlotSeat）。
 *
 * 座位 = conversation.input.left：官方工具行左区 `.tools` 内
 * [renderSlot(input.permission), renderSlot(input.plan), renderSlot(input.left)]
 * 的末位——issue #1 里「上传视频」按钮、dsh-qoder-plugin 的额度读数等第三方
 * 条目所在座位。遮蔽官方条目后该渲染点消失，本组件在自绘工具行左区同位置
 * （`.dci-tools` 内、权限触发器之后）复刻官方 renderer 的 list 合成。
 *
 * 门槛与官方同款：`input === undefined || sessionId === undefined` 不渲染
 * （Toolbar 判断 state，组件再兜底 sessionId）；槽位未声明/无条目 → 零残留。
 */

import { InputSlotSeat } from './InputSlotSeat';

const LEFT_SLOT = 'conversation.input.left';

export interface InputLeftSlotProps {
  sessionId: string | undefined;
  /** 宿主下发给本插件条目的 standard props 原样面（见 InputSlotSeat）。 */
  standard: Record<string, unknown> | undefined;
}

export function InputLeftSlot(props: InputLeftSlotProps): JSX.Element | null {
  return <InputSlotSeat slot={LEFT_SLOT} sessionId={props.sessionId} standard={props.standard} />;
}
