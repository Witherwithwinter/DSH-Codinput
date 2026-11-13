# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.4.1] — 2026-11-13

### 修复

- **`conversation.composer.dock` 座位被静默抹掉（issue #8）**：官方 `InputBar` 在卡片下方 `.dock` 容器里渲染该 list 座（`[renderSlot("conversation.composer.dock", {}), ContextMeter]`），bar 被 `priority:-1` 遮蔽后渲染点随官方输入框消失——注册在这里的 `dsh-cost-meter`（默认 `position="dock"`）、`dsh-quota-meter` 等条目整块 UI 不可见。现在数据行在胶囊组之前按官方 list 语义复刻该座位（`ComposerDockSlot`，与左右座共用 `InputSlotSeat` 引擎；owner props 为空、`sessionId` 缺省不渲染）。**只镜像第三方条目**：官方宿主自己也往该座注册 `ActivityPill(id activity)` / `UsagePill(id usage)`（client-ui-chat，slot catalog 与运行时双证），它们由数据行自绘胶囊顶替，整座镜像会重复渲染（隔离宿主实测 3 项 → 5 项），故按 `SHIPPED_DOCK_IDS` 过滤；没有第三方条目时行为与旧版一致。
- **未镜像座位静默失效无告警**：`input.overlay` / `input.attachments` 在接管期间仍无渲染点。新增 `src/client/seats.ts` 运行时审计：接管生效时订阅这两个座位的条目变化，发现「有**第三方**占用者但无渲染点」即写 `__dshCodinputErrs`（`slot.unmirrored`）+ console 告警；官方自带占用者（overlay 的 `slash-menu` / `command-popup` / `feedback-dialog`、attachments 的 `ComposerAttachments`——接管设计已知代价，其 UI 由自绘面或官方其它路径承担）静默跳过，干净宿主不再刷屏；同座位同占用者只报一次，插件卸载时断开订阅。占用者名按 `options.id` → 组件名 → 归属名取值，不再出现不可读的压缩短名。

### 验证

- **隔离宿主运行时验证（issue #8 修复）**：独立 `DSH_HOME` + `@deepseek-ai/dsh@0.2.2-rc.1` + 无头 Edge，加载真实关闭态会话，未发消息、未调模型。结果：装 `dsh-cost-meter@1.9.64` 后数据行出现其 dock 条目（成本按钮），修复前该 UI 无渲染点；干净宿主数据行保持 3 项（官方 Activity/Usage 胶囊不再重复）、`__dshCodinputErrs` 为空、无 console 告警；第三方 overlay 告警路径保留。报告与截图见 `docs/review/issue8-runtime.md`（仓库外文档目录，不入库）。

### 文档

- **修正 README 的租客断言**：原文「`input.attachments` / `overlay` / `dock` 生态暂无租客，留扩展位」未经核验且不成立——`dsh-cost-meter` 默认注册 `conversation.composer.dock`、`dsh-context` 注册 `conversation.input.overlay`、`@knyazevai/dsh-client-ui-attachment` 无条件注册 `conversation.input.attachments`（其首版早于该断言）。中英 README 同步改为「已镜像 / 未镜像」清单 + 宿主侧原因（slot 声明单 owner、无原生转发），并区分 `conversation.input.dock`（bar 之外、不受影响）与 `conversation.composer.dock`（bar 体内、原被抹掉）；同时补上这些座位上**官方自带占用者**（composer.dock 的 Activity/Usage 胶囊、attachments 的 `ComposerAttachments`、overlay 的指令/斜杠/反馈弹层）——镜像与审计都只针对第三方。

[0.4.1]: https://github.com/Witherwithwinter/DSH-Codinput/compare/v0.4.0...v0.4.1

## [0.4.0] — 2026-11-10

本版本适配 DSH `0.2.2-rc.1` 桌面/网页宿主，带来 Markdown 渲染升级（Obsidian 风格，全内置离线）与编辑器字面字符渲染（移除字体连字）。

### 修复

