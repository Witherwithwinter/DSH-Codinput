// 客户端产物构建：esbuild bundle + cjs，包成 window.__ModuleLoader__.load。
// 外部依赖只有 react / react-dom（平台模块）；CodeMirror / marked / dompurify /
// highlight.js / katex / mermaid 一律随包内置。
//
// 默认出**发布产物**：压缩、无 sourcemap（源码随包在 src/，不必把内联 sourcemap
// 打进产物——那是 1MB 级的体积）。开发调试用 --dev（npm run build:dev）：
// 不压缩 + 内联 sourcemap，可在浏览器里直接看到 TypeScript 源码。
//
// Markdown 扩展渲染的两个构建期 plugin（保证仍是单文件 lib/client.js）：
// - katex-css-inline：把 node_modules/katex/dist/katex.min.css 变成虚拟模块
//   `virtual:katex-css`，其中 20 个 woff2 字体全部内联为 data URI、woff/ttf 回退项
//   删除 → 运行时零网络请求（离线可用）。替换或残留引用会直接让构建失败。
// - mermaid-trim：mermaid 的 dist/mermaid.core.mjs 用 dynamic import 按需加载 52 个
//   图类型 chunk；这里在构建期把**未内置**的图类型 stub 成 `diagram = undefined`
//   （渲染这些类型时 mermaid 抛错 → 前端回退「源码 + 错误样式」），并把
//   chunk-CFHHFPVC.mjs 里的 `...true ? [` 改成 `...false ? [`（mermaid 自带的
//   tiny-build 开关）移除 ELK/cose-bilkent 布局 loader（省 ~2MB；请求 ELK 的图会按
//   mermaid 官方逻辑 fallback 到 dagre）。替换必须命中，否则构建失败——防止
//   mermaid 升级后裁剪静默失效。
//
// 两个 plugin 以工厂函数导出，供本地验收脚本复用（scripts 内部 API，不对外）。
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
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
const MERMAID_LAYOUT_CHUNK = join(mermaidDistDir, 'chunks', 'mermaid.core', 'chunk-CFHHFPVC.mjs');

/**
 * 从 mermaid.core.mjs 里解析「图类型 id → dynamic import 的 chunk 文件」映射。
 * 每个图类型的 loader 形如 `const { diagram } = await import("./chunks/.../xxx.mjs")`，
 * 上方 25 行内有 `var idN = "<图类型>"`。
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
      buildApi.onLoad({ filter: /chunk-CFHHFPVC\.mjs$/ }, () => {
        if (patchedLayout === null) {
          const source = readFileSync(MERMAID_LAYOUT_CHUNK, 'utf8');
          if (!source.includes('...true ? [')) {
            throw new Error(
              '[mermaid-trim] chunk-CFHHFPVC.mjs 里找不到 ELK/cose 布局开关 `...true ? [`（mermaid 版本变化，构建中止）',
            );
          }
          patchedLayout = source.replace('...true ? [', '...false ? [');
          console.log('[dsh-codinput] Mermaid 裁剪：移除 ELK/cose-bilkent 布局 loader（省 ~2MB）');
        }
        return {
          contents: patchedLayout,
          loader: 'js',
          resolveDir: dirname(MERMAID_LAYOUT_CHUNK),
          watchFiles: [MERMAID_LAYOUT_CHUNK],
        };
      });
      console.log(
        `[dsh-codinput] Mermaid 裁剪：内置 ${MERMAID_KEEP.size} 种图类型，stub ${stubbed} 种（入口共 ${knownIds.size} 种）`,
      );
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
    external: ['react', 'react-dom'],
    plugins: [createKatexCssPlugin(), createMermaidTrimPlugin()],
    banner: {
      js: [
        `window.__ModuleLoader__.load({ id: ${JSON.stringify(pkg.name)}, factory: (require) => {`,
        'var module = { exports: {} };',
        'var exports = module.exports;',
        'Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });',
      ].join('\n')
    },
    footer: {
      js: 'return module.exports; } })'
    }
  });

  // 自检 1：产物必须是合法 JS。banner/footer 拼接错误（例如换行被双重转义成
  // 字面 `\n` 两字符）会造成 `SyntaxError: Invalid or unexpected token`，宿主
  // 加载插件直接失败——这里在构建末尾用 `node --check` 把它拦在发布之前。
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
// 用 realpath 比较：本地验收副本里 scripts/ 可能是 junction/symlink，ESM 会把
// import.meta.url 解析到真实路径，直接比较字符串会误判为「被 import」而不构建。
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
