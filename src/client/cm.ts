/** CodeMirror 6 集成：行号（可关）、当前行与行号高亮（常开）、软换行、撤销历史、Tab 缩进。 */

import { history, historyKeymap, defaultKeymap, indentWithTab } from '@codemirror/commands';
import {
  highlightActiveLine,
  highlightActiveLineGutter,
  lineNumbers,
  dropCursor,
  placeholder as cmPlaceholder,
  EditorView,
  keymap,
} from '@codemirror/view';
import { Annotation, Compartment, EditorState, type Extension, type Text } from '@codemirror/state';
import { loadPrefs, subscribePrefs } from './prefs';

/**
 * ShadowRoot 内样式：把 CodeMirror DOM 与宿主 160+ 样式表和 `:has()` 祖先链彻底隔离。
 *
 * 根因：DSH 宿主在 `.wSkVaW_scrollBody` / `[data-files-navigator-row]` / `html` 上挂有
 * 多条 `:has(...)` 规则，Light DOM 下 `.cm-content` 每次增删行都会触发整棵会话树重算样式
 * （2000 节点下每次按键 35ms+）。将编辑器与 `.dci-pos` 迁入 open ShadowRoot 后，
 * `:has()` 失效与 5900+ 宿主规则在阴影边界处截断，仅匹配 CodeMirror 自身 ~15 条规则，
 * 同时通过继承保留全部 `--dsw-*` / `--dsh-*` 主题与滚动条变量。
 */
const EDITOR_SHADOW_CSS = `
:host {
  display: flex;
  flex-direction: column;
  position: relative;
  min-height: 0;
  box-sizing: border-box;
}
.dci-cm-mount {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.dci-pos {
  position: absolute;
  right: 10px;
  bottom: 6px;
  font-size: 11px;
  color: var(--dsw-alias-label-caption, currentColor);
  opacity: 0.75;
  pointer-events: none;
  font-variant-numeric: tabular-nums;
  z-index: 3;
  contain: layout style;
}
@supports not selector(::-webkit-scrollbar) {
  .cm-scroller {
    scrollbar-width: thin;
    scrollbar-color: var(--dsh-scrollbar-thumb, color-mix(in srgb, currentColor 18%, transparent)) transparent;
  }
}
::-webkit-scrollbar {
  width: var(--dsh-scrollbar-width, 5px);
  height: var(--dsh-scrollbar-width, 5px);
}
::-webkit-scrollbar-track {
  margin-block: var(--dsh-scrollbar-track-margin, 0px);
  background: transparent;
}
::-webkit-scrollbar-thumb {
  border: var(--dsh-scrollbar-thumb-border, 0px) solid transparent;
  border-radius: 999px;
  corner-shape: round;
  background: var(--dsh-scrollbar-thumb, color-mix(in srgb, currentColor 18%, transparent));
  background-clip: content-box;
}
::-webkit-scrollbar-thumb:hover {
  background-color: var(--dsh-scrollbar-thumb-hover, color-mix(in srgb, currentColor 26%, transparent));
}
::-webkit-scrollbar-corner {
  background: transparent;
}
`;

export interface EditorShadowMount {
  readonly shadow: ShadowRoot;
  readonly mount: HTMLDivElement;
  readonly posEl: HTMLDivElement;
}

/** 为 `.dci-cm-host` 一次性挂载（或复用）open ShadowRoot 及其编辑器挂点与行列指示器。 */
export function ensureEditorShadow(host: HTMLDivElement): EditorShadowMount {
  let shadow = host.shadowRoot;
  if (!shadow) {
    shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = EDITOR_SHADOW_CSS;
    const mount = document.createElement('div');
    mount.className = 'dci-cm-mount';
    const posEl = document.createElement('div');
    posEl.className = 'dci-pos';
    posEl.textContent = '1, 1';
    shadow.append(style, mount, posEl);
    return { shadow, mount, posEl };
  }
  let mount = shadow.querySelector<HTMLDivElement>('.dci-cm-mount');
  if (!mount) {
    mount = document.createElement('div');
    mount.className = 'dci-cm-mount';
    shadow.appendChild(mount);
  }
  let posEl = shadow.querySelector<HTMLDivElement>('.dci-pos');
  if (!posEl) {
    posEl = document.createElement('div');
    posEl.className = 'dci-pos';
    posEl.textContent = '1, 1';
    shadow.appendChild(posEl);
  }
  return { shadow, mount, posEl };
}

const lineNumbersCompartment = new Compartment();
const themeCompartment = new Compartment();
const placeholderCompartment = new Compartment();
const editableCompartment = new Compartment();

export interface EditorAppearanceOptions {
  lineNumbers: boolean;
  fontFamily: string;
  placeholder: string;
}