- **`/codinput` 退出丢草稿**：宿主的命令通道在调用插件 `ui.run()` 之前已把命令 token 从草稿消费掉，旧实现随后 `setTimeout(80ms)` **无条件 `setDraft('')`**，把 token 之外的用户草稿整体清空。现改为**同步** `stripCommandToken()`：只在草稿确实以 `/codinput` 开头（token 后跟空白或行尾）时剥掉 token，其余内容原样保留；普通 / 悬浮 / 侧栏三形态与三条退出入口均不再丢草稿。
- **编辑器「丢字」实为字体连字**：JetBrains Mono 的连字把 `->` 画成 `→`、把 `//` 画成合并字形，用户视角是「编辑侧的 `-` / 首个 `/` 消失」，与消息记录（纯文本）不一致；隔离宿主逐键码点取证确认**文档 / 机器草稿 / 持久化草稿里的字符一个不少**，纯属渲染层。现默认关闭编辑器字体连字：`.cm-scroller` / `.cm-content` 输出 `font-variant-ligatures: none` 与 `font-feature-settings: "liga" 0, "calt" 0`；本版同时移除「字体连字」设置（理由见下）。
- **桌面端 calt shaping bug 结论**：DSH 桌面 `0.2.2-rc.1`（Electron 44.7 / Chromium 152）在「`calt`/`liga` 连字 + 后续任意字符」时会把连字第一格画空，**只在 CodeMirror 编辑器面**出现；普通 DOM（预览/用户消息/代码块）正常，web/Edge 157 正常。实测修补字体（calt 搬 liga）、12 种 CSS/合成层 workaround 均无法规避 → **编辑器保持字面是桌面端唯一稳定解**；Markdown 渲染面可以使用连字（见下）。
- **麦克风按钮消失（0.2.2 回归）**：0.2.2 的 voice-input 条目 `inject()` 新增 `hooks.microphoneDevice` / `hooks.pluginNavigation`，`VoiceInput` 需要 `useSpeechReadiness` / `useMicrophoneDevice` / `usePluginNavigation`；旧 `VoiceActivity` 只绑定 `speechReadiness`、丢弃其余 hooks → 组件内 `usePluginNavigation is not a function` 抛错被条目边界静默，麦克风整体不渲染。改为 `slotEntry.entryInjectProps` 通用折叠：`hooks` 表任意键 → `use<Name>` 选择器钩子、其余字段原样。
- **带图用户消息渲染错误（0.2.2 回归）**：0.2.2 移除了座位 prop `renderMessageImages`，用户消息附件行改由 `conversation.chat.user.content` factory 渲染、图片走 `conversation.chat.user.images` 槽位（官方 `MessageImages` 缩略图 + 原图灯箱）。旧实现拿不到新 prop → 回退文件卡 `image.png PNG 53KB` 且点击无法放大。现在附件行整体委托官方 factory（`content.text=""` → 官方只渲染附件行），图片/灯箱完全走官方；旧宿主回退链保留（`renderMessageImages` → 文件卡）。
- **Shift+Enter 换行失效（B1，@RaM-bugourp）**：旧版偏好迁移把 `lineBreakHotkey` 写成 `shift-enter`（规范分隔符是 `+`）→ 永远不匹配。迁移值改为 `shift+enter` 并修复已存坏值；另修行为层：自定义换行快捷键显式插入 `\n` 后选区未随之前移，光标留在插入点之前导致后续输入落回上一行 → `EditorPane` dispatch 现带 `selection: { anchor: head + 1 }`。
- **快捷键被旧迁移反复覆盖（B2，@RaM-bugourp）**：旧字段 `sendKey` / `lineBreakKey` / `floating` 一直留在存储里，每次加载都重新迁移、覆盖用户改过的快捷键。改为一次性迁移：迁移后删除旧字段、只写已知字段；用户已改过的新值优先。
- **偏好设置无类型校验（B3，@RaM-bugourp）**：存储写坏（坏 JSON、错误类型、数组、未知键、越界数值）会抛错或污染界面。新增 `normalizePrefs`：每字段独立类型/枚举/范围校验并回退默认，任意输入不抛错；保存前同样归一化。偏好键 `dsh-codinput.prefs.v2` → `.v3` 一次性迁移（旧字段清理、坏值修复）。
- **统计与缓存命中边界文本（B4，@RaM-bugourp）**：`formatCacheHitPercent` 完整复刻官方 0.2.2 算法（`99.9 / 99.99 / 99.999…`）；`formatTokens` K 位舍入到 1000 时进位 M（`999_950 → 1M tok`，永不 1000K）；tps/duration 补 NaN/±Infinity 防护；数据行胶囊、详情面板、上下文小圈全部走安全函数。
- **用户消息可伪造会话 chip（B5，安全，@RaM-bugourp）**：marked 默认透传原始 HTML、DOMPurify 白名单允许 `span` + `data-dci-wire` → 手写 `<span data-dci-wire="x">` 会被装饰成会话 chip。现在原始 HTML 一律转义为文本，`data-dci-wire` 只能由插件自身的 Markdown 扩展产生；伪造 span/script/onerror/style/iframe/javascript: 均不执行、不产生 chip。
- **「问答被渲染成用户侧消息」**：确认是宿主 0.2.2 官方行为——会把 `ask_user_question` 的回答渲染成官方 **question-reply 回执卡片**（DOM 带 `data-question-reply`），不是本插件气泡；插件另加防御：遇到 `source.kind === 'user-question-reply'` 的节点让位官方渲染。
- **Markdown 渲染缺陷（验收发现并复验）**：callout `question` 家族误用背景语义 token 作前景 accent（浅/深对比度仅 1.15/1.47）→ 8 家族统一改为前景派生，最低 4.93（浅）/7.87（深）；用户消息图片 `width` 属性被 legacy `.dci-umsg-md img { width:auto }` 覆盖 → 删除该规则，Obsidian 尺寸语法两侧一致；预览「后开」时 `activateMarkdown` effect 缺 `previewOn` 依赖 → KaTeX/Mermaid/复制按钮未激活，补齐依赖；用户消息 h1–h6/th/td 因 legacy `font:` 简写未跟随等宽字体 → mono 态显式补 family/连字。
- **构建 P0**：`scripts/build.mjs` banner 拼接双重转义（`.join('\n')`）产出字面 `\n`，整包 JS 语法无效（宿主 `import failed`）→ 修复为 `.join('\n')` 并新增构建末尾 `node --check` 与单文件断言，坏产物直接阻断构建。

### 变更

- **底部工具行逐值对齐官方 `0.2.2-rc.1` InputBar**：`+` 指令钮 28×28、`conversation.input.permission` / `.plan` 槽位镜像（官方权限选择器 / 计划 chip）、`input.left` / `.right` / `.model` 座位顺序、语音 activity 座位（麦克风钮）、sending 阶段独立停止钮与旋转发送态、官方 stop / sending / steer·queue 文案、行 `container-type: inline-size` / padding `2px 8px 6px` / gap 12 / `@container` 窄宽 gap 8、模型文字 compact 收起；圆形按钮补 `corner-shape: round`（宿主默认 squircle）。
- **编辑器字面渲染**：`->`、`//` 等始终按字面字符显示，与预览 / 用户消息的纯文本一致；「字体连字」设置项移除（prefs 遗留字段忽略并丢弃）。
- **用户消息 Markdown 统一渲染管线**：预览 `.dci-preview` 与用户消息 `.dci-umsg-md` 共用同一 `renderMarkdown`，输出一致；会话 chip 装饰、附件 factory 委托、question-reply 让位、官方气泡外层均保留。
- **候选菜单四向自适应浮层**：悬浮 / 右侧栏形态的 `/` `@` 候选菜单从「头部行下方固定弹出、覆盖编辑区」改为 `createPortal(document.body)` 的 `position: fixed` 浮层——以 `.dci-card` 实时矩形为不可覆盖区，在上/下/左/右按可用空间自适应选位，打开期间逐帧复算；普通形态保持卡片上方浮层。
- 预览面板 `overflow-y: auto` → `overflow: auto`（宽表格/代码块可横向滚动）。
- 设置项调整：移除「字体连字」；新增「Markdown 等宽连字」（默认开）。
- 数据行详情面板 portal 化：三枚面板（会话统计 / Token 用量 / 上下文分段）`createPortal(document.body)` + `position: fixed`，跟随滚动/尺寸变化、Escape 与点外关闭、三枚互斥。

### 新增

- **Markdown 渲染（Obsidian 风格，全内置离线）**：GFM 表格（逐列对齐、宽表横滚）/ 任务清单（只读勾选、嵌套）/ 删除线 / 自动链接；**脚注**（上标 + 文末脚注区 + 回跳）；**8 类 Obsidian Callouts**（note/tip/warning/danger/info/success/question/quote，图标/配色/折叠，浅深主题对比度达标）；Obsidian 扩展语法 `==高亮==`、`%%注释%%`（隐藏、不误伤代码）、`[[wikilink|别名]]`（chip，点击复制目标）、`![[file]]`（样式化降级）、图片尺寸 `![alt|300](url)`、图片点击灯箱。
- **代码块**：highlight.js 46 种语言高亮 + 语言标签 + 复制按钮（未知语言不高亮不崩）。
- **数学公式**：KaTeX 行内 `$...$` / 块级 `$$...$$`；错误公式回退原文；20 个 woff2 字体全部内联 data URI，运行时**零网络请求**。
- **Mermaid**：13 类图表（flowchart / sequence / class / state / ER / gantt / pie / journey / gitGraph / info / mindmap / timeline），可见时懒渲染、浅深主题跟随、`securityLevel:'strict'`、失败回退源码；ELK/cose 与 cytoscape 构建期排除。
- **Markdown 正文等宽连字（默认开、设置可关）**：预览与用户消息正文改用 JetBrains Mono，`->`/`=>`/`//` 等靠**字体连字**显示箭头/连字（DOM、草稿、复制、发送内容仍是原文）；代码块/行内代码使用各自代码字体并同样显示连字；用户消息 h1–h6/th/td 同步等宽。
- 构建：`scripts/build.mjs` 新增 `katex-css-inline` / `mermaid-trim` 两个构建期 plugin（带断言防依赖升级静默失效）+ 产物 `node --check` / 单文件自检。
- 新依赖：`highlight.js ^11.12.0`（BSD-3）、`katex ^0.18.0`（MIT）、`mermaid ^12.3.0`（MIT）；`NOTICE` 补三方许可与传递依赖（ELK/cytoscape 未分发）。

