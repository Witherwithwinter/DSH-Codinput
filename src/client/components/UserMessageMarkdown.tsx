/**
 * 用户消息 Markdown 渲染：conversation.chat.node 键控座的 user / steering
 * 遮蔽条目（prefs.userMarkdown 开启时挂载，关闭即卸载还座官方）。
 *
 * 官方 UserStyleBubble 复刻：右对齐气泡（附件行 + 气泡 + 引用摘要行 + 操作行），
 * 气泡文本在官方纯文本排版之上按 Markdown 渲染（marked gfm+breaks + DOMPurify，
 * 与编辑器预览同一管线），Markdown 样式逐条移植官方 MarkdownText.module.css。
 * @/ 引用 chip、/技能 chip、复制钮、时间戳、点开文件/技能等行为逐值对齐官方
 * projectUserText（dsh-client-ui-primitives，MIT，见 LICENSE 归属段）。
 *
 * 挂载面（v0.3.7 取证，宿主 0.2.x web）：chat.view 的 flowItem 渲染点
 * `renderSlot("conversation.chat.node", owner, { entryKey: routedNode.kind })`，
 * 官方以 key=user/steering 注册 UserMessageNodeView；键控座同 key 低 priority
 * 者胜（动态包守卫对插件 register 强制分配负遮蔽秩，与 bar 接管同机制）。
 * 发送瞬间的本地回显（PendingSubmissionBubble）不经本槽位，保持官方纯文本，
 * 落库后即换 Markdown 形态。
 *
 * 已知边界（刻意不做）：KaTeX 数学公式、Shiki 代码高亮与 CodeBlock 语言横幅、
 * 链接分类图标不渲染（官方 MarkdownText 的完整面超出自含范围）；未知内容块
 * 出极简 JSON 块（官方 JsonBlock 的降级形态）。
 */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Marked, type MarkedExtension } from 'marked';
import * as DOMPurifyModule from 'dompurify';
import type { SlotRegisterOptions } from '../host-types';
import { diagError } from '../diag';
import { bindForeign, t, type TranslateParams } from '../i18n';
import { FileGlyph, fileExtension, fileSizeText } from './AttachmentRail';

/* ---------- 注册 ---------- */

export function userMarkdownRegistrations(): { options: SlotRegisterOptions; component: unknown }[] {
  // user：落库用户消息；steering：落库插队消息。同一气泡渲染。
  return (['user', 'steering'] as const).map((key) => ({
    options: {
      name: 'conversation.chat.node',
      key,
      priority: -1,
      registrant: 'dsh-codinput',
    },
    component: UserMessageMarkdown,
  }));
}

/* ---------- 官方形状（消费切面，鸭子类型） ---------- */

interface TextBlock {
  type: 'text';
  text?: string;
}
interface ImageBlock {
  type: 'image';
  attachment?: unknown;
}
interface FileBlock {
  type: 'file';
  attachment?: { name?: string; bytes?: number };
}

interface UserMessageData {
  content?: readonly unknown[];
  referenceLabels?: readonly string[];
  skillNames?: readonly string[];
  time?: unknown;
}

export interface UserMessageMarkdownProps {
  node?: { data?: UserMessageData } | undefined;
  /** 官方 renderMessageImages 座位 prop（图片缩略/灯箱全官方）。 */
  renderMessageImages?: ((args: { images: readonly unknown[]; align: string; compact?: boolean }) => React.ReactNode) | undefined;
  openFile?: ((path: string) => void) | undefined;
  openSkill?: ((name: string) => void) | undefined;
}

interface ContentParts {
  text: string;
  attachments: ({ type: 'image'; image: unknown } | { type: 'file'; file: { name?: string; bytes?: number } })[];
  rest: unknown[];
}

