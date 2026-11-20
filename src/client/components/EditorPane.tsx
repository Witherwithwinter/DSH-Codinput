/**
 * 编辑区：CodeMirror 6 本体 + 草稿单写镜像。
 *
 * 官方输入机是唯一事实源：本地键入经 setDraft 单写入口上报；官方侧变化
 * （pick 补全、claim、提交清空、会话切换）回写灌入编辑器（external 标注，
 * 不再回写）。草稿与光标全程保留，形态切换不触碰。
 *
 * 撤销历史跨形态保留：三态切换会让本组件重挂载（inline ↔ portal ↔ 侧栏），
 * 挂载时按 stateKey（会话）取回上次的 EditorState（含撤销栈/选区/文档），
 * 卸载时暂存回去；滚动位置一并记忆。扩展里的回调走模块级 hooks 槽（见 cm.ts），
 * 因此复用旧 state 不会调到已卸载实例的 props。
 *
 * 草稿上报策略（0.5.0 性能修正）：官方 `inputActions.setDraft(text)` 是
 * **整篇替换**（单次成本 O(草稿长度)），因此本组件只在宿主真正需要草稿时同步：
 * 1. 空闲去抖（停手 500ms）——保证草稿持久化与其它插件读数最终一致；
 * 2. 宿主即将读写草稿的语义动作前**同步 flush**（发送、空格/claim、菜单
 *    键盘 pick、遮罩层指针按下、指令按钮）；
 * 3. 触发词（`/` `@`）开始时同步 flush，使宿主侧 hit 的 draftRev 与草稿
 *    一致；
 * 4. 页面隐藏 / `pagehide` / 失焦 / 卸载前 flush——刷新或关窗丢不了最后几个
 *    字符。
 * 纯输入期间不发任何宿主往返：编辑器与界面都只消费本地文本。
 */

import { useEffect, useLayoutEffect, useRef } from 'react';
import { EditorView } from '@codemirror/view';
import { Transaction, type Text } from '@codemirror/state';
import type { ComposerKeyboard, InputState, InputActions, InputTriggerController } from '../host-types';
import {
  createEditorExtensions,
  createEditorState,
  ensureEditorShadow,
  applyEditorOptions,
  subscribeEditorPrefs,
  setEditorEditable,
  setActiveEditorHooks,
  clearActiveEditorHooks,
  takeEditorSnapshot,
  putEditorSnapshot,
  readEditorDoc,
  rememberEditorDoc,
  enterEditor,
  leaveEditor,
  rememberDetachedHost,
  takeDetachedHost,
  externalAnnotation,
} from '../cm';
import { reportTrack, arbitrateForMenu, adjudicateSpace } from '../triggers';
import { loadPrefs } from '../prefs';
import { matchEvent } from '../hotkey';
import { diagDebug } from '../diag';

/** 宿主语义动作前可调的编辑器控制面（表面/工具行持有）。 */
export interface EditorControl {
  /** 把本地草稿同步给官方输入机（有差异才写）。 */
  flush(): void;
  /** flush + 用当前光标重新上报触发管线（pick/claim 的 draftRev CAS 需要）。 */
  flushAndTrack(): void;
  /**
   * 同步读编辑器里最新文本（本地事实源）。界面侧的 draftRef 只跟 rAF 回调更新，
   * 「最后一笔输入 + 同一帧点发送」会读到上一拍的旧值（误判空草稿走 Steer）。
   */
  getDraft(): string;
}

export interface DraftMeta {
  readonly empty: boolean;
  readonly plain: boolean;
  readonly dirty: boolean;
}

