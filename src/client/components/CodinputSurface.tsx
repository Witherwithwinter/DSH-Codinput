/**
 * Codinput 主体表面：头部行（品牌 · 编辑/预览双开关）、编辑预览区
 * （左右分屏）、工具行、数据行。主输入（composer bar 遮蔽条目）与
 * 侧边标签页共用本表面；读写同一台官方输入机，草稿天然同源。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { EditorView } from '@codemirror/view';
import { marked } from 'marked';
import * as DOMPurifyModule from 'dompurify';
import type {
  ComposerKeyboard,
  InputActions,
  InputState,
  InputTriggerController,
  UseProjection,
} from '../host-types';
import { stash } from '../services';
import { loadPrefs, savePrefs } from '../prefs';
import { addFilesToDraft, dragHasFiles } from '../attachments';
import { diagError, diagSession, diagWindow } from '../diag';
import { IconEdit, IconEye } from '../icons';
import { t, useT } from '../i18n';
import { EditorPane } from './EditorPane';
import { SlashMenu } from './SlashMenu';
import { PopupSelectView } from './PopupSelectView';
import { AttachmentRail } from './AttachmentRail';
import { Toolbar } from './Toolbar';
import { StatsRow } from './StatsRow';


export interface CodinputSurfaceProps {
  sessionId: string | undefined;
  state: InputState | undefined;
  actions: InputActions | undefined;
  useProjection: UseProjection | undefined;
  /** 宿主 bar owner props 透传：占位文案与禁用。 */
  placeholder?: string;
  disabled?: boolean;
  /** 官方 bar variant：hero（新会话，无对话记录）不渲染数据行。 */
  hero?: boolean;
  /** chat 树解析的轮次计时（模型用时 / TTFT），数据行详情面板用。 */
  chatTimings?: { modelMs?: number; ttftMs?: number };
  /** 侧栏形态（视觉略紧凑）。 */
  side?: boolean;
  /** 悬浮形态（卡片在 FloatingShell 内 portal 渲染；拖动由 CodinputBar 的会话管理）。 */
  float?: boolean;
  /** 顶部行拖动区的 pointerdown（悬浮进出会话，CodinputBar 提供）。 */
  onDragZonePointerDown?: (event: React.PointerEvent<HTMLDivElement>) => void;
}

marked.setOptions({ gfm: true, breaks: true });

/** dompurify 的导出形状随打包条件漂移：默认导出与命名空间都兼容。 */
const DOMPurify = ((DOMPurifyModule as unknown as { default?: unknown }).default ??
  DOMPurifyModule) as unknown as { sanitize(html: string): string };