### 说明

- 本版同时包含编辑器字面渲染、Markdown 渲染与正文/行内代码连字等能力（详见上文章节）。
- **体积**：`lib/client.js` ≈ 3.55 MB（gzip ≈ 1.10 MiB / brotli ≈ 0.94 MiB）；相对 0.3.9 基线（≈ 540 KB）增加约 2.84 MiB raw——全部 Markdown 渲染依赖（KaTeX 字体、highlight.js、Mermaid）内联打包，换来**离线可用、零网络请求**；构建约 1–7 s，单文件、连续构建字节一致。
- **安全**：原始 HTML 一律转义；外链 `target=_blank rel=noopener noreferrer`、`javascript:`/`data:` 协议拦截；KaTeX `trust:false`；Mermaid `securityLevel:'strict'` + SVG 过 DOMPurify；代码高亮只输出 class/文本。
- **已知限制**：Mermaid 仅内置 13 类常用图（其余回退源码）；`[[wikilink]]` 仅复制目标名、不做仓库导航；`![[图片]]` 只做文本降级；**编辑器不做字体连字**（桌面 Chromium 152 无解，等宿主升级）；系统未安装 JetBrains Mono 时正文等宽回退到宿主 code font（无连字则箭头退化为字面）。
- **「Markdown 等宽连字」开关语义**：开启时预览与用户消息的正文/标题/表格/行内代码均用 JBM 显示连字；关闭后**预览行内代码**回到阅读字体字面、正文恢复阅读字体；**用户消息行内代码**回到宿主代码字体（该字体默认连字，视觉上仍可能显示箭头，开关不改变它）。
- **验收记录**（隔离 web DSH `0.2.2-rc.1` + 无头 Edge；隔离桌面 Electron 44.7 / Chromium 152 抽验）：底部工具行/麦克风、带图用户消息与问答、prefs 迁移与统计边界、Markdown 渲染（GFM/脚注/Callouts/Obsidian 语法/图片尺寸与灯箱/代码高亮/KaTeX/Mermaid/正文与行内代码连字）、安全与回归全部 PASS；桌面抽验（编辑器字面渲染、预览正文连字、无第一格空白）PASS；`__dshCodinputErrs` / console error 全为 0。
- **发布材料**：`npm run typecheck` 通过；`lib/client.js` 由当前源码重建（md5 `a7708d2d00ce005de5e599cc7819296f`，3,555,033 B；gzip 1,157,872 B / brotli 958,709 B；构建自检 `node --check` OK）。

[0.4.0]: https://github.com/Witherwithwinter/DSH-Codinput/compare/v0.3.9...v0.4.0

## [0.3.9] — 2026-11-06

修复 dsh `0.2.2-rc.1` 上模型 / 权限 / 设置下拉的整体错位、布局变化不跟随与开合失效：菜单改为 portal 到 `document.body`，锚点改按元素实时读取。

### 修复

- **菜单包含块被劫持，整体错位**（`MenuSurface`）：`.dci-menu` 虽为 `position: fixed`，但祖先链上的 `transform` / `filter` / `backdrop-filter` / `contain` 会把包含块从视口换成该祖先，`left/top` 按错误坐标系解释（实测可偏出 400px+）。现改为 `createPortal(document.body)`，与官方 ModelSelect 菜单、数据行详情面板同路数。
- **锚点是矩形快照，布局变化不跟随**（`MenuSurface`）：原实现保存 `getBoundingClientRect()` 快照，`scroll` / `resize` 重算读同一份快照、结果恒等被丢弃。现改为按元素实时读取；打开期间逐帧比对锚点位置（1px 阈值）兜住不产生 scroll/resize 的布局重排；锚点未布局或菜单零尺寸时不落位。
- **点触发器开合失效**（`MenuSurface` / `ModelMenu`）：全局 `pointerdown` 捕获监听把落在触发器上的点击也当作外部点击先关闭，触发器 `onClick` 随后读到 `open=false` 又开回来（点一次收不起来）。现外部点击判定跳过锚点、开合交给触发器 toggle；`ModelMenu` 移除自管点外关闭。模型 / 权限 / 设置三处调用方同步改为传元素 + 打开瞬间矩形。

### 说明

- 发布材料：`npm run typecheck` 通过；两次发布构建字节一致（`lib/client.js` sha256 `4ef5a5917614b811b7345adbc5166e649014718dbb63929ee3654e8b2656460c`，与入库产物一致）。
- 兼容验证：隔离 web 宿主 `@deepseek-ai/dsh@0.2.2-rc.1`（临时 prefix + 独立 `DSH_HOME` + 无头 Edge 自动化探针，`link:` 安装本仓库构建产物）33/33 断言通过——菜单为 `body` 直接子节点 / `position: fixed`；模型菜单 top = 触发器 top − 8 − 菜单高（逐像素 0 误差、右对齐）；祖先 `transform: translateY(150px)` 下仍 0 误差；布局位移 120px 后 2 帧内回贴；连点两次 开→收；点外部关闭、点菜单内不关；设置下拉 top = 触发器 bottom + 4（0 误差）且不被设置容器裁剪；窗口 1440×900→1100×760 后重算跟随。全程 console error / pageerror 为 0、`__dshCodinputErrs` 为空。
- 未覆盖：模型子页长列表滚动（隔离宿主无凭据、目录为空）、视口 12px 夹取分支、真实模型/权限切换提交。
- 0.3.8 既有功能与行为不变；本版仅调整菜单定位与开合实现（`lib/client.js` 同步重建）。PR #5（@LittleFishStars）。

[0.3.9]: https://github.com/Witherwithwinter/DSH-Codinput/compare/v0.3.8...v0.3.9

## [0.3.8] — 2026-10-30

数据行三枚详情面板改为官方同构的 portal + fixed 锚定定位（滚动/尺寸变化跟随、Escape 与点外关闭、三面板单一展开）；设置页开关样式与面板背景/圆角 token 对齐官方；修复 patchReload live 热更新后新增样式类不注入；修复 0.3.7 带图用户消息渲染崩溃（P0）并收紧用户消息 Markdown 的安全基线（P1）。

