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

export function EditorPane(props: EditorPaneProps): JSX.Element {
  const { state, actions, triggers, keyboard, onSendGesture, placeholder, autoFocus, viewRef, onCaretMoved, disabled, solo, stateKey } = props;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const composingRef = useRef(false);
  const [pos, setPos] = useState<{ line: number; col: number }>({ line: 1, col: 1 });

  // 每次渲染读取最新协作对象进闭包（避免重建编辑器）。
  const liveRef = useRef(props);
  liveRef.current = props;

  const draft = state?.draft ?? '';
  /** 撤销历史/选区暂存键：会话变了就换一份编辑器（各自的历史互不串台）。 */
  const key = stateKey ?? 'default';

  // ---- 创建编辑器（一次） ----
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const prefs = loadPrefs();
    const hooks = {
      onKeydown: (view: EditorView, event: KeyboardEvent): boolean => {
        const live = liveRef.current;
        // 1) 候选菜单打开时键盘 ↑↓/Enter/Tab/Esc 经 arbitrate 裁决。
        if (arbitrateForMenu(live.triggers, event, composingRef.current)) {
          event.preventDefault();
          return true;
        }
        // 2) 输入法 composition 状态守卫：中文选词回车绝不触发发送。
        if (composingRef.current) return false;
        // 3) 空格裁决：真 = 输入机已应用 claim。
        if (event.key === ' ' && !event.ctrlKey && !event.metaKey && !event.altKey) {
          if (adjudicateSpace(live.triggers)) {
            event.preventDefault();
            return true;
          }
        }
        // 4) 发送/换行手势（彻底自定义：偏好里存任意组合串，逐键精确匹配；
        //    换行组合若非普通 Enter 需显式插入，普通 Enter 走默认插入）。
        const prefsNow = loadPrefs();
        if (matchEvent(prefsNow.sendHotkey, event)) {
          event.preventDefault();
          live.onSendGesture();
          return true;
        }
        if (matchEvent(prefsNow.lineBreakHotkey, event) && prefsNow.lineBreakHotkey !== 'enter') {
          event.preventDefault();
          view.dispatch({ changes: { from: view.state.selection.main.head, insert: '\n' } });
          return true;
        }
        return false;
      },
      onLocalChange: (text: string): void => {
        const live = liveRef.current;
        if (!live.actions) return;
        try {
          live.actions.setDraft(text); // 单写入口：持久化与跨形态同步全部由官方承担
        } catch (error) {
          diagDebug('setDraft failed', error);
        }
      },
      onCaret: (text: string, caret: number): void => {
        const live = liveRef.current;
        // 官方同源：track 带机器当拍修订号（keyboard 面实时读，React props
        // 滞后一拍——带旧 rev 会让 pick/claim 的 draftRev CAS 必然失败）。
        reportTrack(live.triggers, text, caret, live.keyboard?.snapshot ?? live.state);
        const view = viewRef.current;
        const line = view?.state.doc.lineAt(caret);
        setPos({ line: line ? line.number : 1, col: caret - (line ? line.from : 0) + 1 });
        live.onCaretMoved?.(caret);
      },
      onCompositionChange: (composing: boolean): void => {
        composingRef.current = composing;
      },
      onFocusChange: (focused: boolean): void => {
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
    // 行列指示按恢复后的选区初始化（否则要先动一下才显示真实位置）。
    const head = view.state.selection.main.head;
    const line = view.state.doc.lineAt(head);
    setPos({ line: line.number, col: head - line.from + 1 });
    if (autoFocus) view.focus();
    return () => {
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
  // addToHistory:false —— 官方侧灌入不进撤销栈：否则「宿主刚清空草稿」这件事
  // 自己成了一条可撤销记录，用户按 Ctrl+Z 会把已发送的内容又拉回编辑器。
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (draft === current) return;
    const anchor = Math.min(view.state.selection.main.head, draft.length);
    view.dispatch({
      annotations: [externalAnnotation.of(true), Transaction.addToHistory.of(false)],
      changes: { from: 0, to: current.length, insert: draft },
      selection: { anchor: draft === '' ? 0 : anchor },
      scrollIntoView: true,
    });
  }, [draft]);

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