export interface EditorPaneProps {
  state: InputState | undefined;
  actions: InputActions | undefined;
  triggers: InputTriggerController | undefined;
  /** 键盘面：track 上报取实时 snapshot（pick 的 draftRev CAS 要求机器当拍修订号）。 */
  keyboard?: ComposerKeyboard;
  /** 发送手势（Enter/Ctrl+Enter 由偏好决定）：空草稿转队列全量 Steer。 */
  onSendGesture(): void;
  placeholder: string;
  /** 宿主表面持有的编辑器句柄（caret 屏幕坐标锚定候选菜单）。 */
  viewRef: { current: EditorView | null };
  /** 表面持有时可执行「同步草稿」控制（发送按钮 / 菜单遮罩层等宿主读写前）。 */
  editorCtlRef?: { current: EditorControl | null };
  /** 本地草稿文本上报（挂载/外部回写/状态切换时使用）。 */
  onDraftText?(text: string): void;
  /** 零序列化草稿元状态上报（热输入路径仅传 O(1) 空/命令判定与脏标记）。 */
  onDraftMeta?(meta: DraftMeta): void;
  /** ShadowRoot 内 `.cm-scroller` 滚动回调（scroll 不跨阴影边界冒泡，供分屏同步滚动用）。 */
  onEditorScroll?(): void;
  /** 外层 `.dci-body` 引用与是否自动增高：连按 Enter/Backspace 时临时稳高，避免宿主 ResizeObserver 每行触发整页样式重算。 */
  bodyRef?: { current: HTMLDivElement | null };
  autoGrow?: boolean;
  /** caret 移动回调（表面用于菜单锚点）。 */
  onCaretMoved?(caret: number): void;
  /** 挂载后自动聚焦（侧栏打开等场景）。 */
  autoFocus?: boolean;
  /** owner disabled（blocked/disabled 场景软禁用）。 */
  disabled?: boolean;
  /** 独占整行（预览关闭时）；分屏下必须为 false，两栏各占一半。 */
  solo?: boolean;
  /** 撤销历史/选区暂存的键（会话 id；hero 态用固定键）。 */
  stateKey?: string;
  onFocusedChange?(focused: boolean): void;
}

/** 停手多久后把草稿同步给官方输入机（持久化/其它插件读数用）。 */
const IDLE_PUBLISH_MS = 500;
/** 自动增高态连按 Enter 时阶梯扩展的最小间隔（ms），避免每行触发宿主 seatObserver。 */
const REPEAT_GROW_STEP_MS = 200;
/** 连按稳高的兜底释放时长（ms，应对失焦/漏 keyup）。 */
const REPEAT_RELEASE_MS = 180;

/**
 * 刚刚开始一个触发词（当前 token 恰好是刚敲下的单个 `/` 或 `@`）。
 * 只有这一刻需要先同步草稿：宿主按此 track 打开候选菜单，菜单 hit 的
 * span/draftRev 要与宿主文档对齐，之后 pick/claim 的 CAS 才命中。
 */
function justStartedTrigger(text: string, caret: number): boolean {
  let i = caret - 1;
  const floor = Math.max(0, caret - 256);
  for (; i >= floor; i -= 1) {
    const ch = text.charAt(i);
    if (ch === ' ' || ch === '\n' || ch === '\t') break;
  }
  const start = i + 1;
  if (caret - start !== 1) return false;
  const ch = text.charAt(start);
  return ch === '/' || ch === '@';
}

/** 当前光标所在 token（最多回看 256 字符）是否以 `/` 或 `@` 开头。 */
function tokenStartsWithTrigger(slice: string): boolean {
  let i = slice.length - 1;
  for (; i >= 0; i -= 1) {
    const ch = slice.charAt(i);
    if (ch === ' ' || ch === '\n' || ch === '\t') break;
  }
  const start = i + 1;
  if (start >= slice.length) return false;
  const ch = slice.charAt(start);
  return ch === '/' || ch === '@';
}

/** O(1) 判定不可变 Text 文档的空态与非命令态（零整篇字符串分配）。 */
function classifyDoc(doc: Text): { empty: boolean; plain: boolean } {
  const iter = doc.iter();
  while (!iter.next().done) {
    const chunk = iter.value;
    for (let i = 0; i < chunk.length; i += 1) {
      const code = chunk.charCodeAt(i);
      if (code === 32 || code === 10 || code === 9 || code === 13) continue;
      return { empty: false, plain: code !== 47 /* '/' */ };
    }
  }
  return { empty: true, plain: false };
}

