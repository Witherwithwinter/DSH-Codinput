/**
 * 统一 Markdown 渲染管线的**唯一入口**。
 *
 * 预览面板（CodinputSurface）与用户消息（UserMessageMarkdown）都只调
 * `renderMarkdown(text)`：同步、返回已净化 HTML，两处输出逐字节一致。
 * 渲染之外的 DOM 交互（图片灯箱、wikilink 复制、扩展渲染的异步激活）由本模块
 * 的辅助函数接管，组件侧只挂一个 onClick + 一个 activateMarkdown effect。
 *
 * ## 对外接口
 * - `renderMarkdown(text, options?)` → sanitized HTML（同步）
 * - `markdownStyles` → 本管线新增 CSS（由 `src/client/styles.ts` 拼接注入）
 * - `registerMarkdownExtension(ext)` → 轻量 registry（扩展渲染 高亮/KaTeX/Mermaid）
 * - `activateMarkdown(root, surface?)` → innerHTML 落地后的扩展激活（可返回清理函数）
 * - `handleMarkdownClick(event, { onImage })` → 图片点击开灯箱 / wikilink 点击复制
 * - `copyTextToClipboard(text)` → 剪贴板（含 execCommand 兜底）
 *
 * ## registry 约定（扩展渲染 契约）
 * ```ts
 * const off = registerMarkdownExtension({
 *   name: 'katex',                       // 唯一名；重复注册覆盖旧项
 *   marked: { extensions: [...], renderer: { ... } }, // marked 扩展（必须同步）
 *   allowTags: ['math', 'annotation'],   // 增量放行 DOMPurify 白名单
 *   allowAttrs: ['data-katex'],
 *   // 异步面（Mermaid）：innerHTML 落地后由 activateMarkdown 调，返回清理函数
 *   activate(root, { surface }) { ...; return () => cleanup(); },
 * });
 * off(); // 注销并重建解析器
 * ```
 * 约束：`marked` 扩展不得设 `async: true`（renderMarkdown 是同步契约）；异步渲染
 * 请放 `activate`（宿主 DOM 已就绪），需要的高度变化由调用方/ResizeObserver 处理。
 * `renderer` 扩展返回 `false` 可回退上一实现（marked 约定）。
 */

import { Marked, type MarkedExtension } from 'marked';
import { diagError } from '../diag';
import { escapeHtml, sanitizeMarkdown, type SanitizeExtras } from './sanitize';
import {
  beginFootnoteRender,
  buildFootnotesHtml,
  coreMarkedOptions,
  endFootnoteRender,
  extractFootnotes,
} from './extensions';
import { markdownStyles } from './styles';

export { markdownStyles };

/** 渲染面：预览面板 / 用户消息气泡（扩展渲染 可据此做差异化激活）。 */
export type MarkdownSurface = 'preview' | 'user-message';

/** 激活钩子拿到的上下文。 */
export interface MarkdownRenderContext {
  surface: MarkdownSurface;
}

/**
 * registry 扩展项。基础渲染 只用到基础面；扩展渲染的代码高亮/KaTeX 走 `marked`，
 * Mermaid 走 `activate`（异步、DOM 就绪后）。
 */
export interface MarkdownExtension {
  /** 唯一标识；同名重复注册以最后一次为准。 */
  name: string;
  /** marked 扩展（tokenizer/renderer/hooks）。不得声明 async。 */
  marked?: MarkedExtension;
  /** 追加放行的 DOMPurify 标签（如 KaTeX 的 math/annotation）。 */
  allowTags?: readonly string[];
  /** 追加放行的 DOMPurify 属性（如 data-katex）。 */
  allowAttrs?: readonly string[];
  /**
   * innerHTML 落地后调用（组件在 useEffect 里调 `activateMarkdown`）。
   * 返回清理函数，会在下次渲染/卸载前执行。只应在已净化的根节点上工作。
   */
  activate?: (root: HTMLElement, context: MarkdownRenderContext) => void | (() => void);
}

export interface RenderMarkdownOptions {
  /** 渲染面标识；基础渲染 只作激活上下文透传，不改变输出。 */
  surface?: MarkdownSurface;
}

/* ---------- 解析器 / registry ---------- */

let extensions: MarkdownExtension[] = [];
let parser: Marked = buildParser();
let sanitizeExtras: SanitizeExtras | undefined;

function buildParser(): Marked {
  const packs: MarkedExtension[] = [coreMarkedOptions];
  for (const extension of extensions) {
    if (extension.marked) packs.push(extension.marked);
  }
  // marked 的 use() 对后注册的 tokenizer 前插：registry 扩展天然覆盖核心扩展。
  return new Marked(...packs);
}

function rebuild(): void {
  parser = buildParser();
  const tags: string[] = [];
  const attrs: string[] = [];
  for (const extension of extensions) {
    if (extension.allowTags) tags.push(...extension.allowTags);
    if (extension.allowAttrs) attrs.push(...extension.allowAttrs);
  }
  sanitizeExtras = tags.length > 0 || attrs.length > 0 ? { tags, attrs } : undefined;
}

/**
 * 注册一个渲染扩展（扩展渲染 接高亮/KaTeX/Mermaid 用）。返回注销函数。
 * 注册后立即重建解析器；同名覆盖旧项。
 */
export function registerMarkdownExtension(extension: MarkdownExtension): () => void {
  if (!extension || typeof extension.name !== 'string' || extension.name === '') {
    throw new Error('markdown: registerMarkdownExtension requires a non-empty name');
  }
  extensions = [...extensions.filter((item) => item.name !== extension.name), extension];
  rebuild();
  return () => {
    const next = extensions.filter((item) => item !== extension);
    if (next.length === extensions.length) return;
    extensions = next;
    rebuild();
  };
}