### 变更

- **数据行详情面板 portal 化**（`StatsRow`）：会话统计 / Token 用量 / 上下文分段三枚面板改为 `createPortal(document.body)` + `position: fixed`，插件侧移植官方 `useAnchoredPosition` / `useStatDialog` 语义——side top / align start、gap 8、视口 margin 12、帧顶 clearance（`--dsh-frame-top-clearance`，`data-fullscreen` 归零）、滚动（捕获相位）/窗口 resize/面板尺寸变化重算并夹进视口。三枚面板各有独立 seat；新增 Escape 与点外关闭（点面板内部不关），并保持三枚单一展开态互斥。
- **设置页开关对齐官方 primitives**：`Switch.module.css` 逐值对齐——`999px` 圆角 + `corner-shape: round`、`disabled` 态、`focus-visible` 走官方 focus ring token、滑块走 `--dsw-alias-switch-thumb`；ON 轨道用 `--dsw-alias-brand-primary`（随宿主主题，与官方 Switch 同款）。
- **面板与数据行 token 对齐官方**：面板背景优先 `--dsw-specific-menu`、保留 `--dsw-menu-surface-fill` 旧宿主回退链；圆角改 `var(--dsw-radius-lg)`；数据行胶囊 expanded 态、上下文仪表条 `corner-shape`、trigger 字号 token 与官方对齐。
- **npm 包描述**：`package.json` description 扩为「DSH 插件……web 与桌面端通用」。

### 修复

- **样式热更新失效**（`injectStyles`）：宿主 `patchReload: live` 原地更新插件后，旧 `<style id="dsh-codinput-styles">` 仍在、原实现「已存在即 return」导致新版新增类名（如 `.dci-umsg-*`）永不注入；现改为已存在时按内容原位刷新 `textContent`。
- **带图用户消息渲染崩溃（0.3.7 发布回归，P0）**：`contentParts` 把 `ImageAttachmentRef` 裸传给官方 `renderMessageImages`，官方 `ImageGallery` 计算 React key 时读 `image.attachment.attachmentId` 抛错；宿主 `SlotErrorBoundary` 捕获后**废黜**该键控条目，该页此后所有用户/插队消息退回官方纯文本（静默失效）。现按官方形状包成 `{ attachment }`；并补图片降级卡——宿主缺 `renderMessageImages` 座位 prop 时不再静默丢图。
- **用户消息 Markdown 安全基线收紧（P1）**：marked 透传的原始 HTML 经 DOMPurify 白名单收敛（禁 `style` / `form` / 控件 / 媒体 / 行内 style 等原始 HTML），链接与图片 URI 只放行 http(s)/mailto（非白名单链接拆成纯文本、破图降级为 alt 文本），与官方 `MarkdownText` 的 `sanitizeUrl` / `remoteImageUrl` 口径对齐；http(s) 链接统一新开页。
- **用户消息 Markdown 细节**：补 `useT` 订阅（宿主语言切换后复制钮/引用摘要等文案即时更新）；复制成功态定时器在卸载时清理；文件夹 chip 与官方一致不可点；chip 点击实时读取最新 `openFile`/`openSkill`（晚到不再失效）；组件加 `memo`；0 字节文件卡显示 `0B`；`bindForeign` 不再缓存 null（宿主 locale 晚到仍能绑定）。

### 说明

- 本版发布材料确认范围：`npm run typecheck` 通过、两次发布构建字节一致（sha256 可复现）。
- 已在隔离 web 宿主 `0.2.0-rc.2`（独立 `DSH_HOME` + 无头 Edge + `link:` 安装本仓库构建产物）实测：三枚面板均为 `body` 直接子节点、`position: fixed`，几何逐像素吻合（面板底距锚点顶 8px、左缘对齐锚点）；互斥、点外关闭、点面板内不关、Escape 关闭、窗口 resize 后跟随且不出视口均通过。用户消息 Markdown（strong/code/pre/list/link、@引用 chip、复制态）正常，XSS 探针（`<img onerror>`、`<script>`）被净化且未执行，`__dshCodinputErrs` 为空。未单独覆盖：滚动跟随、面板自身 ResizeObserver 分支、macOS 桌面实机目检。
- 桌面 `0.2.1-rc.3` 取证：从该版 `app.asar` 提取官方 CSS Modules 与主题 token，逐值核对 Switch 规则、stats / ContextMeter 面板的 portal+fixed 与背景/圆角、`--dsh-frame-top-clearance`，与 0.3.8 实现一致；macOS 毛玻璃/不透明度差异未实机目检。
- 0.3.7 已发布的三项功能（用户消息 Markdown、插件页图标、数据行三面板互斥）机制不变；本版修正其带图崩溃与安全基线，以及交互/样式细节。

[0.3.8]: https://github.com/Witherwithwinter/DSH-Codinput/compare/v0.3.7...v0.3.8

## [0.3.7] — 2026-10-29

用户消息 Markdown 渲染：右侧自己发出的消息按 Markdown 排版（设置可关）；插件页图标接入；数据行三面板唯一展开修复。

### 新增

- **用户消息 Markdown 渲染**（`UserMessageMarkdown`）：`conversation.chat.node` 键控座 user/steering 官方渲染器的 priority 遮蔽条目——气泡文本经 marked（GFM+breaks）+ DOMPurify 渲染，Markdown 样式逐条移植官方 MarkdownText.module.css；官方气泡形态全保留：附件行（图片走官方 `renderMessageImages` 座位 prop、文件卡复刻）、@文件/@会话//技能 引用 chip（官方 `projectUserText` 三组正则逐值复刻，文件/技能可点开）、复制钮与时间戳、引用摘要行、悬停显形（复刻官方 `data-actions-reveal` + `data-chat-flow-kind` 选择器面）。设置 → Codinput「用户消息 Markdown 渲染」开关（默认开）；关闭即卸载条目还原官方纯文本，无需刷新页面。行内代码与围栏代码块统一用 `--dsw-alias-markdown-code-block` 底色（深浅主题同色、随肤跟随）。已知边界：KaTeX 数学式、Shiki 代码高亮、代码块语言横幅不做；发送瞬间的本地回显不经该槽位，落库后即换 Markdown 形态。
- **插件页图标**：package.json 顶层 `"icon": "./assets/icon.png"`——宿主读取该字段（相对路径、限 SVG/PNG/JPEG/WebP、≤256 KiB）转 data URL，已装插件列表不再落默认图。

### 修复

- **数据行三面板唯一展开**：上下文小圈（`ContextGauge`）原先自持展开态，可与两枚统计胶囊同时展开（同时存在两个详情面板）；现并入 `StatsRow` 单一展开态，任意时刻至多一个面板。

### 说明

