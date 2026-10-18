/**
 * 模型名标签：渲染官方 model-selection 在 `conversation.input.model.label`
 * 子槽位（0.2.1 起）的条目组件本体——桌面版宿主挂载
 * dsh-client-ui-deepseek-model-label-1017 后，官方给 deepseek-flash 的
 * 目录名「DeepSeek-V4.1-Flash」后面追加一枚 info 色发布徽章「1017」
 * （Tag 原语，官方插件的样式注入自带）。web 宿主（0.1.x）没有该插件、
 * 槽位键也未声明，条目为空 → 回退纯名，与官方两个宿主的表现各自一致。
 *
 * 渲染公式复刻官方 ModelSelect.renderModelLabel：外包
 * span[data-provider-id][data-model-id]，条目 props = {provider, model,
 * placement, selected, t = locale.bind(entry.locale)}；无条目或条目崩溃
 * 一律回退 fallback（官方 renderSlot 的 fallback 同参）。
 */

import { createElement, useMemo } from 'react';
import { EntryBoundary, firstComponentEntry, translatorFor, useSlotEntries } from './slotEntry';

const LABEL_SLOT = 'conversation.input.model.label';

export type ModelLabelPlacement = 'trigger' | 'menu' | 'option';

export interface ModelLabelProps {
  provider: { id: string; name: string };
  model: { id: string; name: string };
  placement: ModelLabelPlacement;
  selected: boolean;
  /** 无官方条目 / 条目崩溃时的回退显示（通常是目录名）。 */
  fallback: string;
}

export function ModelLabel(props: ModelLabelProps): JSX.Element {
  const { provider, model, placement, selected, fallback } = props;
  const entries = useSlotEntries(LABEL_SLOT);
  const entry = useMemo(() => firstComponentEntry(entries), [entries]);
  // 徽章文案在官方插件自己的词典里（ns = deepseek-model-label-1017）；
  // 条目没带 locale 就没有可用的 t，按无条目回退。
  const translator = useMemo(
    () => (entry && entry.locale ? translatorFor(entry) : null),
    [entry],
  );

  let label: React.ReactNode = fallback;
  if (entry && translator) {
    label = createElement(entry.component as React.ComponentType<Record<string, unknown>>, {
      provider,
      model,
      placement,
      selected,
      t: translator,
    });
  }
  return (
    <span data-provider-id={provider.id} data-model-id={model.id}>
      <EntryBoundary fallback={fallback}>{label}</EntryBoundary>
    </span>
  );
}
