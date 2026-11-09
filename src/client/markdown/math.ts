/**
 * 扩展渲染：KaTeX 数学公式（`$...$` 行内 / `$$...$$` 块级；字体全内置离线）。
 *
 * ## 为什么是「占位符 + activate 替换」而不是直接出 KaTeX HTML
 * KaTeX 的 HTML 输出依赖大量 inline style（strut 高度、分式/上下标定位），而
 * 基础渲染的净化白名单为了安全硬性 `FORBID_ATTR: ['style']`（见 sanitize.ts）。
 * 因此这里让 marked 只产出**空占位元素**（源码以 base64 放 data 属性，经
 * registry 的 `allowAttrs` 增量放行），`activateMath` 在 innerHTML 落地后同步
 * 调 `katex.renderToString` 替换 innerHTML —— KaTeX 输出由库生成、输入 escape、
 * `trust:false`，不经过 DOMPurify 也不会引入用户可控 HTML。
 *
 * 失败（`throwOnError:true` → 抛错）回退「原样公式源码 + 错误样式」，不抛到页面。
 *
 * ## 行内 `$...$` 的防误伤规则（对齐 KaTeX auto-render 思路）
 * - 开 `$` 后不能是空白或另一个 `$`（`$$` 是块级）；
 * - 闭 `$` 前不能是空白/反斜杠（`\$` 是字面量）；
 * - 闭 `$` 后不能是数字或 `$`（`$5 and $10` 这类货币文本不会命中）；
 * - 内容不允许换行；转义字符按 `\x` 整体吞掉。
 */

import katex from 'katex';
import type { TokenizerAndRendererExtension, Tokens } from 'marked';
import katexCss from 'virtual:katex-css';
import { decodeBase64Utf8, encodeBase64Utf8 } from './heavy-shared';

const KATEX_STYLE_ID = 'dci-md-katex-css';
let katexCssInjected = false;

/**
 * 首次出现公式时注入 KaTeX CSS（字体是 CSS 内嵌的 data URI，零网络请求）。
 * 必须插在本插件 `<style id="dsh-codinput-styles">` **之前**：KaTeX 默认样式
 * 先落地，我们在 heavyMarkdownStyles 里的 `.dci-md .katex` 覆盖才能生效。
 */
export function ensureKatexCss(): void {
  if (katexCssInjected || typeof document === 'undefined') return;
  katexCssInjected = true;
  if (document.getElementById(KATEX_STYLE_ID)) return;
  if (typeof katexCss !== 'string' || katexCss === '') return;
  const style = document.createElement('style');
  style.id = KATEX_STYLE_ID;
  style.textContent = katexCss;
  const pluginStyle = document.getElementById('dsh-codinput-styles');
  if (pluginStyle && pluginStyle.parentNode) pluginStyle.parentNode.insertBefore(style, pluginStyle);
  else document.head.appendChild(style);
}

/* ---------- marked 侧：占位元素 ---------- */

function placeholder(tex: string, display: boolean): string {
  const encoded = encodeBase64Utf8(tex);
  const tag = display ? 'div' : 'span';
  const className = display ? 'dci-md-math-block' : 'dci-md-math-inline';
  return `<${tag} class="${className}" data-dci-md-math="${encoded}" data-dci-md-display="${display ? '1' : '0'}"></${tag}>`;
}

/** 块级 `$$ ... $$`（可跨行；要求独占块边界）。 */
const blockMathExtension: TokenizerAndRendererExtension = {
  name: 'dciBlockMath',
  level: 'block',
  start(src: string): number | undefined {
    const index = src.indexOf('$$');
    return index < 0 ? undefined : index;
  },
  tokenizer(src: string): Tokens.Generic | undefined {
    const match = /^\$\$[ \t]*\n?([\s\S]+?)\n?[ \t]*\$\$[ \t]*(?:\n|$)/u.exec(src);
    if (!match) return undefined;
    const tex = match[1].trim();
    if (tex === '') return undefined;
    return { type: 'dciBlockMath', raw: match[0], text: tex };
  },
  renderer(token: Tokens.Generic): string {
    return `${placeholder(String(token['text'] ?? ''), true)}\n`;
  },
};

/** 行内 `$ ... $`（规则见文件头注释）。 */
const inlineMathExtension: TokenizerAndRendererExtension = {
  name: 'dciInlineMath',
  level: 'inline',
  start(src: string): number | undefined {
    const index = src.indexOf('$');
    return index < 0 ? undefined : index;
  },
  tokenizer(src: string): Tokens.Generic | undefined {
    const match = /^\$(?![\s$])((?:\\.|[^$\\\n])+?)(?<![\s\\])\$(?![\d$])/u.exec(src);
    if (!match) return undefined;
    const tex = match[1];
    if (tex.trim() === '') return undefined;
    return { type: 'dciInlineMath', raw: match[0], text: tex };
  },
  renderer(token: Tokens.Generic): string {
    return placeholder(String(token['text'] ?? ''), false);
  },
};

/** 交给 registry 的 `marked.extensions`。 */
export const mathMarkedExtensions: TokenizerAndRendererExtension[] = [blockMathExtension, inlineMathExtension];

/* ---------- 激活期：同步替换为 KaTeX HTML ---------- */

function renderMathNode(node: HTMLElement): void {
  const encoded = node.getAttribute('data-dci-md-math') ?? '';
  const display = node.getAttribute('data-dci-md-display') === '1';
  const tex = decodeBase64Utf8(encoded);
  try {
    const html = katex.renderToString(tex, {
      displayMode: display,
      throwOnError: true,
      trust: false,
      strict: false,
      output: 'htmlAndMathml',
    });
    node.innerHTML = html;
    node.classList.add('dci-md-math-rendered');
  } catch (error) {
    node.classList.add('dci-md-math-error');
    node.textContent = tex;
    node.setAttribute('title', error instanceof Error ? error.message : String(error));
  }
}

/** innerHTML 落地后的公式渲染（同步；基础渲染 `activateMarkdown` 调用）。 */
export function activateMath(root: HTMLElement): void {
  const nodes = root.querySelectorAll<HTMLElement>('[data-dci-md-math]');
  if (nodes.length === 0) return;
  ensureKatexCss();
  for (const node of nodes) {
    try {
      renderMathNode(node);
    } catch {
      // renderMathNode 已处理 KaTeX 解析错误；这里兜底任何意外（不抛给 React）。
    }
  }
}
