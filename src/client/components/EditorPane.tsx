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
 * **整篇替换**——宿主会 clear + 逐行重建 Lexical 文档、重算投影、序列化快照，
 * 单次成本 O(草稿长度)。若每键上报一次，长草稿下连按 Enter/Backspace 就是
 * 每键 O(n)，主线程被占满（实测 600 行草稿单次 setDraft ≈ 52 ms）。
 * 因此本组件只在宿主真正需要草稿时同步：
 * 1. 空闲去抖（停手 500ms）——保证草稿持久化与其它插件读数最终一致；
 * 2. 宿主即将读写草稿的语义动作前**同步 flush**（发送、空格/claim、菜单
 *    键盘 pick、遮罩层指针按下、指令按钮）；
 * 3. 触发词（`/` `@`）开始时同步 flush，使宿主侧 hit 的 draftRev 与草稿
 *    一致；
 * 4. 页面隐藏 / `pagehide` / 失焦 / 卸载前 flush——刷新或关窗丢不了最后几个
 *    字符。
 * 纯输入期间不发任何宿主往返：编辑器与界面都只消费本地文本。
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { EditorView } from '@codemirror/view';
import { Transaction } from '@codemirror/state';
import type { ComposerKeyboard, InputState, InputActions, InputTriggerController } from '../host-types';
import {
  createEditorExtensions,
  createEditorState,
  applyEditorOptions,
  subscribeEditorPrefs,
  setEditorEditable,
  setActiveEditorHooks,
  clearActiveEditorHooks,
  takeEditorSnapshot,
  putEditorSnapshot,
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
  /** 本地草稿文本上报（界面即时状态：空/是否命令草稿/预览内容）。 */
  onDraftText?(text: string): void;
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

/**
 * 刚刚开始一个触发词（当前 token 恰好是刚敲下的单个 `/` 或 `@`）。
 * 只有这一刻需要先同步草稿：宿主按此 track 打开候选菜单，菜单 hit 的
 * span/draftRev 要与宿主文档对齐，之后 pick/claim 的 CAS 才命中。
 * 查询串继续输入不再同步（否则长草稿里每键 O(n)），pick 前有 flushAndTrack。
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

/** 当前是否命令草稿（行首非空白后的第一个字符是 `/`）：空格 claim 只在这种草稿里发生。 */
function isCommandDraft(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charAt(i);
    if (ch === ' ' || ch === '\n' || ch === '\t') continue;
    return ch === '/';
  }
  return false;
}

