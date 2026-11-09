/**
 * 统一 Markdown 管线的 marked 扩展层。
 *
 * 本模块只产出 HTML 片段，不做净化（净化在 `sanitize.ts`）也不做 DOM 交互
 * （灯箱 / wikilink 复制在 `index.ts` 的交互辅助里）。核心扩展：
 *
 * - GFM 增强：表格/任务清单/删除线/自动链接由 marked 的 gfm 能力提供；这里
 *   接管 link/image 渲染 —— 外链补 `target=_blank rel=noopener noreferrer`、
 *   只放行 http(s)/mailto/页内锚点，图片支持 Obsidian 尺寸语法 `![alt|300](url)`
 *   且非 http(s) 图降级为 alt 文本（不破图、不执行）。
 * - 脚注：`[^1]` / `[^1]: ...`（定义在解析前抽出，正文上标 + 文末 footnote 区，
 *   可回跳；编号按首次引用顺序，渲染 id 带本轮回数前缀避免多消息撞 id）。
 * - Obsidian callout：`> [!note] Title`（含 `+`/`-` 折叠），图标/配色走
 *   `markdownStyles` 里的主题 token。
 * - Obsidian 语法：`==高亮==`、`%%注释%%`（整行/多行/行内都隐藏）、
 *   `[[目标|别名]]`（可点复制目标的 chip）、`![[图片.png]]`（不可解析 → 样式化
 *   文本，不崩）。
 * - 会话引用线格式 `@[标签](dsh-session:…)`：产出 `<span data-dci-wire>` 占位，
 *   由用户消息侧装饰成官方引用 chip（B5：该属性只可能由本扩展产生）。
 * - 原始 HTML：`renderer.html` 一律转义（顶层渲染器见 `coreRenderer`）。
 */

import type {
  MarkedExtension,
  RendererObject,
  RendererThis,
  Token,
  Tokens,
  TokenizerAndRendererExtension,
  TokenizerThis,
} from 'marked';
import { escapeHtml } from './sanitize';

/* =====================================================================
 * 脚注：解析前抽取定义 + 渲染态（编号 / 前缀 / 引用计数）
 * ===================================================================== */

export interface FootnoteDefinition {
  id: string;
  /** 从 1 起的正文显示编号（按首次引用顺序）。 */
  number: number;
  /** 定义原文（已去掉 `[^id]: ` 前缀与续行缩进，可含多段）。 */
  body: string;
}

export interface ExtractedFootnotes {
  /** 移除脚注定义行后的 Markdown。 */
  text: string;
  /** 被引用到的定义（按首次引用顺序编号）。 */
  definitions: FootnoteDefinition[];
}

export interface FootnoteRenderState {
  /** 本轮渲染的 DOM id 前缀（如 `dci-md-7-`）：同一页面多次渲染不撞 id。 */
  prefix: string;
  /** id → 显示编号。 */
  numbers: Map<string, number>;
  /** 编号 → 已出现引用次数（重复引用生成唯一 id）。 */
  shownRefs: Map<number, number>;
}

let footnoteState: FootnoteRenderState | null = null;

/** 每次 renderMarkdown 同步执行：begin → parse → buildFootnotes → end。 */
export function beginFootnoteRender(state: FootnoteRenderState): void {
  footnoteState = state;
}

export function endFootnoteRender(): void {
  footnoteState = null;
}

/** 文末脚注区；`renderBlock` 把定义 Markdown 渲染成块级 HTML。 */
export function buildFootnotesHtml(
  definitions: readonly FootnoteDefinition[],
  renderBlock: (markdown: string) => string,
): string {
  if (definitions.length === 0) return '';
  const prefix = footnoteState?.prefix ?? '';
  const items = definitions.map((def) => {
    const body = renderBlock(def.body);
    const back = `<a class="dci-md-fnback" href="#${prefix}fnref-${def.number}" data-dci-fn="back" title="↩">↩</a>`;
    return `<li id="${prefix}fn-${def.number}" class="dci-md-fnitem">${body}${back}</li>`;
  });
  return `<section class="dci-md-footnotes" data-dci-footnotes="true"><ol class="dci-md-fnlist">${items.join('')}</ol></section>\n`;
}

