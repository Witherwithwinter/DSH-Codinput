/**
 * 模型与思考强度菜单：官方 ModelSelect 座位（conversation.input.model 槽位）
 * 的触发器与两级 cell 菜单复刻。
 * 数据来自官方 per-session 目录（ctx.modelDirectories.directoryFor(id).store：
 * { current, groups, status, error }），写入走官方 select（selectModel RPC）。
 * 服务缺席时触发器禁用。
 *
 * 0.2.1 同步：模型名的显示名经官方 `conversation.input.model.label` 子槽位
 * 渲染（ModelLabel）——桌面版宿主的 deepseek-model-label-1017 插件会给
 * deepseek-flash 追加「1017」发布徽章，web 宿主无条目回退纯名；思考强度
 * 显示对齐官方公式（selection 未显式指定时回落模型 defaultEffort，模型无
 * reasoning 元数据时显示会话 retainedEffort，均无才显示 Default），推理
 * 等级菜单在模型未声明默认强度时补官方的 Default（跟随提供方默认）行。
 */

import { useEffect, useRef, useState } from 'react';
import type { ModelCatalogModel, ModelProviderGroup, ModelSelection } from '../host-types';
import { getSessionDirectory, type DirectorySnapshot } from '../modeldir';
import { stash } from '../services';
import { IconChevronOfficial } from '../icons';
import { ModelLabel } from './ModelLabel';
import { MenuCheck, MenuSurface } from './MenuSurface';
import { useSnapshot } from './useSnapshot';
import { t } from '../i18n';

export interface ModelMenuProps {
  sessionId: string | undefined;
  onNotify?(level: 'info' | 'error', text: string): void;
}

type MenuView = 'root' | 'models' | 'efforts';

/** 目录中按 (provider, model id) 找目录项。 */
function findCurrent(
  current: ModelSelection | null,
  groups: readonly ModelProviderGroup[],
): { group: ModelProviderGroup; model: ModelCatalogModel } | null {
  if (!current) return null;
  for (const group of groups) {
    if (group.id !== current.provider) continue;
    const model = group.models.find((m) => m.id === current.model);
    if (model) return { group, model };
  }
  return null;
}

/** 触发器显示模型**显示名**（目录项 name；目录未热时退回 id）。 */
function modelLabel(selection: ModelSelection | null, groups: readonly ModelProviderGroup[]): string {
  if (!selection) return t('tool.modelPlain');
  return findCurrent(selection, groups)?.model.name ?? selection.model;
}

/**
 * 思考强度显示（官方 ModelSelect 的 effortLabel 公式）：目录里找不到当前
 * 模型 → 无强度段；模型无 reasoning 元数据 → 会话 retainedEffort（官方
 * 已折成显示名）；selection 未显式指定 → 模型 defaultEffort 的名字；再
 * 无才显示 Default（effort.providerDefault，官方中英同为「Default」）。
 */
function effortLabel(
  selection: ModelSelection | null,
  groups: readonly ModelProviderGroup[],
  snapshot: DirectorySnapshot | undefined,
): string | undefined {
  const found = findCurrent(selection, groups);
  if (!found) return undefined;
  const reasoning = found.model.reasoning;
  if (!reasoning) return snapshot?.retainedEffort;
  const effective = selection?.reasoningEffort ?? reasoning.defaultEffort;
  if (effective === undefined) return 'Default';
  return reasoning.efforts.find((level) => level.id === effective)?.name ?? effective;
}

