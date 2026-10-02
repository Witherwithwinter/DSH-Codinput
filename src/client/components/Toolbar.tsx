/**
 * 工具行：结构与样式逐条对齐官方 InputBar 工具行——
 * 左侧 .dci-tools：指令（plus）、权限（shield 触发器）；
 * 右侧 .dci-trailing：模型与思考强度（触发器）、语音输入（官方 activity 槽位
 * 条目，桌面版宿主才有）、发送（.primary 圆钮）。
 * 按钮沿用官方 keepFocus 语义（mousedown 不夺走编辑器焦点）。
 * 附件无独立按钮（官方已并入 slash「添加 · 文件」），粘贴/拖拽路径保留。
 * 0.1.7-rc.2 起官方上下文小圈不再在工具行（挪进卡片下方 dock 行，见 StatsRow）。
 * 语音展开时隐藏 tools 与模型（官方 activity 同款：capture 行接管整行，
 * 发送/停止保持可见）。
 */

import { useCallback, useState } from 'react';
import type { DraftAttachmentId, InputActions, InputState, InputTriggerController, UseProjection } from '../host-types';
import { openCommandMenu } from '../triggers';
import { t, useT } from '../i18n';
import { IconPlusOfficial, IconSendOfficial, IconStopOfficial } from '../icons';
import { ModelMenu } from './ModelMenu';
import { PermissionMenu } from './PermissionMenu';
import { VoiceActivity } from './VoiceActivity';

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
  /** 会话运行中且草稿空（官方 primaryStops）：主按钮变停止。 */
  primaryStops?: boolean;
  /** 停止生成（官方 stop：conversation.cancel）。 */
  onStop?(): void;
}

/** 官方 keepFocus：mousedown 阻止默认，避免编辑器失焦。 */
function keepFocus(event: React.MouseEvent): void {
  event.preventDefault();
}

export function Toolbar(props: ToolbarProps): JSX.Element {
  const { sessionId, state, actions, triggers, caretRef, useProjection, disabled, onNotify } = props;
  useT();

  const attachments: readonly DraftAttachmentId[] = state?.attachmentIds ?? [];
  // 官方 activity 语义：语音展开时本行左侧工具与模型控件隐藏、capture 行伸展。
  const [voiceActive, setVoiceActive] = useState(false);
  const onVoiceActiveChange = useCallback((active: boolean): void => setVoiceActive(active), []);

  const onCommandClick = (): void => {
    if (!triggers) return;
    openCommandMenu(triggers, undefined, caretRef.current ?? 0);
  };

  return (
    <div className="dci-row" data-voice-active={voiceActive || undefined}>
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
        <div className="dci-standard-controls">
          <ModelMenu
            sessionId={sessionId}
            onNotify={onNotify}
          />
        </div>
        <div className="dci-voice-seat">
          <VoiceActivity
            sessionId={sessionId}
            inputActions={actions}
            locked={disabled === true}
            onActiveChange={onVoiceActiveChange}
          />
        </div>
        <button
          type="button"
          className="dci-send"
          aria-label={props.primaryStops ? t('tool.stop') : t('tool.send')}
          title={props.primaryStops ? t('tool.stop') : t('tool.send')}
          disabled={props.primaryStops ? !props.onStop : props.sendDisabled}
          onMouseDown={keepFocus}
          onClick={() => (props.primaryStops ? props.onStop?.() : props.onSend())}
        >
          {props.primaryStops ? <IconStopOfficial size={16} /> : <IconSendOfficial size={16} />}
        </button>
      </div>
    </div>
  );
}
