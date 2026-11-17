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
    '&': { fontSize: '13px', height: '100%' },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': {
      fontFamily,
      lineHeight: '1.6',
      overflow: 'auto',
      ...LITERAL_TEXT_STYLES,
    },
    '.cm-content': {
      caretColor: 'var(--dsw-alias-state-business-primary, currentColor)',
      paddingBottom: '8px',
      ...LITERAL_TEXT_STYLES,
    },
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
    // 行号栏定宽（issue #3）：行号 gutter 是 flex 列，列宽由最宽的子
    // `.cm-gutterElement` 决定，其中还有一个隐藏占位元素，其文本是
    // maxLineNumber(doc.lines)——按 9/99/999… 取档。若只看可见行号，行数从
    // 9→10、99→100 时占位元素与可见数字一起变宽，整列变宽、正文右移。
    // 这里给**每个**行号元素同一个 min-width = 3 个数字 + 左右内边距
    // （10px + 6px = 16px，与下方 padding 同源）。`ch` 是「0」字形宽度，随
    // prefs.fontFamily / fontSize 自动换算，等宽字体下 3ch 恰为三位数字宽；
    // 于是 ≤999 行列宽恒等于该值，>999 行时内容才会把列撑开（不裁切数字）。
    // 注：CM 基础主题已给 `.cm-gutterElement` 设 box-sizing: border-box，
    // 故 min-width 含内边距。首个/末个元素（含隐藏占位）同规则。
    '.cm-lineNumbers .cm-gutterElement': {
      minWidth: 'calc(3ch + 16px)',
      padding: '0 6px 0 10px',
      // 比例字体下把 0-9 设为等宽数字，避免单/多位数因字形宽度不同而抖动。
      fontVariantNumeric: 'tabular-nums',
    },
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

/** 从缓存里淘汰最久未使用的键（Map 首次插入序 ≈ LRU 近邻）。 */
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
  rememberEditorDoc(key, snapshot.state.doc.toString());
}

// ---------- 实时文档镜像（重叠挂载时的文档传递） ----------
//
// 快照只描述「旧实例离开时的编辑器」：形态切换不是原子的——新实例（侧栏
// body）常常先挂载、旧实例（主输入面）下一拍才卸载。此时新实例 take 到的是
// 空（旧实例还没来得及 put），若从空文档起步，首次按键就会把宿主草稿顶掉。
// 故再记一份**只读旁路**：本地每次文档变化即时刷新（只存字符串引用，O(1)，
// 不做拷贝），新实例挂载时据此判定「同会话还有活着的旧实例，且文档比快照新」，
// 优先采用它而不是新建空文档。与快照同键、同容量、同淘汰顺序；区别是 read
// 不移除——它可能被后续多个实例继续使用。

const liveDocs = new Map<string, string>();

/** 刷新某键的实时文档（EditorPane 在本地输入 / 外部回写后调用）。 */
export function rememberEditorDoc(key: string, doc: string): void {
  // 重新插入以刷新「最近使用」顺序：最久未用的键先被淘汰。
  liveDocs.delete(key);
  liveDocs.set(key, doc);
  evictOldest(liveDocs);
}

/** 窥视某键的实时文档（不移除）；没有则 undefined。 */
export function readEditorDoc(key: string): string | undefined {
  return liveDocs.get(key);
}

// ---------- 同键挂载实例计数（形态切换重叠窗口的判定） ----------
//
// 形态切换跨 React 树（主输入面 ↔ 侧栏 body），不是原子操作：新实例可能先挂载、
// 旧实例下一拍才卸载。此时「宿主草稿」props 可能还是旧投影，而实时文档镜像已经
// 是最新本地内容。挂载对账必须知道「此刻是否还有同键实例活着」：重叠 = 本地优先
// （并立即补写宿主）；不重叠 = 官方输入机是唯一事实源，离开期间的官方改写要认。

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
//
// 同一提交内的重挂载（inline ↔ portal 悬浮，同一 React 树）有个已知时序：
// 新实例的 props 是**render 阶段**读的（旧实例还没 flush），cleanup 的 flush 在
// commit 阶段才把本地草稿写进宿主。于是新实例挂载时看到的 `state.draft` 是
// 「flush 前的旧投影」——如果按「宿主优先」处理，就会把用户刚敲的字丢掉。
// 卸载时记下两件事即可判定：published = 离开时写进宿主的文本（宿主应持有的值），
// stale = 写之前的宿主值（同一提交重挂载时新 props 很可能正是它）。

export interface DetachedHostDraft {
  /** 离开时 flush 后宿主应持有的草稿。 */
  readonly published: string;
  /** flush 之前宿主（props 投影）的草稿；与 published 不同说明有未同步尾巴。 */
  readonly stale: string;
  /** 记录时刻（ms）。滞后回声只在「同一提交内的重挂载」成立——超出窗口的记录
   *  说明期间用户在官方输入框里改过草稿，stale 值可能恰好等于新草稿，不能
   *  据此复活旧文本（见 EditorPane 的 staleEcho 判定）。 */
  readonly at: number;
}

const detachedHosts = new Map<string, DetachedHostDraft>();

/** 卸载时记录宿主读数（与快照同键同容量；take 语义 = 只被下一次挂载消费一次）。 */
export function rememberDetachedHost(key: string, published: string, stale: string): void {
  detachedHosts.delete(key);
  detachedHosts.set(key, { published, stale, at: Date.now() });
  while (detachedHosts.size > CACHE_MAX) {
    const oldest = detachedHosts.keys().next().value;
    if (oldest === undefined) break;
    detachedHosts.delete(oldest);
  }
}

/** 取走上次卸载时的宿主读数（移出，避免旧记录影响更后面的挂载）。 */
export function takeDetachedHost(key: string): DetachedHostDraft | undefined {
  const value = detachedHosts.get(key);
  if (value !== undefined) detachedHosts.delete(key);
  return value;
}
