/**
 * 工具行：结构与样式逐条对齐官方 InputBar 工具行——
 * 左侧 .dci-tools：指令（plus）、添加附件（paperclip）、权限（shield 触发器）；
 * 右侧 .dci-trailing：模型与思考强度（触发器）、发送（.primary 圆钮）。
 * 按钮沿用官方 keepFocus 语义（mousedown 不夺走编辑器焦点）。
 */

import { useEffect, useRef, useState } from 'react';
import type { DraftAttachmentId, InputActions, InputState, InputTriggerController, UseProjection } from '../host-types';
import { openCommandMenu } from '../triggers';
import { stash } from '../services';
import { addFilesToDraft } from '../attachments';
import { t, useT } from '../i18n';
import { IconPaperclipOfficial, IconPlusOfficial, IconSendOfficial } from '../icons';
import { ModelMenu } from './ModelMenu';
import { PermissionMenu } from './PermissionMenu';
import { useSnapshot } from './useSnapshot';

export interface ToolbarProps {
  sessionId: string | undefined;
  state: InputState | undefined;
  actions: InputActions | undefined;
  triggers: InputTriggerController | undefined;
  /** caret 偏移（指令按钮以当前 caret 构造 synthetic hit）。 */
  caretRef: { current: number | null };
  useProjection: UseProjection | undefined;
  /** owner disabled（权限触发器随之锁住，对齐官方 locked）。 */
  disabled?: boolean;
  onNotify?(level: 'info' | 'error', text: string): void;
  /** 主发送手势（与编辑器发送键同一策略）。 */
  onSend(): void;
  sendDisabled?: boolean;
}

/** 官方 keepFocus：mousedown 阻止默认，避免编辑器失焦。 */
function keepFocus(event: React.MouseEvent): void {
  event.preventDefault();
}

export function Toolbar(props: ToolbarProps): JSX.Element {
  const { sessionId, state, actions, triggers, caretRef, useProjection, disabled, onNotify } = props;
  useT();
  const fileRef = useRef<HTMLInputElement | null>(null);

  const attachments: readonly DraftAttachmentId[] = state?.attachmentIds ?? [];

  const onCommandClick = (): void => {
    if (!triggers) return;
    openCommandMenu(triggers, undefined, caretRef.current ?? 0);
  };

  const onAttach = (files: FileList | null): void => {
    addFilesToDraft(sessionId, actions, files, onNotify);
  };

  return (
    <div className="dci-row">
      <div className="dci-tools">
        <button
          type="button"
          className="dci-add"
          aria-label={t("tool.command")}
          aria-haspopup="listbox"
          title={t("tool.command")}
          disabled={!triggers}
          onMouseDown={keepFocus}
          onClick={onCommandClick}
        >
          <IconPlusOfficial size={14} />
        </button>
        <button
          type="button"
          className="dci-add"
          aria-label={t("tool.attach")}
          title={t("tool.attach")}
          onMouseDown={keepFocus}
          onClick={() => fileRef.current?.click()}
        >
          <IconPaperclipOfficial size={14} />
        </button>
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            onAttach(e.target.files);
            e.target.value = '';
          }}
        />
        <PermissionMenu
          sessionId={sessionId}
          actions={actions}
          currentDraft={state?.draft ?? ''}
          useProjection={useProjection}
          disabled={disabled}
          onNotify={onNotify}
        />
      </div>
      <div className="dci-trailing">
        <ModelMenu
          sessionId={sessionId}
          onNotify={onNotify}
        />
        <ContextGauge useProjection={useProjection} />
        <button
          type="button"
          className="dci-send"
          aria-label={t("tool.send")}
          title={t("tool.send")}
          disabled={props.sendDisabled}
          onMouseDown={keepFocus}
          onClick={() => props.onSend()}
        >
          <IconSendOfficial size={16} />
        </button>
      </div>
    </div>
  );
}

const GAUGE_CIRCUMFERENCE = 2 * Math.PI * 5.5;

