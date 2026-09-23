/**
 * popupSelect 壳：官方 PopupSelectController 的 headless 状态渲染
 * （命令的选项弹层，如 /model 类确认选择）。键盘与指针路由回控制器。
 */

import { useEffect, useMemo, useRef } from 'react';
import { filterOptions } from './popup-filter';
import type { PopupSelectController, PopupState } from '../host-types';
import { useSnapshot } from './useSnapshot';
import { t } from '../i18n';

export interface PopupSelectViewProps {
  popup: PopupSelectController;
}

export function PopupSelectView(props: PopupSelectViewProps): JSX.Element | null {
  const { popup } = props;
  const state = useSnapshot(popup.state) as PopupState | undefined;
  const searchRef = useRef<HTMLInputElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const filtered = useMemo(
    () => (state ? filterOptions(state.options, state.search) : []),
    [state?.options, state?.search],
  );

  useEffect(() => {
    if (!state?.open) return;
    const onDown = (event: PointerEvent): void => {
      if (rootRef.current && event.target instanceof Node && rootRef.current.contains(event.target)) return;
      popup.dismiss();
    };
    const onKey = (event: KeyboardEvent): void => {
      if (!state.open || state.submitting) return;
      if (state.confirming) {
        if (event.key === 'Escape') {
          event.preventDefault();
          popup.cancelConfirmation();
        }
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        popup.move(1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        popup.move(-1);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        void popup.select(state.active);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        popup.dismiss({ focusComposer: true });
      }
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [state?.open, state?.submitting, state?.confirming, state?.active, popup]);

  useEffect(() => {
    if (state?.open) searchRef.current?.focus();
  }, [state?.open]);

  if (!state?.open) return null;

  const confirming = state.confirming;

  return (
    <div className="dci-menu" ref={rootRef}>
      {state.command ? <div className="dci-group-title">{state.command}</div> : null}
      {state.status === 'failed' ? (
        <div className="dci-error">{state.error ?? t('menu.loadFailed')}</div>
      ) : null}
      {state.status === 'failed' ? (
        <button type="button" className="dci-btn" onClick={() => popup.retry()}>
          重试
        </button>
      ) : null}
      {state.status === 'ready' && !confirming ? (
        <input
          ref={searchRef}
          className="dci-search"
          type="text"
          placeholder={t("menu.filter")}
          value={state.search}
          onChange={(e) => popup.setSearch(e.target.value)}
        />
      ) : null}
      {confirming ? (
        <div className="dci-confirm">
          <div className="dci-row-name">{String(confirming.label ?? '')}</div>
          {confirming.detail ? <div className="dci-row-desc">{String(confirming.detail)}</div> : null}
          <label>
            <input type="checkbox" checked={state.acknowledged} onChange={(e) => popup.acknowledge(e.target.checked)} />
            <span>{t("popup.ack")}</span>
          </label>
          <div className="dci-confirm-actions">
            <button type="button" className="dci-btn" onClick={() => popup.cancelConfirmation()}>
              取消
            </button>
            <button
              type="button"
              className="dci-btn"
              data-primary="true"
              disabled={state.submitting || !state.acknowledged}
              onClick={() => void popup.confirm()}
            >
              确认
            </button>
          </div>
        </div>
      ) : (
        <>
          {state.status === 'pending' ? <div className="dci-empty">{t('menu.loading')}</div> : null}
          {state.status === 'ready' && filtered.length === 0 ? <div className="dci-empty">{t('menu.empty')}</div> : null}
          {filtered.map((option, index) => (
            <button
              key={`${String(option.label)}:${index}`}
              type="button"
              className="dci-opt"
              data-active={index === state.active || undefined}
              onMouseEnter={() => popup.highlight(index)}
              onClick={() => void popup.select(index)}
            >
              <span className="dci-opt-copy">
                <span className="dci-opt-name">{String(option.label ?? '')}</span>
                {option.detail ? <span className="dci-opt-desc">{String(option.detail)}</span> : null}
              </span>
            </button>
          ))}
        </>
      )}
      {state.error && state.status === 'ready' ? <div className="dci-error">{state.error}</div> : null}
    </div>
  );
}
