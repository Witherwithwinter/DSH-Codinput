/**
 * Markdown 管线样式：由 `src/client/styles.ts` import 后拼接注入一次。
 *
 * 两段：
 *  A. 预览面板排版 —— 自 `src/client/styles.ts` 的 `.dci-preview` 段迁入
 *     （逐条保持原视觉，另补表格对齐/表头底色）。
 *  B. 统一扩展样式 —— 以 `.dci-md` 为根（预览内层 div 与用户消息
 *     `.dci-umsg-md` 同挂该类）：callout / 脚注 / `==高亮==` / wikilink /
 *     任务清单只读勾选框 / 图片放大光标 / 表格对齐 / 会话引用占位。
 *     用户消息的正文排版仍由官方对齐的 `.dci-umsg-md` 规则承担，这里只加
 *     扩展块自己的规则（新类名，不覆盖既有排版）。
 *
 * 主题：颜色一律走宿主 `--dsw-*` token + color-mix；token 缺失时回退
 * currentColor 混合或中性色，浅色/深色都可读。callout 图标用 CSS mask +
 * 内联 data URI（24 视框 lucide 线性路径），不往 DOM 里塞 SVG——
 * 净化白名单保持 Markdown 产出面，不额外放行 svg。
 */
export const markdownStyles = `
/* ===== A. 预览面板排版（迁自 styles.ts，视觉逐条保持） ===== */
.dci-preview { flex: 1 1 100%; min-width: 0; box-sizing: border-box; overflow: auto; padding: 8px 14px 10px; font-size: 13px; line-height: 1.65; }
.dci-preview h1, .dci-preview h2, .dci-preview h3, .dci-preview h4 { margin: 0.7em 0 0.35em; line-height: 1.3; }
.dci-preview h1 { font-size: 1.35em; } .dci-preview h2 { font-size: 1.2em; } .dci-preview h3 { font-size: 1.08em; }
.dci-preview p { margin: 0.45em 0; } .dci-preview ul, .dci-preview ol { margin: 0.45em 0; padding-left: 1.5em; }
.dci-preview code { font-family: inherit; background: color-mix(in srgb, currentColor 9%, transparent);
  border-radius: 4px; padding: 0.1em 0.35em; font-size: 0.92em; }
.dci-preview pre { background: color-mix(in srgb, currentColor 7%, transparent); border-radius: 8px;
  padding: 10px 12px; overflow-x: auto; } .dci-preview pre code { background: transparent; padding: 0; }
.dci-preview blockquote { margin: 0.5em 0; padding: 0.1em 0.9em; border-left: 3px solid color-mix(in srgb, currentColor 22%, transparent); opacity: 0.85; }
.dci-preview table { border-collapse: collapse; margin: 0.6em 0; }
.dci-preview th, .dci-preview td { border: 1px solid color-mix(in srgb, currentColor 18%, transparent); padding: 4px 9px; }
.dci-preview th { background: color-mix(in srgb, currentColor 5%, transparent); font-weight: 600; }
.dci-preview :is(th, td)[align='center'] { text-align: center; }
/* 预览链接走官方 markdown 同款 alias-link token（官方 _markdown_ a 逐值核对）。 */
.dci-preview a { color: var(--dsw-alias-link, #4c8dff); } .dci-preview img { max-width: 100%; } .dci-preview hr { border: none;
  border-top: 1px solid color-mix(in srgb, currentColor 14%, transparent); }

/* ===== B. 统一扩展样式根 ===== */
.dci-md { min-width: 0; }
/* 方案 A：Markdown 正文等宽连字字体（设置 → Markdown 等宽连字，默认开）。
   目标：正文与行内代码里的 -> / => / // 等靠字体 calt/liga 连字显示为箭头/连字，
   DOM 文本仍是原文（不做字符替换）；只影响 Markdown 显示面，编辑器保持字面。
   - font-variant-ligatures / font-feature-settings 显式打开，避免被宿主全局样式关掉；
   - 关闭态（根上没有 data-mono）不写任何字体/连字覆盖 → 恢复宿主阅读字体；
   - 代码块/嵌入块保持代码字体并复位为默认连字设置（用户取舍：代码块不动）；
     行内代码按用户要求也显示连字箭头（见下方 preview/umsg 两条规则）。 */
.dci-md[data-mono='true'] {
  font-family: 'JetBrains Mono', var(--ds-font-family-code, ui-monospace, monospace);
  font-variant-ligatures: normal;
  font-feature-settings: 'calt' 1, 'liga' 1;
}
.dci-md[data-mono='true'] :is(.dci-md-codeblock, pre, .dci-md-embed) {
  font-variant-ligatures: normal;
  font-feature-settings: normal;
}
/* 围栏代码块固定走宿主代码字体（与 扩展渲染的 .dci-md-pre 同值），避免正文等宽字体
   泄漏进代码面。 */
.dci-md[data-mono='true'] pre { font-family: var(--ds-font-family-code, ui-monospace, monospace); }
/* 行内代码：用户取舍「右侧预览两处（正文 + 行内代码）都要连字箭头」，故 mono 态下
   预览/用户消息行内代码都走 JBM（回退代码字体 token）并显式打开 calt/liga；关闭态
   不命中本规则，预览行内代码恢复 0.6 的阅读字体继承行为。代码块不在此列（不动）。 */
.dci-preview .dci-md[data-mono='true'] :not(pre) > code,
.dci-umsg-md[data-mono='true'] :not(pre) > code {
  font-family: 'JetBrains Mono', var(--ds-font-family-code, ui-monospace, monospace);
  font-variant-ligatures: normal;
  font-feature-settings: 'calt' 1, 'liga' 1;
}
/* 用户消息 legacy 排版（src/client/styles.ts）用 font: 简写定义标题/表格单元格，
   简写会重置 font-family 且元素级优先级高于继承 → mono 态根字体到不了这些元素。
   这里显式补 family + 连字（字号/字重/行高仍由原 font 简写决定，不改观感）；只影响
   用户消息根，预览侧这些元素没有 font 简写、本来就继承根字体。代码面各自的代码字体
   规则不受影响（行内代码/代码块未命中本选择器）。 */
.dci-umsg-md[data-mono='true'] :is(h1, h2, h3, h4, h5, h6),
.dci-umsg-md[data-mono='true'] .dci-umsg-tscroll :is(th, td) {
  font-family: 'JetBrains Mono', var(--ds-font-family-code, ui-monospace, monospace);
  font-variant-ligatures: normal;
  font-feature-settings: 'calt' 1, 'liga' 1;
}
/* 图片：点击开灯箱（交互在 markdown 模块的 handleMarkdownClick）。 */
.dci-md img { max-width: 100%; height: auto; cursor: zoom-in; }
/* 任务清单：只读勾选框（marked 产出 input[disabled]，装饰期保证不可编辑）。 */
.dci-md li:has(> input[type='checkbox']) { list-style: none; }
.dci-md li > input[type='checkbox'] { width: 14px; height: 14px; margin: 0 6px 0 0; vertical-align: -2px;
  accent-color: var(--dsw-alias-label-secondary, currentColor); }
.dci-md ul:has(> li > input[type='checkbox']) { padding-left: 4px; }
/* GFM 表格对齐（marked 产出 align 属性；官方用户消息表样式把 text-align 定死为 start，这里在属性面回补）。 */
.dci-md :is(th, td)[align='center'] { text-align: center; }
.dci-md :is(th, td)[align='right'] { text-align: right; }
.dci-md :is(th, td)[align='left'] { text-align: left; }

/* ==高亮== */
.dci-md mark { background: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #d9a400) 34%, transparent);
  color: inherit; border-radius: 3px; padding: 0 2px; box-decoration-break: clone; -webkit-box-decoration-break: clone; }

/* [[wikilink]]：无宿主导航目标 → 样式化 chip，点击复制目标名（复制态短暂加深）。 */
.dci-md .dci-md-wikilink { display: inline; max-width: 100%; margin: 0 2px; padding: 0 4px; font: inherit; font-weight: 500;
  color: var(--dsw-alias-state-business-primary, #4c8dff); cursor: copy; white-space: normal; overflow-wrap: anywhere;
  border: 0.5px solid color-mix(in srgb, var(--dsw-alias-state-business-primary, #4c8dff) 32%, transparent);
  border-radius: var(--dsw-radius-sm, 6px);
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4c8dff) 10%, transparent); }
.dci-md .dci-md-wikilink:hover { background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4c8dff) 18%, transparent); }
.dci-md .dci-md-wikilink:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary, #4c8dff)); outline-offset: 2px; }
.dci-md .dci-md-wikilink[data-dci-copied='true'] { background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4c8dff) 26%, transparent); }
/* ![[图片.png]]：无法解析仓库文件 → 样式化文本（代码面），不崩不留破图。 */
.dci-md .dci-md-embed { display: inline; padding: 0 4px; font-family: var(--ds-font-family-code, monospace); font-size: 0.9em;
  color: var(--dsw-alias-markdown-placeholder, var(--dsw-alias-label-tertiary, currentColor));
  background: var(--dsw-alias-markdown-code-block, color-mix(in srgb, currentColor 8%, transparent));
  border-radius: var(--dsw-radius-sm, 6px); }
/* 会话引用线格式占位（预览面纯展示；用户消息侧装饰成官方引用 chip）。 */
.dci-md span[data-dci-wire] { color: var(--dsw-alias-state-business-primary, #4c8dff); font-weight: 500; }

/* Obsidian callout：左色条 + 同色浅底 + 图标/标题；普通 blockquote 不受影响。
   accent 必须**从前景色派生**：家族 token 只提供色相，再与宿主
   --dsw-alias-label-primary 按 55/45 混合——浅色主题前景近黑、混出深 accent，
   深色主题前景近白、混出浅 accent，于是 title/图标/左边框在两个主题都保持可读
   （QA 实测：浅色 5.4–9.2、深色 8.3–11.8，阈值 3.0）。
   不能直接拿 state-* / markdown-citation 之类「背景/状态语义」色当前景：
   浅色下 success=2.1、warning=2.0，citation 是背景色（浅 1.15 / 深 1.47）会糊底。 */
.dci-md .dci-md-callout { --dci-md-accent-hue: var(--dsw-alias-state-business-primary, #4c8dff);
  --dci-md-accent: color-mix(in srgb, var(--dci-md-accent-hue) 55%, var(--dsw-alias-label-primary, currentColor) 45%);
  margin: 14px 0; padding: 8px 12px; border-left: 3px solid var(--dci-md-accent);
  border-radius: var(--dsw-radius-sm, 6px);
  background: color-mix(in srgb, var(--dci-md-accent) 9%, transparent);
  color: var(--dsw-alias-label-primary, inherit); }
.dci-md .dci-md-callout[data-family='green'] { --dci-md-accent-hue: var(--dsw-alias-state-success-primary, #2f9e6e); }
.dci-md .dci-md-callout[data-family='amber'] { --dci-md-accent-hue: var(--dsw-alias-state-warn-primary, #d9a400); }
.dci-md .dci-md-callout[data-family='red'] { --dci-md-accent-hue: var(--dsw-alias-state-error-primary, #e5484d); }
/* purple 无对应语义 state token：固定紫只作色相源，再按主题混向前景
   （--dsw-alias-markdown-citation 是背景色语义，不能当 accent）。 */
.dci-md .dci-md-callout[data-family='purple'] { --dci-md-accent-hue: #8b7cf6; }
.dci-md .dci-md-callout[data-family='gray'] { --dci-md-accent-hue: var(--dsw-alias-label-secondary, currentColor); }
.dci-md .dci-md-callout-head { display: flex; align-items: center; gap: 6px; min-width: 0;
  color: var(--dci-md-accent); font-weight: 600; line-height: 24px; }
.dci-md .dci-md-callout-label { min-width: 0; overflow-wrap: anywhere; }
.dci-md .dci-md-callout-body { margin-top: 2px; }
.dci-md .dci-md-callout-body > :first-child { margin-top: 0; }
.dci-md .dci-md-callout-body > :last-child { margin-bottom: 0; }
.dci-md details.dci-md-callout > summary { list-style: none; cursor: pointer; }
.dci-md details.dci-md-callout > summary::-webkit-details-marker { display: none; }
/* callout 图标：mask + 内联 SVG（描边形状，颜色由 background-color/currentColor 给）。 */
.dci-md .dci-md-callout-icon { --dci-md-icon: none; flex: none; width: 16px; height: 16px; background-color: currentColor;
  -webkit-mask-image: var(--dci-md-icon); mask-image: var(--dci-md-icon);
  -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat;
  -webkit-mask-position: center; mask-position: center;
  -webkit-mask-size: 16px 16px; mask-size: 16px 16px; }
.dci-md .dci-md-callout-icon[data-icon='pencil'] { --dci-md-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z'/%3E%3Cpath d='m15 5 4 4'/%3E%3C/svg%3E"); }
.dci-md .dci-md-callout-icon[data-icon='info'] { --dci-md-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='12' r='10'/%3E%3Cpath d='M12 16v-4'/%3E%3Cpath d='M12 8h.01'/%3E%3C/svg%3E"); }
.dci-md .dci-md-callout-icon[data-icon='bulb'] { --dci-md-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5'/%3E%3Cpath d='M9 18h6'/%3E%3Cpath d='M10 22h4'/%3E%3C/svg%3E"); }
.dci-md .dci-md-callout-icon[data-icon='check-circle'] { --dci-md-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M21.801 10A10 10 0 1 1 17 3.335'/%3E%3Cpath d='m9 11 3 3L22 4'/%3E%3C/svg%3E"); }
.dci-md .dci-md-callout-icon[data-icon='check-square'] { --dci-md-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m9 11 3 3L22 4'/%3E%3Cpath d='M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11'/%3E%3C/svg%3E"); }
.dci-md .dci-md-callout-icon[data-icon='alert-triangle'] { --dci-md-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3'/%3E%3Cpath d='M12 9v4'/%3E%3Cpath d='M12 17h.01'/%3E%3C/svg%3E"); }
.dci-md .dci-md-callout-icon[data-icon='x-octagon'] { --dci-md-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M2.586 16.726A2 2 0 0 1 2 15.312V8.688a2 2 0 0 1 .586-1.414l4.688-4.688A2 2 0 0 1 8.688 2h6.624a2 2 0 0 1 1.414.586l4.688 4.688A2 2 0 0 1 22 8.688v6.624a2 2 0 0 1-.586 1.414l-4.688 4.688a2 2 0 0 1-1.414.586H8.688a2 2 0 0 1-1.414-.586z'/%3E%3Cpath d='m15 9-6 6'/%3E%3Cpath d='m9 9 6 6'/%3E%3C/svg%3E"); }
.dci-md .dci-md-callout-icon[data-icon='help-circle'] { --dci-md-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='12' r='10'/%3E%3Cpath d='M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3'/%3E%3Cpath d='M12 17h.01'/%3E%3C/svg%3E"); }
.dci-md .dci-md-callout-icon[data-icon='quote'] { --dci-md-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z'/%3E%3Cpath d='M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z'/%3E%3C/svg%3E"); }
.dci-md .dci-md-callout-icon[data-icon='list'] { --dci-md-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M3 6h.01'/%3E%3Cpath d='M3 12h.01'/%3E%3Cpath d='M3 18h.01'/%3E%3Cpath d='M8 6h13'/%3E%3Cpath d='M8 12h13'/%3E%3Cpath d='M8 18h13'/%3E%3C/svg%3E"); }
.dci-md .dci-md-callout-icon[data-icon='flame'] { --dci-md-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z'/%3E%3C/svg%3E"); }

/* 脚注：正文上标 + 文末列表（可回跳）。 */
.dci-md .dci-md-fnref { font-size: 0.72em; line-height: 0; vertical-align: super; }
.dci-md .dci-md-fnref a { padding: 0 1px; color: var(--dsw-alias-state-business-primary, #4c8dff);
  font-weight: 600; text-decoration: none; }
.dci-md .dci-md-fnref a:hover { text-decoration: underline; }
.dci-md .dci-md-footnotes { margin-top: 20px; padding-top: 10px;
  border-top: 0.5px solid var(--dsw-alias-border-l2, color-mix(in srgb, currentColor 14%, transparent));
  font-size: 0.9em; color: var(--dsw-alias-label-secondary, inherit); }
.dci-md .dci-md-fnlist { margin: 0; padding: 0; list-style: none; }
.dci-md .dci-md-fnitem { position: relative; margin: 6px 0; }
.dci-md .dci-md-fnitem > :is(p, div) { display: inline; margin: 0; }
.dci-md .dci-md-fnback { margin-left: 4px; color: var(--dsw-alias-state-business-primary, #4c8dff);
  font-size: 0.9em; text-decoration: none; }
.dci-md .dci-md-fnback:hover { text-decoration: underline; }
`;
