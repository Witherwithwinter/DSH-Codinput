/**
 * 扩展渲染：代码块高亮（highlight.js 常用语言子集，全部打进单文件、离线可用）。
 *
 * 产出（经 基础渲染的 marked renderer 覆盖，再交给 DOMPurify 白名单）：
 *   <div class="dci-md-codeblock">
 *     <div class="dci-md-codebar"><span class="dci-md-codelang">js</span>
 *       <button class="dci-md-copy" …>…</button></div>
 *     <pre class="dci-md-pre"><code class="hljs language-js">…</code></pre>
 *   </div>
 * 输出只有 class 与文本（hljs 的 span 只带 class），DOMPurify 白名单无需新增
 * 标签；复制按钮的点击在 `activateCodeBlocks` 里用事件委托接（返回 cleanup）。
 *
 * `mermaid` 语言块不在本模块渲染，交给 `mermaid.ts` 的占位元素（异步渲染）。
 */

import hljs from 'highlight.js/lib/core';
import type { LanguageFn } from 'highlight.js';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import clojure from 'highlight.js/lib/languages/clojure';
import cmake from 'highlight.js/lib/languages/cmake';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import dart from 'highlight.js/lib/languages/dart';
import diff from 'highlight.js/lib/languages/diff';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import elixir from 'highlight.js/lib/languages/elixir';
import go from 'highlight.js/lib/languages/go';
import gradle from 'highlight.js/lib/languages/gradle';
import graphql from 'highlight.js/lib/languages/graphql';
import groovy from 'highlight.js/lib/languages/groovy';
import haskell from 'highlight.js/lib/languages/haskell';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import julia from 'highlight.js/lib/languages/julia';
import kotlin from 'highlight.js/lib/languages/kotlin';
import less from 'highlight.js/lib/languages/less';
import lua from 'highlight.js/lib/languages/lua';
import makefile from 'highlight.js/lib/languages/makefile';
import markdown from 'highlight.js/lib/languages/markdown';
import matlab from 'highlight.js/lib/languages/matlab';
import nginx from 'highlight.js/lib/languages/nginx';
import perl from 'highlight.js/lib/languages/perl';
import php from 'highlight.js/lib/languages/php';
import plaintext from 'highlight.js/lib/languages/plaintext';
import powershell from 'highlight.js/lib/languages/powershell';
import protobuf from 'highlight.js/lib/languages/protobuf';
import python from 'highlight.js/lib/languages/python';
import r from 'highlight.js/lib/languages/r';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import scala from 'highlight.js/lib/languages/scala';
import scss from 'highlight.js/lib/languages/scss';
import shell from 'highlight.js/lib/languages/shell';
import sql from 'highlight.js/lib/languages/sql';
import swift from 'highlight.js/lib/languages/swift';
import typescript from 'highlight.js/lib/languages/typescript';
import vim from 'highlight.js/lib/languages/vim';
import wasm from 'highlight.js/lib/languages/wasm';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import type { Tokens } from 'marked';
import { copyTextToClipboard } from './index';
import { escapeHtml, safeLanguageClass } from './heavy-shared';
import { renderMermaidBlock } from './mermaid';

/** 内置语言表（46 种常用；只注册一次）。 */
const LANGUAGES: ReadonlyArray<readonly [string, LanguageFn]> = [
  ['xml', xml],
  ['css', css],
  ['scss', scss],
  ['less', less],
  ['javascript', javascript],
  ['typescript', typescript],
  ['json', json],
  ['yaml', yaml],
  ['bash', bash],
  ['shell', shell],
  ['powershell', powershell],
  ['python', python],
  ['java', java],
  ['c', c],
  ['cpp', cpp],
  ['csharp', csharp],
  ['go', go],
  ['rust', rust],
  ['kotlin', kotlin],
  ['swift', swift],
  ['ruby', ruby],
  ['php', php],
  ['sql', sql],
  ['markdown', markdown],
  ['diff', diff],
  ['dockerfile', dockerfile],
  ['ini', ini],
  ['makefile', makefile],
  ['lua', lua],
  ['r', r],
  ['perl', perl],
  ['graphql', graphql],
  ['protobuf', protobuf],
  ['plaintext', plaintext],
  ['dart', dart],
  ['scala', scala],
  ['elixir', elixir],
  ['haskell', haskell],
  ['clojure', clojure],
  ['groovy', groovy],
  ['julia', julia],
  ['matlab', matlab],
  ['nginx', nginx],
  ['vim', vim],
  ['cmake', cmake],
  ['gradle', gradle],
  ['wasm', wasm],
];

for (const [name, definition] of LANGUAGES) {
  try {
    hljs.registerLanguage(name, definition);
  } catch {
    // 单个语言注册失败不应拖垮整块高亮（未知语言回退纯文本）。
  }
}

/** 代码块别名 → hljs 语言名（hljs 自身的 aliases 之外再补一批常见写法）。 */
const LANGUAGE_ALIASES: Readonly<Record<string, string>> = {
  html: 'xml',
  htm: 'xml',
  svg: 'xml',
  vue: 'xml',
  md: 'markdown',
  yml: 'yaml',
  sh: 'bash',
  zsh: 'bash',
  ps1: 'powershell',
  pwsh: 'powershell',
  docker: 'dockerfile',
  make: 'makefile',
  'c++': 'cpp',
  'c#': 'csharp',
  cs: 'csharp',
  rs: 'rust',
  py: 'python',
  rb: 'ruby',
  kt: 'kotlin',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  jsonc: 'json',
  text: 'plaintext',
  txt: 'plaintext',
  plain: 'plaintext',
  'objective-c': 'objectivec',
};

