/**
 * Codinput 主体表面：头部行（品牌 · 编辑/预览双开关）、编辑预览区
 * （左右分屏）、工具行、数据行。主输入（composer bar 遮蔽条目）与
 * 侧边标签页共用本表面；读写同一台官方输入机，草稿天然同源。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { EditorView } from '@codemirror/view';
import type {
  ComposerKeyboard,
  InputActions,
  InputState,
  InputTriggerController,
  UseProjection,
} from '../host-types';
import { stash } from '../services';
import { loadPrefs, savePrefs, subscribePrefs } from '../prefs';
import { addFilesToDraft, bindSessionFilePicker, dragHasFiles } from '../attachments';
import { diagError, diagSession, diagWindow } from '../diag';
import { IconEdit, IconEye } from '../icons';
import { t, useT } from '../i18n';
import {
  activateMarkdown,
  handleMarkdownClick,
  renderMarkdown,
  type MarkdownImageTarget,
} from '../markdown';
import { EditorPane } from './EditorPane';
import { SlashMenu } from './SlashMenu';
import { PopupSelectView } from './PopupSelectView';
import { AttachmentRail } from './AttachmentRail';
import { ImageLightbox } from './ImageLightbox';
import { Toolbar } from './Toolbar';
import { StatsRow } from './StatsRow';


export interface CodinputSurfaceProps {
  sessionId: string | undefined;
  state: InputState | undefined;
  actions: InputActions | undefined;
  useProjection: UseProjection | undefined;
  /**
   * conversation.input.left / .right 条目的 standard props 原样面（宿主
   * kit − owner props），经 Toolbar 转给输入座位镜像转发渲染。
   */
  inputStandard?: Record<string, unknown> | undefined;
  /** 宿主 bar owner props 透传：占位文案与禁用。 */
  placeholder?: string;
  disabled?: boolean;
  /** 会话级阻塞（宿主 blocked）：编辑器与发送锁死，但停止钮仍可点（官方同款）。 */
  blocked?: boolean;
  /** 会话运行中（useSession s.running）：空草稿时主按钮变停止（官方同款）。 */
  running?: boolean;
  /** 官方 bar variant：hero（新会话，无对话记录）不渲染数据行。 */
  hero?: boolean;
  /** chat 树解析的轮次计时（模型用时 / TTFT），数据行详情面板用。 */
  /** chat legacy 节点数组（sessionStats 投影缺席时派生轮次/decode 计时）。 */
  chatNodes?: unknown;
  /** 侧栏形态（视觉略紧凑）。 */
  side?: boolean;
  /** 悬浮形态（卡片在 FloatingShell 内 portal 渲染；拖动由 CodinputBar 的会话管理）。 */
  float?: boolean;
  /** 顶部行拖动区的 pointerdown（悬浮进出会话，CodinputBar 提供）。 */
  onDragZonePointerDown?: (event: React.PointerEvent<HTMLDivElement>) => void;
}