export interface EditorOptions extends EditorAppearanceOptions {
  editable: boolean;
}

/** 外部灌入（官方草稿回写）标注：本来源的变化不再回写 setDraft。 */
export const externalAnnotation = Annotation.define<boolean>();

export interface EditorHooks {
  /** DOM 级 keydown（先于默认键位表）：返回 true 表示已消费。 */
  onKeydown(view: EditorView, event: KeyboardEvent): boolean;
  /** DOM 级 keyup：用于连按结束后释放高度锁定。 */
  onKeyup?(view: EditorView, event: KeyboardEvent): void;
  /** 本地文档变化（用户输入所致）：传 O(1) 不可变 Text 树，按需才序列化。 */
  onLocalChange(doc: Text): void;
  /** 光标/文档变化后的上报：传 O(1) Text 树与是否改文档标记，热路径零 doc.toString()。 */
  onCaret(doc: Text, docChanged: boolean, caret: number): void;
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
      keyup: (event, view) => {
        activeHooks?.onKeyup?.(view, event);
        return false;
      },
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
    // 单光标编辑器不启用 drawSelection()：CodeMirror 自绘光标每次按键都会多触发一次
    // 同步 DOM 布局与动画样式重算；原生 caretColor + ::selection 走合成器直绘，零额外 layout。
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
      // 热路径零 doc.toString()：把不可变 Text 树直接交给 EditorPane 按需读取/序列化。
      const doc = update.state.doc;
      if (update.docChanged && !update.transactions.some((tr) => tr.annotation(externalAnnotation) === true)) {
        activeHooks?.onLocalChange(doc);
      }
      if (update.docChanged || update.selectionSet) {
        activeHooks?.onCaret(doc, update.docChanged, update.state.selection.main.head);
      }
    }),
  ];
}

/** 热更新外观偏好（行号 / 字体 / 占位）：不动 editableCompartment，避免意外解锁只读态。 */
export function applyEditorOptions(view: EditorView, options: EditorAppearanceOptions): void {
  view.dispatch({
    effects: [
      lineNumbersCompartment.reconfigure(options.lineNumbers ? lineNumbers() : []),
      themeCompartment.reconfigure(baseTheme(options.fontFamily)),
      placeholderCompartment.reconfigure(cmPlaceholder(options.placeholder)),
    ],
  });
}

/** busy 阶段软锁 / owner disabled：切换编辑开关（editableCompartment 的唯一写入口）。 */
export function setEditorEditable(view: EditorView, editable: boolean): void {
  view.dispatch({
    effects: editableCompartment.reconfigure(EditorView.editable.of(editable)),
  });
}

/** 偏好（行号/字体）热更新订阅：settings 与编辑器共用 prefs 缓存单源。 */
export function subscribeEditorPrefs(view: EditorView, placeholder: string): () => void {
  let lastLineNumbers = loadPrefs().lineNumbers;
  let lastFontFamily = loadPrefs().fontFamily;
  return subscribePrefs(() => {
    const prefs = loadPrefs();
    if (prefs.lineNumbers === lastLineNumbers && prefs.fontFamily === lastFontFamily) return;
    lastLineNumbers = prefs.lineNumbers;
    lastFontFamily = prefs.fontFamily;
    applyEditorOptions(view, {
      lineNumbers: prefs.lineNumbers,
      fontFamily: prefs.fontFamily,
      placeholder,
    });
  });
}

/**
 * 永远按字面字符渲染：同时关掉 `liga` / `calt`。
 *
 * 连字会把 `->`、`//` 等替换成合并字形，视觉上像「字符消失」；更关键的是
 * DSH 桌面 0.2.2 内置的 Chromium 152 在「`calt` 连字 + 后续任意字符」时会把
 * 连字字形第一格画空（宿主 shaping bug，CSS 层面无法稳定规避）。故本插件不做
 * 连字：编辑器所见即所存，也与预览 / 消息区的纯文本渲染保持一致。
 */
const LITERAL_TEXT_STYLES = {
  fontVariantLigatures: 'none',
  fontFeatureSettings: '"liga" 0, "calt" 0',
} as const;

