/**
 * 扩展渲染：Mermaid 图表（异步渲染为 SVG；全内置、离线；仅内置 13 种常用图类型）。
 *
 * 契约分工：
 * - marked 侧（`renderMermaidBlock`）只产出占位 div：源码 base64 进
 *   `data-dci-md-mermaid`，内部先放一份「源码 + mermaid 标签」的可读降级内容
 *   （JS 还没激活时也能读源码，视觉上是普通代码块）；
 * - `activateMermaid`（基础渲染 `activateMarkdown` 调用，DOM 就绪后）：
 *   懒加载 mermaid（dynamic import，esbuild 内联进单文件；首次真正需要时才执行
 *   mermaid 模块初始化的开销，首屏不受影响）→ IntersectionObserver 可见时排队
 *   渲染 → `mermaid.render` → DOMPurify(SVG profile) 净化 → 替换 innerHTML。
 * - `securityLevel: 'strict'`（mermaid 自己也会净化 label）、`theme` 跟随宿主
 *   浅/深色并监听主题变化重渲染；失败回退「源码 + 错误样式」，不抛到页面。
 * - 构建期裁剪见 `scripts/build.mjs`：未内置的图类型被 stub，渲染时抛错走回退；
 *   ELK/cose 布局被移除（请求 ELK 时 mermaid 官方逻辑自动 fallback dagre）。
 *
 * 高度/滚动：SVG 由 CSS 约束 `max-width:100%; height:auto`；容器高度变化交给
 * 宿主滚动容器自然响应（不做滚动同步的额外干预，避免破坏预览分屏同步）。
 */

import * as DOMPurifyModule from 'dompurify';
import { decodeBase64Utf8, encodeBase64Utf8, escapeHtml } from './heavy-shared';

type DomPurifyLike = {
  sanitize(html: string, options?: Record<string, unknown>): string;
  isSupported?: boolean;
};

/** dompurify 的导出形状随打包条件漂移：默认导出与命名空间都兼容（同 基础渲染）。 */
const DOMPurify = ((DOMPurifyModule as unknown as { default?: unknown }).default ??
  DOMPurifyModule) as unknown as DomPurifyLike;

type MermaidModule = typeof import('mermaid');
type MermaidApi = MermaidModule['default'];
type MermaidRenderResult = Awaited<ReturnType<MermaidApi['render']>>;
type MermaidTheme = 'default' | 'dark';

/* ---------- marked 侧：占位元素 ---------- */

/** ```mermaid 代码块 → 占位容器（源码 base64 保存在属性里，等 activate 渲染）。 */
export function renderMermaidBlock(source: string): string {
  const encoded = encodeBase64Utf8(source);
  return [
    '<div class="dci-md-mermaid" data-dci-md-mermaid="',
    encoded,
    '" data-dci-md-state="pending">',
    '<div class="dci-md-mermaid-pending">',
    '<div class="dci-md-mermaid-badge">mermaid</div>',
    `<pre class="dci-md-pre"><code>${escapeHtml(source)}</code></pre>`,
    '</div>',
    '</div>\n',
  ].join('');
}

/* ---------- 懒加载 / 配置 ---------- */

let mermaidPromise: Promise<MermaidApi> | null = null;
let activeTheme: MermaidTheme | null = null;
let parseErrorSilenced = false;
let renderSeq = 0;
let queue: Promise<void> = Promise.resolve();

/** 首次需要时 import('mermaid')（esbuild 打包成单文件内的惰性模块初始化）。 */
function loadMermaid(): Promise<MermaidApi> {
  mermaidPromise ??= import('mermaid').then((module) => module.default);
  return mermaidPromise;
}

/** 串行队列：mermaid 内部有执行队列，这里再串一层避免并发 render 互相踩临时容器。 */
function enqueue(task: () => Promise<void>): void {
  queue = queue.then(task, task).catch(() => {
    // 单个图表失败已在 renderInto 内回退，队列本身不因异常中断。
  });
}

function nextRenderId(): string {
  renderSeq += 1;
  return `dci-md-mermaid-${renderSeq.toString(36)}`;
}

/** 让 mermaid 的 parse 错误静默（错误由我们自己的回退块呈现，不污染 console）。 */
function silenceParseErrors(api: MermaidApi): void {
  if (parseErrorSilenced) return;
  parseErrorSilenced = true;
  try {
    api.setParseErrorHandler?.(() => {});
  } catch {
    // 旧版本没有该 API 时忽略。
  }
}