export function CodinputSurface(props: CodinputSurfaceProps): JSX.Element {
  const { sessionId, state, actions, useProjection, inputStandard, placeholder, disabled, blocked, running, side, hero, chatNodes, float, onDragZonePointerDown } = props;
  // 语言切换时整棵表面重渲染（文案都走 i18n 的 t()）。
  useT();

  const [editOn, setEditOn] = useState<boolean>(() => loadPrefs().defaultEdit);
  const [previewOn, setPreviewOn] = useState<boolean>(() => loadPrefs().defaultPreview);
  const [bodyHeight, setBodyHeight] = useState<number | null>(() => loadPrefs().composerBodyHeight);
  /** Markdown 正文等宽连字（设置 → Markdown 等宽连字）：即时跟随 prefs 变化。 */
  const [markdownMono, setMarkdownMono] = useState<boolean>(() => loadPrefs().markdownMono);
  useEffect(() => subscribePrefs(() => setMarkdownMono(loadPrefs().markdownMono)), []);
  /** 拖文件悬停卡片时的落区提示（松手即入草稿附件）。 */
  const [dropActive, setDropActive] = useState(false);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const caretRef = useRef<number | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  /** 预览 Markdown 根（图片点灯箱 / 扩展渲染 扩展激活的挂点）。 */
  const previewBodyRef = useRef<HTMLDivElement | null>(null);
  /** Markdown 内 http(s) 图片点击后的大图灯箱。 */
  const [lightbox, setLightbox] = useState<MarkdownImageTarget | null>(null);
  const onPreviewClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    handleMarkdownClick(event, { onImage: setLightbox });
  };

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

  // 文件拾取绑定：官方 InputBar 挂载时把 shell 的 filePicker 绑给自己，卸载
  // 解绑——slash「添加 · 文件」行 available = shell.canPickFiles，接管期间不
  // 绑该行就消失。接管面挂载即绑、卸载即解，open 走本模块的附件入草稿链路。
  useEffect(() => {
    if (!sessionId) return;
    return bindSessionFilePicker(sessionId);
  }, [sessionId]);

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

  // 官方 stop 同链路：sessions.scope(sid).get('conversation').cancel()。
  const stopSession = (): void => {
    if (!sessionId) return;
    try {
      const scope = stash.sessions?.scope(sessionId) as
        | { get?: (name: string) => { cancel?: () => Promise<unknown> } }
        | undefined;
      const conversation = scope?.get?.('conversation');
      void conversation?.cancel?.()?.catch?.(() => {});
    } catch {
      /* 会话作用域缺席：静默（下一拍 running 投影自会收敛） */
    }
  };
  const onStop = stopSession;

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

  // 官方同语义（0.2.2 InputBar）：empty = 草稿与附件皆空；machineBusy = 输入机
  // 三个 busy 阶段（adjudicating / submitting / sending）——编辑器软锁、主按钮
  // 不再可提交；sending 时主按钮转 spinner，停止由独立停止钮（interruptible）承接。
  const inert = disabled === true || blocked === true;
  const draftEmpty = (state?.draft ?? '').trim() === '';
  const noAttachments = (state?.attachmentIds.length ?? 0) === 0;
  const empty = draftEmpty && noAttachments;
  const phase = state?.phase;
  const sending = phase === 'sending';
  const machineBusy = phase === 'adjudicating' || phase === 'submitting' || sending;
  // 官方 primaryStops = running && subagent===null && !sending && (empty || blocked)。
  // （插件侧无 subagent；blocked 走 bar owner props。）
  // 停止形态不随禁用锁死：官方 primaryDisabled 在停止分支只看 stop 是否可用。
  const primaryStops = running === true && !sending && (empty || blocked === true);
  // 官方 primaryDisabled 的非停止分支：empty || disabled || machineBusy || uploadsPending
  // （插件侧草稿附件即传即用，无 uploadsPending；!live 等价于 actions 缺席）。
  const sendDisabled = primaryStops ? false : empty || inert || machineBusy || actions === undefined;

  // 统一 Markdown 管线（与用户消息同一函数）：同步渲染，draft 变更即重算。
  const html = useMemo(
    () => renderMarkdown(state?.draft ?? '', { surface: 'preview' }),
    [state?.draft, previewOn],
  );
  // 扩展渲染 扩展（代码高亮 / KaTeX / Mermaid）的 DOM 激活口；无注册扩展时 no-op。
  // 依赖必须含 previewOn：预览是条件渲染，「先粘贴、后开预览」时 html 没变、根节点
  // 却从 null 变成新挂载节点，只靠 [html] 会跳过激活（late-mount 路径：KaTeX 停在
  // 占位、Mermaid 一直 pending、代码块复制按钮无事件）。previewOn 切换时 React 会
  // 先跑上一次 cleanup，再对新根重新激活；side/float 与 normal 共用本效果。
  useEffect(() => {
    if (!previewOn) return undefined;
    return activateMarkdown(previewBodyRef.current, 'preview');
  }, [html, previewOn]);

  // ---- 分屏同步滚动：两侧按滚动比例互随（内容高度不同，比例映射） ----
  // scroll 不冒泡但走捕获相位，挂在 body 上的 onScrollCapture 能收到两栏的
  // 滚动，且 CM 视图随会话重建（scrollDOM 换新）也无需重挂监听；epsilon 防
  // 两侧事件互馈成回环。预览栏不显示滚动条（编辑栏为主），滚轮仍可反向带动。
  const syncSplitScroll = (event: React.SyntheticEvent<HTMLDivElement>): void => {
    if (!editOn || !previewOn) return;
    const src = event.target as HTMLElement;
    const editorScroll = viewRef.current?.scrollDOM;
    const previewScroll = previewRef.current;
    if (!editorScroll || !previewScroll) return;
    const dst = src === editorScroll ? previewScroll : src === previewScroll ? editorScroll : null;
    if (!dst) return;
    const srcMax = src.scrollHeight - src.clientHeight;
    if (srcMax <= 0) return;
    const top = (src.scrollTop / srcMax) * (dst.scrollHeight - dst.clientHeight);
    if (Math.abs(dst.scrollTop - top) > 1) dst.scrollTop = top;
  };
  // 进入分屏 / 草稿更新 / 切会话后，预览按编辑器当前比例对齐。
  useEffect(() => {
    if (!editOn || !previewOn) return;
    const editorScroll = viewRef.current?.scrollDOM;
    const previewScroll = previewRef.current;
    if (!editorScroll || !previewScroll) return;
    const editorMax = editorScroll.scrollHeight - editorScroll.clientHeight;
    if (editorMax <= 0) return;
    previewScroll.scrollTop = (editorScroll.scrollTop / editorMax) * (previewScroll.scrollHeight - previewScroll.clientHeight);
  }, [editOn, previewOn, html, sessionId]);

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
          onScrollCapture={syncSplitScroll}
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
              // 官方 busy 软锁：adjudicating / submitting / sending 三阶段编辑器只读
              //（EditorPane 内部已覆盖前两者，sending 由这里并入 disabled）。
              disabled={inert || sending}
              autoFocus={true}
              solo={!previewOn}
              stateKey={sessionId ?? 'hero'}
            />
          ) : null}
          {previewOn ? (
            <div className="dci-preview" data-solo={!editOn} ref={previewRef} onClick={onPreviewClick}>
              {html ? (
                <div
                  className="dci-md"
                  data-dci-md="preview"
                  data-mono={markdownMono ? 'true' : undefined}
                  ref={previewBodyRef}
                  dangerouslySetInnerHTML={{ __html: html }}
                />
              ) : (
                <span style={{ opacity: 0.4 }}>{t("preview.empty")}</span>
              )}
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
          // 官方两个 owner 信号分开下发：inert（disabled）与 blocked。
          // locked = inert || blocked；modelSeatLocked = inert || !live（不含 blocked）。
          disabled={disabled === true}
          blocked={blocked === true}
          running={running === true}
          primaryStops={primaryStops}
          onStop={onStop}
          onNotify={notifyFor(sessionId)}
          onSend={sendGesture}
          sendDisabled={sendDisabled}
          inputStandard={inputStandard}
        />

        {/* 数据行：悬浮形态收进卡片（工具行下方，随卡片圆角一体）。 */}
        {float && hero !== true ? (
          <StatsRow useProjection={useProjection} sessionId={sessionId} chatNodes={chatNodes} standard={inputStandard} />
        ) : null}

        {/* 官方 MenuView 锚定：normal 形态仍以卡片顶上方 absolute 浮层弹出（几何不变）；
            side/float 形态由 SlashMenu portal 到 body，按卡片四周空位做自适应 fixed
            浮层（不遮编辑区、不挤压卡片布局）。 */}
        {triggers ? (
          <SlashMenu triggers={triggers} dropdown={side === true || float === true} anchorRef={cardRef} />
        ) : null}
      </div>

      {/* 数据行：主输入/侧栏渲染在卡片下方（官方 hero 新会话态无 stats）。 */}
      {!float && hero !== true ? (
        <StatsRow useProjection={useProjection} sessionId={sessionId} chatNodes={chatNodes} standard={inputStandard} />
      ) : null}

      {popup ? <PopupSelectView popup={popup} anchorRef={cardRef} /> : null}

      {/* Markdown 图片大图灯箱（用户消息侧同组件同行为）。 */}
      {lightbox ? (
        <ImageLightbox
          src={lightbox.src}
          alt={lightbox.alt}
          labels={{ dialog: t('image.preview'), close: t('image.closePreview') }}
          onClose={() => setLightbox(null)}
        />
      ) : null}
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
