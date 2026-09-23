/** CodeMirror 6 集成：行号（可关）、当前行与行号高亮（常开）、软换行、撤销历史、Tab 缩进。 */

import { history, historyKeymap, defaultKeymap, indentWithTab } from '@codemirror/commands';
import {
  highlightActiveLine,
  highlightActiveLineGutter,
  lineNumbers,
  drawSelection,
  dropCursor,
  placeholder as cmPlaceholder,
  EditorView,
  keymap,
} from '@codemirror/view';
import { Annotation, Compartment, EditorState, type Extension } from '@codemirror/state';
import { loadPrefs, subscribePrefs } from './prefs';

const lineNumbersCompartment = new Compartment();
const themeCompartment = new Compartment();
const placeholderCompartment = new Compartment();
const editableCompartment = new Compartment();

export interface EditorOptions {
  lineNumbers: boolean;
  fontFamily: string;
  placeholder: string;
  editable: boolean;
}

/** 外部灌入（官方草稿回写）标注：本来源的变化不再回写 setDraft。 */
export const externalAnnotation = Annotation.define<boolean>();

export interface EditorHooks {
  /** DOM 级 keydown（先于默认键位表）：返回 true 表示已消费。 */
  onKeydown(view: EditorView, event: KeyboardEvent): boolean;
  /** 本地文档变化（用户输入所致）：唯一写入口在此回调里交给官方 setDraft。 */
  onLocalChange(text: string): void;
  /** 光标/文档变化后的上报（触发管线 track + 行列指示）。 */
  onCaret(text: string, caret: number): void;
  onCompositionChange(composing: boolean): void;
  onFocusChange(focused: boolean): void;
}

/**
 * 当前挂载编辑器的逻辑回调。扩展里**不闭包捕获** hooks，而是每次调用现取
 * 这个槽——因为跨形态切换会复用（见 takeEditorSnapshot）上一次的 EditorState，
 * 而它的扩展是那时创建的：若闭包捕获旧实例，恢复后就还在调用早已卸载的
 * 组件的 props（读旧 actions/旧 keyboard snapshot）。同一时刻只有一个编辑面
 * （三态单实例），模块级单槽足够且不会串台。
 */
let activeHooks: EditorHooks | null = null;

/** 挂载时绑定（EditorPane 的 effect 负责）。 */
export function setActiveEditorHooks(hooks: EditorHooks | null): void {
  activeHooks = hooks;
}

/**
 * 卸载时清空——但只清自己装的那一份。侧栏承载的切换不是原子的：侧栏 body
 * 常常先挂载（新实例装上 hooks），主输入面在下一拍才卸载（旧实例清空），无
 * 条件清空会把新实例的 hooks 摘掉，于是侧栏里打字不落草稿、行列指示不动、
 * 发送手势失效。按实例身份判断即可。
 */
export function clearActiveEditorHooks(hooks: EditorHooks): void {
  if (activeHooks === hooks) activeHooks = null;
}

export function createEditorExtensions(options: EditorOptions): Extension[] {
  return [
    EditorView.domEventHandlers({
      keydown: (event, view) => activeHooks?.onKeydown(view, event) ?? false,
      compositionstart: () => {
        activeHooks?.onCompositionChange(true);
        return false;
      },
      compositionend: () => {
        // compositionend 落在 DOM 变更之后；延一帧避免选词回车误入 send 分支。
        setTimeout(() => activeHooks?.onCompositionChange(false), 0);
        return false;
      },
      focus: () => {
        activeHooks?.onFocusChange(true);
        return false;
      },
      blur: () => {
        activeHooks?.onFocusChange(false);
        return false;
      },
    }),
    history(),
    drawSelection(),
    dropCursor(),
    EditorView.lineWrapping,
    highlightActiveLine(),
    highlightActiveLineGutter(),
    lineNumbersCompartment.of(options.lineNumbers ? lineNumbers() : []),
    themeCompartment.of(baseTheme(options.fontFamily)),
    placeholderCompartment.of(cmPlaceholder(options.placeholder)),
    editableCompartment.of(EditorView.editable.of(options.editable)),
    keymap.of([...historyKeymap, ...defaultKeymap, indentWithTab]),
    EditorView.updateListener.of((update) => {
      if (update.docChanged && !update.transactions.some((tr) => tr.annotation(externalAnnotation) === true)) {
        activeHooks?.onLocalChange(update.state.doc.toString());
      }
      if (update.docChanged || update.selectionSet) {
        activeHooks?.onCaret(update.state.doc.toString(), update.state.selection.main.head);
      }
    }),
  ];
}

