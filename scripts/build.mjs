// 客户端产物构建：esbuild bundle + cjs，包成 window.__ModuleLoader__.load。
// 外部依赖只有平台模块（宿主 PLATFORM_MODULES 共享表）：react / react-dom，以及
// 官方原语库 @deepseek-ai/dsh-client-ui-primitives（Tooltip / ImageLightbox 等——
// 「能不复刻就不复刻」，直接用宿主同一份官方实现）。
// CodeMirror / marked / dompurify / highlight.js / katex / mermaid 一律随包内置。
//
// 默认出**发布产物**：压缩、无 sourcemap（源码随包在 src/，不必把内联 sourcemap
// 打进产物——那是 1MB 级的体积）。开发调试用 --dev（npm run build:dev）：
// 不压缩 + 内联 sourcemap，可在浏览器里直接看到 TypeScript 源码。
//
// 构建期 plugins（保证单文件 lib/client.js）：
// - katex-css-inline：把 node_modules/katex/dist/katex.min.css 变成虚拟模块
//   `virtual:katex-css`，其中 20 个 woff2 字体全部内联为 data URI、woff/ttf 回退项
//   删除 → 运行时零网络请求（离线可用）。替换或残留引用会直接让构建失败。
// - mermaid-trim：构建期把未内置图类型 stub 成 `diagram = undefined`，并动态定位
//   mermaid.core chunks 中携带 ELK/cose 布局开关 `...true ? [` 的唯一 chunk（不写死
//   版本哈希文件名），替换为 `...false ? [` 移除 ELK/cose-bilkent 布局 loader（省 ~2MB）。
// - css-template-minify：发布构建时用 esbuild CSS 压缩器裁剪内联 CSS 模板字符串
//   （styles.ts / markdown/styles.ts / markdown/heavy.ts）里的中文注释与多余空白，
//   同时在构建期校验 CSS 语法。
import { execFileSync } from 'node:child_process';
import { build, transform } from 'esbuild';
import { mkdir, stat } from 'node:fs/promises';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dev = process.argv.includes('--dev');
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const rootDir = fileURLToPath(new URL('..', import.meta.url));
const nodeModulesDir = join(rootDir, 'node_modules');
const katexDistDir = join(nodeModulesDir, 'katex', 'dist');
const mermaidDistDir = join(nodeModulesDir, 'mermaid', 'dist');

/* =====================================================================
 * plugin 1：KaTeX CSS + woff2 字体内联
 * ===================================================================== */

