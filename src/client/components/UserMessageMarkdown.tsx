/**
 * 用户消息 Markdown 渲染：conversation.chat.node 键控座的 user / steering
 * 遮蔽条目（prefs.userMarkdown 开启时挂载，关闭即卸载还座官方）。
 *
 * 官方 UserStyleBubble 复刻：右对齐气泡（附件行 + 气泡 + 引用摘要行 + 操作行），
 * 气泡文本按 Markdown 渲染。v0.6 起渲染统一走 `src/client/markdown/`（与编辑器
 * 预览同一函数 `renderMarkdown`，输出逐字节一致）；会话引用占位 span
 * （data-dci-wire）在下面的装饰期换成官方引用 chip。Markdown 样式逐条移植官方
 * MarkdownText.module.css。@/ 引用 chip、/技能 chip、复制钮、时间戳、点开文件/
 * 技能等行为逐值对齐官方 projectUserText（dsh-client-ui-primitives，MIT，见
 * LICENSE 归属段）。
 *
 * 挂载面（v0.3.7 取证，宿主 0.2.x web）：chat.view 的 flowItem 渲染点
 * `renderSlot("conversation.chat.node", owner, { entryKey: routedNode.kind })`，
 * 官方以 key=user/steering 注册 UserMessageNodeView；键控座同 key 低 priority
 * 者胜（动态包守卫对插件 register 强制分配负遮蔽秩，与 bar 接管同机制）。
 * 发送瞬间的本地回显（PendingSubmissionBubble）不经本槽位，保持官方纯文本，
 * 落库后即换 Markdown 形态。
 *
 * 宿主代际（0.2.0 → 0.2.2）：0.2.2 的 user 节点视图改由「Factory + 键控座」
 * 组合渲染，官方 UserContent（conversation.chat.user.content）只负责附件行 /
 * 文本 / 额外块 / 引用摘要。本组件保留 Markdown 文本接管，但把**附件行**整段
 * 委托给该 Factory（content.text 置空 → 官方只出附件行）：图片经
 * conversation.chat.user.images → MessageImages 得到官方缩略图与点击大图灯箱。
 * 旧 0.2.0 宿主没有该 Factory，FactoryOutlet 会渲染 options.fallback，回落到
 * 该宿主专有的 renderMessageImages 座位；再没有则保留文件卡降级（不静默丢内容）。
 * 两条附带约束：question-reply 来源的消息让位官方 question-reply 卡片；原始
 * HTML 一律按文本转义（data-dci-wire 只能由本文件的 md 扩展产生）。
 *
 * 已知边界（刻意不做）：KaTeX 数学公式、Shiki 代码高亮与 CodeBlock 语言横幅、
 * 链接分类图标不渲染（官方 MarkdownText 的完整面超出自含范围）；未知内容块
 * 出极简 JSON 块（官方 JsonBlock 的降级形态）。
 */

import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { SlotRegisterOptions } from '../host-types';
import { diagError } from '../diag';
import { loadPrefs, subscribePrefs } from '../prefs';
import { bindForeign, t, useT, type TranslateParams } from '../i18n';
import {
  activateMarkdown,
  copyTextToClipboard,
  handleMarkdownClick,
  renderMarkdown,
  type MarkdownImageTarget,
} from '../markdown';
import { FileGlyph, fileExtension, fileSizeText } from './AttachmentRail';
import { ImageLightbox } from './ImageLightbox';

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
  /** 官方 messageDefinition 落在 user/steering 节点上的消息源（鸭子切面）。 */
  source?: unknown;
}

/** 0.2.0 宿主座位：官方 MessageImages（缩略图 + 灯箱）的便携 prop 形态。 */
type RenderMessageImages = (args: { images: readonly unknown[]; align: string; compact?: boolean }) => ReactNode;

/** 0.2.2 宿主座位：键控条目 kit 固定下发的 Factory 渲染器（boundRenderFactorySlot）。 */
type RenderFactorySlot = (
  name: string,
  props: Record<string, unknown>,
  options?: { fallback?: ReactNode },
) => ReactNode;

export interface UserMessageMarkdownProps {
  node?: { kind?: string; data?: UserMessageData } | undefined;
  /** 0.2.0 宿主：图片缩略/灯箱官方座位（0.2.2 已移除此 prop，改走 Factory）。 */
  renderMessageImages?: RenderMessageImages | undefined;
  /**
   * 0.2.2 宿主：官方 UserMessageNodeView 同座下发的 Factory seat。附件行委托
   * conversation.chat.user.content；旧宿主没有该 Factory 时 FactoryOutlet 会渲染
   * options.fallback（本组件传入旧座位/文件卡链路，不静默丢内容）。
   */
  renderFactorySlot?: RenderFactorySlot | undefined;
  /** 0.2.2 用户节点 owner props 直传的授权图片加载器（官方同座）。 */
  loadImage?: unknown;
  openFile?: ((path: string) => void) | undefined;
  openSkill?: ((name: string) => void) | undefined;
}