/** 当前是否命令草稿（行首非空白后的第一个字符是 `/`）：空格 claim 只在这种草稿里发生。 */
function isDocCommand(doc: Text): boolean {
  const { empty, plain } = classifyDoc(doc);
  return !empty && !plain;
}

export function EditorPane(props: EditorPaneProps): JSX.Element {
  const { state, placeholder, autoFocus, viewRef, disabled, solo, stateKey, autoGrow } = props;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const composingRef = useRef(false);
  /** 触发管线与行列指示合并到下一帧：连按 Enter/Backspace 时每帧最多更新一次，零 React 重渲染。 */
  const trackRafRef = useRef(0);
  const pendingTrackRef = useRef<{ doc: Text; docChanged: boolean; caret: number } | null>(null);
  /** 本地最新文档（不可变 Text 树）+ 惰性序列化缓存（热输入路径零 doc.toString()）。 */
  const latestDocRef = useRef<Text | null>(null);
  const cachedTextDocRef = useRef<Text | null>(null);
  const latestTextRef = useRef('');
  const localDirtyRef = useRef(false);
  /** 上一次是否处于触发词上下文：为 true 时即使离开触发词也要再上报一拍让宿主收起菜单。 */
  const trackActiveRef = useRef(true);
  /** 最近一次同步给宿主的草稿（外部回写的比对基准：相等即「自己的回声/过期投影」）。 */
  const lastPublishedRef = useRef('');
  /**
   * 挂载时本地文档已领先并立即补写给宿主：宿主 prop 在回声到达前可能仍是补写前
   * 的旧值。对账必须忽略这一次「过期回声」，否则会把刚恢复的本地文档顶回旧值。
   */
  const supersededHostDraftRef = useRef<string | null>(null);
  /** 外部回写 effect 用的同步口（挂载 effect 内填充；避免两处闭包重复实现）。 */
  const flushRef = useRef<() => void>(() => {});
  /** 释放连按高度锁的回调（autoGrow 切换为 false 时也主动释放）。 */
  const releaseHeightLockRef = useRef<() => void>(() => {});
  /** 空闲同步定时器。 */
  const idleTimerRef = useRef(0);
  const caretOffsetRef = useRef(0);
  const lastPosRef = useRef<{ line: number; col: number }>({ line: -1, col: -1 });

  // 每次渲染读取最新协作对象进闭包（避免重建编辑器）。
  const liveRef = useRef(props);
  liveRef.current = props;

  const hostDraft = state?.draft ?? '';
  /** 撤销历史/选区暂存键：会话变了就换一份编辑器（各自的历史互不串台）。 */
  const key = stateKey ?? 'default';
  /** busy 阶段软锁（adjudicating / submitting 只读）与 owner disabled。 */
  const locked =
    disabled === true || (state !== undefined && (state.phase === 'adjudicating' || state.phase === 'submitting'));

  // ---- 创建编辑器（按会话键） ----
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const prefs = loadPrefs();
    const { shadow, mount, posEl } = ensureEditorShadow(host);

    /**
     * 挂载时的输入机面：切会话（stateKey 变化）时本实例先跑旧 cleanup、
     * 后跑新 effect，而 render 阶段已把 liveRef 换成新会话 props——收尾的
     * flush 必须写回**旧会话**的输入机，否则会把上一会话未同步的草稿灌进
     * 新会话。
     */
    const mountActions = props.actions;

    /** 惰性序列化当前文档（同一不可变 Text 引用命中 O(1) 缓存）。 */
    const readLatestText = (): string => {
      const doc = latestDocRef.current;
      if (doc !== null && cachedTextDocRef.current !== doc) {
        latestTextRef.current = doc.toString();
        cachedTextDocRef.current = doc;
      }
      return latestTextRef.current;
    };

    const writePos = (doc: Text, caret: number): void => {
      const clamped = Math.max(0, Math.min(doc.length, caret));
      const line = doc.lineAt(clamped);
      const col = clamped - line.from + 1;
      if (lastPosRef.current.line === line.number && lastPosRef.current.col === col) return;
      lastPosRef.current.line = line.number;
      lastPosRef.current.col = col;
      posEl.textContent = `${line.number}, ${col}`;
    };

    /** 把本地草稿同步给官方输入机（整篇替换——只在该同步时同步）。 */
    const publish = (text: string, target = liveRef.current.actions): void => {
      if (!target) return;
      if (text === lastPublishedRef.current) {
        localDirtyRef.current = false;
        return;
      }
      try {
        target.setDraft(text); // 单写入口：持久化与跨形态同步全部由官方承担
      } catch (error) {
        diagDebug('setDraft failed', error);
        return;
      }
      lastPublishedRef.current = text;
      if (cachedTextDocRef.current === latestDocRef.current && text === latestTextRef.current) {
        localDirtyRef.current = false;
      }
    };

    const clearIdle = (): void => {
      if (idleTimerRef.current !== 0) {
        window.clearTimeout(idleTimerRef.current);
        idleTimerRef.current = 0;
      }
    };

    /** 宿主语义动作前：把最后一版本地草稿写进官方输入机。 */
    const flushDraft = (): void => {
      clearIdle();
      if (!localDirtyRef.current && latestTextRef.current === lastPublishedRef.current) return;
      const text = readLatestText();
      if (text !== lastPublishedRef.current) publish(text);
      else localDirtyRef.current = false;
    };

    /** flush + 用当前光标重报触发管线（宿主 pick/claim 的 span.draftRev 必须当拍）。 */
    const flushAndTrack = (): void => {
      flushDraft();
      const live = liveRef.current;
      const text = readLatestText();
      reportTrack(live.triggers, text, caretOffsetRef.current, live.keyboard?.snapshot ?? live.state);
      trackActiveRef.current = true;
    };

    /** 停手后同步：保证草稿持久化与其它插件读数最终一致。 */
    const scheduleIdlePublish = (): void => {
      clearIdle();
      idleTimerRef.current = window.setTimeout(() => {
        idleTimerRef.current = 0;
        publish(readLatestText());
      }, IDLE_PUBLISH_MS);
    };

    // ---- 连按高度稳定器（自动增高态下规避宿主 seatObserver 每行整页样式重算） ----
    let repeatLockEl: HTMLDivElement | null = null;
    let repeatLockMaxH = 0;
    let repeatLastStepAt = 0;
    let repeatReleaseTimer = 0;

    const clearRepeatTimer = (): void => {
      if (repeatReleaseTimer !== 0) {
        window.clearTimeout(repeatReleaseTimer);
        repeatReleaseTimer = 0;
      }
    };

    const releaseHeightLock = (): void => {
      clearRepeatTimer();
      const el = repeatLockEl;
      if (!el) return;
      repeatLockEl = null;
      el.style.height = '';
      const activeView = viewRef.current;
      if (activeView) {
        activeView.dispatch({ effects: EditorView.scrollIntoView(activeView.state.selection.main.head) });
      }
    };
    releaseHeightLockRef.current = releaseHeightLock;

    const engageHeightLock = (view: EditorView, growing: boolean): void => {
      if (liveRef.current.autoGrow !== true) return;
      const bodyEl = liveRef.current.bodyRef?.current ?? null;
      if (!bodyEl) return;
      const now = performance.now();
      if (repeatLockEl !== bodyEl) {
        const curH = bodyEl.getBoundingClientRect().height;
        const maxRaw = parseFloat(getComputedStyle(bodyEl).maxHeight);
        repeatLockMaxH = Number.isFinite(maxRaw) && maxRaw > 0 ? maxRaw : window.innerHeight * 0.46;
        // 精确写回当前浮点高度：对宿主 ResizeObserver 造成 0px 变化，不触发任何重算。
        bodyEl.style.height = `${curH}px`;
        repeatLockEl = bodyEl;
        repeatLastStepAt = now;
      } else if (growing && now - repeatLastStepAt >= REPEAT_GROW_STEP_MS) {
        const curLocked = parseFloat(bodyEl.style.height) || 0;
        if (curLocked < repeatLockMaxH - 1) {
          const desired = Math.min(repeatLockMaxH, Math.max(curLocked, view.scrollDOM.scrollHeight));
          if (desired > curLocked + 1) {
            bodyEl.style.height = `${desired}px`;
            repeatLastStepAt = now;
          }
        }
      }
      clearRepeatTimer();
      repeatReleaseTimer = window.setTimeout(releaseHeightLock, REPEAT_RELEASE_MS);
    };

    flushRef.current = flushDraft;
    /** 页面隐藏 / 关窗 / 刷新前兜底：把最后几个字符同步给当前会话。 */
    const onPageHide = (): void => {
      flushDraft();
    };
    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'hidden') flushDraft();
    };
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibilityChange);

    const hooks = {
      onKeydown: (view: EditorView, event: KeyboardEvent): boolean => {
        const live = liveRef.current;
        const menuOpen = live.triggers?.menu.getSnapshot().open === true;
        // 1) 候选菜单打开时的键盘裁决：只有会**改草稿**的 Enter/Tab 需要先
        //    同步（pick/claim 走宿主 span + draftRev）；方向键/Esc 只动菜单。
        if (menuOpen && (event.key === 'Enter' || event.key === 'Tab')) flushAndTrack();
        if (arbitrateForMenu(live.triggers, event, composingRef.current)) {
          event.preventDefault();
          return true;
        }
        // 2) 输入法 composition 状态守卫：中文选词回车绝不触发发送。
        if (composingRef.current) return false;
        // 3) 空格裁决：真 = 输入机已应用 claim。只有命令草稿才可能 claim（O(1) 判定）。
        if (event.key === ' ' && !event.ctrlKey && !event.metaKey && !event.altKey) {
          if (isDocCommand(view.state.doc)) {
            flushAndTrack();
            if (adjudicateSpace(live.triggers)) {
              event.preventDefault();
              return true;
            }
          }
        }
        // 4) 发送/换行手势（彻底自定义：偏好里存任意组合串，逐键精确匹配；
        //    换行组合若非普通 Enter 需显式替换选区插入换行，普通 Enter 走默认插入）。
        const prefsNow = loadPrefs();
        if (matchEvent(prefsNow.sendHotkey, event)) {
          releaseHeightLock();
          flushDraft(); // 发送读宿主当拍 draft/revision：先补最后一版
          event.preventDefault();
          live.onSendGesture();
          return true;
        }
        const customLineBreak = matchEvent(prefsNow.lineBreakHotkey, event) && prefsNow.lineBreakHotkey !== 'enter';
        if (event.repeat) {
          if (customLineBreak || event.key === 'Enter') engageHeightLock(view, true);
          else if (event.key === 'Backspace' || event.key === 'Delete') engageHeightLock(view, false);
        }
        if (customLineBreak) {
          event.preventDefault();
          const sel = view.state.selection.main;
          // 显式替换当前选区并把光标移到新行首，与原生 Enter 行为一致。
          view.dispatch({
            changes: { from: sel.from, to: sel.to, insert: '\n' },
            selection: { anchor: sel.from + 1 },
            scrollIntoView: true,
          });
          return true;
        }
        return false;
      },
      onKeyup: (_view: EditorView, event: KeyboardEvent): void => {
        if (
          repeatLockEl !== null &&
          (event.key === 'Enter' || event.key === 'Backspace' || event.key === 'Delete')
        ) {
          releaseHeightLock();
        }
      },
      onLocalChange: (doc: Text): void => {
        latestDocRef.current = doc;
        localDirtyRef.current = true;
        // 实时镜像：O(1) 存不可变 Text 树，重叠挂载读时再按需序列化。
        rememberEditorDoc(key, doc);
        scheduleIdlePublish();
      },
      onCaret: (doc: Text, docChanged: boolean, caret: number): void => {
        const live = liveRef.current;
        latestDocRef.current = doc;
        caretOffsetRef.current = caret;
        live.onCaretMoved?.(caret);
        // 行列指示、触发管线与草稿元状态合并到下一帧：每帧最多跑一次，零 React 重渲染。
        const prev = pendingTrackRef.current;
        pendingTrackRef.current = { doc, docChanged: docChanged || (prev?.docChanged ?? false), caret };
        if (trackRafRef.current === 0) {
          trackRafRef.current = requestAnimationFrame(() => {
            trackRafRef.current = 0;
            const pending = pendingTrackRef.current;
            pendingTrackRef.current = null;
            if (pending === null) return;
            writePos(pending.doc, pending.caret);
            const cur = liveRef.current;
            if (pending.docChanged) {
              const { empty, plain } = classifyDoc(pending.doc);
              cur.onDraftMeta?.({ empty, plain, dirty: true });
            }
            const menuOpen = cur.triggers?.menu.getSnapshot().open === true;
            const sliceFrom = Math.max(0, pending.caret - 256);
            const slice = pending.doc.sliceString(sliceFrom, pending.caret);
            const inTrigger = tokenStartsWithTrigger(slice);
            if (menuOpen || inTrigger || trackActiveRef.current) {
              const fullText = readLatestText();
              if (
                cur.triggers &&
                (localDirtyRef.current || fullText !== lastPublishedRef.current) &&
                justStartedTrigger(slice, slice.length)
              ) {
                publish(fullText);
              }
              // 官方同源：track 带机器当拍修订号（keyboard 面实时读）。
              reportTrack(cur.triggers, fullText, pending.caret, cur.keyboard?.snapshot ?? cur.state);
              trackActiveRef.current = inTrigger || cur.triggers?.menu.getSnapshot().open === true;
            }
          });
        }
      },
      onCompositionChange: (composing: boolean): void => {
        composingRef.current = composing;
      },
      onFocusChange: (focused: boolean): void => {
        // 失焦即把草稿交给官方并释放高度锁（切换窗口/其它控件时持久化不滞后）。
        if (!focused) {
          releaseHeightLock();
          flushDraft();
        }
        liveRef.current.onFocusedChange?.(focused);
      },
    };
    // 绑定本实例的逻辑回调（模块级单槽，恢复旧 state 时也走当前实例）。
    setActiveEditorHooks(hooks);
    // ---- 挂载对账：快照 / 实时文档 / 宿主草稿 ----
    const concurrent = enterEditor(key);
    const hostAtMount = props.state?.draft ?? '';
    const restored = takeEditorSnapshot(key);
    const liveDoc = readEditorDoc(key);
    const snapshotDoc = restored === undefined ? undefined : restored.state.doc.toString();
    const localDoc = concurrent
      ? (liveDoc ?? snapshotDoc ?? hostAtMount)
      : (snapshotDoc ?? liveDoc ?? hostAtMount);
    const detached = takeDetachedHost(key);
    const staleEcho =
      detached !== undefined &&
      Date.now() - detached.at < 300 &&
      hostAtMount === detached.stale &&
      detached.stale !== detached.published;
    const adoptLocal = concurrent || snapshotDoc === undefined || staleEcho;
    const seedDoc = adoptLocal ? localDoc : hostAtMount;
    const reuseSnapshot = restored !== undefined && seedDoc === snapshotDoc;
    const view = new EditorView({
      state:
        reuseSnapshot && restored !== undefined
          ? restored.state
          : createEditorState(
              createEditorExtensions({
                lineNumbers: prefs.lineNumbers,
                fontFamily: prefs.fontFamily,
                placeholder,
                editable: !locked,
              }),
              seedDoc,
            ),
      parent: mount,
      root: shadow,
    });
    if (reuseSnapshot && restored !== undefined) {
      view.scrollDOM.scrollTop = restored.scrollTop;
      // 复用快照时同步当前会话的锁定态（离开时可能是另一状态）。
      setEditorEditable(view, !locked);
    }
    const onScroll = (): void => {
      liveRef.current.onEditorScroll?.();
    };
    view.scrollDOM.addEventListener('scroll', onScroll, { passive: true });
    viewRef.current = view;
    // 本地镜像初始化：编辑器文档为准；宿主草稿只作为「已同步」基准。
    latestDocRef.current = view.state.doc;
    latestTextRef.current = view.state.doc.toString();
    cachedTextDocRef.current = view.state.doc;
    localDirtyRef.current = latestTextRef.current !== hostAtMount;
    trackActiveRef.current = true;
    lastPublishedRef.current = hostAtMount;
    rememberEditorDoc(key, view.state.doc);
    // 本地领先：立即补写宿主，并记住被顶掉的旧值——回声到达前的那次对账要忽略它。
    if (latestTextRef.current !== hostAtMount) {
      supersededHostDraftRef.current = hostAtMount;
      publish(latestTextRef.current);
      // 宿主此刻可能还没就绪（publish 空转）：停手后补一次，保证最终一致。
      scheduleIdlePublish();
    } else {
      supersededHostDraftRef.current = null;
    }
    // 控制面身份：重叠挂载时旧实例的卸载不得把新实例的控制面清空（见 cleanup）。
    const ctl: EditorControl = { flush: flushDraft, flushAndTrack, getDraft: readLatestText };
    if (props.editorCtlRef) props.editorCtlRef.current = ctl;
    props.onDraftText?.(latestTextRef.current);
    const { empty: initEmpty, plain: initPlain } = classifyDoc(view.state.doc);
    props.onDraftMeta?.({ empty: initEmpty, plain: initPlain, dirty: false });
    // 行列指示按恢复后的选区初始化（否则要先动一下才显示真实位置）。
    const head = view.state.selection.main.head;
    caretOffsetRef.current = head;
    lastPosRef.current = { line: -1, col: -1 };
    writePos(view.state.doc, head);
    if (autoFocus) view.focus();
    return () => {
      releaseHeightLock();
      releaseHeightLockRef.current = () => {};
      view.scrollDOM.removeEventListener('scroll', onScroll);
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      flushRef.current = () => {};
      clearIdle();
      // ---- 收尾不变量：只有「仍是该会话最新文档」的实例才允许回写 ----
      const finalText = readLatestText();
      const liveDocNow = readEditorDoc(key);
      if (liveDocNow === undefined || liveDocNow === finalText) {
        rememberEditorDoc(key, view.state.doc);
        // 把本会话最后一版本地草稿写回**本会话**（mountActions），不是新会话。
        const staleHost = lastPublishedRef.current;
        if (mountActions && finalText !== lastPublishedRef.current) {
          publish(finalText, mountActions);
        }
        // 记录「宿主应持有 / 写前投影」：同树重挂载的 props 滞后回声据此识别。
        rememberDetachedHost(key, finalText, staleHost);
        // 暂存编辑器状态（撤销栈 + 选区 + 文档 + 滚动），下次挂载原样装回。
        putEditorSnapshot(key, { state: view.state, scrollTop: view.scrollDOM.scrollTop });
      }
      if (trackRafRef.current !== 0) {
        cancelAnimationFrame(trackRafRef.current);
        trackRafRef.current = 0;
      }
      pendingTrackRef.current = null;
      // 重叠挂载时新实例可能已经接管了这两个共享句柄：按身份判断，别清别人的。
      if (props.editorCtlRef && props.editorCtlRef.current === ctl) props.editorCtlRef.current = null;
      if (viewRef.current === view) viewRef.current = null;
      leaveEditor(key);
      view.destroy();
      clearActiveEditorHooks(hooks);
    };
    // key 变化（切会话）= 换一份编辑器，各自历史互不串台。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // 脱离自动增高态（如切到手动拖高/侧栏/悬浮）时立刻释放任何进行中的高度锁。
  useEffect(() => {
    if (autoGrow !== true) releaseHeightLockRef.current();
  }, [autoGrow]);

  // ---- 官方草稿 → 编辑器回写（外部变化：pick / claim / 提交清空 / 会话切换） ----
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (hostDraft === lastPublishedRef.current) {
      supersededHostDraftRef.current = null;
      return;
    }
    if (hostDraft === supersededHostDraftRef.current) {
      supersededHostDraftRef.current = null;
      if (localDirtyRef.current || latestTextRef.current !== lastPublishedRef.current) flushRef.current();
      return;
    }
    supersededHostDraftRef.current = null;
    if (localDirtyRef.current || latestTextRef.current !== lastPublishedRef.current) {
      flushRef.current();
      return;
    }
    const current = view.state.doc.toString();
    if (hostDraft === current) {
      lastPublishedRef.current = hostDraft;
      localDirtyRef.current = false;
      return;
    }
    lastPublishedRef.current = hostDraft;
    latestTextRef.current = hostDraft;
    localDirtyRef.current = false;
    trackActiveRef.current = true;
    // 用公共前缀/后缀求插入段末尾，确保光标落在被改写片段之后（避免 pick 后候选菜单复现）。
    let prefix = 0;
    const maxPrefix = Math.min(current.length, hostDraft.length);
    while (prefix < maxPrefix && current.charCodeAt(prefix) === hostDraft.charCodeAt(prefix)) prefix += 1;
    let suffix = 0;
    const maxSuffix = Math.min(current.length - prefix, hostDraft.length - prefix);
    while (
      suffix < maxSuffix &&
      current.charCodeAt(current.length - 1 - suffix) === hostDraft.charCodeAt(hostDraft.length - 1 - suffix)
    ) {
      suffix += 1;
    }
    const caretAt = Math.max(0, Math.min(hostDraft.length, hostDraft.length - suffix));
    view.dispatch({
      annotations: [externalAnnotation.of(true), Transaction.addToHistory.of(false)],
      changes: { from: 0, to: current.length, insert: hostDraft },
      selection: { anchor: caretAt },
      scrollIntoView: true,
    });
    latestDocRef.current = view.state.doc;
    cachedTextDocRef.current = view.state.doc;
    rememberEditorDoc(key, view.state.doc);
    liveRef.current.onDraftText?.(hostDraft);
    const { empty, plain } = classifyDoc(view.state.doc);
    liveRef.current.onDraftMeta?.({ empty, plain, dirty: true });
  }, [hostDraft, key]);

  // ---- 偏好（行号/字体）与占位文案热更新 ----
  // 依赖必须包含 key：切会话会销毁旧 view 并新建 view，漏掉 key 会让订阅钉在已销毁的旧 view 上；
  // 且只改外观 compartment，不触碰 editableCompartment（避免偏好变动时解锁只读编辑器）。
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const dispose = subscribeEditorPrefs(view, placeholder);
    applyEditorOptions(view, currentOptions(placeholder));
    return dispose;
  }, [key, placeholder, viewRef]);

  // ---- busy 阶段软锁与 owner disabled（依赖含 key，切到锁定会话时同步锁定新 view） ----
  useEffect(() => {
    const view = viewRef.current;
    if (view) setEditorEditable(view, !locked);
  }, [key, locked, viewRef]);

  return (
    <div className="dci-editor-wrap" data-solo={solo || undefined}>
      <div className="dci-cm-host" ref={hostRef} />
    </div>
  );
}

function currentOptions(placeholder: string): { lineNumbers: boolean; fontFamily: string; placeholder: string } {
  const prefs = loadPrefs();
  return { lineNumbers: prefs.lineNumbers, fontFamily: prefs.fontFamily, placeholder };
}
