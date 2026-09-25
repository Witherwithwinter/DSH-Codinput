/**
 * 工具行：结构与样式逐条对齐官方 InputBar 工具行——
 * 左侧 .dci-tools：指令（plus）、添加附件（paperclip）、权限（shield 触发器）；
 * 右侧 .dci-trailing：模型与思考强度（触发器）、发送（.primary 圆钮）。
 * 按钮沿用官方 keepFocus 语义（mousedown 不夺走编辑器焦点）。
 * 0.1.7-rc.2 起官方上下文小圈不再在工具行（挪进卡片下方 dock 行，见 StatsRow）。
 */

import { useRef } from 'react';
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