interface ContentParts {
  text: string;
  /** 图片：官方 contentParts 把它包成 { attachment: ImageAttachmentRef }——官方 ImageGallery
   * 的 React key 读 image.attachment.attachmentId；裸 ref 会让 key 计算访问 preview.url 崩。 */
  attachments: ({ type: 'image'; image: { attachment: unknown } } | { type: 'file'; file: { name?: string; bytes?: number } })[];
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
    else if (b && b.type === 'image' && b.attachment !== undefined) parts.attachments.push({ type: 'image', image: { attachment: b.attachment } });
    else if (b && b.type === 'file' && b.attachment !== undefined) parts.attachments.push({ type: 'file', file: (b.attachment ?? {}) as { name?: string; bytes?: number } });
    else parts.rest.push(block);
  }
  parts.text = texts.join('');
  return parts;
}

/* ---------- Markdown 管线 ---------- */

/* 统一管线在 src/client/markdown/：renderMarkdown 产出 sanitized HTML；会话引用线格式
   @[...](dsh-session:…) 的占位 span 由管线扩展产生，下面的装饰期把占位换成官方引用 chip。*/

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

function chipElement(range: ChipRange, actionsRef: React.MutableRefObject<ChipActions>): HTMLElement {
  const actions = actionsRef.current;
  // 官方 projectUserText：只有 file 与 /skill 可点（folder / session 是纯 span）；
  // 点击时读 actionsRef.current，回调后到时无需重新装饰 DOM。
  const clickable =
    range.clickable &&
    (range.kind === 'file'
      ? typeof actions.openFile === 'function'
      : range.kind === 'slash' && typeof actions.openSkill === 'function');
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
      const live = actionsRef.current;
      if (range.kind === 'slash') live.openSkill?.(range.display.slice(1));
      else live.openFile?.(range.label.slice(1).replace(/^"|"$/gu, ''));
    });
  }
  return chip;
}

/** 官方排序轴：start 升序 → session 先于 generic → 更长者先。 */
function rangeRank(range: ChipRange): number {
  return range.kind === 'session' ? 0 : 1;
}

/** 把一段文本按 ranges 切开，plain 部分留原文本节点，token 位换成 chip 元素。 */
function splitTextNode(node: Text, ranges: ChipRange[], actionsRef: React.MutableRefObject<ChipActions>): void {
  const fragment = document.createDocumentFragment();
  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor) fragment.appendChild(document.createTextNode(node.data.slice(cursor, range.start)));
    fragment.appendChild(chipElement(range, actionsRef));
    cursor = range.end;
  }
  if (cursor < node.data.length) fragment.appendChild(document.createTextNode(node.data.slice(cursor)));
  node.parentNode?.replaceChild(fragment, node);
}