export function ModelMenu(props: ModelMenuProps): JSX.Element {
  const { sessionId, onNotify } = props;
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<MenuView>('root');
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [anchor, setAnchor] = useState<{ left: number; top: number; right: number; bottom: number } | null>(null);

  // 服务缺席（installServices 未注入到）时禁用；svcEpoch 轮询兜底见 CodinputSurface。
  const directory = getSessionDirectory(sessionId);
  const snap = useSnapshot(directory?.store) as DirectorySnapshot | undefined;

  // 首次打开时确保目录已加载（官方 load 语义）。
  useEffect(() => {
    if (!open || !directory) return;
    directory.load().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent): void => {
      if (refContains(rootMenuRef.current, event.target)) return;
      close();
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const rootMenuRef = useRef<HTMLDivElement | null>(null);

  const openMenu = (): void => {
    const el = triggerRef.current;
    if (!el) return;
    setAnchor(el.getBoundingClientRect());
    setView('root');
    setOpen(true);
  };

  const close = (): void => {
    setOpen(false);
    setView('root');
  };

  const current = snap?.current ?? null;
  const groups = snap?.groups ?? [];
  const found = findCurrent(current, groups);
  const currentModelName = modelLabel(current, groups);
  const currentEffort = effortLabel(current, groups, snap);
  const triggerTitle = currentEffort === undefined ? currentModelName : `${currentModelName} · ${currentEffort}`;
  /** 官方 renderModelLabel：触发器/根菜单 cell 位置的当前模型显示名。 */
  const renderCurrentName = (placement: 'trigger' | 'menu', target: NonNullable<typeof found>): JSX.Element => (
    <ModelLabel
      provider={{ id: target.group.id, name: target.group.name }}
      model={target.model}
      placement={placement}
      selected={true}
      fallback={currentModelName}
    />
  );

  const pick = async (group: ModelProviderGroup, model: ModelCatalogModel, effortId: string | undefined): Promise<void> => {
    if (!directory || busy) return;
    const next: ModelSelection = {
      provider: group.id,
      model: model.id,
      ...(effortId !== undefined ? { reasoningEffort: effortId } : {}),
    };
    setBusy(true);
    try {
      await directory.select(next);
    } catch (error) {
      onNotify?.('error', error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
      close();
    }
  };

  const refContains = (el: Element | null, target: EventTarget | null): boolean =>
    !!el && target instanceof Node && el.contains(target);

  return (
    <div style={{ position: 'relative', minWidth: 0 }}>
      <button
        ref={triggerRef}
        type="button"
        className="dci-trigger"
        data-model=""
        style={{ maxWidth: 'min(360px, 45cqw)' }}
        data-open={open}
        onMouseDown={(e) => e.preventDefault()}
        disabled={!directory}
        onClick={() => (open ? close() : openMenu())}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("tool.model", { name: triggerTitle })}
        title={t("tool.model", { name: triggerTitle })}
      >
        <span className="dci-triggerLabel">{found ? renderCurrentName('trigger', found) : currentModelName}</span>
        {currentEffort ? <span className="dci-triggerEffort">{currentEffort}</span> : null}
        <span className="dci-chev" data-open={open}>
          <IconChevronOfficial size={14} />
        </span>
      </button>

      {open && anchor ? (
        <div ref={rootMenuRef}>
          <MenuSurface anchor={anchor} onClose={close} alignEnd={true} minWidth={240}>
            {view === 'root' ? (
              <>
                <button type="button" className="dci-cell" onClick={() => setView('models')}>
                  <span className="dci-cellLabel">{t("menu.model")}</span>
                  <span className="dci-cellValue">
                    {found ? renderCurrentName('menu', found) : currentModelName}
                  </span>
                  <span className="dci-cellChevron" style={{ transform: 'rotate(-90deg)' }} aria-hidden="true">
                    <IconChevronOfficial size={14} />
                  </span>
                </button>
                {found?.model.reasoning ? (
                  <button type="button" className="dci-cell" onClick={() => setView('efforts')}>
                    <span className="dci-cellLabel">{t("menu.reasoning")}</span>
                    <span className="dci-cellValue">{currentEffort}</span>
                    <span className="dci-cellChevron" style={{ transform: 'rotate(-90deg)' }} aria-hidden="true">
                      <IconChevronOfficial size={14} />
                    </span>
                  </button>
                ) : null}
              </>
            ) : null}

            {view === 'models' ? (
              <>
                <div className="dci-menuLabel">{t("menu.model")}</div>
                {groups.map((group) => (
                  <div key={group.id}>
                    <div className="dci-menuLabel">{group.name}</div>
                    {group.models.map((model) => {
                      const active = current !== null && current.provider === group.id && current.model === model.id;
                      return (
                        <button
                          key={model.id}
                          type="button"
                          className="dci-item"
                          disabled={busy}
                          title={model.description}
                          onClick={() => void pick(group, model, model.reasoning?.defaultEffort)}
                        >
                          <span className="dci-itemLabel">
                            <ModelLabel
                              provider={{ id: group.id, name: group.name }}
                              model={model}
                              placement="option"
                              selected={active}
                              fallback={model.name}
                            />
                          </span>
                          {active ? (
                            <span className="dci-check" aria-hidden="true">
                              <MenuCheck size={16} />
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                ))}
                {groups.length === 0 ? <div className="dci-empty">{snap?.status === 'loading' ? t('menu.refreshingModels') : t('menu.noModels')}</div> : null}
              </>
            ) : null}

            {view === 'efforts' ? (
              <>
                <div className="dci-menuLabel">{t("menu.reasoning")}</div>
                {(() => {
                  const reasoning = found?.model.reasoning;
                  if (!reasoning) return <div className="dci-empty">{t("menu.reasoningNone")}</div>;
                  const effectiveEffort = current?.reasoningEffort ?? reasoning.defaultEffort;
                  // 官方 effortChoices：模型未声明默认强度时补一行 Default
                  // （写回时省略 reasoningEffort = 跟随提供方默认）。
                  const rows: { key: string; effort: string | undefined; label: string }[] = [
                    ...(reasoning.defaultEffort === undefined
                      ? [{ key: 'provider-default', effort: undefined as string | undefined, label: 'Default' }]
                      : []),
                    ...reasoning.efforts.map((eff) => ({
                      key: `effort:${eff.id}`,
                      effort: eff.id,
                      label: eff.name,
                    })),
                  ];
                  return rows.map((row) => {
                    const active = effectiveEffort === row.effort;
                    const named = row.effort === undefined ? undefined : reasoning.efforts.find((e) => e.id === row.effort);
                    return (
                      <button
                        key={row.key}
                        type="button"
                        className="dci-item"
                        disabled={busy}
                        title={named?.description}
                        onClick={() => found && void pick(found.group, found.model, row.effort)}
                      >
                        <span className="dci-itemLabel">{row.label}</span>
                        {active ? (
                          <span className="dci-check" aria-hidden="true">
                            <MenuCheck size={16} />
                          </span>
                        ) : null}
                      </button>
                    );
                  });
                })()}
              </>
            ) : null}
          </MenuSurface>
        </div>
      ) : null}
    </div>
  );
}