async function ensureMermaid(theme: MermaidTheme): Promise<MermaidApi> {
  const api = await loadMermaid();
  silenceParseErrors(api);
  if (activeTheme !== theme) {
    api.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme,
      logLevel: 'fatal',
      fontFamily: 'inherit',
      // mermaid 12 起 `flowchart.htmlLabels` 已废弃：必须用**全局 htmlLabels:false**
      // 才会输出 SVG `<text>` 标签。否则节点文字落在 foreignObject 里（DOMPurify
      // SVG 净化会剥掉其 HTML 子节点 → 空框；本地 harness 实测）。
      htmlLabels: false,
      flowchart: { useMaxWidth: true },
      sequence: { useMaxWidth: true },
      gantt: { useMaxWidth: true },
      mindmap: { useMaxWidth: true },
      timeline: { useMaxWidth: true },
    });
    activeTheme = theme;
  }
  return api;
}

/* ---------- 主题检测 ---------- */

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function parseCssColor(value: string): Rgb | null {
  const text = value.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/u.exec(text);
  if (hex) {
    const raw = hex[1] as string;
    const full =
      raw.length === 3
        ? raw
            .split('')
            .map((char) => char + char)
            .join('')
        : raw;
    return {
      r: Number.parseInt(full.slice(0, 2), 16),
      g: Number.parseInt(full.slice(2, 4), 16),
      b: Number.parseInt(full.slice(4, 6), 16),
    };
  }
  const rgb = /^rgba?\(([^)]+)\)$/u.exec(text);
  if (rgb) {
    const parts = (rgb[1] as string)
      .split(/[,/\s]+/u)
      .filter(Boolean)
      .map((part) => Number.parseFloat(part));
    if (parts.length >= 3 && parts.slice(0, 3).every((part) => Number.isFinite(part))) {
      return { r: parts[0] as number, g: parts[1] as number, b: parts[2] as number };
    }
  }
  return null;
}