/** 官方 contentParts 逐值复刻：文本串接、图片/文件附件、未知块入 rest。 */
function contentParts(content: readonly unknown[] | undefined): ContentParts {
  const parts: ContentParts = { text: '', attachments: [], rest: [] };
  if (!Array.isArray(content)) return parts;
  const texts: string[] = [];
  for (const block of content) {
    const b = block as Partial<TextBlock> | Partial<ImageBlock> | Partial<FileBlock> | null;
    if (b && b.type === 'text' && typeof b.text === 'string') texts.push(b.text);
    else if (b && b.type === 'image' && b.attachment !== undefined) parts.attachments.push({ type: 'image', image: b.attachment });
    else if (b && b.type === 'file' && b.attachment !== undefined) parts.attachments.push({ type: 'file', file: (b.attachment ?? {}) as { name?: string; bytes?: number } });
    else parts.rest.push(block);
  }
  parts.text = texts.join('');
  return parts;
}

/* ---------- Markdown 管线（marked + DOMPurify，与编辑器预览同源） ---------- */

/** dompurify 的导出形状随打包条件漂移：默认导出与命名空间都兼容。 */
const DOMPurify = ((DOMPurifyModule as unknown as { default?: unknown }).default ??
  DOMPurifyModule) as unknown as { sanitize(html: string): string };

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}

/** 会话引用的落库线格式：@[标签](dsh-session:…)（官方 SESSION_WIRE_RE）。 */
const SESSION_WIRE_SRC = /^@\[([^\]\n]+)\]\(dsh-session:[^)\s]+\)/;

/** marked 扩展：线格式不进通用链接解析（DOMPurify 会剥掉 dsh-session: href），
 * 渲染成带 data 的占位 span，装饰期换成会话 chip。 */
const sessionWireExtension: NonNullable<MarkedExtension['extensions']>[number] = {
  name: 'dshSessionWire',
  level: 'inline',
  start(src: string): number | undefined {
    const i = src.indexOf('@[');
    return i < 0 ? undefined : i;
  },
  tokenizer(src: string) {
    const m = SESSION_WIRE_SRC.exec(src);
    if (!m) return undefined;
    return { type: 'dshSessionWire', raw: m[0], label: m[1] } as never;
  },
  renderer(token) {
    const label = String((token as { label?: unknown }).label ?? '');
    return `<span data-dci-wire="${escapeHtml(label)}">${escapeHtml(label)}</span>`;
  },
};

const mdParser = new Marked({ gfm: true, breaks: true, extensions: [sessionWireExtension] });

function renderMarkdown(text: string): string {
  try {
    return DOMPurify.sanitize(mdParser.parse(text) as string);
  } catch (error) {
    diagError('umsg.markdown', error);
    return `<p>${escapeHtml(text).replace(/\n/g, '<br>')}</p>`;
  }
}

/* ---------- 引用 chip（官方 projectUserText 逐值复刻） ---------- */

/** 裸 @token / /token 允许携带的句尾标点（官方 TRAILING_PUNCTUATION_RE）。 */
const TRAILING_PUNCTUATION_RE = /[.,;:!?，。；：！？]+$/u;
/** 通用引用 token：/指令、@"带空格路径"、@路径（官方正则）。 */
const REF_TOKEN_RE = /(^|\s)(\/[\w-]+(?=\s|$)|@"[^"\n]+"|@[^\s]+)/gu;

type ChipKind = 'session' | 'file' | 'folder' | 'slash';

interface ChipRange {
  start: number;
  end: number;
  kind: ChipKind;
  /** 原样 label（含 @ 或 /，title 用）。 */
  label: string;
  display: string;
  clickable: boolean;
}

interface ChipActions {
  openFile?: ((path: string) => void) | undefined;
  openSkill?: ((name: string) => void) | undefined;
  skillNames: readonly string[];
  referenceLabels: readonly string[];
}

function sessionWireRanges(text: string): ChipRange[] {
  const ranges: ChipRange[] = [];
  const re = /@\[([^\]\n]+)\]\(dsh-session:[^)\s]+\)/gu;
  let wire: RegExpExecArray | null;
  while ((wire = re.exec(text)) !== null) {
    ranges.push({
      start: wire.index,
      end: wire.index + wire[0].length,
      kind: 'session',
      label: wire[0],
      display: wire[1],
      clickable: false,
    });
  }
  return ranges;
}

