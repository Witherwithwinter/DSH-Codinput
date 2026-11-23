/**
 * 数据行的 `conversation.composer.dock` 座位薄壳（引擎见 InputSlotSeat，
 * 与左右座共用同一套 list 合成）。
 *
 * 官方口径（0.2.2 `InputBar.tsx` + `SlotOutlet`）：
 * 卡片下方 `.dock[data-composer-dock="true"]` 内渲染
 * `<div data-slot="conversation.composer.dock" style="display: contents">` 包裹的
 * list 槽位条目，再跟官方 `ContextMeter`。
 *
 * 必须保留 `display: contents` 的 `[data-slot="conversation.composer.dock"]` 外壳：
 * - 官方 `ActivityPill` / `UsagePill` 与第三方追加型插件（如 `dsh-cost-meter`）按官方
 *   `list` 顺序原样呈现；
 * - 第三方替换型状态栏插件（如 `dsh-desktop-statusbar`）通过
 *   `[data-slot="conversation.composer.dock"]` 选择器隐藏官方统计胶囊，缺少该属性
 *   外壳会导致官方胶囊无法被替换插件隐藏。
 */

import { InputSlotSeat } from './InputSlotSeat';

export const COMPOSER_DOCK_SLOT = 'conversation.composer.dock';

export interface ComposerDockSlotProps {
  sessionId: string | undefined;
  /** 宿主下发给 bar 条目的 standard props 原样面（见 InputSlotSeat）。 */
  standard: Record<string, unknown> | undefined;
}

export function ComposerDockSlot(props: ComposerDockSlotProps): JSX.Element | null {
  return (
    <div data-slot={COMPOSER_DOCK_SLOT} style={{ display: 'contents' }}>
      <InputSlotSeat
        slot={COMPOSER_DOCK_SLOT}
        sessionId={props.sessionId}
        standard={props.standard}
      />
    </div>
  );
}