- **挂载面事实**：键控座每 key 低 priority 者胜，宿主动态包守卫对插件 register 强制分配唯一负秩——注册即遮蔽、卸载即还座官方（与 `composer.bar` 接管同机制）。
- **已实测**（真实 web 宿主 `0.2.0-rc.2`，本地 link 安装本仓库构建产物，Chromium 自动化探针）：Markdown 消息渲染语义正确（ARIA 树 paragraph/strong/code/list、截图目检排版）、设置开关不刷新页面即时切换形态、整页重载后持久消息保持 Markdown、复制/时间戳/引用 chip 行为正常、`__dshCodinputErrs` 为空；插件卡图标与 `assets/icon.png` 逐字节一致；轮步/用量/上下文三面板互斥展开（开新关旧、再点收起）实测通过。

[0.3.7]: https://github.com/Witherwithwinter/DSH-Codinput/compare/v0.3.6...v0.3.7

## [0.3.6] — 2026-10-28

模型座让位（issue #4）：`conversation.input.model` 单值座上的第三方遮蔽者恢复显示；出厂 ModelSelect 不镜像，继续由自绘模型芯片代表。

### 新增

- **`conversation.input.model` 单值座让位镜像**（`ModelSlot`）：以 priority 遮蔽宿主模型座的插件（reasoning-slider / dsh-effort-dial 一类）注册会成功、条目确实是单值座赢家，但官方 InputBar 被遮蔽后该座唯一的 `renderSlot` 调用点随之消失——「不报错、永不上屏」（issue #4）。接管工具行现于官方同位（`.dci-standard-controls` 内、`input.right` 之后）镜像该座赢家，并把官方 `InputControlOwnerProps` 的 owner prop `locked` 原样下发。有第三方遮蔽者时让位并隐藏自绘模型芯片（同座只留一个控件，与官方单值座语义一致）；无遮蔽者时保持既有自绘芯片（普通/悬浮/侧栏三形态同享）。
- **单值座「第三方遮蔽者」判据**（`isShadowingOccupant`）：宿主动态包守卫对非 chain 槽位的 register **强制**分配页内遮蔽秩（`options.priority` 为唯一负数）、fiber 名取 `dyn/<pluginId>`；出厂占用者（client-ui-model-selection 的 ModelSelect）不带 priority（≡0）。只镜像前者——镜像出厂条目会与自绘芯片重复成两个模型选择器。
- **让位失败降级**：条目 `inject(sessionId)` 是宿主 fiber 上下文里的闭包，插件侧调用会丢 ctx 绑定，依赖宿主服务面的 inject 会抛错（实测 dsh-model-accordion 0.2.1 的 `directoryFor` 抛 `cannot get property "remote.session" without inject`）。`entryInjectFailed` 预检 + 条目边界 `fallback` 让单值座在「inject 不可复现 / 组件崩溃」时回退自绘芯片，而不是留空或连坐输入面。

### 说明

- **已实测**（真实 web 宿主 `0.2.0-rc.2`，本地 link 安装本仓库构建产物，Chromium 自动化探针）：reasoning-slider 0.0.7 与 dsh-effort-dial 0.1.0 均在官方模型座原位显示（`.dci-standard-controls` 内 `input.right` 座位之后）、自绘芯片隐藏、弹层可打开并读出真实模型/推理档位；卸载插件后自绘芯片原样恢复；同屏右座（dsh-prompt-enhancer）无回归；`__dshCodinputErrs` 为空、无控制台报错。
- **降级实测**：dsh-model-accordion 0.2.1（带 inject 面）在模型座降级回自绘芯片——座位不空、无控制台报错，仅 `__dshCodinputErrs` 记一条 `slot.inject` 诊断（其 inject 依赖宿主 ctx，插件侧不可复现）。
- **机制覆盖未逐一实测**：悬浮 / 侧栏两形态与普通形态共用同一 Toolbar（座位自动同享）；`locked` 置灰只在会话拒绝交互时可见（官方语义 `removed || inert || !live`，Codinput 下发自身 `inert`，含 blocked，口径略严一档）。
- **边界**：第三方若自行给该座补声明 children 会与宿主已声明冲突（宿主 `already declared`），镜像层不做；多个插件同时遮蔽同一单值座属槽位竞争，由宿主 fail-loud。

[0.3.6]: https://github.com/Witherwithwinter/DSH-Codinput/compare/v0.3.5...v0.3.6

## [0.3.5] — 2026-10-23

第三方输入座位补齐（issue #1 之左座）：`conversation.input.left` 条目恢复显示；v0.3.4 的右座实现泛化为「座位镜像」层。

### 新增

- **左座 `conversation.input.left` 槽位转发渲染**：该子槽位位于官方工具行左区 `.tools` 内 modes（权限→计划）之后——issue 截图里的底栏按钮（如「上传视频」）、dsh-qoder-plugin 的额度读数等第三方条目注册在这里；遮蔽官方输入框后渲染点随条目一起消失。接管卡片工具行现于同位置（`.dci-tools` 内、权限触发器之后）复刻官方 renderer 的 list 合成，三形态（普通/悬浮/侧栏标签）同享。已在真实 web 宿主（`0.2.0-rc.2`）实测：座位条目渲染进左区几何正确位置、三形态一致、无横向溢出，卸载条目后零残留。
- **座位镜像通用引擎**：v0.3.4 的右座实现抽成 `InputSlotSeat`（座位名 + standard props 面参数化），左右两座共用同一套 list 合成（id 首占位去重 + order 升序）、条目 inject/`use<Name>` 钩子、条目 locale 的 `t`、standard props 原样通道与逐条目崩溃隔离；后续座位接入只需再加一片薄壳。

### 说明

- 检测即兼容：槽位无条目或宿主过旧（无该子槽位）时座位不渲染，零样式零行为残留；单个条目崩溃被边界隔离，不连坐输入面。
- 左右两座的 standard props 面同源：宿主下发给 bar/侧栏 body 条目的 kit 减去 owner props（侧栏再剔除注入的 `useTabInfo`）。
- **已知限制（本版边界）**：`conversation.input.model` 单座（如 dsh-model-accordion 类替换模型选择器的插件）与自绘模型芯片 UX 冲突，本版不镜像；`conversation.input.attachments` / `overlay` / `dock` 生态暂无租客，留扩展位。
- **覆盖边界（措辞分界）**：左座转发在真实 web 宿主（`0.2.0-rc.2`）上以确定性探针条目实测通过（渲染位置/三形态/卸载零残留）；dsh-qoder-plugin 的左额度读数与右探针双座条目实测注册成功、无报错，但其组件按官方契约在未选中 Qoder provider 时返回 `null`，可见读数属机制推断、未实测；左座席位的「上传视频」类插件真身未在本环境出现，同属机制覆盖（其注册形态与已实测样本同轴）。右座既有租客（dsh-prompt-enhancer）端到端回归实测不受影响。