function sessionLabelRanges(text: string, labels: readonly string[]): ChipRange[] {
  const ranges: ChipRange[] = [];
  for (const rawLabel of [...new Set(labels)].sort((a, b) => b.length - a.length)) {
    const label = `@${rawLabel}`;
    let start = text.indexOf(label);
    while (start >= 0) {
      ranges.push({ start, end: start + label.length, kind: 'session', label, display: rawLabel, clickable: false });
      start = text.indexOf(label, start + label.length);
    }
  }
  return ranges;
}

function genericTokenRanges(text: string, skillNames: readonly string[]): ChipRange[] {
  const ranges: ChipRange[] = [];
  REF_TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = REF_TOKEN_RE.exec(text)) !== null) {
    const tokenStart = m.index + m[1].length;
    const raw = m[2];
    const label = raw.startsWith('@"') ? raw : raw.replace(TRAILING_PUNCTUATION_RE, '');
    if (label.length <= 1) continue;
    if (label.startsWith('/')) {
      if (!skillNames.includes(label.slice(1))) continue;
      ranges.push({ start: tokenStart, end: tokenStart + label.length, kind: 'slash', label, display: label, clickable: true });
      continue;
    }
    const path = label.slice(1).replace(/^"|"$/gu, '');
    const kind: ChipKind = path.endsWith('/') ? 'folder' : 'file';
    const segments = path.split(/[\\/]/u).filter(Boolean);
    const display = segments[segments.length - 1] ?? path;
    ranges.push({ start: tokenStart, end: tokenStart + label.length, kind, label, display, clickable: true });
  }
  return ranges;
}

/* ---------- 装饰期（innerHTML 落地后的 DOM 后处理） ---------- */

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgPath(d: string, stroke: boolean): SVGPathElement {
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', d);
  path.setAttribute(stroke ? 'stroke' : 'fill', 'currentColor');
  return path;
}

function refIconSvg(kind: ChipKind): SVGSVGElement | null {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'dci-umsg-chipicon');
  if (kind === 'session') {
    svg.appendChild(svgPath('M5 6.75H11', true));
    svg.appendChild(svgPath('M5 9H8', true));
    svg.appendChild(
      svgPath(
        'M2.37067 11.2497C1.5872 9.89252 1.32042 8.29798 1.61945 6.7597C1.91847 5.22141 2.76317 3.84293 3.99801 2.87809C5.23285 1.91325 6.7747 1.427 8.33964 1.50888C9.90458 1.59076 11.3873 2.23526 12.5147 3.32369C13.6422 4.41232 14.3384 5.8717 14.4751 7.43304C14.6118 8.99438 14.1797 10.5525 13.2585 11.8205C12.3372 13.0885 10.9889 13.9809 9.4617 14.3334C8.18666 14.6277 6.8587 14.529 5.64964 14.0601C5.17095 13.8745 4.76937 13.4929 4.26509 13.3963C3.67389 13.2832 2.95232 13.5595 2.0377 14.3334',
        true,
      ),
    );
    return svg;
  }
  if (kind === 'file') {
    svg.appendChild(svgPath('M4.9375 5.90295H11.0625', true));
    svg.appendChild(svgPath('M4.9375 9.02991H8.27841', true));
    svg.appendChild(
      svgPath(
        'M12.5 1.32617C13.3039 1.32617 14 1.95171 14 2.77637V13.2246C13.9996 14.0489 13.3036 14.6738 12.5 14.6738H3.5C2.69637 14.6738 2.00042 14.0489 2 13.2246V2.77637C2 1.95171 2.69613 1.32617 3.5 1.32617H12.5ZM3.5 2.32617C3.1993 2.32617 3 2.55186 3 2.77637V13.2246C3.00044 13.4489 3.19963 13.6738 3.5 13.6738H12.5C12.8004 13.6738 12.9996 13.4489 13 13.2246V2.77637C13 2.55186 12.8007 2.32617 12.5 2.32617H3.5Z',
        false,
      ),
    );
    return svg;
  }
  if (kind === 'folder') {
    svg.appendChild(
      svgPath(
        'M1.50439 3.11059C1.50439 2.55831 1.95211 2.1106 2.50439 2.1106H5.43389C5.67773 2.1106 5.91318 2.19969 6.09593 2.36113L7.71649 3.79265C7.89924 3.95409 8.1347 4.04319 8.3785 4.04319H13.4958C14.0481 4.04319 14.4958 4.4909 14.4958 5.04319V12.8894C14.4958 13.4417 14.0481 13.8894 13.4958 13.8894H2.50439C1.95211 13.8894 1.50439 13.4417 1.50439 12.8894V4.04319V3.11059Z',
        true,
      ),
    );
    svg.appendChild(svgPath('M3.63501 7.66614H12.3647', true));
    return svg;
  }
  return null;
}