/** 代码围栏状态（``` / ~~~，长度 ≥3 且闭合不短于开启）。 */
interface FenceState {
  ch: string;
  len: number;
}

function fenceOpen(line: string): FenceState | null {
  const m = /^\s{0,3}(`{3,}|~{3,})/u.exec(line);
  if (!m) return null;
  return { ch: m[1][0], len: m[1].length };
}

function fenceClose(line: string, open: FenceState): boolean {
  const m = /^\s{0,3}(`{3,}|~{3,})\s*$/u.exec(line);
  return m !== null && m[1][0] === open.ch && m[1].length >= open.len;
}

/** 忽略围栏代码 + 行内代码后的脚注引用顺序（编号 = 首次出现顺序）。 */
function collectFootnoteRefs(text: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  let fence: FenceState | null = null;
  for (const line of text.split('\n')) {
    if (fence) {
      if (fenceClose(line, fence)) fence = null;
      continue;
    }
    const open = fenceOpen(line);
    if (open) {
      fence = open;
      continue;
    }
    const masked = line.replace(/`[^`\n]*`/gu, (m) => ' '.repeat(m.length));
    const re = /\[\^([^\]\s]+)\]/gu;
    let m: RegExpExecArray | null;
    while ((m = re.exec(masked)) !== null) {
      if (seen.has(m[1])) continue;
      seen.add(m[1]);
      ids.push(m[1]);
    }
  }
  return ids;
}

/**
 * 从 Markdown 源里抽出 `[^id]: ...` 定义行（含 2+ 空格 / Tab 缩进的续行），
 * 并把被引用的定义按首次引用顺序编号。未被引用的定义随定义行一起丢弃
 * （与 Obsidian / Pandoc 一致）。
 *
 * 只识别块首（≤3 空格缩进）的定义行；围栏代码里的 `[^x]:` 不动。
 */
export function extractFootnotes(source: string): ExtractedFootnotes {
  const lines = source.split('\n');
  const kept: string[] = [];
  const rawDefs = new Map<string, string>();
  let current: { id: string; lines: string[] } | null = null;
  let pendingBlanks: string[] = [];
  let fence: FenceState | null = null;

  const flush = (): void => {
    if (!current) return;
    const body = current.lines.join('\n').replace(/[\s\u00a0]+$/u, '');
    rawDefs.set(current.id, body);
    current = null;
  };
  const dropPendingBlanks = (): void => {
    pendingBlanks = [];
  };
  const keepPendingBlanks = (): void => {
    kept.push(...pendingBlanks);
    pendingBlanks = [];
  };

  for (const line of lines) {
    if (fence) {
      kept.push(line);
      if (fenceClose(line, fence)) fence = null;
      continue;
    }
    if (current) {
      if (line.trim() === '') {
        pendingBlanks.push(line);
        continue;
      }
      // 定义续行：Tab 或 2+ 空格缩进（Obsidian 沿用「缩进即续行」的手感）。
      if (/^(?: {2,}|\t)/u.test(line)) {
        for (const blank of pendingBlanks) current.lines.push(blank);
        dropPendingBlanks();
        current.lines.push(line.replace(/^(?: {1,4}|\t)/u, ''));
        continue;
      }
      flush();
      keepPendingBlanks();
    }
    const open = fenceOpen(line);
    if (open) {
      fence = open;
      kept.push(line);
      continue;
    }
    const def = /^ {0,3}\[\^([^\]\s]+)\]:[ \t]*(.*)$/u.exec(line);
    if (def) {
      current = { id: def[1], lines: [def[2]] };
      continue;
    }
    kept.push(line);
  }
  if (current) {
    flush();
    keepPendingBlanks();
  }
  const text = kept.join('\n');
  const definitions: FootnoteDefinition[] = [];
  let number = 0;
  for (const id of collectFootnoteRefs(text)) {
    const body = rawDefs.get(id);
    if (body === undefined) continue;
    definitions.push({ id, number: ++number, body });
  }
  return { text, definitions };
}

/* =====================================================================
 * 内联扩展
 * ===================================================================== */

interface FootnoteRefToken extends Tokens.Generic {
  type: 'dciFootnoteRef';
  number: number;
  refIndex: number;
}

const footnoteRefExtension: TokenizerAndRendererExtension = {
  name: 'dciFootnoteRef',
  level: 'inline',
  start(src: string): number | undefined {
    const i = src.indexOf('[^');
    return i < 0 ? undefined : i;
  },
  tokenizer(this: TokenizerThis, src: string): Tokens.Generic | undefined {
    const m = /^\[\^([^\]\s]+)\]/u.exec(src);
    if (!m || !footnoteState) return undefined;
    const number = footnoteState.numbers.get(m[1]);
    if (number === undefined) return undefined;
    const shown = footnoteState.shownRefs.get(number) ?? 0;
    footnoteState.shownRefs.set(number, shown + 1);
    return { type: 'dciFootnoteRef', raw: m[0], number, refIndex: shown + 1 } as FootnoteRefToken;
  },
  renderer(this: RendererThis, token: Tokens.Generic): string {
    const ref = token as FootnoteRefToken;
    const prefix = footnoteState?.prefix ?? '';
    const refId =
      ref.refIndex === 1 ? `${prefix}fnref-${ref.number}` : `${prefix}fnref-${ref.number}-${ref.refIndex}`;
    return `<sup class="dci-md-fnref"><a href="#${prefix}fn-${ref.number}" id="${refId}" data-dci-fn="ref">${ref.number}</a></sup>`;
  },
};

interface HighlightToken extends Tokens.Generic {
  type: 'dciHighlight';
  tokens: Token[];
}

/** `==高亮==` → `<mark>`（不跨行，避免吞掉整段）。 */
const highlightExtension: TokenizerAndRendererExtension = {
  name: 'dciHighlight',
  level: 'inline',
  // `=` 不是 marked 内联扫描的天然停点，给 start 让 inlineText 在 `==` 前切开，
  // 否则整段会先被吃成一个 text token，扩展永远看不到高亮语法。
  start(src: string): number | undefined {
    const i = src.indexOf('==');
    return i < 0 ? undefined : i;
  },
  tokenizer(this: TokenizerThis, src: string): Tokens.Generic | undefined {
    const m = /^==(?=\S)([^\n]*?\S)==/u.exec(src);
    if (!m) return undefined;
    return { type: 'dciHighlight', raw: m[0], tokens: this.lexer.inlineTokens(m[1], []) } as HighlightToken;
  },
  childTokens: ['tokens'],
  renderer(this: RendererThis, token: Tokens.Generic): string {
    const highlight = token as HighlightToken;
    return `<mark class="dci-md-mark">${this.parser.parseInline(highlight.tokens ?? [])}</mark>`;
  },
};

/** 行内注释 `%%…%%`：整段消失（不渲染空白占位）。 */
const commentInlineExtension: TokenizerAndRendererExtension = {
  name: 'dciCommentInline',
  level: 'inline',
  // 同 highlight：`%` 不是天然停点，靠 start 把文本 cut 在 `%%` 之前。
  start(src: string): number | undefined {
    const i = src.indexOf('%%');
    return i < 0 ? undefined : i;
  },
  tokenizer(src: string): Tokens.Generic | undefined {
    const m = /^%%[^\n]*?%%/u.exec(src);
    if (!m) return undefined;
    // marked 按 token.type 找扩展 renderer，而 renderer 是挂在扩展 name 上的：
    // 这里 type 必须与 name 完全一致，否则渲染器查不到、原文会漏出来。
    return { type: 'dciCommentInline', raw: m[0] };
  },
  renderer(): string {
    return '';
  },
};

/** 多行注释块：块首 `%%` 起、后续任意行内再次出现 `%%` 收（单行注释交给 inline）。 */
const commentBlockExtension: TokenizerAndRendererExtension = {
  name: 'dciCommentBlock',
  level: 'block',
  tokenizer(src: string): Tokens.Generic | undefined {
    const lines = src.split('\n');
    const first = lines[0] ?? '';
    if (!/^ {0,3}%%/u.test(first)) return undefined;
    const open = /^ {0,3}%%/u.exec(first);
    if (!open || first.slice(open[0].length).includes('%%')) return undefined;
    let close = -1;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].includes('%%')) {
        close = i;
        break;
      }
    }
    if (close < 0) return undefined;
    let raw = lines.slice(0, close + 1).join('\n');
    if (close + 1 < lines.length) raw += '\n';
    return { type: 'dciCommentBlock', raw };
  },
  renderer(): string {
    return '';
  },
};

interface WikilinkToken extends Tokens.Generic {
  type: 'dciWikilink';
  target: string;
  alias: string;
}

/** `[[目标]]` / `[[目标|别名]]`：样式化 chip，点击复制目标名（交互见 index.ts）。 */
const wikilinkExtension: TokenizerAndRendererExtension = {
  name: 'dciWikilink',
  level: 'inline',
  start(src: string): number | undefined {
    const i = src.indexOf('[[');
    return i < 0 ? undefined : i;
  },
  tokenizer(src: string): Tokens.Generic | undefined {
    const m = /^\[\[([^\]\n|]+)(?:\|([^\]\n]+))?\]\]/u.exec(src);
    if (!m) return undefined;
    const target = m[1].trim();
    if (target === '') return undefined;
    return { type: 'dciWikilink', raw: m[0], target, alias: (m[2] ?? '').trim() } as WikilinkToken;
  },
  renderer(token: Tokens.Generic): string {
    const link = token as WikilinkToken;
    const label = link.alias !== '' ? link.alias : link.target;
    return `<button type="button" class="dci-md-wikilink" data-dci-wikilink="${escapeHtml(link.target)}" title="${escapeHtml(`[[${link.target}]]`)}">${escapeHtml(label)}</button>`;
  },
};

interface EmbedToken extends Tokens.Generic {
  type: 'dciEmbed';
  target: string;
  alias: string;
}

/** `![[图片.png]]`：宿主没有仓库解析面 → 样式化文本；正则整段吃掉，不崩。 */
const embedExtension: TokenizerAndRendererExtension = {
  name: 'dciEmbed',
  level: 'inline',
  start(src: string): number | undefined {
    const i = src.indexOf('![[');
    return i < 0 ? undefined : i;
  },
  tokenizer(src: string): Tokens.Generic | undefined {
    const m = /^!\[\[([^\]\n|]+)(?:\|([^\]\n]+))?\]\]/u.exec(src);
    if (!m) return undefined;
    const target = m[1].trim();
    if (target === '') return undefined;
    return { type: 'dciEmbed', raw: m[0], target, alias: (m[2] ?? '').trim() } as EmbedToken;
  },
  renderer(token: Tokens.Generic): string {
    const embed = token as EmbedToken;
    const label = embed.alias !== '' ? embed.alias : embed.target;
    return `<span class="dci-md-embed" title="${escapeHtml(embed.target)}">${escapeHtml(label)}</span>`;
  },
};

/* =====================================================================
 * 块级扩展：Obsidian callout
 * ===================================================================== */

type CalloutFamily = 'blue' | 'green' | 'amber' | 'red' | 'purple' | 'gray';

interface CalloutMeta {
  label: string;
  family: CalloutFamily;
  /** markdownStyles 里的 mask 图标名。 */
  icon: string;
}

/** Obsidian 官方 callout 类型 + 常见别名；未知类型按 note 家族渲染（标题用原名）。 */
const CALLOUT_KINDS: Record<string, CalloutMeta> = {
  note: { label: 'Note', family: 'blue', icon: 'pencil' },
  abstract: { label: 'Abstract', family: 'blue', icon: 'list' },
  summary: { label: 'Summary', family: 'blue', icon: 'list' },
  tldr: { label: 'TL;DR', family: 'blue', icon: 'list' },
  info: { label: 'Info', family: 'blue', icon: 'info' },
  todo: { label: 'Todo', family: 'blue', icon: 'check-square' },
  tip: { label: 'Tip', family: 'green', icon: 'bulb' },
  hint: { label: 'Hint', family: 'green', icon: 'bulb' },
  important: { label: 'Important', family: 'amber', icon: 'flame' },
  success: { label: 'Success', family: 'green', icon: 'check-circle' },
  check: { label: 'Check', family: 'green', icon: 'check-circle' },
  done: { label: 'Done', family: 'green', icon: 'check-circle' },
  question: { label: 'Question', family: 'purple', icon: 'help-circle' },
  help: { label: 'Help', family: 'purple', icon: 'help-circle' },
  faq: { label: 'FAQ', family: 'purple', icon: 'help-circle' },
  warning: { label: 'Warning', family: 'amber', icon: 'alert-triangle' },
  caution: { label: 'Caution', family: 'amber', icon: 'alert-triangle' },
  attention: { label: 'Attention', family: 'amber', icon: 'alert-triangle' },
  danger: { label: 'Danger', family: 'red', icon: 'x-octagon' },
  error: { label: 'Error', family: 'red', icon: 'x-octagon' },
  failure: { label: 'Failure', family: 'red', icon: 'x-octagon' },
  fail: { label: 'Fail', family: 'red', icon: 'x-octagon' },
  missing: { label: 'Missing', family: 'red', icon: 'x-octagon' },
  bug: { label: 'Bug', family: 'red', icon: 'x-octagon' },
  example: { label: 'Example', family: 'purple', icon: 'list' },
  quote: { label: 'Quote', family: 'gray', icon: 'quote' },
  cite: { label: 'Cite', family: 'gray', icon: 'quote' },
};

function calloutMeta(kind: string): CalloutMeta {
  const known = CALLOUT_KINDS[kind];
  if (known) return known;
  const label = kind === '' ? 'Note' : kind.charAt(0).toUpperCase() + kind.slice(1);
  return { label, family: 'blue', icon: 'info' };
}

interface CalloutToken extends Tokens.Generic {
  type: 'dciCallout';
  kind: string;
  fold: string;
  title: string;
  tokens: Token[];
}

const CALLOUT_HEAD = /^ {0,3}>[ \t]?\[!([a-zA-Z][a-zA-Z0-9_-]*)\]([+-]?)[ \t]*(.*)$/u;

/** `> [!note] 标题` + 后续 `>` 行 → 带图标/配色的 callout 块（`+`/`-` 折叠）。 */
const calloutExtension: TokenizerAndRendererExtension = {
  name: 'dciCallout',
  level: 'block',
  tokenizer(this: TokenizerThis, src: string): Tokens.Generic | undefined {
    const lines = src.split('\n');
    const head = CALLOUT_HEAD.exec(lines[0] ?? '');
    if (!head) return undefined;
    const rawLines: string[] = [lines[0]];
    const bodyLines: string[] = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      // 只有继续带 `>` 的行才属于本 blockquote/callout；空行（未带 `>`）结束本块
      // ——`> a\n\n> b` 在 CommonMark/Obsidian 里是两个块，不能吞并成一次 callout。
      if (!/^ {0,3}>/u.test(line)) break;
      rawLines.push(line);
      bodyLines.push(line.replace(/^ {0,3}>[ \t]?/u, ''));
    }
    let raw = rawLines.join('\n');
    if (rawLines.length < lines.length) raw += '\n';
    const body = bodyLines.join('\n');
    const prevTop = this.lexer.state.top;
    this.lexer.state.top = true;
    let tokens: Token[];
    try {
      tokens = this.lexer.blockTokens(body, []);
    } finally {
      this.lexer.state.top = prevTop;
    }
    return { type: 'dciCallout', raw, kind: head[1].toLowerCase(), fold: head[2], title: head[3].trim(), tokens } as CalloutToken;
  },
  renderer(this: RendererThis, token: Tokens.Generic): string {
    const callout = token as CalloutToken;
    const meta = calloutMeta(callout.kind);
    const label = callout.title !== '' ? callout.title : meta.label;
    const body = this.parser.parse(callout.tokens ?? []);
    const head = `<span class="dci-md-callout-icon" data-icon="${meta.icon}"></span><span class="dci-md-callout-label">${escapeHtml(label)}</span>`;
    const attrs = `class="dci-md-callout" data-callout="${escapeHtml(callout.kind)}" data-family="${meta.family}"`;
    if (callout.fold === '-' || callout.fold === '+') {
      const open = callout.fold === '+' ? ' open' : '';
      return `<details ${attrs}${open}><summary class="dci-md-callout-head">${head}</summary><div class="dci-md-callout-body">${body}</div></details>\n`;
    }
    return `<div ${attrs}><div class="dci-md-callout-head">${head}</div><div class="dci-md-callout-body">${body}</div></div>\n`;
  },
};

/* =====================================================================
 * 会话引用线格式（用户消息 chip 的唯一起源，B5）
 * ===================================================================== */

/** 会话引用的落库线格式：@[标签](dsh-session:…)（官方 SESSION_WIRE_RE）。 */
const SESSION_WIRE_SRC = /^@\[([^\]\n]+)\]\(dsh-session:[^)\s]+\)/u;

const sessionWireExtension: TokenizerAndRendererExtension = {
  name: 'dshSessionWire',
  level: 'inline',
  start(src: string): number | undefined {
    const i = src.indexOf('@[');
    return i < 0 ? undefined : i;
  },
  tokenizer(src: string): Tokens.Generic | undefined {
    const m = SESSION_WIRE_SRC.exec(src);
    if (!m) return undefined;
    return { type: 'dshSessionWire', raw: m[0], label: m[1] };
  },
  renderer(token: Tokens.Generic): string {
    const label = String((token as { label?: unknown }).label ?? '');
    return `<span data-dci-wire="${escapeHtml(label)}">${escapeHtml(label)}</span>`;
  },
};

/* =====================================================================
 * 顶层渲染器（原始 HTML 转义 / 链接与图片白名单）
 * ===================================================================== */

/** 本管线放行的链接协议（页内锚点给脚注回跳用）。 */
const SAFE_HREF = /^(?:https?:|mailto:|#)/i;

export const coreRenderer: RendererObject = {
  /**
   * B5（安全）：marked 默认把原始 HTML 原样透传。用户消息是不可信面——
   * 手写 `<span data-dci-wire="x">x</span>` 会被装饰期当成会话 chip（伪造），
   * `<style>` 等还会污染整页。这里把原始 HTML 一律按文本转义：`data-dci-*`
   * 从此只能由本模块的扩展产生；DOMPurify 白名单继续作为兜底。
   */
  html({ text }) {
    return escapeHtml(text);
  },
  link({ href, title, tokens }) {
    const text = this.parser.parseInline(tokens ?? []);
    const raw = typeof href === 'string' ? href.trim() : '';
    if (!SAFE_HREF.test(raw)) return text;
    const external = /^https?:/i.test(raw);
    const target = external ? ' target="_blank"' : '';
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
    return `<a href="${escapeHtml(raw)}"${titleAttr}${target} rel="noopener noreferrer">${text}</a>`;
  },
  image({ href, title, text }) {
    const rawHref = typeof href === 'string' ? href.trim() : '';
    const rawAlt = typeof text === 'string' ? text : '';
    // Obsidian 尺寸语法：![alt|300](url) / ![alt|300x200](url)（宽度生效，高度随比例）。
    const sized = /^(.*)\|(\d+)(?:x\d+)?$/u.exec(rawAlt.trim());
    const altSource = (sized ? sized[1] : rawAlt).trim();
    const alt = altSource.replace(/\\([\\`*_{}[\]()#+\-.!|>~])/gu, '$1').replace(/[*_`~]/gu, '');
    // 非 http(s) 图片（相对路径 / data: / javascript:）降级为 alt 文本，不留破图。
    if (!/^https?:\/\//i.test(rawHref)) return escapeHtml(alt);
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
    const width = sized ? ` width="${sized[2]}"` : '';
    return `<img src="${escapeHtml(rawHref)}" alt="${escapeHtml(alt)}"${titleAttr}${width} loading="lazy" decoding="async">`;
  },
};

/* =====================================================================
 * 扩展清单
 * ===================================================================== */

/** marked 侧核心扩展（顺序即注册顺序；marked 内部对同层 tokenizer 前插，语义上互不重叠）。 */
export const coreExtensions: TokenizerAndRendererExtension[] = [
  sessionWireExtension,
  footnoteRefExtension,
  highlightExtension,
  commentInlineExtension,
  commentBlockExtension,
  wikilinkExtension,
  embedExtension,
  calloutExtension,
];

/** 供 index.ts 组装 marked 实例用（GFM + 换行 + 核心扩展 + 核心渲染器）。 */
export const coreMarkedOptions: MarkedExtension = {
  gfm: true,
  breaks: true,
  extensions: coreExtensions,
  renderer: coreRenderer,
};

/** 渲染期才能确定的脚注状态访问口（供 index.ts 组装 state）。 */
export function footnoteRenderState(): FootnoteRenderState | null {
  return footnoteState;
}