export function CodinputSurface(props: CodinputSurfaceProps): JSX.Element {
  const { sessionId, state, actions, useProjection, placeholder, disabled, side, hero, chatTimings, float, onDragZonePointerDown } = props;
  // 语言切换时整棵表面重渲染（文案都走 i18n 的 t()）。
  useT();

  const [editOn, setEditOn] = useState<boolean>(() => loadPrefs().defaultEdit);
  const [previewOn, setPreviewOn] = useState<boolean>(() => loadPrefs().defaultPreview);
  const [bodyHeight, setBodyHeight] = useState<number | null>(() => loadPrefs().composerBodyHeight);
  /** 拖文件悬停卡片时的落区提示（松手即入草稿附件）。 */
  const [dropActive, setDropActive] = useState(false);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const caretRef = useRef<number | null>(null);

  // 高度调节：仅顶边把手，1:1 跟手（顶边上移多少、编辑区就高多少），松手持久化。
  // 宽度不做自有调节——沿用官方聊天宽度调节器（wSkVaW_widthHandle）：
  // 官方样式 --dsh-composer-card-max-width = --dsh-chat-content-width + 32px，
  // 卡片的 max-width 取同一变量，天然跟随。
  const startDrag =
    (event: React.PointerEvent<HTMLDivElement>): void => {
      event.preventDefault();
      const handle = event.currentTarget;
      const startY = event.clientY;
      const baseH =
        bodyHeight ?? Math.max(60, cardRef.current?.querySelector('.dci-body')?.getBoundingClientRect().height ?? 0);
      handle.dataset.dragging = 'true';
      let nextH = bodyHeight;
      const onMove = (e: PointerEvent): void => {
        nextH = Math.round(Math.min(window.innerHeight - 260, Math.max(96, baseH - (e.clientY - startY))));
        setBodyHeight(nextH);
      };
      const onUp = (): void => {
        handle.dataset.dragging = 'false';
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        savePrefs({ composerBodyHeight: nextH });
      };
      try {
        handle.setPointerCapture(event.pointerId);
      } catch {
        /* 合成事件无活动指针：window 监听兜底 */
      }
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    };


  // 服务 stash 由 ctx.inject 异步填充：未就绪时短轮询触发重算。
  const [svcEpoch, setSvcEpoch] = useState(0);

  useEffect(() => {
    // 至少开启一个开关。
    if (!editOn && !previewOn) setEditOn(true);
  }, [editOn, previewOn]);

  // 逐会话解析官方服务面：触发管线 + 键盘面 + popupSelect。
  // 每次渲染现解析（Map 级开销）：会话绑定重生成后旧控制器会被宿主
  // dispose，挂载时缓存一次性解析会持有死实例且永不自愈。
  const resolveTriggers = (): InputTriggerController | undefined => {
    if (!sessionId || !stash.conversation) return undefined;
    try {
      return stash.conversation.input.inputTriggers(sessionId) ?? undefined;
    } catch {
      return undefined;
    }
  };
  const resolveKeyboard = (): ComposerKeyboard | undefined => {
    if (!sessionId || !stash.conversation) return undefined;
    try {
      return stash.conversation.input.keyboard(sessionId);
    } catch {
      return undefined;
    }
  };
  const triggers = resolveTriggers();
  const keyboard = resolveKeyboard();

  // faces 未解析（stash 未就绪或宿主瞬时不可解析）时短轮询触发重算。
  useEffect(() => {
    if (!sessionId || (triggers && keyboard)) return;
    const timer = window.setInterval(() => setSvcEpoch((n) => n + 1), 300);
    const stop = window.setTimeout(() => window.clearInterval(timer), 10_000);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(stop);
    };
  }, [sessionId, triggers, keyboard]);

  const popup = useMemo(() => {
    // alpha：sessions.scope('') 会抛错——必须先判空 sessionId。
    if (!sessionId || !stash.sessions || !stash.commandUi) return undefined;
    if (typeof stash.commandUi.popupFor !== 'function') return undefined;
    try {
      return stash.commandUi.popupFor(stash.sessions.scope(sessionId));
    } catch {
      return undefined;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, svcEpoch]);

  // popup 拾取后的 composer 焦点归还（官方 overlay wiring 的等价绑定）。
  // alpha 的 commandUi 未提供 bindComposerFocus——按需可用。
  useEffect(() => {
    if (!sessionId || !stash.commandUi) return;
    const face = stash.commandUi as unknown as Record<string, unknown>;
    if (typeof face['bindComposerFocus'] !== 'function') return;
    return (face['bindComposerFocus'] as (id: string, fn: () => void) => () => void)(
      sessionId,
      () => viewRef.current?.focus(),
    );
  }, [sessionId]);

  // 诊断口：__dshCodinputSessionId / Triggers / Keyboard（docs/idea.md 附录约定）。
  useEffect(() => {
    diagSession(sessionId ?? null);
    const w = diagWindow();
    if (sessionId) {
      if (triggers) w.__dshCodinputTriggers[sessionId] = triggers;
      if (keyboard) w.__dshCodinputKeyboard[sessionId] = keyboard;
      w.__dshCodinputShell[sessionId] = { surface: true, side: side === true };
    }
    return () => {
      diagSession(null);
    };
  }, [sessionId, triggers, keyboard, side]);

  const caretMoved = (caret: number): void => {
    caretRef.current = caret;
  };

  const sendGesture = (): void => {
    if (!actions) return;
    const st = state;
    const draftEmpty = !st || st.draft.trim() === '';
    const noAttachments = !st || st.attachmentIds.length === 0;
    if (draftEmpty && noAttachments) {
      keyboard?.steerQueue(); // 空草稿：发送手势转队列全量 Steer
      return;
    }
    actions.submit();
  };

  // 官方同语义：草稿与附件皆空时发送禁用（空草稿手势仍可经键盘 Steer）。
  const draftEmpty = (state?.draft ?? '').trim() === '';
  const noAttachments = (state?.attachmentIds.length ?? 0) === 0;
  const sendDisabled =
    disabled ||
    actions === undefined ||
    (state !== undefined && state.phase === 'submitting') ||
    (draftEmpty && noAttachments);

  const html = useMemo(
    () => DOMPurify.sanitize(marked.parse(state?.draft ?? '') as string),
    [state?.draft, previewOn],
  );

  const toggleEdit = (): void => {
    if (!editOn && previewOn) setEditOn(true);
    else if (editOn && previewOn) setEditOn(false);
  };
  const togglePreview = (): void => {
    if (!previewOn && editOn) setPreviewOn(true);
    else if (previewOn && editOn) setPreviewOn(false);
  };

  const placeholderText = placeholder ?? t("editor.placeholder");

  // ---- 附件入口 #2 / #3：粘贴与拖入 ----
  // 粘贴/拖放的捕获相位处理：只在带文件时接管（纯文本粘贴照常交给编辑器），
  // 且 stopPropagation 不让 CodeMirror 再处理一次（否则同一张图会入两份）。
  const notify = notifyFor(sessionId);
  const onPasteCapture = (event: React.ClipboardEvent<HTMLDivElement>): void => {
    const files = event.clipboardData?.files;
    if (!files || files.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    addFilesToDraft(sessionId, actions, files, notify);
  };
  const onDragOverCapture = (event: React.DragEvent<HTMLDivElement>): void => {
    if (!dragHasFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    if (!dropActive) setDropActive(true);
  };
  const onDragLeave = (event: React.DragEvent<HTMLDivElement>): void => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setDropActive(false);
  };
  const onDropCapture = (event: React.DragEvent<HTMLDivElement>): void => {
    setDropActive(false);
    const files = event.dataTransfer?.files;
    if (!files || files.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    addFilesToDraft(sessionId, actions, files, notify);
  };

  return (
    <div className="dci-surface" data-side={side || undefined} data-float={float || undefined}>
      <div
        className="dci-card"
        data-composer-card="codinput"
        data-drop={dropActive || undefined}
        ref={cardRef}
        onPasteCapture={onPasteCapture}
        onDragOverCapture={onDragOverCapture}
        onDragLeave={onDragLeave}
        onDropCapture={onDropCapture}
      >
        <div className="dci-rip" data-axis="y" data-side="top" onPointerDown={startDrag} />
        <div className="dci-accessory">
          <button type="button" className="dci-iconbtn" data-on={editOn} onClick={toggleEdit} title={t("head.edit")}>
            <IconEdit size={14} />
          </button>
          <button type="button" className="dci-iconbtn" data-on={previewOn} onClick={togglePreview} title={t("head.preview")}>
            <IconEye size={14} />
          </button>
          {/* 主输入卡片：开关右侧的空白即拖动区——一拖自动脱出悬浮，拖回底部自动回普通。 */}
          {!side ? <div className="dci-float-dragzone" onPointerDown={onDragZonePointerDown} /> : null}
        </div>

        {actions && (state?.attachmentIds.length ?? 0) > 0 ? (
          <AttachmentRail
            state={state}
            sessionId={sessionId}
            onRemove={(id) => {
              const conversation = stash.conversation;
              actions.removeAttachment(id);
              try {
                conversation?.releaseDraftAttachment(id);
              } catch (error) {
                diagError('attachments', error);
              }
            }}
          />
        ) : null}

        <div
          className="dci-body"
          data-split={editOn && previewOn}
          style={
            !side && !float && bodyHeight !== null
              ? ({ '--dci-body-h': `${bodyHeight}px`, '--dci-body-max': `${bodyHeight}px` } as React.CSSProperties)
              : undefined
          }
        >
          {editOn ? (
            <EditorPane
              state={state}
              actions={actions}
              triggers={triggers}
              keyboard={keyboard}
              onSendGesture={sendGesture}
              placeholder={placeholderText}
              viewRef={viewRef}
              onCaretMoved={caretMoved}
              disabled={disabled === true}
              autoFocus={true}
              solo={!previewOn}
              stateKey={sessionId ?? 'hero'}
            />
          ) : null}
          {previewOn ? (
            <div className="dci-preview" data-solo={!editOn}>
              {html ? <div dangerouslySetInnerHTML={{ __html: html }} /> : <span style={{ opacity: 0.4 }}>{t("preview.empty")}</span>}
            </div>
          ) : null}
        </div>

        <Toolbar
          sessionId={sessionId}
          state={state}
          actions={actions}
          triggers={triggers}
          caretRef={caretRef}
          useProjection={useProjection}
          disabled={disabled}
          onNotify={notifyFor(sessionId)}
          onSend={sendGesture}
          sendDisabled={sendDisabled}
        />

        {/* 数据行：悬浮形态收进卡片（工具行下方，随卡片圆角一体）。 */}
        {float && hero !== true ? (
          <StatsRow useProjection={useProjection} sessionId={sessionId} chatTimings={chatTimings} />
        ) : null}

        {/* 官方 MenuView 锚定：主模式以卡片顶上方弹出；侧栏/悬浮形态由
            SlashMenu 按 dropdown 改为头部行下方向下弹出（不被面板/视口裁剪） */}
        {triggers ? <SlashMenu triggers={triggers} dropdown={side === true || float === true} /> : null}
      </div>

      {/* 数据行：主输入/侧栏渲染在卡片下方（官方 hero 新会话态无 stats）。 */}
      {!float && hero !== true ? (
        <StatsRow useProjection={useProjection} sessionId={sessionId} chatTimings={chatTimings} />
      ) : null}

      {popup ? <PopupSelectView popup={popup} /> : null}
    </div>
  );
}

function notifyFor(sessionId: string | undefined): ((level: 'info' | 'error', text: string) => void) | undefined {
  if (!sessionId) return undefined;
  return (level, text) => {
    try {
      const actx = stash.sessions?.scope(sessionId);
      if (!actx || !stash.conversation) return;
      stash.conversation.input.for(actx).notify(level, text);
    } catch (error) {
      diagError('notify', error);
    }
  };
}

export type { InputActions };