/** 官方点击守卫：双击与按住划选不触发（避免打断复制选区）。 */
function chipClickGuard(event: MouseEvent): boolean {
  if (event.detail > 1) return true;
  const target = event.currentTarget;
  if (event.detail !== 0 && target instanceof Node) {
    const doc = target.ownerDocument;
    if (doc?.getSelection()?.isCollapsed === false) return true;
  }
  return false;
}

function chipElement(range: ChipRange, actions: ChipActions): HTMLElement {
  const clickable =
    range.clickable &&
    (range.kind === 'file' || range.kind === 'folder'
      ? typeof actions.openFile === 'function'
      : typeof actions.openSkill === 'function');
  const chip = document.createElement(clickable ? 'button' : 'span');
  if (clickable) chip.setAttribute('type', 'button');
  chip.className = 'dci-umsg-chip';
  chip.dataset.chip = range.kind;
  chip.title = range.label;
  const icon = refIconSvg(range.kind);
  if (icon) chip.appendChild(icon);
  chip.appendChild(document.createTextNode(range.display));
  if (clickable) {
    chip.addEventListener('click', (event: Event) => {
      if (chipClickGuard(event as MouseEvent)) return;
      if (range.kind === 'file' || range.kind === 'folder') actions.openFile?.(range.label.slice(1).replace(/^"|"$/gu, ''));
      else actions.openSkill?.(range.display.slice(1));
    });
  }
  return chip;
}

/** 官方排序轴：start 升序 → session 先于 generic → 更长者先。 */
function rangeRank(range: ChipRange): number {
  return range.kind === 'session' ? 0 : 1;
}

/** 把一段文本按 ranges 切开，plain 部分留原文本节点，token 位换成 chip 元素。 */
function splitTextNode(node: Text, ranges: ChipRange[], actions: ChipActions): void {
  const fragment = document.createDocumentFragment();
  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor) fragment.appendChild(document.createTextNode(node.data.slice(cursor, range.start)));
    fragment.appendChild(chipElement(range, actions));
    cursor = range.end;
  }
  if (cursor < node.data.length) fragment.appendChild(document.createTextNode(node.data.slice(cursor)));
  node.parentNode?.replaceChild(fragment, node);
}

function chipTextNodes(root: HTMLElement, actions: ChipActions): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node: Node): number {
      const parent = (node as Text).parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      // 代码/链接里不做 chip（改写内容会破坏代码与链接文本）。
      if (parent.closest('pre, code, a, .dci-umsg-chip')) return NodeFilter.FILTER_REJECT;
      return (node as Text).data.length === 0 ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    nodes.push(current as Text);
    current = walker.nextNode();
  }
  for (const node of nodes) {
    const ranges = [
      ...sessionWireRanges(node.data),
      ...sessionLabelRanges(node.data, actions.referenceLabels),
      ...genericTokenRanges(node.data, actions.skillNames),
    ];
    if (ranges.length === 0) continue;
    ranges.sort((a, b) => a.start - b.start || rangeRank(a) - rangeRank(b) || b.end - a.end);
    const picked: ChipRange[] = [];
    let cursor = 0;
    for (const range of ranges) {
      if (range.start < cursor) continue;
      picked.push(range);
      cursor = range.end;
    }
    if (picked.length === 0) continue;
    splitTextNode(node, picked, actions);
  }
}