const KATEX_CSS_PATH = join(katexDistDir, 'katex.min.css');
const KATEX_FONTS_DIR = join(katexDistDir, 'fonts');
/** `url(fonts/X.woff2)` → data URI。 */
const KATEX_WOFF2_URL = /url\((["']?)fonts\/([A-Za-z0-9_-]+\.woff2)\1\)/g;
/** 同一条 @font-face 里 woff/ttf 回退项（woff2 之后紧跟，只留 woff2）。 */
const KATEX_WOFF_TTF_FALLBACK =
  /,url\((["']?)fonts\/[A-Za-z0-9_-]+\.woff\1\) format\("woff"\),url\((["']?)fonts\/[A-Za-z0-9_-]+\.ttf\2\) format\("truetype"\)/g;

function renderKatexCss() {
  const raw = readFileSync(KATEX_CSS_PATH, 'utf8');
  const missing = [];
  let inlined = 0;
  let css = raw.replace(KATEX_WOFF2_URL, (match, _quote, file) => {
    const fontPath = join(KATEX_FONTS_DIR, file);
    if (!existsSync(fontPath)) {
      missing.push(file);
      return match;
    }
    inlined += 1;
    return `url(data:font/woff2;base64,${readFileSync(fontPath).toString('base64')})`;
  });
  css = css.replace(KATEX_WOFF_TTF_FALLBACK, '');
  const leftover = [...css.matchAll(/url\((["']?)fonts\/([^)'"]+)\1\)/g)].map((match) => match[2]);
  if (missing.length > 0) {
    throw new Error(`[katex-css-inline] 缺少 woff2 字体文件：${missing.join(', ')}`);
  }
  if (leftover.length > 0) {
    throw new Error(`[katex-css-inline] 仍有未内联的字体引用：${leftover.slice(0, 5).join(', ')}`);
  }
  if (inlined === 0) {
    throw new Error('[katex-css-inline] 未替换到任何 woff2 字体（KaTeX 版本/目录结构变化？）');
  }
  console.log(
    `[dsh-codinput] KaTeX CSS 内联 ${inlined} 个 woff2 字体 → ${(css.length / 1024).toFixed(0)} KiB（无运行时网络请求）`,
  );
  return css;
}

/** KaTeX CSS/字体离线内联 plugin（`virtual:katex-css` 虚拟模块）。 */
export function createKatexCssPlugin() {
  return {
    name: 'katex-css-inline',
    setup(buildApi) {
      buildApi.onResolve({ filter: /^virtual:katex-css$/ }, () => ({ path: 'katex-css', namespace: 'virtual-katex' }));
      buildApi.onLoad({ filter: /.*/, namespace: 'virtual-katex' }, () => ({
        contents: `export default ${JSON.stringify(renderKatexCss())};`,
        loader: 'js',
        watchFiles: [KATEX_CSS_PATH],
      }));
    },
  };
}

/* =====================================================================
 * plugin 2：mermaid 图类型裁剪 + ELK/cose 布局移除
 * ===================================================================== */

/** 内置的 Mermaid 图类型（其余在构建期 stub；渲染时走源码+错误样式回退）。 */
const MERMAID_KEEP = new Set([
  'flowchart-v2',
  'flowchart-elk',
  'sequence',
  'classDiagram',
  'stateDiagram',
  'er',
  'gantt',
  'pie',
  'journey',
  'gitGraph',
  'info',
  'mindmap',
  'timeline',
]);

const MERMAID_CORE_ENTRY = join(mermaidDistDir, 'mermaid.core.mjs');
const MERMAID_CHUNKS_DIR = join(mermaidDistDir, 'chunks', 'mermaid.core');
const MERMAID_LAYOUT_SWITCH = '...true ? [';

/**
 * 动态定位携带 ELK/cose-bilkent 布局开关 `...true ? [` 的唯一 chunk，
 * 不再硬编码特定 patch 版本的哈希文件名（如 chunk-CFHHFPVC.mjs）。
 * 若匹配数为 0 或 >1 立即抛错，防止 mermaid 升级后裁剪静默失效。
 */
function findMermaidLayoutChunk() {
  const matches = [];
  for (const name of readdirSync(MERMAID_CHUNKS_DIR)) {
    if (!name.endsWith('.mjs')) continue;
    const full = join(MERMAID_CHUNKS_DIR, name);
    const source = readFileSync(full, 'utf8');
    if (source.includes(MERMAID_LAYOUT_SWITCH)) {
      matches.push({ name, full, source });
    }
  }
  if (matches.length !== 1) {
    throw new Error(
      `[mermaid-trim] 期望在 ${MERMAID_CHUNKS_DIR} 中找到唯一含 \`${MERMAID_LAYOUT_SWITCH}\` 的布局 chunk，实际找到 ${matches.length} 个（${matches.map((m) => m.name).join(', ')}）`,
    );
  }
  return matches[0];
}

/**
 * 从 mermaid.core.mjs 里解析「图类型 id → dynamic import 的 chunk 文件」映射。
 * @returns {Map<string, Set<string>>} chunk 文件名 → 图类型 id 集合
 */
function readMermaidDiagramChunks() {
  const lines = readFileSync(MERMAID_CORE_ENTRY, 'utf8').split('\n');
  /** @type {Map<string, Set<string>>} */
  const byFile = new Map();
  for (let index = 0; index < lines.length; index += 1) {
    const imported = /await import\("\.\/chunks\/mermaid\.core\/([^"]+)\.mjs"\)/.exec(lines[index]);
    if (!imported) continue;
    let diagramId = null;
    for (let back = index; back >= Math.max(0, index - 25); back -= 1) {
      const declared = /^var id\d* = "([^"]+)"/.exec(lines[back]);
      if (declared) {
        diagramId = declared[1];
        break;
      }
    }
    if (!diagramId) continue;
    const file = `${imported[1]}.mjs`;
    const ids = byFile.get(file);
    if (ids) ids.add(diagramId);
    else byFile.set(file, new Set([diagramId]));
  }
  return byFile;
}

/** Mermaid 图类型裁剪 + ELK/cose 布局移除 plugin。 */
export function createMermaidTrimPlugin() {
  const chunkIds = readMermaidDiagramChunks();
  const knownIds = new Set([...chunkIds.values()].flatMap((ids) => [...ids]));
  for (const wanted of MERMAID_KEEP) {
    if (!knownIds.has(wanted)) {
      throw new Error(
        `[mermaid-trim] 内置图类型 "${wanted}" 在 mermaid 入口里找不到对应 chunk（mermaid 版本变化？）`,
      );
    }
  }
  const layoutChunk = findMermaidLayoutChunk();
  const layoutFileFilter = new RegExp(`${layoutChunk.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
  const stubbed = knownIds.size - MERMAID_KEEP.size;
  let patchedLayout = null;

  return {
    name: 'mermaid-trim',
    setup(buildApi) {
      // 未内置图类型的 dynamic import chunk → 空图 stub（保留 detector，渲染时抛错）。
      buildApi.onResolve({ filter: /chunks[\\/]mermaid\.core[\\/][^\\/]+\.mjs$/ }, (args) => {
        const file = basename(args.path);
        const ids = chunkIds.get(file);
        if (!ids) return undefined; // 共享工具 chunk：正常打包
        for (const id of ids) if (MERMAID_KEEP.has(id)) return undefined;
        return { path: `stub:${file}`, namespace: 'mermaid-trim-stub' };
      });
      buildApi.onLoad({ filter: /.*/, namespace: 'mermaid-trim-stub' }, () => ({
        contents: 'export const diagram = undefined;',
        loader: 'js',
      }));
      // mermaid 自带 tiny-build 开关：移除 ELK + cose-bilkent 布局 loader。
      buildApi.onLoad({ filter: layoutFileFilter }, () => {
        if (patchedLayout === null) {
          patchedLayout = layoutChunk.source.replace(MERMAID_LAYOUT_SWITCH, '...false ? [');
          console.log(`[dsh-codinput] Mermaid 裁剪：移除 ${layoutChunk.name} 中的 ELK/cose-bilkent 布局 loader（省 ~2MB）`);
        }
        return {
          contents: patchedLayout,
          loader: 'js',
          resolveDir: dirname(layoutChunk.full),
          watchFiles: [layoutChunk.full],
        };
      });
      console.log(
        `[dsh-codinput] Mermaid 裁剪：内置 ${MERMAID_KEEP.size} 种图类型，stub ${stubbed} 种（入口共 ${knownIds.size} 种）`,
      );
    },
  };
}

/* =====================================================================
 * plugin 3：内联 CSS 模板字符串构建期压缩（去除大段注释与空白）
 * ===================================================================== */

const CSS_TEMPLATE_TARGETS = [
  { fileSuffix: 'src/client/styles.ts', binding: 'const CSS = ' },
  { fileSuffix: 'src/client/markdown/styles.ts', binding: 'export const markdownStyles = ' },
  { fileSuffix: 'src/client/markdown/heavy.ts', binding: 'export const heavyMarkdownStyles = ' },
];

/** 发布构建压缩 styles.ts / markdown/styles.ts / markdown/heavy.ts 中的内联 CSS 字符串。 */
export function createCssMinifyPlugin({ minify = true } = {}) {
  return {
    name: 'css-template-minify',
    setup(buildApi) {
      if (!minify) return;
      buildApi.onLoad({ filter: /src[\\/]client[\\/](?:styles|markdown[\\/](?:styles|heavy))\.ts$/ }, async (args) => {
        const normalized = args.path.replace(/\\/g, '/');
        const target = CSS_TEMPLATE_TARGETS.find((item) => normalized.endsWith(item.fileSuffix));
        if (!target) return undefined;
        const source = readFileSync(args.path, 'utf8');
        const marker = `${target.binding}\``;
        const startIdx = source.indexOf(marker);
        if (startIdx < 0) {
          throw new Error(`[css-template-minify] 在 ${target.fileSuffix} 中找不到 \`${marker}\``);
        }
        const cssStart = startIdx + marker.length;
        // 扫描静态 CSS 模板字面量末尾（允许 \` 转义，拒绝 ${ 插值避免误伤）。
        let cursor = cssStart;
        while (cursor < source.length) {
          const ch = source[cursor];
          if (ch === '\\') {
            cursor += 2;
            continue;
          }
          if (ch === '$' && source[cursor + 1] === '{') {
            throw new Error(`[css-template-minify] ${target.fileSuffix} 中的 CSS 模板包含动态插值，拒绝静态压缩`);
          }
          if (ch === '`') break;
          cursor += 1;
        }
        if (cursor >= source.length) {
          throw new Error(`[css-template-minify] ${target.fileSuffix} 中的 CSS 模板未闭合`);
        }
        const rawCss = source.slice(cssStart, cursor);
        const result = await transform(rawCss, { loader: 'css', minify: true });
        const saved = rawCss.length - result.code.length;
        console.log(
          `[dsh-codinput] CSS 压缩 ${target.fileSuffix}：${(rawCss.length / 1024).toFixed(1)} → ${(result.code.length / 1024).toFixed(1)} KiB（-${(saved / 1024).toFixed(1)} KiB）`,
        );
        const replaced =
          source.slice(0, startIdx) +
          `${target.binding}${JSON.stringify(result.code)}` +
          source.slice(cursor + 1);
        return {
          contents: replaced,
          loader: 'ts',
          resolveDir: dirname(args.path),
          watchFiles: [args.path],
        };
      });
    },
  };
}