[0.3.5]: https://github.com/Witherwithwinter/DSH-Codinput/compare/v0.3.4...v0.3.5

## [0.3.4] — 2026-10-23

第三方输入条目兼容（issue #1 之右座）：接管后 `conversation.input.right` 座条目恢复显示（已实测 dsh-prompt-enhancer 的 ✨/🎤）；模型/推理强度弹层恢复官方形态。

### 新增

- **`conversation.input.right` 槽位转发渲染**：该子槽位由官方 InputBar（`conversation.composer.bar` 缺省条目）声明并在其工具行内渲染；Codinput 以 priority -1 遮蔽官方条目后，槽位渲染点随官方输入框一起消失，注册在此槽位的第三方按钮（如 dsh-prompt-enhancer 的 ✨ 提示词优化 / 🎤 语音识别）无处挂载。接管卡片的工具行现于官方同座位（右侧标准控件区、模型选择之前）复刻官方 renderer 的 list 条目合成（id 首占位去重 + order 升序 + priority 遮蔽序、条目 inject/`use<Name>` 钩子、条目 locale 的 `t`、standard props 原样通道、逐条目崩溃隔离），三形态（普通/悬浮/侧栏标签）同享。
- **检测即兼容**：槽位无条目或宿主过旧（无该子槽位）时座位不渲染，零样式零行为残留；单个条目崩溃被边界隔离，不连坐输入面。

### 修复

- **菜单钻入子页后向下弹出**：`MenuSurface` 旧实现只在打开瞬间定位一次（尺寸变化不重算），从根菜单点进更长的「模型 / 推理强度」列表时，卡片保持小菜单算好的顶边向下生长、盖住触发器，视觉上变成「向下弹出」。现复刻官方 ModelSelect 的 `place()` 三路监听（ResizeObserver 挂卡片 + 页面 scroll/resize），内容尺寸每次变化即重算上方锚位并夹进视口。
- **模型选择框无滚动条**：旧 `.dci-menu` 把 `max-height: 100vh - 24px` 与 `overflow-y: auto` 压在卡片本体且未注入官方卡片的 `--dsh-scrollbar-thumb`（l2）变量；叠加上一条后卡片伸出视口被浏览器裁切，列表项既够不着也不出条。现按官方两级结构复刻——卡片 `overflow: hidden` + `max-height: min(360px, 100vh - 96px)`，列表在 `.dci-viewport` 内滚、细滚动条按官方 l2 变量着色；`popupSelect` 壳（命令选项弹层）同步内滚结构。

### 说明

- 官方渲染门槛同款复刻：`input === undefined || sessionId === undefined` 时整个座位不渲染。
- 条目声明 store 的 `useStore`/`actions` 面依赖宿主私有记账，插件侧不可复现；现网此类条目未出现。
- **覆盖边界**：本版转发的是 `conversation.input.right`（右座）；`conversation.input.left`（左座，如部分插件的「上传视频」按钮与 qoder-plugin 的额度读数）暂未转发，后续版本补齐。
- **右座覆盖面**：同座其他条目（如各 Qoder 渠道插件的积分/余额读数）按同一合成机制恢复显示——推断自各包源码的槽位注册（五家 Qoder 桥接包均注册于 right 座），未逐一实测。

[0.3.4]: https://github.com/Witherwithwinter/DSH-Codinput/compare/v0.3.3...v0.3.4

## [0.3.3] — 2026-10-23

主题/皮肤插件兼容：错误色与预览链接逐值对齐官方；README 增补皮肤作者指南。

### 变更

- **错误色回退值逐值对齐官方**：`.dci-error` 与完全权限确认警示图标的错误色回退值由 `#ff6b6b` 改为官方同款 `#d54941`（token 仍走 `--dsw-alias-state-error-primary`，仅无该令牌的宿主回退时可见差异）。
- **预览链接走官方 alias-link token**：markdown 预览的链接色由写死 `#4c8dff` 改为 `var(--dsw-alias-link, #4c8dff)`，换肤下与官方 markdown 链接同进退。

### 新增

- **README 皮肤作者指南（中英）**：新增「主题 / 皮肤插件兼容」章节——覆写宿主 `--dsw-*` token 即全盘生效（含 token 定义在 body 层、覆写需写同层的注意点）；官方写死的值清单（发送钮图标前景白等，属预期不跟 token）；稳定的 `dci-` 前缀类名契约与注入顺序（皮肤后注入按常规 CSS 权重覆盖）。

[0.3.3]: https://github.com/Witherwithwinter/DSH-Codinput/compare/v0.3.2...v0.3.3

## [0.3.2] — 2026-10-18

桌面版 0.2.1 模型区同步（官方 1017 发布徽章）；侧栏标签与指南页条目上品牌标。

### 新增

- **模型名 1017 发布徽章同步（桌面版 `0.2.1-rc.2`）**：官方给模型座位新增了模型名标签子槽位（`conversation.input.model.label`），并以内置插件给 DeepSeek 官方通道的 flash 模型显示名后追加一枚 info 色发布徽章「1017」。Codinput 原样渲染该槽位的官方条目组件——触发器、模型菜单根页与模型列表三处与原生输入框同款（徽章样式随官方插件自带注入）。官方未提供条目时（web 各版本、桌面 `0.2.0-rc.2` 及更早）自动回退纯模型名，与各自宿主的原生表现一致。
- **侧栏标签与指南页条目上品牌标**：侧栏标签芯片改走官方标签标题座位（`sidebar.right.pane.tab.title`，与官方 Files / Guide 标签同构），在标签名前渲染鲸鱼蓝 `#3964FE` 品牌标（此前是无图标的纯文本）；指南页「Codinput」条目同样以品牌标替换官方的灰色立方体兜底图标；拖出浮动后窗口标题同享。

### 变更

- **思考强度显示对齐官方公式**：会话未显式指定强度时回落当前模型的默认强度并显示其名字（此前一律显示「Default」，官方显示的是默认强度名，如 Max / High）；模型未提供推理元数据时显示会话保留强度。推理等级菜单在模型未声明默认强度时补官方的「Default（跟随提供方默认）」行；模型无推理元数据时不再显示强度入口（官方同款）。
- **触发器样式逐值对齐**：圆角走 `--dsw-radius-sm` 令牌链（无令牌的旧宿主回退原 24px 视觉）；模型触发器字重 400、权限触发器保持 500——官方两款触发器本就不同，此前共用类一律 500。

### 说明

- **检测即兼容**：模型徽章经官方槽位条目渲染，条目缺席时自动回退纯名，无样式无行为残留。桌面版 `0.2.1-rc.2` 端到端实测（徽章、强度显示、品牌标、触发器）；web `0.1.7-rc.2` 按官方包逐行取证（无该子槽位与徽章插件、目录快照字段一致）加守卫降级覆盖；`0.1.5-rc.2` / `0.1.6-alpha.2` 沿用既往结论。升级宿主后建议按 [TESTING.md](./TESTING.md) 冒烟。