interface PressureSnapshot {
  contextWindow?: number;
  pressureTokens?: number;
  projectedTokens?: number;
}

interface BreakdownSnapshot {
  messageTokens?: number;
  systemTokens?: number;
  toolsTokens?: number;
}

function shortTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}K`;
  return `${n}`;
}

/** 上下文占用小圈（官方 JObwrW 复刻）：双环仪表 + 点击展开分段面板。 */
function ContextGauge(props: { useProjection: UseProjection | undefined }): JSX.Element | null {
  const { useProjection } = props;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const pressure = useProjection
    ? (useProjection('contextPressure') as PressureSnapshot | undefined)
    : undefined;
  const breakdown = useProjection
    ? (useProjection('contextBreakdown') as BreakdownSnapshot | undefined)
    : undefined;
  // 点外面关闭。
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent): void => {
      if (rootRef.current && event.target instanceof Node && rootRef.current.contains(event.target)) return;
      setOpen(false);
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [open]);

  if (!pressure || !pressure.contextWindow) return null;
  const windowTokens = pressure.contextWindow;
  const pct = Math.min(100, Math.max(0, ((pressure.pressureTokens ?? 0) / windowTokens) * 100));
  const dash = (pct / 100) * GAUGE_CIRCUMFERENCE;
  const segments: readonly [string, number][] = [
    ['dci-gauge-colorSystem', breakdown?.systemTokens ?? 0],
    ['dci-gauge-colorTools', breakdown?.toolsTokens ?? 0],
    ['dci-gauge-colorMessages', breakdown?.messageTokens ?? 0],
  ];
  return (
    <span className="dci-gauge-root" ref={rootRef}>
      <button
        type="button"
        className="dci-gauge-trigger"
        aria-label={t("tool.context", { percent: Math.round(pct) })}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={t("tool.context", { percent: Math.round(pct) })}
        onClick={() => setOpen(!open)}
      >
        <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">
          <circle className="dci-gauge-track" cx="7" cy="7" r="5.5" />
          <circle
            className="dci-gauge-fill"
            cx="7" cy="7" r="5.5"
            strokeDasharray={`${dash} ${GAUGE_CIRCUMFERENCE}`}
            transform="rotate(-90 7 7)"
          />
        </svg>
      </button>
      {open ? (
        <div className="dci-gauge-panel" role="dialog" aria-label={t("tool.contextTitle")}>
          <div className="dci-gauge-header">
            <span className="dci-gauge-headline">{t("tool.contextTitle")}</span>
            <span className="dci-gauge-percent">{Math.round(pct)}%</span>
            <span className="dci-gauge-figures">
              ~{shortTokens(pressure.pressureTokens ?? 0)} / {shortTokens(windowTokens)}
            </span>
          </div>
          <div className="dci-gauge-bar">
            {segments.map(([cls, tokens]) => (
              <div
                key={cls}
                className={`dci-gauge-segment ${cls}`}
                style={{ width: `${(tokens / windowTokens) * 100}%` }}
              />
            ))}
          </div>
          <dl className="dci-gauge-rows">
            <div className="dci-gauge-row">
              <dt>
                <span className={`dci-gauge-swatch dci-gauge-colorSystem`} aria-hidden="true" />
                {t("stats.prompt")}
              </dt>
              <dd>~{shortTokens(breakdown?.systemTokens ?? 0)}</dd>
            </div>
            <div className="dci-gauge-row">
              <dt>
                <span className={`dci-gauge-swatch dci-gauge-colorTools`} aria-hidden="true" />
                {t("stats.tools")}
              </dt>
              <dd>~{shortTokens(breakdown?.toolsTokens ?? 0)}</dd>
            </div>
            <div className="dci-gauge-row">
              <dt>
                <span className={`dci-gauge-swatch dci-gauge-colorMessages`} aria-hidden="true" />
                {t("stats.messages")}
              </dt>
              <dd>~{shortTokens(breakdown?.messageTokens ?? 0)}</dd>
            </div>
          </dl>
        </div>
      ) : null}
    </span>
  );
}