export function applyEditorOptions(view: EditorView, options: EditorOptions): void {
  view.dispatch({
    effects: [
      lineNumbersCompartment.reconfigure(options.lineNumbers ? lineNumbers() : []),
      themeCompartment.reconfigure(baseTheme(options.fontFamily)),
      placeholderCompartment.reconfigure(cmPlaceholder(options.placeholder)),
      editableCompartment.reconfigure(EditorView.editable.of(options.editable)),
    ],
  });
}

/** busy 阶段软锁 / owner disabled：切换编辑开关。 */
export function setEditorEditable(view: EditorView, editable: boolean): void {
  view.dispatch({
    effects: editableCompartment.reconfigure(EditorView.editable.of(editable)),
  });
}

/** 偏好（行号/字体）热更新订阅：settings 与编辑器共用 localStorage 单源。 */
export function subscribeEditorPrefs(view: EditorView, placeholder: string, editable: boolean): () => void {
  return subscribePrefs(() => {
    const prefs = loadPrefs();
    applyEditorOptions(view, {
      lineNumbers: prefs.lineNumbers,
      fontFamily: prefs.fontFamily,
      placeholder,
      editable,
    });
  });
}

function baseTheme(fontFamily: string): Extension {
  return EditorView.theme({
    '&': { fontSize: '13px', height: '100%' },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': {
      fontFamily,
      lineHeight: '1.6',
      overflow: 'auto',
    },
    '.cm-content': { caretColor: 'var(--dsw-alias-state-business-primary, currentColor)', paddingBottom: '8px' },
    '.cm-line': { padding: '0 8px' },
    // CodeMirror 自绘光标（drawSelection）默认黑色，深色主题下不可见——
    // 显式对齐官方输入框的 caret 颜色（品牌强调色）。
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: 'var(--dsw-alias-state-business-primary, currentColor)',
    },
    '.cm-gutters': {
      backgroundColor: 'transparent',
      border: 'none',
      color: 'color-mix(in srgb, currentColor 32%, transparent)',
    },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'currentColor', fontWeight: 600 },
    '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, currentColor 6%, transparent)' },
    '.cm-lineNumbers .cm-gutterElement': { minWidth: '2.2em', padding: '0 6px 0 10px' },
    '.cm-selectionBackground': { backgroundColor: 'color-mix(in srgb, currentColor 15%, transparent) !important' },
    '.cm-placeholder': { color: 'color-mix(in srgb, currentColor 38%, transparent)' },
  });
}

export function createEditorState(extensions: Extension[], doc: string): EditorState {
  return EditorState.create({ doc, extensions });
}

// ---------- 编辑器状态暂存（跨形态 / 跨会话保留撤销历史） ----------
//
// 三态切换时协调表面会重挂载（inline ↔ portal ↔ 侧栏），EditorView 随之销毁。
// 若每次都新建 EditorState，用户敲了半天的内容一拖成悬浮就撤销不回去了。
// 故按会话暂存 state（撤销栈、选区、文档都在 state 里），下次挂载原样装回；
// 滚动位置单独记住（state 不含滚动）。同一时刻只有一个持有者：挂载即 take
// （移出），卸载再 put——避免两个 EditorView 共享同一 state（CM 不支持）。

export interface EditorSnapshot {
  readonly state: EditorState;
  readonly scrollTop: number;
}

const CACHE_MAX = 4;
const snapshots = new Map<string, EditorSnapshot>();

/** 取回并移出该键的快照（含撤销历史）；没有则 undefined（新建）。 */
export function takeEditorSnapshot(key: string): EditorSnapshot | undefined {
  const snapshot = snapshots.get(key);
  if (snapshot) snapshots.delete(key);
  return snapshot;
}

/** 卸载时暂存：不清空内容，只把「离开时的编辑器」留给下次挂载。 */
export function putEditorSnapshot(key: string, snapshot: EditorSnapshot): void {
  snapshots.delete(key);
  snapshots.set(key, snapshot);
  while (snapshots.size > CACHE_MAX) {
    const oldest = snapshots.keys().next().value;
    if (oldest === undefined) break;
    snapshots.delete(oldest);
  }
}