/** 解析代码块语言：返回 hljs 可高亮的语言名；未知返回空串。 */
export function resolveHighlightLanguage(raw: string): string {
  const normalized = raw.trim().toLowerCase();
  if (normalized === '') return '';
  const candidates = [normalized, LANGUAGE_ALIASES[normalized] ?? ''];
  for (const candidate of candidates) {
    if (candidate === '') continue;
    try {
      if (hljs.getLanguage(candidate)) return candidate;
    } catch {
      // getLanguage 对奇怪名字可能抛错：当作未知继续。
    }
  }
  return '';
}

export interface CodeHighlightResult {
  /** 已在内部转义过的 HTML（hljs span / 纯文本）。 */
  html: string;
  /** 实际使用的 hljs 语言名（未知为空串）。 */
  language: string;
  /** 是否真的走了高亮（未知语言为 false）。 */
  known: boolean;
}

/** 高亮一段源码；未知语言 / 高亮异常一律回退「转义纯文本」。 */
export function highlightCode(source: string, rawLanguage: string): CodeHighlightResult {
  const language = resolveHighlightLanguage(rawLanguage);
  if (language === '') return { html: escapeHtml(source), language: '', known: false };
  try {
    const result = hljs.highlight(source, { language, ignoreIllegals: true });
    return { html: result.value, language, known: true };
  } catch {
    return { html: escapeHtml(source), language, known: false };
  }
}

/** 复制按钮文案：宿主语言是 en 时用英文，其余中文（插件默认中文环境）。 */
function copyLabels(): { copy: string; copied: string } {
  let language = 'zh';
  if (typeof document !== 'undefined') {
    language = (document.documentElement.getAttribute('lang') ?? '').toLowerCase();
  }
  if (language === '') {
    try {
      language = (navigator.language ?? 'zh').toLowerCase();
    } catch {
      language = 'zh';
    }
  }
  return language.startsWith('en') ? { copy: 'Copy', copied: 'Copied' } : { copy: '复制', copied: '已复制' };
}

/** marked renderer.code 的实现：chrome（语言标签 + 复制按钮）+ 高亮代码。 */
export function renderCodeBlock(token: Tokens.Code): string {
  const source = typeof token.text === 'string' ? token.text : '';
  const info = typeof token.lang === 'string' ? token.lang.trim() : '';
  const requested = info === '' ? '' : (info.split(/\s+/u)[0] ?? '');
  if (requested.toLowerCase() === 'mermaid') return renderMermaidBlock(source);

  const result = highlightCode(source, requested);
  const { copy } = copyLabels();
  const label = requested === '' ? 'text' : requested;
  const hljsClass = result.known ? 'hljs ' : '';
  const languageClass = result.language === '' ? '' : `language-${safeLanguageClass(result.language)}`;
  return [
    '<div class="dci-md-codeblock">',
    '<div class="dci-md-codebar">',
    `<span class="dci-md-codelang">${escapeHtml(label)}</span>`,
    `<button type="button" class="dci-md-copy" title="复制代码 / Copy code"><span class="dci-md-copy-glyph" aria-hidden="true"></span><span class="dci-md-copy-text">${escapeHtml(copy)}</span></button>`,
    '</div>',
    `<pre class="dci-md-pre"><code class="${hljsClass}${languageClass}">${result.html}</code></pre>`,
    '</div>\n',
  ].join('');
}

/* ---------- 激活期：复制按钮（事件委托，返回 cleanup） ---------- */

const COPY_FEEDBACK_MS = 1200;

function flashCopied(button: HTMLButtonElement, timers: Set<number>): void {
  const { copy, copied } = copyLabels();
  button.dataset.dciCopied = 'true';
  const text = button.querySelector('.dci-md-copy-text');
  if (text) text.textContent = copied;
  const timer = window.setTimeout(() => {
    timers.delete(timer);
    if (!button.isConnected) return;
    delete button.dataset.dciCopied;
    if (text) text.textContent = copy;
  }, COPY_FEEDBACK_MS);
  timers.add(timer);
}

/**
 * innerHTML 落地后的复制按钮激活（基础渲染 `activateMarkdown` 调用）。
 * 没有代码块时零开销；返回 cleanup 摘掉监听与计时器。
 */
export function activateCodeBlocks(root: HTMLElement): (() => void) | undefined {
  if (!root.querySelector('.dci-md-copy')) return undefined;
  const timers = new Set<number>();
  const onClick = (event: Event): void => {
    const target = event.target instanceof Element ? event.target.closest('.dci-md-copy') : null;
    if (!(target instanceof HTMLButtonElement) || !root.contains(target)) return;
    const block = target.closest('.dci-md-codeblock');
    const code = block ? block.querySelector('code') : null;
    if (!code) return;
    const text = code.textContent ?? '';
    void copyTextToClipboard(text).then((ok) => {
      if (ok) flashCopied(target, timers);
    });
  };
  root.addEventListener('click', onClick);
  return () => {
    root.removeEventListener('click', onClick);
    for (const timer of timers) window.clearTimeout(timer);
    timers.clear();
  };
}
