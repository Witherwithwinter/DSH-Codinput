/**
 * 扩展渲染 Heavy 扩展的统一注册入口 + 自有 CSS。
 *
 * 三个 registry 扩展（基础渲染 `registerMarkdownExtension`）：
 * - `dci-heavy-code`    —— marked.renderer.code 覆盖（highlight.js 高亮 + 语言标签
 *                           + 复制按钮），activate 里挂复制事件委托；
 * - `dci-heavy-math`    —— marked 行内/块级 `$...$` 占位扩展，activate 里同步
 *                           `katex.renderToString` 替换（字体 CSS 全内置）；
 * - `dci-heavy-mermaid` —— 只做 allowAttrs（占位属性）+ activate 异步渲染 SVG。
 *
 * 调用点：`src/client/index.tsx` 的 apply() 里调一次（幂等，返回注销函数）。
 * CSS 由 `src/client/styles.ts` 追加拼接（本模块只导出字符串，不自己注入全局样式，
 * 避免与 基础渲染的样式注入顺序打架）；KaTeX 自带 CSS 在首次用到公式时懒注入。
 */

import { registerMarkdownExtension } from './index';
import { activateCodeBlocks, renderCodeBlock } from './code';
import { activateMath, mathMarkedExtensions } from './math';
import { activateMermaid } from './mermaid';

let disposer: (() => void) | null = null;

/**
 * 注册 扩展渲染的三个渲染扩展（幂等）。
 * @returns 注销函数（再次注册会先复用同一个注册集）。
 */
export function registerHeavyMarkdown(): () => void {
  if (disposer) return disposer;
  const offs: (() => void)[] = [];
  try {
    offs.push(
      registerMarkdownExtension({
        name: 'dci-heavy-code',
        marked: { renderer: { code: renderCodeBlock } },
        activate: activateCodeBlocks,
      }),
    );
    offs.push(
      registerMarkdownExtension({
        name: 'dci-heavy-math',
        marked: { extensions: mathMarkedExtensions },
        allowAttrs: ['data-dci-md-math', 'data-dci-md-display'],
        activate: activateMath,
      }),
    );
    offs.push(
      registerMarkdownExtension({
        name: 'dci-heavy-mermaid',
        allowAttrs: ['data-dci-md-mermaid', 'data-dci-md-state'],
        activate: activateMermaid,
      }),
    );
  } catch (error) {
    for (const off of offs) {
      try {
        off();
      } catch {
        // 回滚失败不掩盖原始错误。
      }
    }
    throw error;
  }
  disposer = () => {
    for (const off of offs) {
      try {
        off();
      } catch {
        // 注销异常不应中断组件卸载。
      }
    }
    disposer = null;
  };
  return disposer;
}