function chipTextNodes(root: HTMLElement, actionsRef: React.MutableRefObject<ChipActions>): void {
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
  const { skillNames, referenceLabels } = actionsRef.current;
  for (const node of nodes) {
    const ranges = [
      ...sessionWireRanges(node.data),
      ...sessionLabelRanges(node.data, referenceLabels),
      ...genericTokenRanges(node.data, skillNames),
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
    splitTextNode(node, picked, actionsRef);
  }
}

/** innerHTML 落地后的整备：链接新开页、表格出滚动壳、线格式与 @/// token 换 chip。 */
function decorateMarkdownRoot(root: HTMLElement | null, actionsRef: React.MutableRefObject<ChipActions>): void {
  if (!root) return;
  try {
    // 官方 sanitizeUrl 只放行 http(s)/mailto：其余链接（含 DOMPurify 已剥掉 href 的残链）
    // 没有可点面，拆回纯文本；http(s) 统一新开页。页内锚点（#…）是统一管线的
    // 脚注上标/回跳，必须保留可点。
    for (const anchor of Array.from(root.querySelectorAll('a'))) {
      const href = anchor.getAttribute('href') ?? '';
      if (href.startsWith('#')) continue;
      if (/^https?:/i.test(href)) {
        anchor.setAttribute('target', '_blank');
        anchor.setAttribute('rel', 'noreferrer noopener');
        continue;
      }
      if (/^mailto:/i.test(href)) {
        anchor.setAttribute('rel', 'noreferrer noopener');
        continue;
      }
      anchor.replaceWith(...Array.from(anchor.childNodes));
    }
    // 官方 remoteImageUrl 只放行 http(s)；相对/data: 图片降级成 alt 文本，不留破图。
    for (const img of Array.from(root.querySelectorAll('img'))) {
      if (/^https?:/i.test(img.getAttribute('src') ?? '')) continue;
      img.replaceWith(document.createTextNode(img.getAttribute('alt') ?? ''));
    }
    // 只保留 GFM 任务清单的只读复选框（marked 产出 checked/disabled，type 可能被
    // sanitize 剥掉），其余 <input> 一律移除——不让用户消息里出现可编辑表单控件。
    for (const input of Array.from(root.querySelectorAll('input'))) {
      if (!input.hasAttribute('disabled')) {
        input.remove();
        continue;
      }
      input.setAttribute('type', 'checkbox');
      input.setAttribute('disabled', '');
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
      placeholder.replaceWith(chipElement({ start: 0, end: 0, kind: 'session', label, display: label, clickable: false }, actionsRef));
    }
    chipTextNodes(root, actionsRef);
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
  const meta = [fileExtension(name).toUpperCase().slice(0, 8), fileSizeText(bytes)].filter(Boolean).join(' ');
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

/** 旧/异形宿主缺 renderMessageImages 座位 prop 时的图片降级卡（不静默丢内容）。 */
function MessageImageFallback({ image }: { image: { attachment: unknown } }): JSX.Element {
  const att = (image.attachment ?? {}) as { name?: unknown; mediaType?: unknown; bytes?: unknown };
  const name = typeof att.name === 'string' && att.name !== '' ? att.name : t('umsg.image');
  const media = typeof att.mediaType === 'string' ? att.mediaType.replace(/^image\//i, '').toUpperCase() : '';
  const meta = [media, typeof att.bytes === 'number' ? fileSizeText(att.bytes) : ''].filter(Boolean).join(' ');
  return (
    <span className="dci-umsg-file" data-image-fallback="true" title={name}>
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

/**
 * 附件行回退：0.2.2 主路径由官方 content Factory 渲染（见 view），只有旧宿主的
 * FactoryOutlet fallback 才会走到这里——0.2.0 宿主用其 renderMessageImages 座位
 * （官方缩略图 + 灯箱），再缺则保留文件卡降级，保证内容不静默丢失。
 */
function AttachmentRowFallback({
  attachments,
  renderMessageImages,
}: {
  attachments: ContentParts['attachments'];
  renderMessageImages?: RenderMessageImages | undefined;
}): JSX.Element {
  const compact = attachments.length > 1;
  return (
    <div className="dci-umsg-attrow" data-message-attachments="true">
      {attachments.map((att, index) =>
        att.type === 'image' ? (
          <Fragment key={`image:${index}`}>
            {renderMessageImages
              ? renderMessageImages({ images: [att.image], align: 'end', compact })
              : <MessageImageFallback image={att.image} />}
          </Fragment>
        ) : (
          <MessageFileCard key={`file:${index}`} file={att.file} />
        ),
      )}
    </div>
  );
}

function UserMessageMarkdownView(props: UserMessageMarkdownProps): JSX.Element | null {
  const { node, renderMessageImages, renderFactorySlot, loadImage, openFile, openSkill } = props;
  // 订阅宿主 locale 快照：语言切换时复制钮/引用摘要等文案即时刷新（其它组件同款）。
  useT();
  const data = (node?.data ?? {}) as UserMessageData;
  const content = data.content;
  const referenceLabels = useMemo(() => (Array.isArray(data.referenceLabels) ? data.referenceLabels : []), [data.referenceLabels]);
  const skillNames = useMemo(() => (Array.isArray(data.skillNames) ? data.skillNames : []), [data.skillNames]);
  const { text, attachments, rest } = useMemo(() => contentParts(content), [content]);
  const showBubble = text !== '' || rest.length > 0;
  // 官方 UserStyleBubble 的 facts 形状（0.2.2）：引用标签/技能名随 content 传给
  // 官方 content Factory；text 为空时它不渲染文本，facts 只为同构保留。
  const factoryFacts = useMemo(
    () => ({
      ...(referenceLabels.length > 0 ? { sessionLabels: referenceLabels } : {}),
      ...(skillNames.length > 0 ? { skillNames } : {}),
    }),
    [referenceLabels, skillNames],
  );
  const sourceKind = (data.source as { kind?: unknown } | null | undefined)?.kind;

  /** Markdown 正文等宽连字（prefs.markdownMono）：即时跟随设置变化。 */
  const [markdownMono, setMarkdownMono] = useState<boolean>(() => loadPrefs().markdownMono);
  useEffect(() => subscribePrefs(() => setMarkdownMono(loadPrefs().markdownMono)), []);

  const html = useMemo(() => (text === '' ? '' : renderMarkdown(text, { surface: 'user-message' })), [text]);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  /** Markdown 内 http(s) 图片点击后的大图（用户消息里的 Markdown 图片与预览一致走灯箱）。 */
  const [lightbox, setLightbox] = useState<MarkdownImageTarget | null>(null);
  const onMarkdownClick = useCallback((event: React.MouseEvent<HTMLDivElement>): void => {
    handleMarkdownClick(event, { onImage: setLightbox });
  }, []);
  const actionsRef = useRef<ChipActions>({ openFile, openSkill, skillNames, referenceLabels });
  actionsRef.current = { openFile, openSkill, skillNames, referenceLabels };
  // 引用标签 / 技能名单后到（投影刷新）时重跑装饰，补齐 @引用与 /技能 chip。
  useEffect(() => {
    decorateMarkdownRoot(bodyRef.current, actionsRef);
  }, [html, referenceLabels, skillNames]);
  // 扩展渲染 扩展（代码高亮 / KaTeX / Mermaid）的 DOM 激活口；本批未注册扩展时是 no-op。
  useEffect(() => activateMarkdown(bodyRef.current, 'user-message'), [html]);

  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<number | null>(null);
  // 卸载时清掉「已复制」回退定时器，避免卸载后的 setState。
  useEffect(
    () => () => {
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    },
    [],
  );
  const onCopy = useCallback(() => {
    if (copied || text === '') return;
    void copyTextToClipboard(text).then((ok) => {
      if (!ok) return;
      setCopied(true);
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => {
        copyTimer.current = null;
        setCopied(false);
      }, 1000);
    });
  }, [copied, text]);

  // 附件行：0.2.2 起整体委托官方 content Factory（text 置空 → 官方只出附件行；
  // extraBlocks 空、referenceLabels 空数组避免与下方自有引用摘要重复）。图片经
  // conversation.chat.user.images → MessageImages 走官方缩略图 + 点击大图灯箱。
  // 旧宿主没有 conversation.chat.user.content Factory 时，FactoryOutlet 渲染
  // options.fallback：0.2.0 的 renderMessageImages 座位 → 文件卡降级。
  const attachmentRow =
    attachments.length === 0 ? null : typeof renderFactorySlot === 'function' ? (
      renderFactorySlot(
        'conversation.chat.user.content',
        {
          content: { text: '', attachments, extraBlocks: [], referenceLabels: [] },
          loadImage,
          facts: factoryFacts,
          interactive: true,
        },
        {
          fallback: <AttachmentRowFallback attachments={attachments} renderMessageImages={renderMessageImages} />,
        },
      )
    ) : (
      <AttachmentRowFallback attachments={attachments} renderMessageImages={renderMessageImages} />
    );

  // 问题 B：问答回复（source.kind === 'user-question-reply'）在官方 0.2.2 由
  // question-reply 键控卡片（[data-question-reply]，官方 UserMessageBubble）呈现。
  // 该消息源若再以 user/steering 节点落到本座（历史投影/旧宿主兜底形态），本组件
  // 再渲染一份就会让同一条问答在消息流里出现两次——这里直接让位官方卡片。
  if (sourceKind === 'user-question-reply') return null;

  if (!showBubble && attachments.length === 0 && referenceLabels.length === 0 && data.time === undefined) {
    // 空消息：不渲染任何东西（避免空操作行突兀）。
    return null;
  }

  return (
    <div className="dci-umsg-row" data-dci-node={node?.kind} data-dci-src={typeof sourceKind === 'string' ? sourceKind : undefined}>
      <div className="dci-umsg-stack">
        {attachmentRow}
        {showBubble && (
          <div className="dci-umsg-bubble">
            {text !== '' && (
              <div
                className="dci-umsg-md dci-md"
                data-dci-md="user-message"
                data-mono={markdownMono ? 'true' : undefined}
                ref={bodyRef}
                onClick={onMarkdownClick}
                dangerouslySetInnerHTML={{ __html: html }}
              />
            )}
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
        {lightbox ? (
          <ImageLightbox
            src={lightbox.src}
            alt={lightbox.alt}
            labels={{ dialog: t('image.preview'), close: t('image.closePreview') }}
            onClose={() => setLightbox(null)}
          />
        ) : null}
      </div>
    </div>
  );
}

/** 与官方 UserMessageNodeView 一致用 memo 包裹：历史节点快照重建时不连坐重渲染。 */
export const UserMessageMarkdown = memo(UserMessageMarkdownView);