/** 当前已注册的扩展名（诊断 / QA 用）。 */
export function registeredMarkdownExtensions(): string[] {
  return extensions.map((extension) => extension.name);
}

/* ---------- 渲染 ---------- */

let renderSeq = 0;

/**
 * 把 Markdown 渲染成可安全 `dangerouslySetInnerHTML` 的 HTML（同步）。
 * 空串返回空串（组件据此显示占位）；任何异常降级为「原文转义 + <br>」，
 * 错误进 `__dshCodinputErrs`（不把未净化 HTML 塞进 DOM）。
 */
export function renderMarkdown(text: string, _options: RenderMarkdownOptions = {}): string {
  const source = typeof text === 'string' ? text : '';
  if (source.trim() === '') return '';
  const renderId = ++renderSeq;
  try {
    const { text: body, definitions } = extractFootnotes(source);
    const numbers = new Map(definitions.map((definition) => [definition.id, definition.number] as const));
    beginFootnoteRender({ prefix: `dci-md-${renderId}-`, numbers, shownRefs: new Map() });
    const parsed = parser.parse(body, { async: false }) as unknown;
    if (typeof parsed !== 'string') {
      throw new Error('markdown: async marked extensions are not supported by renderMarkdown()');
    }
    let html = parsed;
    if (definitions.length > 0) {
      html += buildFootnotesHtml(definitions, (markdown) => parser.parse(markdown, { async: false }));
    }
    return sanitizeMarkdown(html, sanitizeExtras);
  } catch (error) {
    diagError('markdown.render', error);
    try {
      return sanitizeMarkdown(`<p>${escapeHtml(source).replace(/\n/gu, '<br>')}</p>`, sanitizeExtras);
    } catch {
      return '';
    }
  } finally {
    endFootnoteRender();
  }
}

/**
 * innerHTML 落地后激活已注册扩展（扩展渲染的 Mermaid 异步渲染走这里）。
 * 返回清理函数；组件在 useEffect 里 `return activateMarkdown(ref.current, surface)`。
 * 没有注册扩展时是零开销 no-op。
 */
export function activateMarkdown(root: HTMLElement | null, surface: MarkdownSurface = 'preview'): () => void {
  if (!root || extensions.length === 0) return () => {};
  const context: MarkdownRenderContext = { surface };
  const cleanups: (() => void)[] = [];
  for (const extension of extensions) {
    if (typeof extension.activate !== 'function') continue;
    try {
      const cleanup = extension.activate(root, context);
      if (typeof cleanup === 'function') cleanups.push(cleanup);
    } catch (error) {
      diagError('markdown.activate', error);
    }
  }
  return () => {
    for (const cleanup of cleanups) {
      try {
        cleanup();
      } catch (error) {
        diagError('markdown.activate', error);
      }
    }
  };
}

/* ---------- DOM 交互（图片灯箱 / wikilink 复制） ---------- */

export interface MarkdownImageTarget {
  src: string;
  alt: string;
}

interface MarkdownActivation {
  image?: MarkdownImageTarget;
  wikilink?: string;
}

/** 从点击目标解析出「Markdown 根内的图片 / wikilink」。 */
function activationFromEvent(event: { target: EventTarget | null }): MarkdownActivation | null {
  const target = event.target;
  if (!(target instanceof Element)) return null;
  const root = target.closest('.dci-md');
  if (!root) return null;
  const image = target.closest('img');
  if (image && root.contains(image)) {
    const src = image.getAttribute('src') ?? '';
    if (/^https?:\/\//i.test(src)) return { image: { src, alt: image.getAttribute('alt') ?? '' } };
  }
  const wikilink = target.closest('[data-dci-wikilink]');
  if (wikilink && root.contains(wikilink)) {
    const value = wikilink.getAttribute('data-dci-wikilink') ?? '';
    if (value !== '') return { wikilink: value };
  }
  return null;
}

/** 剪贴板写入（含旧 API 兜底；保留官方复制钮同款实现）。 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
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

function flashWikilinkCopied(element: HTMLElement): void {
  element.dataset.dciCopied = 'true';
  window.setTimeout(() => {
    delete element.dataset.dciCopied;
  }, 900);
}

export interface MarkdownClickHandlers {
  /** Markdown 内的 http(s) 图片被点击（组件接灯箱）。 */
  onImage?(image: MarkdownImageTarget): void;
  /** wikilink 目标已复制成功。 */
  onWikilink?(target: string): void;
}

/**
 * Markdown 根的点击委派：图片 → `onImage`（组件开灯箱）；wikilink → 复制目标名。
 * 返回是否已处理（组件可据此阻止默认行为/冒泡）。
 */
export function handleMarkdownClick(
  event: { target: EventTarget | null; preventDefault?: () => void },
  handlers: MarkdownClickHandlers = {},
): boolean {
  const activation = activationFromEvent(event);
  if (!activation) return false;
  if (activation.image) {
    event.preventDefault?.();
    handlers.onImage?.(activation.image);
    return true;
  }
  const target = activation.wikilink as string;
  event.preventDefault?.();
  const element =
    event.target instanceof Element ? event.target.closest<HTMLElement>('[data-dci-wikilink]') : null;
  void copyTextToClipboard(target).then((ok) => {
    if (!ok || !element) return;
    flashWikilinkCopied(element);
    handlers.onWikilink?.(target);
  });
  return true;
}