/** 扩展渲染 自有样式（追加在 基础渲染 markdownStyles 之后，不动既有段）。 */
export const heavyMarkdownStyles = `
/* ===== 扩展渲染：代码块（highlight.js + 语言标签 + 复制按钮）===== */
.dci-md .dci-md-codeblock { margin: 0.7em 0; border-radius: var(--dsw-radius-sm, 8px); overflow: hidden;
  background: var(--dsw-alias-markdown-code-block, color-mix(in srgb, currentColor 6%, transparent));
  border: 0.5px solid var(--dsw-alias-border-l1, color-mix(in srgb, currentColor 12%, transparent)); }
.dci-md .dci-md-codebar { display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 3px 8px 3px 10px; border-bottom: 0.5px solid var(--dsw-alias-border-l1, color-mix(in srgb, currentColor 10%, transparent));
  font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-tertiary, color-mix(in srgb, currentColor 62%, transparent)); }
.dci-md .dci-md-codelang { font-family: var(--ds-font-family-code, ui-monospace, monospace); letter-spacing: 0.02em; }
.dci-md .dci-md-copy { display: inline-flex; align-items: center; gap: 4px; padding: 1px 6px; border: none; border-radius: 5px;
  background: transparent; color: inherit; font: inherit; cursor: pointer; transition: color 0.12s, background-color 0.12s; }
.dci-md .dci-md-copy:hover { background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, currentColor 10%, transparent));
  color: var(--dsw-alias-label-primary, currentColor); }
.dci-md .dci-md-copy:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary, #4c8dff)); outline-offset: 1px; }
.dci-md .dci-md-copy-glyph { width: 12px; height: 12px; flex: none; background-color: currentColor;
  -webkit-mask: var(--dci-md-icon-copy) center / 12px 12px no-repeat; mask: var(--dci-md-icon-copy) center / 12px 12px no-repeat; }
.dci-md .dci-md-copy[data-dci-copied='true'] { color: var(--dsw-alias-state-success-primary, #2f9e6e); }
.dci-md .dci-md-copy[data-dci-copied='true'] .dci-md-copy-glyph {
  -webkit-mask-image: var(--dci-md-icon-check); mask-image: var(--dci-md-icon-check); }
.dci-md .dci-md-copy-text { white-space: nowrap; }
.dci-md .dci-md-pre { margin: 0; padding: 10px 12px; overflow-x: auto; overflow-y: hidden; background: transparent;
  border: 0; border-radius: 0; font-family: var(--ds-font-family-code, ui-monospace, monospace); font-size: 12px; line-height: 1.55; }
.dci-md .dci-md-pre code { padding: 0; border: 0; background: transparent; font: inherit; white-space: pre; }

/* highlight.js token 配色：全部走宿主 --dsw-* 语义 token，浅/深色自动适配；
   token 缺失时用 currentColor 混合回退，保证可读。 */
.dci-md .hljs { color: var(--dsw-alias-label-primary, currentColor); background: transparent; }
.dci-md .hljs-comment, .dci-md .hljs-quote { color: var(--dsw-alias-label-tertiary, color-mix(in srgb, currentColor 55%, transparent)); font-style: italic; }
.dci-md .hljs-keyword, .dci-md .hljs-selector-tag, .dci-md .hljs-literal, .dci-md .hljs-doctag,
.dci-md .hljs-name, .dci-md .hljs-tag { color: var(--dsw-alias-state-business-primary, #79a7ff); }
.dci-md .hljs-string, .dci-md .hljs-regexp, .dci-md .hljs-addition, .dci-md .hljs-attribute,
.dci-md .hljs-meta .hljs-string, .dci-md .hljs-template-tag { color: var(--dsw-alias-state-success-primary, #6fcf97); }
.dci-md .hljs-number, .dci-md .hljs-symbol, .dci-md .hljs-bullet, .dci-md .hljs-variable,
.dci-md .hljs-template-variable, .dci-md .hljs-selector-attr, .dci-md .hljs-selector-pseudo,
.dci-md .hljs-link { color: var(--dsw-alias-state-warn-primary, #e5b567); }
.dci-md .hljs-title, .dci-md .hljs-title.class_, .dci-md .hljs-title.function_, .dci-md .hljs-section,
.dci-md .hljs-selector-id { color: var(--dsw-alias-state-business-primary, #79a7ff); font-weight: 600; }
.dci-md .hljs-attr, .dci-md .hljs-property, .dci-md .hljs-params, .dci-md .hljs-subst { color: var(--dsw-alias-label-primary, currentColor); }
.dci-md .hljs-built_in, .dci-md .hljs-type, .dci-md .hljs-class .hljs-title { color: var(--dsw-alias-state-success-primary, #6fcf97); }
.dci-md .hljs-meta { color: var(--dsw-alias-label-tertiary, color-mix(in srgb, currentColor 58%, transparent)); }
.dci-md .hljs-deletion { color: var(--dsw-alias-state-error-primary, #e5484d); }
.dci-md .hljs-emphasis { font-style: italic; }
.dci-md .hljs-strong { font-weight: 700; }

/* ===== 扩展渲染：KaTeX 数学（公式 CSS 本体懒注入，这里只做容器与主题微调）===== */
.dci-md .dci-md-math-inline { display: inline; }
.dci-md .dci-md-math-block { display: block; margin: 0.65em 0; text-align: center; overflow-x: auto; overflow-y: hidden; }
.dci-md .katex { font-size: 1.06em; }
.dci-md .katex-display { margin: 0.35em 0; }
.dci-md .dci-md-math-error { display: inline-block; max-width: 100%; padding: 1px 5px; border-radius: 4px;
  color: var(--dsw-alias-state-error-primary, #e5484d);
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #e5484d) 10%, transparent);
  font-family: var(--ds-font-family-code, ui-monospace, monospace); font-size: 0.92em; white-space: pre-wrap; overflow-wrap: anywhere; }
.dci-md .dci-md-math-block.dci-md-math-error { display: block; text-align: left; padding: 6px 8px; }

/* ===== 扩展渲染：Mermaid（占位源码 → 异步 SVG / 错误回退）===== */
.dci-md .dci-md-mermaid { position: relative; margin: 0.7em 0; border-radius: var(--dsw-radius-sm, 8px);
  border: 0.5px solid var(--dsw-alias-border-l1, color-mix(in srgb, currentColor 12%, transparent));
  background: var(--dsw-alias-markdown-code-block, color-mix(in srgb, currentColor 4%, transparent));
  overflow-x: auto; overflow-y: hidden; }
.dci-md .dci-md-mermaid[data-dci-md-state='rendered'] { display: flex; justify-content: center; padding: 6px 8px;
  border-color: transparent; background: transparent; }
.dci-md .dci-md-mermaid[data-dci-md-state='rendered'] svg { max-width: 100%; height: auto; }
.dci-md .dci-md-mermaid[data-dci-md-state='rendered'] .dci-md-mermaid-pending { display: none; }
.dci-md .dci-md-mermaid[data-dci-md-state='error'] { padding: 8px 10px;
  border-left: 3px solid var(--dsw-alias-state-error-primary, #e5484d); }
.dci-md .dci-md-mermaid-badge { display: inline-block; margin: 0 0 2px 10px; padding: 1px 6px; border-radius: 999px;
  font-family: var(--ds-font-family-code, ui-monospace, monospace); font-size: 10px; line-height: 14px;
  color: var(--dsw-alias-state-business-primary, #79a7ff);
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #79a7ff) 14%, transparent); }
.dci-md .dci-md-mermaid-pending .dci-md-pre { padding-top: 4px; }
.dci-md .dci-md-mermaid[data-dci-md-state='rendering'] .dci-md-mermaid-badge { opacity: 0.65; }
.dci-md .dci-md-mermaid-error { color: var(--dsw-alias-label-primary, currentColor); }
.dci-md .dci-md-mermaid-error-head { font-size: 12px; font-weight: 600; line-height: 18px;
  color: var(--dsw-alias-state-error-primary, #e5484d); }
.dci-md .dci-md-mermaid-error-msg { margin: 2px 0 4px; font-size: 11px; line-height: 16px; white-space: pre-wrap;
  overflow-wrap: anywhere; color: var(--dsw-alias-label-tertiary, color-mix(in srgb, currentColor 60%, transparent)); }
.dci-md .dci-md-mermaid-error .dci-md-pre { padding-left: 0; padding-right: 0; }

/* 复制/成功图标（CSS mask + data URI，不往 DOM 里塞 SVG，净化白名单保持收敛）。 */
.dci-md { --dci-md-icon-copy: url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2016%2016'%20fill='none'%20stroke='black'%20stroke-width='1.4'%3E%3Crect%20x='5.75'%20y='5.75'%20width='7.5'%20height='7.5'%20rx='1.6'/%3E%3Cpath%20d='M10.25%205.75V4.1A1.6%201.6%200%200%200%208.65%202.5H4.1A1.6%201.6%200%200%200%202.5%204.1v4.55a1.6%201.6%200%200%200%201.6%201.6h1.65'/%3E%3C/svg%3E");
  --dci-md-icon-check: url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2016%2016'%20fill='none'%20stroke='black'%20stroke-width='1.8'%20stroke-linecap='round'%20stroke-linejoin='round'%3E%3Cpath%20d='M2.8%208.6l3.2%203.1%207.2-7.4'/%3E%3C/svg%3E"); }
`;