[0.3.2]: https://github.com/Witherwithwinter/DSH-Codinput/compare/v0.3.1...v0.3.2

## [0.3.1] — 2026-10-11

编辑 + 预览分屏同步滚动；README 展示图与品牌视觉更新；第三方归属补全。

### 新增

- **分屏同步滚动**：编辑 + 预览分屏时两栏按滚动比例互随（两侧内容高度不同，按比例映射）；只保留编辑栏一个滚动条，预览栏藏起滚动条但滚轮仍可反向带动编辑器；进入分屏、草稿更新或切换会话后，预览按编辑器当前比例自动对齐。同时修复分屏内容过高时两栏都出不了滚动条的布局缺陷（grid 隐式行随内容撑高、不受 `max-height` 钳制——两栏改 `minmax(0,1fr)` + `min-height:0`）。

### 变更

- **README 展示图更新为桌面版实拍四图**（普通 / 编辑+预览分屏 / 悬浮 / 侧栏，2×2 布局），并改用**无损 webp**（体积约为原 PNG 的 1/4，像素级无损）；英文 README 与中文共用同一套配图（`assets/en/` 移除）；DSH 兼容徽章更新为 `0.2.0-rc.2+`（展示图摄于桌面版 `0.2.0-rc.2`）。
- **品牌图标重上色**：描边由紫蓝 `#4632DE` 换为 DeepSeek 鲸鱼蓝 `#3964FE`（README 头图、`icon.svg` / `icon.png` 同步，PNG 重渲染仍为 320×320 透明底）。
- **第三方归属补全**：内置依赖（CodeMirror 6、marked、DOMPurify）的版权行与许可声明集中进 [NOTICE](./NOTICE)——压缩产物不留许可注释，NOTICE 随 npm 包分发，覆盖源码与包两种安装路径。

### 说明

- 宿主兼容不变：桌面版（Electron，`0.2.0-rc.2`）与 `0.1.7-rc.2`（next）实测通过，`0.1.5-rc.2` / `0.1.6-alpha.2` 沿用既往结论；升级宿主后建议按 [TESTING.md](./TESTING.md) 冒烟。

[0.3.1]: https://github.com/Witherwithwinter/DSH-Codinput/compare/v0.3.0...v0.3.1

## [0.3.0] — 2026-10-02

官方桌面版语音输入同步：原生输入框有语音按钮时，Codinput 在一模一样的位置渲染一模一样的按钮。

### 新增

- **语音输入按钮同步（官方桌面版兼容）**：官方桌面版（Electron，`0.2.0-rc.2` 起）的输入框带语音输入按钮。Codinput 开启时在完全相同的位置（工具行右侧、模型选择器与发送钮之间）渲染**同一个官方语音组件**——`conversation.input.activity` 槽位条目原样渲染：麦克风触发钮、录音波形、转写、未就绪引导弹窗与中英文案全部是官方代码，官方后续更新自动跟随。录音展开时工具行行为也与官方一致（左侧工具与模型控件让位、capture 行接管整行、发送钮保留）。

### 说明

- **检测即兼容**：宿主未挂载语音插件（web 端各版本、桌面版语音插件关闭）时该槽位无条目，Codinput 同样不渲染按钮——与原生输入框行为一致；条目出现/消失经槽位订阅实时跟随（设置里开关语音插件即时生效）。按钮文案走官方 `voice-input` 词典（听写 / 开始录音 / 识别中… 等），不自备译文。
- **桌面版实测（Electron `0.2.0-rc.2`）**：授权麦克风 → 录音（波形）→ 停止 → 官方转写链路端到端通过；本地模型首次唤醒可能报「Unable to decode audio data」，重试即成功（官方输入框同样如此）。展开态布局、Escape/失焦取消、转写空结果与失败反馈均与官方一致。
- **web 宿主回归**：`0.1.7-rc.2` 实测无语音插件时按钮不渲染、工具行无任何变化，既往功能不受影响。
- 宿主兼容其余不变：`0.1.7-rc.2`（next）实测通过，`0.1.5-rc.2` / `0.1.6-alpha.2` 沿用既往结论；升级宿主后建议按 [TESTING.md](./TESTING.md) 冒烟。

[0.3.0]: https://github.com/Witherwithwinter/DSH-Codinput/compare/v0.2.0...v0.3.0

## [0.2.0] — 2026-09-29

品牌换新 + 一批交互补全：图片原图预览、发送/停止、侧栏 `/codinput` 退出与自动启用，以及输入卡片与数据行对官方布局的逐值对齐。

### 新增

- **品牌图标全面换新**：自绘机型标（代码括号 + 航迹 + 纸飞机）替代 lucide `file-code-corner`——README 头图、悬浮/侧栏唤回小球、slash 的 `/codinput` 命令图标全部换新（小尺寸做了可读性简化）；`assets/` 附透明 PNG、紫色矢量与白色线稿三件套。
- **附件图片原图预览**：点图片缩略图弹出全屏预览层（官方 primitives `ImageLightbox` 逐值复刻）——Esc、背板按下、右上关闭钮三种方式关闭，关闭后焦点还原缩略图。
- **发送 ⇆ 停止**：流式回复期间主按钮自动变停止（官方同款方块 glyph），点击即中断生成（官方 `conversation.cancel` 同链路）；会话阻塞（审批等待）时停止钮仍可点；回复结束或中断后恢复发送。
- **侧栏 `/codinput` 退出**：侧栏里输入 `/codinput` 回车——接管关闭、Codinput 标签自动关闭、官方输入框原样回归；重新打开标签（或再次 `/codinput`）即恢复接管。
- **开标签即启用**：未启用接管时，打开右侧栏的 Codinput 标签直接启用插件。

### 变更

- **slash「添加 · 文件」接管期间照常可用**：接管面按官方契约绑定会话文件拾取器（`bindFilePicker`），文件条目不再随官方输入框卸载而消失；工具行的独立附件按钮随之移除（官方已并入 slash），粘贴 / 拖拽路径不变。
- **slash 菜单排序修正**：空查询不再整列排序（会把「添加/指令」小节打散），改为 `/codinput` 单行按字典序排入指令节首，其余保持官方使用序。
- **输入卡片与数据行对齐官方布局**：surface 复刻官方 composer root（侧向 clearance + 底距）、数据行复刻官方 dock（无横向内缩、距卡片 4px、胶囊组居中），窄列下卡片宽度与官方逐像素一致；圆角/字号/行高改走官方令牌。
- **侧栏承载语义补全**：标签定义 `keepMounted` 保活（浏览同栏其他标签不丢承载）；承载以接管开关为前提（`/codinput` 退出即让位，重开自动恢复）；分栏多标签时编辑面跟随后被查看的一栏。
- **性能与用量取数对齐官方**：`sessionStats` 投影优先、chat 节点派生兜底——tok/s 为 decodeTokens÷decodeMs 的会话持久值（历史会话也显示），缓存命中/时长格式化同官方规则；数据行字号走官方 secondary-1px 公式。
- **README 全面重写 + 五张展示图重拍**（真实对话素材、深色主题）。