function relativeLuminance({ r, g, b }: Rgb): number {
  const channel = (value: number): number => {
    const scaled = value / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * 宿主浅/深色判定（按可靠性降级）：
 * 1. `<html data-theme|data-dsw-theme|data-color-scheme>`（主题插件/宿主约定）；
 * 2. `<html class="dark|theme-dark">`；
 * 3. `--dsw-alias-label-primary` 的亮度（深色主题下正文色是浅色）；
 * 4. `prefers-color-scheme`。
 */
export function detectHostTheme(): MermaidTheme {
  if (typeof document === 'undefined') return 'default';
  const root = document.documentElement;
  const attr =
    root.getAttribute('data-theme') ??
    root.getAttribute('data-dsw-theme') ??
    root.getAttribute('data-color-scheme') ??
    '';
  if (/dark/iu.test(attr)) return 'dark';
  if (/light/iu.test(attr)) return 'default';
  if (root.classList.contains('dark') || root.classList.contains('theme-dark')) return 'dark';
  try {
    const probe = getComputedStyle(root).getPropertyValue('--dsw-alias-label-primary').trim();
    const color = probe === '' ? null : parseCssColor(probe);
    if (color) return relativeLuminance(color) > 0.55 ? 'dark' : 'default';
  } catch {
    // 取样式失败（离屏/测试环境）继续降级。
  }
  try {
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'default';
  } catch {
    return 'default';
  }
}

/* ---------- SVG 净化 ---------- */

/**
 * Mermaid 生成的 SVG 走 DOMPurify 的 SVG profile 净化（禁脚本 / 事件属性）。
 * 标签文字已通过全局 `htmlLabels:false` 落成 SVG `<text>`，所以这里继续禁
 * `foreignObject`（零 HTML 注入面；本地 harness 已断言 flowchart/sequence 标签正常）。
 */
const SVG_SANITIZE_OPTIONS: Record<string, unknown> = {
  USE_PROFILES: { svg: true, svgFilters: true },
  FORBID_TAGS: ['script', 'foreignObject'],
  FORBID_ATTR: ['onload', 'onerror', 'onclick', 'onmouseover', 'onfocus', 'onbegin'],
};

function sanitizeSvg(svg: string): string {
  if (typeof DOMPurify.sanitize !== 'function') return svg;
  try {
    return DOMPurify.sanitize(svg, SVG_SANITIZE_OPTIONS);
  } catch {
    return '';
  }
}

/* ---------- 渲染 ---------- */

function errorMarkup(source: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return [
    '<div class="dci-md-mermaid-error">',
    '<div class="dci-md-mermaid-error-head">Mermaid 渲染失败</div>',
    `<div class="dci-md-mermaid-error-msg">${escapeHtml(message)}</div>`,
    `<pre class="dci-md-pre"><code>${escapeHtml(source)}</code></pre>`,
    '</div>',
  ].join('');
}

/** mermaid.render 会在 body 里建临时容器；无论成败都清掉本轮 id 的残留节点。 */
function cleanupTempNodes(id: string): void {
  if (typeof document === 'undefined') return;
  for (const candidate of [id, `d${id}`]) {
    const node = document.getElementById(candidate);
    if (node && node.parentElement === document.body) node.remove();
  }
}

async function renderInto(element: HTMLElement): Promise<void> {
  if (!element.isConnected) return;
  const source = decodeBase64Utf8(element.getAttribute('data-dci-md-mermaid') ?? '');
  if (source.trim() === '') {
    element.setAttribute('data-dci-md-state', 'error');
    element.innerHTML = errorMarkup(source, new Error('empty mermaid source'));
    return;
  }
  element.setAttribute('data-dci-md-state', 'rendering');
  const id = nextRenderId();
  try {
    const api = await ensureMermaid(detectHostTheme());
    const result: MermaidRenderResult = await api.render(id, source);
    if (!element.isConnected) return;
    const svg = sanitizeSvg(result.svg ?? '');
    if (svg === '') throw new Error('mermaid: empty svg');
    element.innerHTML = svg;
    element.setAttribute('data-dci-md-state', 'rendered');
    try {
      result.bindFunctions?.(element);
    } catch {
      // 交互绑定失败不影响静态 SVG 展示。
    }
  } catch (error) {
    if (!element.isConnected) return;
    element.setAttribute('data-dci-md-state', 'error');
    element.innerHTML = errorMarkup(source, error);
  } finally {
    cleanupTempNodes(id);
  }
}

/* ---------- 主题跟随 ---------- */

/** 监听宿主主题变化；变化后重新 initialize 并重渲染本根内已渲染的图表。 */
function watchTheme(root: HTMLElement, isDisposed: () => boolean): () => void {
  if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return () => {};
  let scheduled = false;
  const rerender = (): void => {
    if (scheduled || isDisposed()) return;
    scheduled = true;
    const run = (): void => {
      scheduled = false;
      if (isDisposed()) return;
      const theme = detectHostTheme();
      if (theme === activeTheme) return;
      for (const node of root.querySelectorAll<HTMLElement>('[data-dci-md-state="rendered"]')) {
        if (!node.hasAttribute('data-dci-md-mermaid')) continue;
        node.setAttribute('data-dci-md-state', 'pending');
        enqueue(() => (isDisposed() ? Promise.resolve() : renderInto(node)));
      }
    };
    // 等宿主把 theme 属性/class 全部落定再读 computed style：延迟一拍再查。
    // 用 setTimeout 而不是 rAF：无头/后台标签页里 rAF 可能被节流甚至不调度，
    // 主题重渲染会因此丢失（本地 harness 实测）；16ms 定时器在两种环境下都稳。
    window.setTimeout(run, 16);
  };
  const observer = new MutationObserver(rerender);
  // 等主题属性/class 全部落定后再读 computed style（rAF 已延迟一拍）。
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'data-theme', 'data-dsw-theme', 'data-color-scheme'],
  });
  let media: MediaQueryList | null = null;
  try {
    media = matchMedia('(prefers-color-scheme: dark)');
  } catch {
    media = null;
  }
  const onMediaChange = (): void => rerender();
  media?.addEventListener?.('change', onMediaChange);
  return () => {
    observer.disconnect();
    media?.removeEventListener?.('change', onMediaChange);
  };
}

/* ---------- 激活期入口 ---------- */

/**
 * innerHTML 落地后的 Mermaid 激活：可见时懒渲染 + 主题跟随。
 * 返回 cleanup（组件下次渲染/卸载时调用）：置 disposed、断开 observer；
 * 已排队但未开始的渲染会因 disposed 被丢弃（mermaid.render 本身不可中断）。
 */
export function activateMermaid(root: HTMLElement): (() => void) | undefined {
  const nodes = root.querySelectorAll<HTMLElement>('[data-dci-md-mermaid]');
  if (nodes.length === 0) return undefined;
  let disposed = false;
  const renderNode = (element: HTMLElement): void => {
    if (disposed) return;
    if (element.getAttribute('data-dci-md-state') !== 'pending') return;
    enqueue(() => (disposed ? Promise.resolve() : renderInto(element)));
  };

  let observer: IntersectionObserver | null = null;
  if (typeof IntersectionObserver === 'function') {
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          observer?.unobserve(entry.target);
          renderNode(entry.target as HTMLElement);
        }
      },
      // 提前 320px 开始渲染：滚动接近时 SVG 已就绪，减少可见的高度跳变。
      { rootMargin: '320px 0px' },
    );
    for (const node of nodes) observer.observe(node);
  } else {
    for (const node of nodes) renderNode(node);
  }

  const stopWatchingTheme = watchTheme(root, () => disposed);
  return () => {
    disposed = true;
    observer?.disconnect();
    stopWatchingTheme();
  };
}
