/**
 * Markdown 输出净化（DOMPurify 兜底）。
 *
 * 安全模型（B5 结论不变）：**原始 HTML 一律在 marked 的 renderer.html 里转义**
 * （见 `extensions.ts`），所以任何 `data-dci-*` 属性只可能由本模块自己的扩展
 * 产生；手写 `<span data-dci-wire="x">` 只会显示成文本。DOMPurify 这里是第二道
 * 闸：白名单收敛到 Markdown 产出面，URI 只放行 http(s)/mailto/页内锚点，
 * 行内 style 一律不进 DOM（`<style>` 一旦落地会全局生效）。
 *
 * 白名单由「基础面 + registry 扩展追加」组成：扩展渲染的 KaTeX/Mermaid 通过
 * `registerMarkdownExtension({ allowTags, allowAttrs })` 增量放行自己的输出标签，
 * 不需要改本文件。
 */

import * as DOMPurifyModule from 'dompurify';

/** dompurify 的导出形状随打包条件漂移：默认导出与命名空间都兼容。 */
const DOMPurify = ((DOMPurifyModule as unknown as { default?: unknown }).default ??
  DOMPurifyModule) as unknown as {
  sanitize(html: string, options?: Record<string, unknown>): string;
  isSupported?: boolean;
};

/** HTML 文本转义（属性值与文本节点共用）。 */
export function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}

/** Markdown 结构 + 本批扩展（callout / 脚注 / 任务清单 / wikilink / 折叠块）。 */
const BASE_TAGS: readonly string[] = [
  'p', 'br', 'strong', 'em', 'del', 'mark', 'code', 'pre', 'blockquote',
  'ul', 'ol', 'li', 'a', 'img',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'input', 'span', 'div', 'section', 'sup', 'sub', 'small', 'button',
  'details', 'summary',
];

/** 属性面。data-* 只在下面显式列出（ALLOW_DATA_ATTR=false），保持 B5 结论。 */
const BASE_ATTRS: readonly string[] = [
  'href', 'src', 'alt', 'title', 'target', 'rel',
  'type', 'checked', 'disabled', 'start',
  'align', 'colspan', 'rowspan', 'class', 'id',
  'width', 'height', 'loading', 'decoding', 'open',
  'data-dci-wire', 'data-callout', 'data-family', 'data-icon',
  'data-dci-wikilink', 'data-dci-fn', 'data-dci-footnotes',
];

/** 链接/图片 URI：页内锚点（脚注回跳）、http(s)、mailto；javascript:/data: 等全部拦截。 */
const ALLOWED_URI = /^(?:https?:|mailto:|#)/i;

/**
 * 非 URL 属性（值不做 URI 协议检查）。
 *
 * DOMPurify 的 `ALLOWED_URI_REGEXP` 会对**所有非「URI-safe」属性**的取值做匹配，
 * 不匹配就整条剥掉——所以 `target="_blank"`、`align="center"`、`width="300"`、
 * `data-callout="note"` 这类非 URL 取值会被误杀。标准解法是把它们登记进
 * `ADD_URI_SAFE_ATTR`（与默认 URI-safe 集合并），只留 href/src 走协议白名单。
 */
const NON_URI_ATTRS: readonly string[] = [
  'alt', 'title', 'target', 'rel', 'type', 'checked', 'disabled', 'start',
  'align', 'colspan', 'rowspan', 'class', 'id',
  'width', 'height', 'loading', 'decoding', 'open',
  'data-dci-wire', 'data-callout', 'data-family', 'data-icon',
  'data-dci-wikilink', 'data-dci-fn', 'data-dci-footnotes',
];

export interface SanitizeExtras {
  /** registry 扩展追加放行的标签（如 KaTeX 的 span/自定义节点）。 */
  tags?: readonly string[];
  /** registry 扩展追加放行的属性（如 KaTeX 的 style-less 数据属性）。 */
  attrs?: readonly string[];
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function sanitizeOptions(extras?: SanitizeExtras): Record<string, unknown> {
  return {
    ALLOWED_TAGS: dedupe([...BASE_TAGS, ...(extras?.tags ?? [])]),
    ALLOWED_ATTR: dedupe([...BASE_ATTRS, ...(extras?.attrs ?? [])]),
    ADD_URI_SAFE_ATTR: dedupe([...NON_URI_ATTRS, ...(extras?.attrs ?? [])]),
    ALLOWED_URI_REGEXP: ALLOWED_URI,
    ALLOW_DATA_ATTR: false,
    FORBID_ATTR: ['style'],
  };
}

/**
 * 净化 marked 产出的 HTML。
 * DOMPurify 不可用（无 DOM 的极端环境）时宁可把 HTML 当文本全转义，
 * 也不把未净化的标记塞进 DOM。
 */
export function sanitizeMarkdown(html: string, extras?: SanitizeExtras): string {
  if (typeof DOMPurify.sanitize !== 'function' || DOMPurify.isSupported === false) {
    return `<p>${escapeHtml(html).replace(/\n/g, '<br>')}</p>`;
  }
  return DOMPurify.sanitize(html, sanitizeOptions(extras));
}