export function EditorPane(props: EditorPaneProps): JSX.Element {
  const { state, actions, triggers, keyboard, onSendGesture, placeholder, autoFocus, viewRef, onCaretMoved, disabled, solo, stateKey } = props;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const composingRef = useRef(false);
  /** 触发管线上报合并到下一帧：连按 Enter/Backspace 时每帧只跑一次 track。 */
  const trackRafRef = useRef(0);
  const pendingTrackRef = useRef<{ text: string; caret: number } | null>(null);
  /** 本地最新草稿（编辑器是事实源；宿主草稿按需同步）。 */
  const latestTextRef = useRef('');
  /** 最近一次同步给宿主的草稿（外部回写的比对基准：相等即「自己的回声/过期投影」）。 */
  const lastPublishedRef = useRef('');
  /** 外部回写 effect 用的同步口（挂载 effect 内填充；避免两处闭包重复实现）。 */
  const flushRef = useRef<() => void>(() => {});
  /** 空闲同步定时器。 */
  const idleTimerRef = useRef(0);
  const caretOffsetRef = useRef(0);
  const [pos, setPos] = useState<{ line: number; col: number }>({ line: 1, col: 1 });

  // 每次渲染读取最新协作对象进闭包（避免重建编辑器）。
  const liveRef = useRef(props);
  liveRef.current = props;

  const hostDraft = state?.draft ?? '';
  /** 撤销历史/选区暂存键：会话变了就换一份编辑器（各自的历史互不串台）。 */
  const key = stateKey ?? 'default';

  // ---- 创建编辑器（一次） ----
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const prefs = loadPrefs();

    /**
     * 挂载时的输入机面：切会话（stateKey 变化）时本实例先跑旧 cleanup、
     * 后跑新 effect，而 render 阶段已把 liveRef 换成新会话 props——收尾的
     * flush 必须写回**旧会话**的输入机，否则会把上一会话未同步的草稿灌进
     * 新会话（on-demand 上报后这是真实风险，旧版本每键上报掩盖了它）。
     */
    const mountActions = props.actions;

    /** 把本地草稿同步给官方输入机（整篇替换——只在该同步时同步）。 */
    const publish = (text: string, target = liveRef.current.actions): void => {
      if (!target) return;
      if (text === lastPublishedRef.current) return;
      try {
        target.setDraft(text); // 单写入口：持久化与跨形态同步全部由官方承担
      } catch (error) {
        diagDebug('setDraft failed', error);
        return;
      }
      lastPublishedRef.current = text;
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
      const text = latestTextRef.current;
      if (text !== lastPublishedRef.current) publish(text);
    };

    /** flush + 用当前光标重报触发管线（宿主 pick/claim 的 span.draftRev 必须当拍）。 */
    const flushAndTrack = (): void => {
      flushDraft();
      const live = liveRef.current;
      reportTrack(live.triggers, latestTextRef.current, caretOffsetRef.current, live.keyboard?.snapshot ?? live.state);
    };

    /** 停手后同步：保证草稿持久化与其它插件读数最终一致。 */
    const scheduleIdlePublish = (): void => {
      clearIdle();
      idleTimerRef.current = window.setTimeout(() => {
        idleTimerRef.current = 0;
        publish(latestTextRef.current);
      }, IDLE_PUBLISH_MS);
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
        //    同步（pick/claim 走宿主 span + draftRev）；方向键/Esc 只动菜单，
        //    不产生 O(n) 的整篇写回。
        if (menuOpen && (event.key === 'Enter' || event.key === 'Tab')) flushAndTrack();
        if (arbitrateForMenu(live.triggers, event, composingRef.current)) {
          event.preventDefault();
          return true;
        }
        // 2) 输入法 composition 状态守卫：中文选词回车绝不触发发送。
        if (composingRef.current) return false;
        // 3) 空格裁决：真 = 输入机已应用 claim。只有命令草稿才可能 claim
        //    （宿主 claim 需要读写草稿，先同步；普通文本空格零宿主往返）。
        if (event.key === ' ' && !event.ctrlKey && !event.metaKey && !event.altKey) {
          if (isCommandDraft(latestTextRef.current)) {
            flushAndTrack();
            if (adjudicateSpace(live.triggers)) {
              event.preventDefault();
              return true;
            }
          }
        }
        // 4) 发送/换行手势（彻底自定义：偏好里存任意组合串，逐键精确匹配；
        //    换行组合若非普通 Enter 需显式插入，普通 Enter 走默认插入）。
        const prefsNow = loadPrefs();
        if (matchEvent(prefsNow.sendHotkey, event)) {
          flushDraft(); // 发送读宿主当拍 draft/revision：先补最后一版
          event.preventDefault();
          live.onSendGesture();
          return true;
        }
        if (matchEvent(prefsNow.lineBreakHotkey, event) && prefsNow.lineBreakHotkey !== 'enter') {
          event.preventDefault();
          const head = view.state.selection.main.head;
          // 显式插入换行后必须把光标放到插入点之后，否则 CodeMirror 会把光标留在插入点之前，后续输入落回上一行（B1 行为层：Shift+Enter「看起来没换行」）；普通 Enter 走 CM 默认 keymap，无此问题。
          view.dispatch({ changes: { from: head, insert: '\n' }, selection: { anchor: head + 1 }, scrollIntoView: true });
          return true;
        }
        return false;
      },
      onLocalChange: (text: string): void => {
        // 纯输入期间不写宿主：只更新本地镜像 + 空闲同步。宿主草稿写入是
        // O(n) 的整篇替换（600 行 ≈ 52 ms），连按 Enter/Backspace 时每键
        // 一次会把主线程占满——这正是「长按换行卡顿」的根因。
        latestTextRef.current = text;
        scheduleIdlePublish();
      },
      onCaret: (text: string, caret: number): void => {
        const live = liveRef.current;
        const view = viewRef.current;
        latestTextRef.current = text;
        caretOffsetRef.current = caret;
        const line = view?.state.doc.lineAt(caret);
        const next = { line: line ? line.number : 1, col: caret - (line ? line.from : 0) + 1 };
        // 行列指示只在值变化时 setState（连按时避免无意义的重渲染）。
        setPos((prev) => (prev.line === next.line && prev.col === next.col ? prev : next));
        live.onCaretMoved?.(caret);
        // 触发管线上报合并到下一帧：`triggers.track` 只做扫描/比对，成本很低
        // （实测 <0.3ms），但每帧仍只跑一次。触发词开始时同拍同步草稿——菜单
        // hit 的 span/draftRev 与宿主文档一致，后续 pick/claim 才落得对。
        pendingTrackRef.current = { text, caret };
        if (trackRafRef.current === 0) {
          trackRafRef.current = requestAnimationFrame(() => {
            trackRafRef.current = 0;
            const pending = pendingTrackRef.current;
            pendingTrackRef.current = null;
            if (pending === null) return;
            const cur = liveRef.current;
            if (cur.triggers && pending.text !== lastPublishedRef.current && justStartedTrigger(pending.text, pending.caret)) {
              publish(pending.text);
            }
            // 官方同源：track 带机器当拍修订号（keyboard 面实时读，React props
            // 滞后一拍——带旧 rev 会让 pick/claim 的 draftRev CAS 必然失败）。
            reportTrack(cur.triggers, pending.text, pending.caret, cur.keyboard?.snapshot ?? cur.state);
            cur.onDraftText?.(pending.text);
          });
        }
      },
      onCompositionChange: (composing: boolean): void => {
        composingRef.current = composing;
      },
      onFocusChange: (focused: boolean): void => {
        // 失焦即把草稿交给官方（停手同步的即时版：切换窗口/其它控件时持久化不滞后）。
        if (!focused) flushDraft();
        liveRef.current.onFocusedChange?.(focused);
      },
    };
    // 绑定本实例的逻辑回调（模块级单槽，恢复旧 state 时也走当前实例）。
    setActiveEditorHooks(hooks);
    // 按会话取回上次离开时的编辑器（含撤销历史）；没有则新建。
    const restored = takeEditorSnapshot(key);
    const view = new EditorView({
      state: restored?.state ?? createEditorState(createEditorExtensions({
        lineNumbers: prefs.lineNumbers,
        fontFamily: prefs.fontFamily,
        placeholder,
        editable: true,
      }), ''),
      parent: host,
    });
    if (restored) view.scrollDOM.scrollTop = restored.scrollTop;
    viewRef.current = view;
    // 本地镜像初始化：编辑器文档为准；宿主草稿只作为「已同步」基准。
    latestTextRef.current = view.state.doc.toString();
    lastPublishedRef.current = props.state?.draft ?? '';
    if (props.editorCtlRef) props.editorCtlRef.current = { flush: flushDraft, flushAndTrack };
    props.onDraftText?.(latestTextRef.current);
    // 行列指示按恢复后的选区初始化（否则要先动一下才显示真实位置）。
    const head = view.state.selection.main.head;
    caretOffsetRef.current = head;
    const line = view.state.doc.lineAt(head);
    setPos({ line: line.number, col: head - line.from + 1 });
    if (autoFocus) view.focus();
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      flushRef.current = () => {};
      // 收尾：把本会话最后一版本地草稿写回**本会话**（mountActions），不是新会话。
      clearIdle();
      if (mountActions && latestTextRef.current !== lastPublishedRef.current) {
        publish(latestTextRef.current, mountActions);
      }
      if (trackRafRef.current !== 0) {
        cancelAnimationFrame(trackRafRef.current);
        trackRafRef.current = 0;
      }
      pendingTrackRef.current = null;
      if (props.editorCtlRef) props.editorCtlRef.current = null;
      viewRef.current = null;
      // 暂存编辑器状态（撤销栈 + 选区 + 文档 + 滚动），下次挂载原样装回。
      putEditorSnapshot(key, { state: view.state, scrollTop: view.scrollDOM.scrollTop });
      view.destroy();
      clearActiveEditorHooks(hooks);
    };
    // key 变化（切会话）= 换一份编辑器，各自历史互不串台。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // ---- 官方草稿 → 编辑器回写（外部变化：pick / claim / 提交清空 / 会话切换） ----
  // 只有**不是本地刚同步出去的那一版**才算外部变化：空闲同步/语义 flush 之后
  // 宿主会把同一份文本发布回来，那不是用户要的「外部改写」，忽略以免回灌。
  // addToHistory:false —— 官方侧灌入不进撤销栈：否则「宿主刚清空草稿」这件事
  // 自己成了一条可撤销记录，用户按 Ctrl+Z 会把已发送的内容又拉回编辑器。
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (hostDraft === lastPublishedRef.current) return;
    // 本地还有未同步文本（用户正在输入）：外部整篇写入不覆盖用户输入，先把本地
    // 草稿交给宿主（宿主会以本插件文本回流；其它插件的整篇 setDraft 让位）。
    // pick/claim/提交清空等宿主动作前都会先 flushAndTrack，到这里时不会 dirty。
    if (latestTextRef.current !== lastPublishedRef.current) {
      flushRef.current();
      return;
    }
    const current = view.state.doc.toString();
    if (hostDraft === current) {
      lastPublishedRef.current = hostDraft;
      return;
    }
    lastPublishedRef.current = hostDraft;
    latestTextRef.current = hostDraft;
    // 光标落在「被改写的片段之后」：官方 setDraft/claim 的语义是文档末尾；
    // 保留旧下标会在「光标后面的单词被替换」时落进 token 中间，触发管线
    // 会立刻把候选菜单又打开（pick 之后菜单复现）。用公共前缀/后缀求插入
    // 段末尾，两种来源（整篇替换 / 片段替换）都给出合理位置。
    let prefix = 0;
    const maxPrefix = Math.min(current.length, hostDraft.length);
    while (prefix < maxPrefix && current.charCodeAt(prefix) === hostDraft.charCodeAt(prefix)) prefix += 1;
    let suffix = 0;
    const maxSuffix = Math.min(current.length - prefix, hostDraft.length - prefix);
    while (
      suffix < maxSuffix
      && current.charCodeAt(current.length - 1 - suffix) === hostDraft.charCodeAt(hostDraft.length - 1 - suffix)
    ) suffix += 1;
    const caretAt = Math.max(0, Math.min(hostDraft.length, hostDraft.length - suffix));
    view.dispatch({
      annotations: [externalAnnotation.of(true), Transaction.addToHistory.of(false)],
      changes: { from: 0, to: current.length, insert: hostDraft },
      selection: { anchor: caretAt },
      scrollIntoView: true,
    });
    liveRef.current.onDraftText?.(hostDraft);
  }, [hostDraft]);

  // ---- 偏好（行号/字体）与占位文案热更新 ----
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const dispose = subscribeEditorPrefs(view, placeholder, true);
    applyEditorOptions(view, { ...currentOptions(placeholder), editable: true });
    return dispose;
  }, [placeholder]);

  // ---- busy 阶段软锁（adjudicating / submitting 只读）与 owner disabled ----
  const locked =
    disabled === true || state !== undefined && (state.phase === 'adjudicating' || state.phase === 'submitting');
  useEffect(() => {
    const view = viewRef.current;
    if (view) setEditorEditable(view, !locked);
  }, [locked, viewRef]);

  return (
    <div className="dci-editor-wrap" data-solo={solo || undefined}>
      <div className="dci-cm-host" ref={hostRef} />
      <div className="dci-pos">
        {pos.line}, {pos.col}
      </div>
    </div>
  );
}

function currentOptions(placeholder: string): { lineNumbers: boolean; fontFamily: string; placeholder: string } {
  const prefs = loadPrefs();
  return { lineNumbers: prefs.lineNumbers, fontFamily: prefs.fontFamily, placeholder };
}
