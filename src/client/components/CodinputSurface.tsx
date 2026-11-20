/**
 * Codinput 主体表面：头部行（品牌 · 编辑/预览双开关）、编辑预览区
 * （左右分屏）、工具行、数据行。主输入（composer bar 遮蔽条目）与
 * 侧边标签页共用本表面；读写同一台官方输入机，草稿天然同源。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EditorView } from '@codemirror/view';
import type {
  ComposerFileIntakeTarget,
  ComposerKeyboard,
  ContinueState,
  InputActions,
  InputState,
  InputTriggerController,
  UseProjection,
} from '../host-types';
import { stash, useService } from '../services';
import { loadPrefs, savePrefs, usePref, type CodinputPrefs } from '../prefs';
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
import { EditorPane, type DraftMeta, type EditorControl } from './EditorPane';
import { InputSlotSeat } from './InputSlotSeat';
import { AttachmentsSeat, useOfficialAttachmentsActive } from './AttachmentsSeat';
import { ImageLightbox, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives';
import { Toolbar } from './Toolbar';
import { StatsRowMemo } from './StatsRow';
import { useAdaptiveOverlayHost } from './overlay-host';

/**
 * 官方 overlay 座位（`conversation.input.overlay`，list/session）：宿主官方
 * client-ui-input-trigger 的 MenuView（`/` 候选）、client-ui-commands 的
 * PopupSelectView（`/model` `/permission` 等弹层）、message-feedback 的
 * FeedbackDialog 都注册在这里。原样渲染进 `.dci-overlay-anchor`（与官方同构）。
 */
const OVERLAY_SLOT = 'conversation.input.overlay';

const selectMarkdownMono = (p: CodinputPrefs): boolean => p.markdownMono;

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
  /** rc.3 Continue/Retry 信号（bar 条目层用 useSession/useProjection 读到后下发）。 */
  continueState?: ContinueState;
  /** 本 composer 的 occurrence：文档级粘贴路由按 main/embedded 选举。 */
  occurrence?: 'main' | 'embedded';
  /** rc.3 bar 注入的文档级粘贴路由注册器。 */
  registerFileIntake?: (target: ComposerFileIntakeTarget) => () => void;
  /** 官方 bar variant：hero（新会话，无对话记录）不渲染数据行。 */
  hero?: boolean;
  /** chat legacy 节点数组（sessionStats 投影缺席时派生轮次/decode 计时）。 */
  chatNodes?: unknown;
  /** 侧栏形态（视觉略紧凑）。 */
  side?: boolean;
  /** 悬浮形态（卡片在 FloatingShell 内 portal 渲染；拖动由 FloatingShell 管理）。 */
  float?: boolean;
  /** 顶部行拖动区的 pointerdown（悬浮进出会话，FloatingShell 提供）。 */
  onDragZonePointerDown?: (event: React.PointerEvent<HTMLDivElement>) => void;
}