function baseTheme(fontFamily: string): Extension {
  return EditorView.theme({
    '&': {
      fontSize: '13px',
      height: '100%',
      minHeight: '0',
      flex: '1 1 auto',
      backgroundColor: 'transparent',
    },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': {
      fontFamily,
      lineHeight: '1.6',
      overflow: 'auto',
      contain: 'layout style paint',
      ...LITERAL_TEXT_STYLES,
    },
    '.cm-content': {
      caretColor: 'var(--dsw-alias-state-business-primary, currentColor)',
      paddingBottom: '8px',
      ...LITERAL_TEXT_STYLES,
    },
    '.cm-content::selection, .cm-content ::selection': {
      backgroundColor: 'color-mix(in srgb, currentColor 15%, transparent)',
    },
    '.cm-line': { padding: '0 8px' },
    '.cm-dropCursor': {
      borderLeftColor: 'var(--dsw-alias-state-business-primary, currentColor)',
    },
    '.cm-gutters': {
      backgroundColor: 'transparent',
      border: 'none',
      color: 'color-mix(in srgb, currentColor 32%, transparent)',
    },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'currentColor', fontWeight: 600 },
    '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, currentColor 6%, transparent)' },
    // 行号栏定宽（issue #3）：给每个行号元素固定 min-width = 3 位数字 + 左右内边距
    // （10px + 6px = 16px），≤999 行列宽恒定、正文不再随行数进位抖动。
    '.cm-lineNumbers .cm-gutterElement': {
      minWidth: 'calc(3ch + 16px)',
      padding: '0 6px 0 10px',
      fontVariantNumeric: 'tabular-nums',
    },
    '.cm-placeholder': { color: 'color-mix(in srgb, currentColor 38%, transparent)' },
  });
}

export function createEditorState(extensions: Extension[], doc: string): EditorState {
  return EditorState.create({ doc, extensions });
}

// ---------- 编辑器状态暂存（跨形态 / 跨会话保留撤销历史） ----------

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

/** 从缓存里淘汰最久未使用的键（Map 插入序 ≈ LRU）。 */
function evictOldest<V>(cache: Map<string, V>): void {
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** 卸载时暂存：不清空内容，只把「离开时的编辑器」留给下次挂载。 */
export function putEditorSnapshot(key: string, snapshot: EditorSnapshot): void {
  snapshots.delete(key);
  snapshots.set(key, snapshot);
  evictOldest(snapshots);
  // 快照即「离开时文档」的权威版本：实时镜像同步指向它（见 readEditorDoc）。
  rememberEditorDoc(key, snapshot.state.doc);
}

// ---------- 实时文档镜像（重叠挂载时的文档传递） ----------

const liveDocs = new Map<string, Text | string>();

/** 刷新某键的实时文档（存 O(1) Text 树或字符串，读取时再按需序列化）。 */
export function rememberEditorDoc(key: string, doc: Text | string): void {
  liveDocs.delete(key);
  liveDocs.set(key, doc);
  evictOldest(liveDocs);
}

/** 窥视某键的实时文档字符串（不移除）；没有则 undefined。 */
export function readEditorDoc(key: string): string | undefined {
  const value = liveDocs.get(key);
  if (value === undefined) return undefined;
  return typeof value === 'string' ? value : value.toString();
}

/** 窥视某键的实时文档原始引用（O(1)，卸载时按引用判定是否为最新实例）。 */
export function readEditorDocRef(key: string): Text | string | undefined {
  return liveDocs.get(key);
}

// ---------- 同键挂载实例计数（形态切换重叠窗口的判定） ----------

const activeEditors = new Map<string, number>();

/**
 * 挂载登记；返回**此前**是否已有同键实例挂载（true = 处于形态切换重叠窗口）。
 * 与 leaveEditor 成对：mount effect 进入、cleanup 注销。
 */
export function enterEditor(key: string): boolean {
  const count = activeEditors.get(key) ?? 0;
  activeEditors.set(key, count + 1);
  return count > 0;
}

/** 卸载注销。 */
export function leaveEditor(key: string): void {
  const count = activeEditors.get(key);
  if (count === undefined) return;
  if (count <= 1) activeEditors.delete(key);
  else activeEditors.set(key, count - 1);
}

// ---------- 卸载时的宿主草稿读数（区分「滞后回声」与「外部改写」） ----------

export interface DetachedHostDraft {
  /** 离开时 flush 后宿主应持有的草稿。 */
  readonly published: string;
  /** flush 之前宿主（props 投影）的草稿；与 published 不同说明有未同步尾巴。 */
  readonly stale: string;
  /** 记录时刻（ms）：仅在「同一提交内重挂载」的极短窗口内有效。 */
  readonly at: number;
}

const detachedHosts = new Map<string, DetachedHostDraft>();

/** 卸载时记录宿主读数（与快照同键同容量；take 语义 = 只被下一次挂载消费一次）。 */
export function rememberDetachedHost(key: string, published: string, stale: string): void {
  detachedHosts.delete(key);
  detachedHosts.set(key, { published, stale, at: Date.now() });
  evictOldest(detachedHosts);
}

/** 取走上次卸载时的宿主读数（移出，避免旧记录影响更后面的挂载）。 */
export function takeDetachedHost(key: string): DetachedHostDraft | undefined {
  const value = detachedHosts.get(key);
  if (value !== undefined) detachedHosts.delete(key);
  return value;
}
