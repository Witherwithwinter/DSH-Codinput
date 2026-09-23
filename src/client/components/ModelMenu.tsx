/**
 * 模型与思考强度菜单：官方 ModelSelection 的触发器与两级 cell 菜单。
 * 数据来自官方 per-session 目录（ctx.modelDirectories.directoryFor(id).store：
 * { current, groups, status, error }），写入走官方 select（selectModel RPC）。
 * 服务缺席时触发器禁用。
 */

import { useEffect, useRef, useState } from 'react';
import type { InputActions, ModelCatalogModel, ModelProviderGroup, ModelSelection } from '../host-types';
import { getSessionDirectory, type DirectorySnapshot } from '../modeldir';
import { stash } from '../services';
import { IconChevronOfficial } from '../icons';
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

/** 推理等级显示名（目录 efforts[].name，如 High；未热时退回首字母大写 id）。 */
function effortLabel(selection: ModelSelection | null, groups: readonly ModelProviderGroup[]): string {
  const effortId = selection?.reasoningEffort;
  if (!effortId) return 'Default';
  const named = findCurrent(selection, groups)?.model.reasoning?.efforts.find((e) => e.id === effortId);
  if (named) return named.name;
  return effortId.charAt(0).toUpperCase() + effortId.slice(1);
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
  const currentModelName = modelLabel(current, groups);
  const currentEffort = effortLabel(current, groups);

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
        style={{ maxWidth: 'min(360px, 45cqw)' }}
        data-open={open}
        onMouseDown={(e) => e.preventDefault()}
        disabled={!directory}
        onClick={() => (open ? close() : openMenu())}
        aria-label={t("tool.model", { name: `${currentModelName} · ${currentEffort}` })}
        title={t("tool.model", { name: `${currentModelName} · ${currentEffort}` })}
      >
        <span className="dci-triggerLabel">{currentModelName}</span>
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
                  <span className="dci-cellValue">{currentModelName}</span>
                  <span className="dci-cellChevron" style={{ transform: 'rotate(-90deg)' }} aria-hidden="true">
                    <IconChevronOfficial size={14} />
                  </span>
                </button>
                <button type="button" className="dci-cell" onClick={() => setView('efforts')}>
                  <span className="dci-cellLabel">{t("menu.reasoning")}</span>
                  <span className="dci-cellValue">{currentEffort}</span>
                  <span className="dci-cellChevron" style={{ transform: 'rotate(-90deg)' }} aria-hidden="true">
                    <IconChevronOfficial size={14} />
                  </span>
                </button>
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
                          <span className="dci-itemLabel">{model.name}</span>
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
                  const found = findCurrent(current, groups);
                  const efforts = found?.model.reasoning?.efforts ?? [];
                  if (efforts.length === 0) return <div className="dci-empty">{t("menu.reasoningNone")}</div>;
                  return efforts.map((eff) => {
                    const active = current?.reasoningEffort === eff.id;
                    return (
                      <button
                        key={eff.id}
                        type="button"
                        className="dci-item"
                        disabled={busy}
                        title={eff.description}
                        onClick={() => found && void pick(found.group, found.model, eff.id)}
                      >
                        <span className="dci-itemLabel">{eff.name}</span>
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