### 修复

- 唤回小球在「侧栏收起 + Codinput 浮动面板打开」时不再多余出现（输入就在眼前）。

### 说明

- 宿主兼容不变：`0.1.7-rc.2`（next）实测通过，`0.1.5-rc.2` / `0.1.6-alpha.2` 沿用既往结论；升级宿主后建议按 [TESTING.md](./TESTING.md) 冒烟。

[0.2.0]: https://github.com/Witherwithwinter/DSH-Codinput/compare/v0.1.1...v0.2.0

## [0.1.1] — 2026-09-25

适配宿主 `0.1.7-rc.2`（`next` 通道）的官方候选菜单亚克力改版；旧 rc 宿主经 token 回退链保持原样。

### 新增

- **候选框亚克力背景**：`/` `@` 候选菜单对齐官方 `0.1.7-rc.2`——官方此版起菜单表面改为 primitives `MenuSurface` 的 material 层（`--dsw-menu-surface-fill` ≈ 45% alpha + `backdrop-filter: blur(40px) saturate(150%)`），菜单本体不再自带背景。复刻菜单改为单元素合并两层，取值逐值一致；同一 token 链应用到指令菜单、数据行详情面板与上下文分段面板。
- **上下文小圈挪进数据行**：官方 `0.1.7-rc.2` 把上下文占用小圈从输入卡片工具行挪到卡片下方 dock 行（stats 胶囊之后），trigger 变为「双环仪表 + 百分比」药丸（padding 1px 8px、gap 6px、13px tabular-nums），且独立于 stats 胶囊渲染（无统计数据时也出现）。已逐值对齐。
- **候选菜单尺寸同步 rc.2**：max-height 320→400（`SlashMenu` 的 JS 上限常量同步修正——该常量以内联样式覆盖 CSS，仅改 CSS 不生效）、item 行 40px/14px→34px/13px（gap 8→6、radius→`--dsw-radius-md`）、图标 16→14px 且颜色走新的 `--dsw-alias-menu-icon`、分节标题/骨架屏/面包屑收紧值同步。

### 修复

- **上下文小圈数值与官方不一致**：官方 `contextOccupancy` 优先取 `projectedTokens`（含投影增长），缺失才退 `pressureTokens`；复刻此前只读 `pressureTokens`，导致启用 Codinput 前后小圈显示不同（如官方 3%、Codinput 2%）。已按官方语义修正（含分段面板 figures 取数）。

### 说明

- **双通道兼容**：`0.1.7-rc.2` 走新 token（亚克力、16px 圆角、menu-icon 色）；`0.1.5-rc.3` 等旧宿主没有这些 token，回退链落回原 rc.3 形态（不透明 `--dsw-specific-menu`、20px 圆角、无 blur），两端均与各自官方一致。
- 官方 rc.2 新增的候选菜单 `[data-overflow-below]` 底部渐隐未复刻（需宿主溢出方向状态，仅影响菜单向下展开的变体）。
- 测试状况（分两层）：静态层面，官方 CSS 从 `dsh-client-ui-theme` / `dsh-client-ui-input-trigger` / `dsh-client-ui-conversation` 的 `0.1.7-rc.2` 包内逐值提取核对；运行时层面，在实机 `0.1.7-rc.2` 上验证了暗/亮主题亚克力、悬浮形态菜单与小圈挪位（CI 仍只做静态把关，运行时零覆盖不变）。

[0.1.1]: https://github.com/Witherwithwinter/DSH-Codinput/compare/v0.1.0...v0.1.1

## [0.1.0] — 2026-09-23

首个公开版本。

### 新增

- **三态单实例输入入口**：普通 / 悬浮 / 侧栏标签三形态，任一时刻恰好一个，且绝不与官方输入框共存。
- **侧栏收起不让位 + 右上角小球**：侧栏收起后输入入口仍是侧栏那一个（不唤回普通模式，也不唤回官方输入框），标题栏下方出现圆形品牌小球，点击展开侧栏并聚焦 Codinput。小球 portal 定位、不占用官方槽位。
- **悬浮窗口式缩放**：四条边 + 四个角落 1:1 跟手，对边为锚点、不越出视口、不小于 360×140，位置与尺寸双记忆。
- **附件三入口**：点选文件、直接粘贴图片、把文件拖进卡片（拖入时描边提示）。
- **附件展示复刻官方**：图片 64×64 圆角缩略图、非图片文件卡（类型 glyph + 名称 + 「扩展名 体积」）、上传中 spinner 与进度条、失败红框整卡重试、轨道溢出时两端翻页箭头——取值逐条对齐官方 `dsh-client-ui-attachment`。
- **撤销历史跨形态保留**：编辑器状态按会话暂存，形态切换/会话切换后 `Ctrl+Z` 依然有效。
- **上下文小圈与数据行**：官方 composer stats 与上下文占用小圈的逐值复刻（含详情面板）。
- **界面多语言（中文 / English）**：全部文案走宿主 locale 服务（`ctx.locale.register` + `bind`），跟随宿主语言设置实时切换；宿主 locale 缺席时退回内置词典。README 提供[中文](./README.md)与 [English](./README.en.md) 两份。

### 说明
- 进入侧栏形态只经侧栏标签本身；早期内部版本的「拖入右侧栏 = 侧栏模式」手势已按产品决策舍弃。
- 偏好键为 `dsh-codinput.prefs.v2` 的 `mode: 'normal' | 'float'`（侧栏态由承载派生、不落盘）；早期内部版本的两态模型 `floating: true` 会自动迁移为 `mode: 'float'`。
- 发布产物为压缩 + 无内联 sourcemap（约 460 KiB）；`npm run build:dev` 保留未压缩 + 内联 sourcemap 的调试产物。
- 官方侧草稿灌入（pick / claim / 提交清空）不进撤销栈。

### 修复

- **侧栏标签里打字不落草稿**：编辑器回调走的是模块级单槽（跨形态复用 `EditorState` 必需），但卸载时无条件清空——侧栏 body 先挂载、主输入面晚一拍才卸载，于是晚卸载的旧实例把新实例的 hooks 摘掉。症状是在侧栏 Codinput 里打字只留在本地面板：不进草稿（刷新/关标签即丢）、行列指示不动、发送/换行手势失效。改为按实例身份清空（`clearActiveEditorHooks`）。

[0.1.0]: https://github.com/Witherwithwinter/DSH-Codinput/releases/tag/v0.1.0