/** innerHTML 落地后的整备：链接新开页、表格出滚动壳、线格式与 @/// token 换 chip。 */
function decorateMarkdownRoot(root: HTMLElement | null, actions: ChipActions): void {
  if (!root) return;
  try {
    for (const anchor of Array.from(root.querySelectorAll('a[href]'))) {
      const href = anchor.getAttribute('href') ?? '';
      if (!/^https?:/i.test(href)) continue;
      anchor.setAttribute('target', '_blank');
      anchor.setAttribute('rel', 'noreferrer noopener');
    }
    for (const table of Array.from(root.querySelectorAll('table'))) {
      const parent = table.parentElement;
      if (!parent || parent.classList.contains('dci-umsg-tscroll')) continue;
      const wrap = document.createElement('div');
      wrap.className = 'dci-umsg-tscroll';
      parent.insertBefore(wrap, table);
      wrap.appendChild(table);
    }
    for (const placeholder of Array.from(root.querySelectorAll('span[data-dci-wire]'))) {
      const label = placeholder.getAttribute('data-dci-wire') ?? '';
      placeholder.replaceWith(chipElement({ start: 0, end: 0, kind: 'session', label, display: label, clickable: false }, actions));
    }
    chipTextNodes(root, actions);
  } catch (error) {
    diagError('umsg.decorate', error);
  }
}

/* ---------- 官方 locale（chat 命名空间）优先，缺失退内置词典 ---------- */

interface TranslatorLike {
  (key: string, params?: TranslateParams): string;
}

function officialText(key: string, fallbackKey: string, params?: TranslateParams): string {
  const chatT = bindForeign('chat') as TranslatorLike | null;
  if (chatT) {
    try {
      const value = chatT(key, params);
      if (value && value !== key) return value;
    } catch {
      /* 落内置词典 */
    }
  }
  return t(fallbackKey, params);
}

function referenceSeparator(): string {
  const chatT = bindForeign('chat') as TranslatorLike | null;
  if (chatT) {
    try {
      const value = chatT('message.referenceSeparator');
      if (value && value !== 'message.referenceSeparator') return value;
    } catch {
      /* 落内置词典 */
    }
  }
  return t('umsg.referenceSummary').includes('引用') ? '、' : ', ';
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** 官方 formatMessageClock 复刻：当天 HH:MM，跨天「M月D日 HH:MM」，跨年带年份。 */
function messageClock(time: unknown, now = Date.now()): string {
  const ms = typeof time === 'number' ? time : typeof time === 'string' ? Date.parse(time) : NaN;
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const n = new Date(now);
  const clock = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  if (d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate()) return clock;
  const params = { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() };
  return `${officialText(d.getFullYear() === n.getFullYear() ? 'clock.md' : 'clock.ymd', d.getFullYear() === n.getFullYear() ? 'umsg.clock.md' : 'umsg.clock.ymd', params)} ${clock}`;
}

async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/* ---------- 图标（官方 MessageIconActions glyph 逐字路径） ---------- */

function CopyGlyph(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1.52075" y="4.07373" width="10.3932" height="10.3932" rx="2" stroke="currentColor" />
      <path
        d="M11.9792 1.53296C13.36 1.53296 14.4792 2.65225 14.4792 4.03296V9.42847C14.4792 10.3756 13.9521 11.1987 13.1755 11.6228V10.3298C13.3652 10.0787 13.4792 9.7674 13.4792 9.42847V4.03296C13.4792 3.20453 12.8077 2.53296 11.9792 2.53296H6.58374C6.27966 2.53301 5.99684 2.6235 5.7605 2.77905H4.42358C4.85652 2.03463 5.66056 1.53304 6.58374 1.53296H11.9792Z"
        fill="currentColor"
      />
    </svg>
  );
}

function CheckGlyph(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2.25 8.5L5.49732 11.7473C5.90519 12.1552 6.57263 12.1344 6.95426 11.7018L13.75 4" stroke="currentColor" />
    </svg>
  );
}

/* ---------- 组件 ---------- */