/* =====================================================================
 * 构建
 * ===================================================================== */

/** 执行一次发布构建（`npm run build` / `node scripts/build.mjs [--dev]`）。 */
export async function main() {
  await mkdir(new URL('../lib', import.meta.url), { recursive: true });

  await build({
    entryPoints: ['src/client/index.tsx'],
    outfile: 'lib/client.js',
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    target: 'es2021',
    jsx: 'automatic',
    minify: !dev,
    sourcemap: dev ? 'inline' : false,
    legalComments: 'none',
    external: [
      'react',
      'react-dom',
      // 宿主 baseline 共享模块（见 host-primitives.d.ts 头注释）；不随包内置。
      '@deepseek-ai/dsh-client-ui-primitives',
    ],
    plugins: [
      createKatexCssPlugin(),
      createMermaidTrimPlugin(),
      createCssMinifyPlugin({ minify: !dev }),
    ],
    banner: {
      js: [
        `window.__ModuleLoader__.load({ id: ${JSON.stringify(pkg.name)}, factory: (require) => {`,
        'var module = { exports: {} };',
        'var exports = module.exports;',
        'Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });',
      ].join('\n'),
    },
    footer: {
      js: 'return module.exports; } })',
    },
  });

  // 自检 1：产物必须是合法 JS。
  try {
    execFileSync(process.execPath, ['--check', 'lib/client.js'], { stdio: 'pipe' });
    console.log('[dsh-codinput] 自检：node --check lib/client.js → OK');
  } catch (error) {
    const stderr =
      error && typeof error === 'object' && 'stderr' in error
        ? Buffer.from(error.stderr).toString('utf8')
        : String(error);
    throw new Error(`[dsh-codinput] 产物语法校验失败（node --check lib/client.js）：\n${stderr.slice(0, 2000)}`);
  }

  // 自检 2：单文件产物（防止误引入 CSS/资源等额外输出）。
  const emitted = readdirSync('lib').filter((name) => name !== 'index.js').sort();
  if (emitted.length !== 1 || emitted[0] !== 'client.js') {
    throw new Error(`[dsh-codinput] 产物体积/文件校验失败：lib/ 下应只有 client.js，实际为 ${emitted.join(', ')}`);
  }

  const { size } = await stat('lib/client.js');
  console.log(
    `[dsh-codinput] built lib/client.js (${dev ? 'dev：未压缩 + 内联 sourcemap' : '发布：压缩、无 sourcemap'}) — ${(size / 1024).toFixed(0)} KiB`,
  );
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
// 用 realpath 比较：本地验收副本里 scripts/ 可能是 junction/symlink。
function realOrSelf(target) {
  try {
    return realpathSync(target);
  } catch {
    return target;
  }
}
const isDirectRun =
  invokedPath !== '' && realOrSelf(invokedPath) === realOrSelf(fileURLToPath(import.meta.url));
if (isDirectRun) await main();
