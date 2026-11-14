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
import { EditorPane, type EditorControl } from './EditorPane';
import { InputSlotSeat } from './InputSlotSeat';
import { AttachmentsSeat, useOfficialAttachmentsActive } from './AttachmentsSeat';
import { ImageLightbox } from '@deepseek-ai/dsh-client-ui-primitives';
import { Toolbar } from './Toolbar';
import { StatsRowMemo } from './StatsRow';
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives';

/**
 * 官方 overlay 座位（`conversation.input.overlay`，list/session）：宿主官方
 * client-ui-input-trigger 的 MenuView（`/` 候选）、client-ui-commands 的
 * PopupSelectView（`/model` `/permission` 等弹层）、message-feedback 的
 * FeedbackDialog 都注册在这里。Codinput 遮蔽官方 bar 后这些座位失去渲染点，
 * 0.5.0 起**不再自绘**，而是把它们原样渲染进与官方 InputBar 同构的
 * `.dci-overlay-anchor`（零高、贴卡片顶边的绝对定位条）：
 * 官方实现自带 `position:absolute; bottom:calc(100%+4px); left:0; right:0`，
 * 于是弹层几何/动画/键盘/焦点/无障碍与官方输入框逐像素一致。
 */
const OVERLAY_SLOT = 'conversation.input.overlay';


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
  const { sessionId, state, actions, useProjection, inputStandard, placeholder, disabled, blocked, running, side, hero, chatNodes, float, onDragZonePointerDown, continueState, occurrence, registerFileIntake } = props;
  // 语言切换时整棵表面重渲染（文案都走 i18n 的 t()）。
  useT();
  // 官方附件条目是否可镜像（决定卡片层粘贴/拖放处理器是否让位给官方链路）。
  const officialAttachments = useOfficialAttachmentsActive(sessionId);

  const [editOn, setEditOn] = useState<boolean>(() => loadPrefs().defaultEdit);
  const [previewOn, setPreviewOn] = useState<boolean>(() => loadPrefs().defaultPreview);
  const [bodyHeight, setBodyHeight] = useState<number | null>(() => loadPrefs().composerBodyHeight);
  /** Markdown 正文等宽连字（设置 → Markdown 等宽连字）：即时跟随 prefs 变化。 */
  const [markdownMono, setMarkdownMono] = useState<boolean>(() => loadPrefs().markdownMono);
  useEffect(() => subscribePrefs(() => setMarkdownMono(loadPrefs().markdownMono)), []);
  // ---- 本地草稿镜像（0.5.0 性能修正） ----
  // 官方 setDraft 是整篇替换（O(草稿长度)），纯输入期间不做宿主往返：界面
  // 只消费编辑器上报的本地文本。为把重渲染压到最低，只有「空草稿 / 命令
  // 草稿」这两个影响按钮形态的布尔变化才 setState（预览开启时另按帧更新
  // 预览内容——预览本身已去抖）。
  const [draftText, setDraftText] = useState<string>(() => state?.draft ?? '');
  const draftRef = useRef<string>(state?.draft ?? '');
  const [previewDraft, setPreviewDraft] = useState<string>(() => state?.draft ?? '');
  const draftEmptyRef = useRef<boolean>((state?.draft ?? '').trim() === '');
  const plainDraftRef = useRef<boolean>(false);
  /** 宿主语义动作前同步草稿的控制面（EditorPane 挂载时填充）。 */
  const editorCtlRef = useRef<EditorControl | null>(null);
  const previewOnRef = useRef<boolean>(previewOn);
  previewOnRef.current = previewOn;
  /** 预览内容更新去抖：连按期间不跟帧（markdown 整篇重渲染是 O(n)）。 */
  const previewTimerRef = useRef(0);
  const schedulePreview = useCallback((): void => {
    if (previewTimerRef.current !== 0) window.clearTimeout(previewTimerRef.current);
    previewTimerRef.current = window.setTimeout(() => {
      previewTimerRef.current = 0;
      setPreviewDraft(draftRef.current);
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
  const onDraftText = useCallback(
    (text: string): void => {
      draftRef.current = text;
      const nextEmpty = text.trim() === '';
      const nextPlain = !nextEmpty && !text.trimStart().startsWith('/');
      if (nextEmpty !== draftEmptyRef.current || nextPlain !== plainDraftRef.current) {
        draftEmptyRef.current = nextEmpty;
        plainDraftRef.current = nextPlain;
        setDraftText(text);
      }
      // 预览开启时按「停手 140ms」刷新内容：连按期间不产生任何整篇重渲染。
      if (previewOnRef.current) schedulePreview();
    },
    [schedulePreview],
  );
  /** 遮罩层（官方菜单/弹层）里按下指针：宿主 pick/claim 会立即读写草稿，先同步。 */
  const onOverlayPointerDown = useCallback((): void => {
    editorCtlRef.current?.flushAndTrack();
  }, []);
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

  // 文件拾取绑定：官方 InputBar 挂载时把 shell 的 filePicker 绑给自己，卸载
  // 解绑——slash「添加 · 文件」行 available = shell.canPickFiles，接管期间不
  // 绑该行就消失。接管面挂载即绑、卸载即解，open 走本模块的附件入草稿链路。
  useEffect(() => {
    if (!sessionId) return;
    return bindSessionFilePicker(sessionId);
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
    // 发送读的是宿主输入机里的草稿：本地输入期间草稿还没上报，先同步最后一版。
    editorCtlRef.current?.flush();
    const st = state;
    const draftEmpty = draftRef.current.trim() === '';
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
  // 空/命令草稿判定用本地镜像（官方草稿是 O(n) 整篇同步，纯输入期间可能滞后）。
  // draftText 只在「空 ↔ 非空 / 命令草稿」切换时更新，所以这里读到的是最新判定。
  const draftEmpty = draftText.trim() === '';
  const noAttachments = (state?.attachmentIds.length ?? 0) === 0;
  const empty = draftEmpty && noAttachments;
  const phase = state?.phase;
  const sending = phase === 'sending';
  const machineBusy = phase === 'adjudicating' || phase === 'submitting' || sending;
  // 官方 primaryStops = running && subagent===null && !sending && (empty || blocked)。
  // （插件侧无 subagent；blocked 走 bar owner props。）
  // 停止形态不随禁用锁死：官方 primaryDisabled 在停止分支只看 stop 是否可用。
  const primaryStops = running === true && !sending && (empty || blocked === true);
  // 官方 primaryRetries（rc.3）：失败轮次可重试、且输入面带不出别的东西时，
  // 主按钮变「继续生成」三角。条件逐项对齐官方 InputBar（subagent/removed 由
  // bar 条目层经 useSession 读到后以 continueState 下发）。
  const cs = continueState;
  const primaryRetries = cs !== undefined
    && running !== true && !cs.subagentActive && empty
    && cs.retryableFailure !== undefined && !cs.pendingHumanInput
    && cs.historyOpen && !cs.submissionPending && !cs.removed
    && !inert && actions !== undefined && (state?.queue.length ?? 0) === 0
    && state?.phase === 'plain' && cs.retry !== undefined;
  const onRetry = (): void => {
    if (cs?.retry !== undefined && cs.retryableFailure !== undefined) cs.retry(cs.retryableFailure);
  };
  // 官方 primaryDisabled 的非停止分支：(!primaryRetries && empty) || disabled ||
  // machineBusy || uploadsPending（插件侧无 uploadsPending；!live 等价于 actions 缺席）。
  const sendDisabled = primaryStops ? false
    : (!primaryRetries && empty) || inert || machineBusy || actions === undefined;

  // rc.3 文档级粘贴路由：没有聚焦可编辑控件时，宿主把粘贴的文件选举给一个
  // 接受它的 composer（主 composer 优先）。官方 InputBar 用 registerFileIntake
  // 注册自己的卡片；接管期间必须由本插件注册，否则粘贴文件没有落点。
  // accepts/add 每拍更新到 ref，注册只随（注册器 × occurrence × 会话）重挂。
  const intakeRef = useRef<{ accepts: () => boolean; add: (files: readonly File[], directories?: ReadonlySet<File>) => void }>({
    accepts: () => false,
    add: () => {},
  });
  intakeRef.current = {
    accepts: () => !inert && !machineBusy && actions !== undefined && sessionId !== undefined,
    add: (files) => {
      addFilesToDraft(sessionId, actions, files, notifyFor(sessionId));
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
  // 卡顿根因（长按 Enter 连续换行 / 长按 Backspace 连续删行）：此前
  // `renderMarkdown` 在**每次草稿变化**都对整篇文档跑一遍解析（预览关着也跑）。
  // 长文档下每次按键 O(n)、连按变 O(n²)，主线程被占满 → 明显掉帧。
  // 现在预览关闭时零 markdown 计算；开启时内容更新去抖，连按只渲染停手后的
  // 最后一版（观感 = 停手才刷新预览）。
  // 开预览 / 切会话：立即对齐当前草稿（避免短暂显示旧稿或上一会话的预览）。
  useEffect(() => {
    if (!previewOn) return;
    setPreviewDraft(draftRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewOn, sessionId]);
  const html = useMemo(
    () => (previewOn ? renderMarkdown(previewDraft, { surface: 'preview' }) : ''),
    [previewDraft, previewOn],
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
  // scroll 不冒泡但走捕获相位，挂在 body 上的 onScrollCapture 能收到两栏
  // 滚动，且 CM 视图随会话重建（scrollDOM 换新）也无需重挂监听；epsilon 防
  // 两侧事件互馈成回环。预览栏不显示滚动条（编辑栏为主），滚轮仍可反向带动。
  //
  // 方向差异（连打性能）：**预览 → 编辑**（用户主动滚预览）立即同步；
  // **编辑 → 预览** 去抖 140ms——连按 Enter/Backspace 时 CM 每键都会
  // scrollIntoView 触发滚动事件，若每键都去读写预览栏 scrollHeight 就会把
  // 整篇预览 markup 反复拉进布局（长草稿分屏下实测掉到 ~30fps）。预览内容
  // 本身也是停手才刷新，跟手同步没有意义。
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
    if (src !== editorScroll) return;
    if (splitSyncTimerRef.current !== 0) window.clearTimeout(splitSyncTimerRef.current);
    splitSyncTimerRef.current = window.setTimeout(() => {
      splitSyncTimerRef.current = 0;
      const a = viewRef.current?.scrollDOM;
      const b = previewRef.current;
      if (a && b) syncPair(a, b);
    }, 140);
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
  const notify = useMemo(() => notifyFor(sessionId), [sessionId]);
  const onPasteCapture = (event: React.ClipboardEvent<HTMLDivElement>): void => {
    const files = event.clipboardData?.files;
    if (!files || files.length === 0) return;
    // 官方附件条目接管时，卡片非编辑器区域的粘贴交给官方文档级 route
    // （宿主在 pad 到 composer 时按 occurrence 选举，双份处理会重复添加）；
    // 编辑器内粘贴仍由本插件落地——CodeMirror 不会自己处理文件粘贴。
    if (officialAttachments) {
      const target = event.target as Element | null;
      if (target?.closest('.cm-content') == null) return;
    }
    event.preventDefault();
    event.stopPropagation();
    addFilesToDraft(sessionId, actions, files, notify);
  };
  // 官方 ComposerAttachments 自带文档级拖放监听 + DropOverlay；接管期间卡片层
  // 监听让位，避免同一批文件被添加两次（条目不可镜像是才回退本节）。
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
        {/* 官方 overlay 座位渲染点（官方 InputBar .overlayAnchor 同构：零高、
            贴卡片顶边的绝对定位条）。官方弹层以它为包含块 + 底边锚点浮出卡片上方。
            指针按下先同步草稿：菜单行 pick / claim 会立刻读写宿主草稿并按
            span.draftRev 做 CAS，纯输入期间宿主草稿是按需同步的，必须先补齐。 */}
        <div className="dci-overlay-anchor" data-composer-overlay onPointerDownCapture={onOverlayPointerDown}>
          {sessionId !== undefined ? (
            <InputSlotSeat slot={OVERLAY_SLOT} sessionId={sessionId} standard={inputStandard} />
          ) : null}
        </div>
        <div className="dci-rip" data-axis="y" data-side="top" onPointerDown={startDrag} />
        <div className="dci-accessory">
          <Tooltip label={t("head.edit")} side="top" delayMs={500} portal>
            <button type="button" className="dci-iconbtn" data-on={editOn} onClick={toggleEdit} aria-label={t("head.edit")}>
              <IconEdit size={14} />
            </button>
          </Tooltip>
          <Tooltip label={t("head.preview")} side="top" delayMs={500} portal>
            <button type="button" className="dci-iconbtn" data-on={previewOn} onClick={togglePreview} aria-label={t("head.preview")}>
              <IconEye size={14} />
            </button>
          </Tooltip>
          {/* 主输入卡片：开关右侧的空白即拖动区——一拖自动脱出悬浮，拖回底部自动回普通。 */}
          {!side ? <div className="dci-float-dragzone" onPointerDown={onDragZonePointerDown} /> : null}
        </div>

        {/* 官方附件座位（0.5.0）：条目可镜像时渲染官方 ComposerAttachments
            （缩略图/文件卡/上传进度/失败重试/拖放浮层/原图灯箱全官方）；旧宿主
            或 inject 不可复现时回退自绘 AttachmentRail。 */}
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
          primaryRetries={primaryRetries}
          onRetry={onRetry}
          onStop={onStop}
          onNotify={notify}
          onSend={sendGesture}
          sendDisabled={sendDisabled}
          inputStandard={inputStandard}
          draftText={draftText}
          getDraft={() => draftRef.current}
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