/** 消息文件卡（官方 FileCard 复刻；glyph 用通用文件形，与草稿附件轨一致）。 */
function MessageFileCard({ file }: { file: { name?: string; bytes?: number } }): JSX.Element {
  const name = typeof file.name === 'string' ? file.name : '';
  const bytes = typeof file.bytes === 'number' ? file.bytes : 0;
  const meta = [fileExtension(name).toUpperCase().slice(0, 8), bytes > 0 ? fileSizeText(bytes) : ''].filter(Boolean).join(' ');
  return (
    <span className="dci-umsg-file" title={name}>
      <span className="dci-umsg-fileglyph">
        <FileGlyph />
      </span>
      <span className="dci-umsg-filecontent">
        <span className="dci-umsg-filename">{name}</span>
        <span className="dci-umsg-filemeta">{meta}</span>
      </span>
    </span>
  );
}

export function UserMessageMarkdown(props: UserMessageMarkdownProps): JSX.Element | null {
  const { node, renderMessageImages, openFile, openSkill } = props;
  const data = (node?.data ?? {}) as UserMessageData;
  const content = data.content;
  const referenceLabels = useMemo(() => (Array.isArray(data.referenceLabels) ? data.referenceLabels : []), [data.referenceLabels]);
  const skillNames = useMemo(() => (Array.isArray(data.skillNames) ? data.skillNames : []), [data.skillNames]);
  const { text, attachments, rest } = useMemo(() => contentParts(content), [content]);
  const compactImages = attachments.length > 1;
  const showBubble = text !== '' || rest.length > 0;

  const html = useMemo(() => (text === '' ? '' : renderMarkdown(text)), [text]);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const actionsRef = useRef<ChipActions>({ openFile, openSkill, skillNames, referenceLabels });
  actionsRef.current = { openFile, openSkill, skillNames, referenceLabels };
  useEffect(() => {
    decorateMarkdownRoot(bodyRef.current, actionsRef.current);
  }, [html]);

  const [copied, setCopied] = useState(false);
  const onCopy = useCallback(() => {
    if (copied || text === '') return;
    void writeClipboard(text).then((ok) => {
      if (!ok) return;
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1000);
    });
  }, [copied, text]);

  if (!showBubble && attachments.length === 0 && referenceLabels.length === 0 && data.time === undefined) {
    // 空消息：不渲染任何东西（避免空操作行突兀）。
    return null;
  }

  return (
    <div className="dci-umsg-row">
      <div className="dci-umsg-stack">
        {attachments.length > 0 && (
          <div className="dci-umsg-attrow" data-message-attachments="true">
            {attachments.map((att, index) =>
              att.type === 'image' ? (
                <Fragment key={`image:${index}`}>
                  {renderMessageImages
                    ? renderMessageImages({ images: [att.image], align: 'end', compact: compactImages })
                    : null}
                </Fragment>
              ) : (
                <MessageFileCard key={`file:${index}`} file={att.file} />
              ),
            )}
          </div>
        )}
        {showBubble && (
          <div className="dci-umsg-bubble">
            {text !== '' && <div className="dci-umsg-md" ref={bodyRef} dangerouslySetInnerHTML={{ __html: html }} />}
            {rest.map((block, index) => (
              <pre key={index} className="dci-umsg-extra">
                {officialText('message.extraBlock', 'umsg.extraBlock')}
                {'\n'}
                {JSON.stringify(block, null, 2)}
              </pre>
            ))}
          </div>
        )}
        {referenceLabels.length > 0 && (
          <div className="dci-umsg-refsum">
            {officialText('message.referenceSummary', 'umsg.referenceSummary', {
              labels: referenceLabels.join(referenceSeparator()),
            })}
          </div>
        )}
        <div className="dci-umsg-actions" data-clock="start">
          {data.time !== undefined && messageClock(data.time) !== '' && (
            <span className="dci-umsg-time">{messageClock(data.time)}</span>
          )}
          <button
            type="button"
            className="dci-umsg-action"
            aria-label={copied ? t('umsg.copied') : t('umsg.copy')}
            title={copied ? t('umsg.copied') : t('umsg.copy')}
            onClick={onCopy}
          >
            {copied ? <CheckGlyph /> : <CopyGlyph />}
          </button>
        </div>
      </div>
    </div>
  );
}
