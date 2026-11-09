/**
 * Markdown 扩展渲染（heavy）共用的小工具。
 *
 * 为什么要 base64 传源码：KaTeX / Mermaid 的「占位元素」要经过 基础渲染的
 * DOMPurify 白名单（那里有意禁止 style、原始 HTML 一律转义）。把公式/图表源码
 * 编码进 `data-dci-*` 属性，既不会被 HTML 解析阶段破坏（引号/换行/尖括号都安全），
 * 也不会把「看起来像 HTML」的源码交给净化器解释；activate 阶段再解码还原。
 *
 * 只做无 DOM 依赖的纯函数（renderMarkdown 在同步契约里也会调用编码）。
 */

import { escapeHtml } from './sanitize';

export { escapeHtml };

/** 一次 fromCharCode 展开的字节数（远小于调用栈上限，长公式也不会爆栈）。 */
const BASE64_CHUNK = 0x8000;

/** UTF-8 文本 → base64（无 btoa/TextEncoder 的极端环境下返回空串）。 */
export function encodeBase64Utf8(text: string): string {
  if (typeof btoa !== 'function' || typeof TextEncoder === 'undefined') return '';
  try {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (let i = 0; i < bytes.length; i += BASE64_CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK));
    }
    return btoa(binary);
  } catch {
    return '';
  }
}

/** base64 → UTF-8 文本（脏数据返回空串，绝不抛错）。 */
export function decodeBase64Utf8(encoded: string): string {
  if (encoded === '' || typeof atob !== 'function' || typeof TextDecoder === 'undefined') return '';
  try {
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  } catch {
    return '';
  }
}

/** 语言名只放行安全字符后进 class；非法名返回空串（未知语言不崩）。 */
export function safeLanguageClass(language: string): string {
  return /^[a-z0-9_+#.-]{1,40}$/iu.test(language) ? language.toLowerCase() : '';
}