export function CodinputSurface(props: CodinputSurfaceProps): JSX.Element {
  const {
    sessionId,
    state,
    actions,
    useProjection,
    inputStandard,
    placeholder,
    disabled,
    blocked,
    running,
    side,
    hero,
    chatNodes,
    float,
    onDragZonePointerDown,
    continueState,
    occurrence,
    registerFileIntake,
  } = props;
  // 语言切换时整棵表面重渲染（文案都走 i18n 的 t()）。
  useT();
  // 官方附件条目是否可镜像（决定卡片层粘贴/拖放处理器是否让位给官方链路）。
  const officialAttachments = useOfficialAttachmentsActive(sessionId);

  const [editOn, setEditOn] = useState<boolean>(() => loadPrefs().defaultEdit);
  const [previewOn, setPreviewOn] = useState<boolean>(() => loadPrefs().defaultPreview);
  const [bodyHeight, setBodyHeight] = useState<number | null>(() => loadPrefs().composerBodyHeight);
  /** Markdown 正文等宽连字（设置 → Markdown 等宽连字）：即时跟随 prefs 变化。 */
  const markdownMono = usePref(selectMarkdownMono);

  // ---- 本地草稿镜像（0.5.0 性能修正 + 0.6.1 零序列化元状态） ----
  const initialDraft = state?.draft ?? '';
  const initialEmpty = initialDraft.trim() === '';
  const initialPlain = !initialEmpty && !initialDraft.trimStart().startsWith('/');
  const [draftText, setDraftText] = useState<string>(initialEmpty ? '' : initialPlain ? 'x' : '/');
  const draftRef = useRef<string>(initialDraft);
  const [previewDraft, setPreviewDraft] = useState<string>(initialDraft);
  const draftEmptyRef = useRef<boolean>(initialEmpty);
  const plainDraftRef = useRef<boolean>(initialPlain);
  /** 宿主语义动作前同步草稿的控制面（EditorPane 挂载时填充）。 */
  const editorCtlRef = useRef<EditorControl | null>(null);
  const previewOnRef = useRef<boolean>(previewOn);
  previewOnRef.current = previewOn;
  /** 预览内容更新去抖：连按期间不跟帧、不序列化（停手 140ms 才读一次最新全文）。 */
  const previewTimerRef = useRef(0);
  const schedulePreview = useCallback((): void => {
    if (previewTimerRef.current !== 0) window.clearTimeout(previewTimerRef.current);
    previewTimerRef.current = window.setTimeout(() => {
      previewTimerRef.current = 0;
      const latest = editorCtlRef.current?.getDraft() ?? draftRef.current;
      draftRef.current = latest;
      setPreviewDraft(latest);
    }, 140);
  }, []);
  useEffect(
    () => () => {
      if (previewTimerRef.current !== 0) {
        window.clearTimeout(previewTimerRef.current);
        previewTimerRef.current = 0;
      }
    },
    [],
  );
  const onDraftMeta = useCallback(
    (meta: DraftMeta): void => {
      if (meta.empty !== draftEmptyRef.current || meta.plain !== plainDraftRef.current) {
        draftEmptyRef.current = meta.empty;
        plainDraftRef.current = meta.plain;
        setDraftText(meta.empty ? '' : meta.plain ? 'x' : '/');
      }
      // 预览开启且文档变化时按「停手 140ms」刷新内容：连按期间零整篇序列化与重渲染。
      if (meta.dirty && previewOnRef.current) schedulePreview();
    },
    [schedulePreview],
  );
  const onDraftText = useCallback(
    (text: string): void => {
      draftRef.current = text;
      const nextEmpty = text.trim() === '';
      const nextPlain = !nextEmpty && !text.trimStart().startsWith('/');
      if (nextEmpty !== draftEmptyRef.current || nextPlain !== plainDraftRef.current) {
        draftEmptyRef.current = nextEmpty;
        plainDraftRef.current = nextPlain;
        setDraftText(nextEmpty ? '' : nextPlain ? 'x' : '/');
      }
      if (previewOnRef.current) schedulePreview();
    },
    [schedulePreview],
  );
  // 仅预览形态（editOn === false）下 EditorPane 未挂载，切会话或外部草稿变化
  // 需直接从宿主 state.draft 同步本地镜像与预览内容，否则预览会停在上一会话的草稿。
  const hostDraft = state?.draft ?? '';
  useEffect(() => {
    if (editOn) return;
    draftRef.current = hostDraft;
    draftEmptyRef.current = hostDraft.trim() === '';
    plainDraftRef.current = !draftEmptyRef.current && !hostDraft.trimStart().startsWith('/');
    setDraftText(draftEmptyRef.current ? '' : plainDraftRef.current ? 'x' : '/');
    setPreviewDraft(hostDraft);
  }, [editOn, hostDraft, sessionId]);

  /** 遮罩层（官方菜单/弹层）里按下指针：宿主 pick/claim 会立即读写草稿，先同步。 */
  const onOverlayPointerDown = useCallback((): void => {
    editorCtlRef.current?.flushAndTrack();
  }, []);
  /** 同步取当前草稿（稳定引用，避免 Toolbar 每次渲染重建 permissionFallback）。 */
  const getLiveDraft = useCallback((): string => editorCtlRef.current?.getDraft() ?? draftRef.current, []);

  /** 拖文件悬停卡片时的落区提示（松手即入草稿附件）。 */
  const [dropActive, setDropActive] = useState(false);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  /** 官方 overlay 座位锚点（float/side 形态下由 overlay-host 改为固定自适应宿主）。 */
  const overlayHostRef = useRef<HTMLDivElement | null>(null);
  const overlayAdaptive = side === true || float === true;
  useAdaptiveOverlayHost(overlayHostRef, cardRef, overlayAdaptive);
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

  // 高度调节：仅顶边把手，1:1 跟手，松手持久化；卸载时回收任何进行中的拖拽监听。
  const cleanupDragRef = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      cleanupDragRef.current?.();
      cleanupDragRef.current = null;
    },
    [],
  );
  const startDrag = (event: React.PointerEvent<HTMLDivElement>): void => {
    event.preventDefault();
    cleanupDragRef.current?.();
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
    const detach = (): void => {
      handle.dataset.dragging = 'false';
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (cleanupDragRef.current === detach) cleanupDragRef.current = null;
    };
    const onUp = (): void => {
      detach();
      savePrefs({ composerBodyHeight: nextH });
    };
    cleanupDragRef.current = detach;
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      /* 合成事件无活动指针：window 监听兜底 */
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  // 服务响应式读取：conversation 异步就绪时立即触发重算；会话面瞬时未绑定时再短轮询兜底。
  const conversation = useService('conversation');
  const [, setSvcEpoch] = useState(0);

  useEffect(() => {
    // 至少开启一个开关。
    if (!editOn && !previewOn) setEditOn(true);
  }, [editOn, previewOn]);

  // 逐会话解析官方服务面：触发管线 + 键盘面（每次渲染现解析，跟随会话绑定换代）。
  const resolveTriggers = (): InputTriggerController | undefined => {
    if (!sessionId || !conversation) return undefined;
    try {
      return conversation.input.inputTriggers(sessionId) ?? undefined;
    } catch {
      return undefined;
    }
  };
  const resolveKeyboard = (): ComposerKeyboard | undefined => {
    if (!sessionId || !conversation) return undefined;
    try {
      return conversation.input.keyboard(sessionId);
    } catch {
      return undefined;
    }
  };
  const triggers = resolveTriggers();
  const keyboard = resolveKeyboard();

  // conversation 已就绪但该会话的触发器/键盘面瞬时不可解析时的短轮询兜底。
  useEffect(() => {
    if (!sessionId || !conversation || (triggers && keyboard)) return;
    const timer = window.setInterval(() => setSvcEpoch((n) => n + 1), 300);
    const stop = window.setTimeout(() => window.clearInterval(timer), 10_000);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(stop);
    };
  }, [sessionId, conversation, triggers, keyboard]);

  // 文件拾取绑定：官方 InputBar 挂载时把 shell 的 filePicker 绑给自己，卸载解绑。
  useEffect(() => {
    if (!sessionId || !conversation) return;
    return bindSessionFilePicker(sessionId);
  }, [sessionId, conversation]);

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
      const conv = scope?.get?.('conversation');
      void conv?.cancel?.()?.catch?.(() => {});
    } catch {
      /* 会话作用域缺席：静默（下一拍 running 投影自会收敛） */
    }
  };
  const onStop = stopSession;

  const sendGesture = (): void => {
    if (!actions) return;
    // 发送读的是宿主输入机里的草稿：本地输入期间草稿还没上报，先同步最后一版。
    editorCtlRef.current?.flush();
    const st = state;
    // 判空用编辑器同步读取（防止最后一笔输入与发送同帧时误走 Steer）。
    const liveDraft = editorCtlRef.current?.getDraft() ?? draftRef.current;
    const draftEmpty = liveDraft.trim() === '';
    const noAttachments = !st || st.attachmentIds.length === 0;
    if (draftEmpty && noAttachments) {
      keyboard?.steerQueue(); // 空草稿：发送手势转队列全量 Steer
      return;
    }
    actions.submit();
  };

  const inert = disabled === true || blocked === true;
  const draftEmpty = draftText.trim() === '';
  const noAttachments = (state?.attachmentIds.length ?? 0) === 0;
  const empty = draftEmpty && noAttachments;
  const phase = state?.phase;
  const sending = phase === 'sending';
  const machineBusy = phase === 'adjudicating' || phase === 'submitting' || sending;
  const primaryStops = running === true && !sending && (empty || blocked === true);
  const cs = continueState;
  const primaryRetries =
    cs !== undefined &&
    running !== true &&
    !cs.subagentActive &&
    empty &&
    cs.retryableFailure !== undefined &&
    !cs.pendingHumanInput &&
    cs.historyOpen &&
    !cs.submissionPending &&
    !cs.removed &&
    !inert &&
    actions !== undefined &&
    (state?.queue.length ?? 0) === 0 &&
    state?.phase === 'plain' &&
    cs.retry !== undefined;
  const onRetry = (): void => {
    if (cs?.retry !== undefined && cs.retryableFailure !== undefined) cs.retry(cs.retryableFailure);
  };
  const sendDisabled = primaryStops
    ? false
    : (!primaryRetries && empty) || inert || machineBusy || actions === undefined;

  // rc.3 文档级粘贴路由：没有聚焦可编辑控件时，宿主把粘贴的文件选举给本 composer。
  const notify = useMemo(() => notifyFor(sessionId), [sessionId]);
  const intakeRef = useRef<{ accepts: () => boolean; add: (files: readonly File[], directories?: ReadonlySet<File>) => void }>({
    accepts: () => false,
    add: () => {},
  });
  intakeRef.current = {
    accepts: () => !inert && !machineBusy && actions !== undefined && sessionId !== undefined,
    add: (files) => {
      addFilesToDraft(sessionId, actions, files, notify);
    },
  };
  useEffect(() => {
    if (registerFileIntake === undefined || cardRef.current === null || sessionId === undefined) return undefined;
    return registerFileIntake({
      card: cardRef.current,
      occurrence: occurrence ?? 'main',
      accepts: () => intakeRef.current.accepts(),
      add: (files, directories) => intakeRef.current.add(files, directories),
    });
  }, [registerFileIntake, occurrence, sessionId]);

  // ---- 预览渲染：只在预览开启时计算；正文更新走「停手 140ms」去抖 ----
  useEffect(() => {
    if (!previewOn) return;
    const latest = editorCtlRef.current?.getDraft() ?? draftRef.current;
    draftRef.current = latest;
    setPreviewDraft(latest);
  }, [previewOn, sessionId]);
  const html = useMemo(
    () => (previewOn ? renderMarkdown(previewDraft, { surface: 'preview' }) : ''),
    [previewDraft, previewOn],
  );
  useEffect(() => {
    if (!previewOn) return undefined;
    return activateMarkdown(previewBodyRef.current, 'preview');
  }, [html, previewOn]);

  // ---- 分屏同步滚动 ----
  const splitSyncTimerRef = useRef(0);
  const syncPair = (src: HTMLElement, dst: HTMLElement): void => {
    const srcMax = src.scrollHeight - src.clientHeight;
    if (srcMax <= 0) return;
    const top = (src.scrollTop / srcMax) * (dst.scrollHeight - dst.clientHeight);
    if (Math.abs(dst.scrollTop - top) > 1) dst.scrollTop = top;
  };
  useEffect(
    () => () => {
      if (splitSyncTimerRef.current !== 0) {
        window.clearTimeout(splitSyncTimerRef.current);
        splitSyncTimerRef.current = 0;
      }
    },
    [],
  );
  const onEditorScroll = useCallback((): void => {
    if (!previewOnRef.current) return;
    if (splitSyncTimerRef.current !== 0) window.clearTimeout(splitSyncTimerRef.current);
    splitSyncTimerRef.current = window.setTimeout(() => {
      splitSyncTimerRef.current = 0;
      const a = viewRef.current?.scrollDOM;
      const b = previewRef.current;
      if (a && b) syncPair(a, b);
    }, 140);
  }, []);
  const syncSplitScroll = (event: React.SyntheticEvent<HTMLDivElement>): void => {
    if (!editOn || !previewOn) return;
    const src = event.target as HTMLElement;
    const editorScroll = viewRef.current?.scrollDOM;
    const previewScroll = previewRef.current;
    if (!editorScroll || !previewScroll) return;
    if (src === previewScroll) {
      syncPair(previewScroll, editorScroll);
      return;
    }
    if (src === editorScroll) onEditorScroll();
  };
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

  const placeholderText = placeholder ?? t('editor.placeholder');

  // ---- 附件入口 #2 / #3：粘贴与拖入 ----
  const onPasteCapture = (event: React.ClipboardEvent<HTMLDivElement>): void => {
    const files = event.clipboardData?.files;
    if (!files || files.length === 0) return;
    if (officialAttachments) {
      const path = event.nativeEvent.composedPath?.() ?? [];
      const inEditor = path.some((node) => node instanceof Element && node.classList.contains('cm-content'));
      const target = event.target as Element | null;
      if (!inEditor && target?.closest('.cm-content, .dci-cm-host') == null) return;
    }
    event.preventDefault();
    event.stopPropagation();
    addFilesToDraft(sessionId, actions, files, notify);
  };
  const onDragOverCapture = (event: React.DragEvent<HTMLDivElement>): void => {
    if (officialAttachments) return;
    if (!dragHasFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    if (!dropActive) setDropActive(true);
  };
  const onDragLeave = (event: React.DragEvent<HTMLDivElement>): void => {
    if (officialAttachments) return;
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setDropActive(false);
  };
  const onDropCapture = (event: React.DragEvent<HTMLDivElement>): void => {
    if (officialAttachments) return;
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
        {/* 官方 overlay 座位渲染点（官方 InputBar .overlayAnchor 同构）。 */}
        <div className="dci-overlay-anchor" data-composer-overlay
          data-adaptive={overlayAdaptive ? '' : undefined}
          ref={overlayHostRef}
          onPointerDownCapture={onOverlayPointerDown}
        >
          {sessionId !== undefined ? (
            <InputSlotSeat slot={OVERLAY_SLOT} sessionId={sessionId} standard={inputStandard} />
          ) : null}
        </div>
        <div className="dci-rip" data-axis="y" data-side="top" onPointerDown={startDrag} />
        <div className="dci-accessory">
          <Tooltip label={t('head.edit')} side="top" delayMs={500} portal>
            <button type="button" className="dci-iconbtn" data-on={editOn} onClick={toggleEdit} aria-label={t('head.edit')}>
              <IconEdit size={14} />
            </button>
          </Tooltip>
          <Tooltip label={t('head.preview')} side="top" delayMs={500} portal>
            <button type="button" className="dci-iconbtn" data-on={previewOn} onClick={togglePreview} aria-label={t('head.preview')}>
              <IconEye size={14} />
            </button>
          </Tooltip>
          {/* 主输入卡片：开关右侧的空白即拖动区——一拖自动脱出悬浮，拖回底部自动回普通。 */}
          {!side ? <div className="dci-float-dragzone" onPointerDown={onDragZonePointerDown} /> : null}
        </div>

        {/* 官方附件座位（0.5.0）：条目可镜像时渲染官方 ComposerAttachments；缺席时回退自绘。 */}
        <AttachmentsSeat
          sessionId={sessionId}
          state={state}
          actions={actions}
          standard={inputStandard}
          useProjection={useProjection}
          disabled={inert}
          machineBusy={machineBusy}
          onNotify={notify}
        />

        <div
          className="dci-body"
          ref={bodyRef}
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
              editorCtlRef={editorCtlRef}
              onDraftText={onDraftText}
              onDraftMeta={onDraftMeta}
              onEditorScroll={onEditorScroll}
              bodyRef={bodyRef}
              autoGrow={!side && !float && bodyHeight === null}
              onCaretMoved={caretMoved}
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
                <span style={{ opacity: 0.4 }}>{t('preview.empty')}</span>
              )}
            </div>
          ) : null}
        </div>

        <Toolbar
          sessionId={sessionId}
          state={state}
          actions={actions}
          triggers={triggers}
          keyboard={keyboard}
          caretRef={caretRef}
          useProjection={useProjection}
          disabled={disabled === true}
          blocked={blocked === true}
          running={running === true}
          primaryStops={primaryStops}
          primaryRetries={primaryRetries}
          onRetry={onRetry}
          onStop={onStop}
          onNotify={notify}
          onSend={sendGesture}
          sendDisabled={sendDisabled}
          inputStandard={inputStandard}
          draftText={draftText}
          getDraft={getLiveDraft}
          onBeforeHostAction={onOverlayPointerDown}
        />

        {/* 数据行：悬浮形态收进卡片（工具行下方，随卡片圆角一体）。 */}
        {float && hero !== true ? (
          <StatsRowMemo useProjection={useProjection} sessionId={sessionId} chatNodes={chatNodes} standard={inputStandard} />
        ) : null}
      </div>

      {/* 数据行：主输入/侧栏渲染在卡片下方（官方 hero 新会话态无 stats）。 */}
      {!float && hero !== true ? (
        <StatsRowMemo useProjection={useProjection} sessionId={sessionId} chatNodes={chatNodes} standard={inputStandard} />
      ) : null}

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
