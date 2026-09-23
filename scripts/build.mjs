// 客户端产物构建：esbuild bundle + cjs，包成 window.__ModuleLoader__.load。
// 外部依赖只有 react / react-dom（平台模块）；CodeMirror / marked / dompurify 一律随包内置。
//
// 默认出**发布产物**：压缩、无 sourcemap（源码随包在 src/，不必把内联 sourcemap
// 打进产物——那是 1MB 级的体积）。开发调试用 --dev（npm run build:dev）：
// 不压缩 + 内联 sourcemap，可在浏览器里直接看到 TypeScript 源码。
import { build } from 'esbuild';
import { mkdir, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';

const dev = process.argv.includes('--dev');
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

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

const { size } = await stat(new URL('../lib/client.js', import.meta.url));
console.log(
  `[dsh-codinput] built lib/client.js (${dev ? 'dev：未压缩 + 内联 sourcemap' : '发布：压缩、无 sourcemap'}) — ${(size / 1024).toFixed(0)} KiB`,
);
