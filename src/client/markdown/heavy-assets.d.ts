/**
 * 扩展渲染 构建期虚拟模块的类型声明。
 *
 * `virtual:katex-css` 由 `scripts/build.mjs` 的 `katex-css-inline` plugin 生成：
 * KaTeX 的 CSS 字符串，其中 `url(fonts/*.woff2)` 已替换为 data URI（字体全内置，
 * 运行时零网络请求），woff/ttf 回退项已删除。
 */
declare module 'virtual:katex-css' {
  const css: string;
  export default css;
}
