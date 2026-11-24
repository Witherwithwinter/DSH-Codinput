# 测试与冒烟清单

本项目的质量把关分为**三层**：

1. **自动静态与单测门禁**（`npm run prepublishOnly` / `.github/workflows/ci.yml`）：
   - `npm run check:popup`（`scripts/check-popup-contract.mjs`）：源码级架构与宿主契约自检（座位镜像、自适应浮层宿主、ShadowRoot 隔离、rc.3 注入面与构建 external 断言）。
   - `npm test`（`scripts/test-unit.mjs`）：14 组零依赖单元测试（快捷键解析与冲突检测、偏好归一化与 v2→v3 迁移、座位条目合成、Markdown 扩展与 XSS 净化、侧栏承载与 bar 注入总线、3D 悬浮与归位区几何、FLIP 过渡、编辑器文件拖放拦截）。
   - `npm run build`（`scripts/build.mjs`）：生产压缩构建 + `node --check` 语法自检；CI 同时检查 `git status --porcelain -- lib/`，确保入库的 `lib/client.js` 与当前源码构建结果逐字节一致（源码安装用户直接消费该产物）。
   - `npm run typecheck`（`tsc --noEmit`）：TypeScript 类型检查。
2. **隔离宿主 CDP 运行时探针**（`scripts/verify/`）：
   - `node scripts/verify/probe.mjs`：自起隔离 `@deepseek-ai/dsh@0.2.2-rc.3` 宿主 + 无头 Edge（CDP），自动验证 `normal / float / side` 三形态装载健康、`/` 与 `/model` 官方浮层几何、四向自适应选位与跨形态草稿同步（**23 项断言**）。
   - `node scripts/verify/probe-switch.mjs`：本地 mock 端点造两个非空会话，自动验证 `A → B → A → B → A` 往返切换后 `/` 候选菜单与 `/model` 弹层不失联（**6 项断言**）。
   - 详见 [scripts/verify/README.md](./scripts/verify/README.md) 与最新基线报告 [scripts/verify/BASELINE.md](./scripts/verify/BASELINE.md)。
3. **手工冒烟清单（本文档）**：
   - 覆盖自动化探针无法替代的桌面实机能力（Electron 语音组件、真实系统剪贴板与文件拖放、失败轮次 Continue 重试、长按 60 fps 体感、视觉排版与第三方插件联调）。

**手工验证准备**：执行 `npm run build`（发布产物）或 `npm run build:dev`（带内联 sourcemap 的调试产物），在桌面版宿主中强刷页面（profile 默认 `patchReload: live`）。

---

## 0. 载入与健康

- [ ] **零报错启动**：页面刷新后 `window.__dshCodinputErrs.length === 0`，控制台无 `pageerror` 或提及插件的 `console.error`。
- [ ] **注册表状态**：`window.__dshCodinputShell` 含 `apply: 'done'`、`bar: 'registered' | 'mounted'`、`settings: 'registered'`、`sidebar.body: 'registered'`、`sidebar.title: 'registered'`、`command: 'registered'`、`md.heavy: 'registered'`、`md.user: 'mounted'`、`md.steering: 'mounted'`（关闭「用户消息 Markdown 渲染」时为 `'unmounted'`），且没有任何 `'failed'` 项。
- [ ] **样式热更新（`patchReload: live`）**：替换 `lib/client.js` 后强刷页面，`<style id="dsh-codinput-styles">` 原位刷新 `textContent`，新增 `dci-` 样式类即时生效，无需清缓存或重装插件。
- [ ] **插件页图标**：宿主插件列表 / 已装插件卡显示 `assets/icon.png`，不回退默认图标。

## 1. 三态单实例（核心不变式）

任何操作后均须满足：`document.querySelectorAll('.dci-surface').length === 1`，`.dci-cm-host.shadowRoot` 内全局仅 **1** 个 `.cm-editor`，且官方输入框不存在（`[data-composer-seat]` 内除 `.dci-card` 外无其它可编辑控件）。

- [ ] **普通 `normal`**：接管卡片位于原输入位，`.dci-surface[data-side]` 与 `.dci-float` 均不存在。
- [ ] **悬浮 `float` 与 3D 悬浮（0.6.0）**：按住卡片顶部居中抓取条或空白区拖动（越过 6px 阈值）→ 脱出为 `.dci-float` 并跟手，底部出现可避让状态栏的虚线归位引导区（`pulling / idle / armed` 三态反馈）；松手在底部输入区之外 → 保持悬浮，刷新页面位置恢复；窗口缩小后悬浮卡自动夹回视口内；开启「3D 悬浮」后随视口中心呈球面朝向，拖动浮空并随松手弹簧自然落回。
- [ ] **悬浮 / 侧栏 ↔ 普通 GPU FLIP 过渡（0.6.0）**：将悬浮卡拖回底部归位区松手或开关侧栏标签 → 聊天内容区、底部渐变底板、归位卡片与回底按钮同步顺滑过渡，无首帧上跳闪动、无逐帧回流卡顿（悬浮位置与尺寸记忆保留）。
- [ ] **悬浮八向缩放**：拖动四条边与四个角落 → 1:1 跟手、对边锚定不动、不越出视口（12px 边距）、不小于 `360×140`；手动调高后外壳带 `data-sized` 且编辑区撑满卡片；刷新页面尺寸保持。
- [ ] **侧栏标签 `side`**：展开右侧栏 → 从指南页点「Codinput」（带鲸鱼蓝品牌标）→ 输入面出现在侧栏面板内，**主输入位为空**。
- [ ] **同栏切标签不让位**：在右侧栏加开「工作区文件」并切换过去 → 主输入位**仍不**回来（`keepMounted: true` 保持承载；页面重载后首次点选激活一次 Codinput 标签即恢复保活）。
- [ ] **侧栏收起不让位 + 小球唤回**：收起右侧栏 → 主输入位**不**回来，标题栏下方右上角出现 36px 圆形唤回小球（`.dci-ball`，右对齐、与官方侧栏按钮不重叠）；点击小球 → 侧栏展开并聚焦 Codinput 标签，小球消失。
- [ ] **关闭标签恢复主输入**：关闭侧栏 Codinput 标签 → 主输入按 `prefs.mode`（普通或悬浮）原样恢复。
- [ ] **分栏多标签单实例**：右侧栏分栏后两栏各开一个 Codinput 标签 → 编辑面归属当前激活/先开的一栏，另一栏仅渲染提示（`.dci-side-notice`），全局仍只有 1 个 `.cm-editor`。
- [ ] **`/codinput` 退出与自动启用**：
  - 经三条入口执行 `/codinput`（① 行首输入 `/codinput` 回车、② 鼠标点选 `/` 候选行、③ 点工具行 `+` 按钮后点选）→ 接管关闭、官方输入框回归且**草稿完整保留**（仅剥离 `/codinput` 命令 token）；
  - 在侧栏形态内执行 `/codinput` → 退回官方输入框（草稿保留）且 **Codinput 标签自动关闭**；
  - 接管关闭状态下，打开右侧栏 Codinput 标签 → **自动重新启用接管**。

## 2. 编辑器、草稿同步与连按性能

- [ ] **ShadowRoot 隔离与视觉对等（0.5.3）**：
  - `.cm-editor` 与右下角行列指示器 `.dci-pos` 挂载在 `.dci-cm-host` 的 open ShadowRoot 内；
  - 浅/深色主题下原生光标颜色（`caret-color`）与品牌强调色一致、选区高亮可读、滚动条样式与宿主一致；
  - **行号三位预留**：开启行号时，1 行即预留 3 位宽度（`calc(3ch + 16px)`，`tabular-nums`），行数从 `9 → 10`、`99 → 100` 时**正文零横向位移**，超过 999 行自然增宽；关闭行号后编辑区宽度正常；
  - 当前行与行号高亮、软换行、`Tab` 插入缩进（不夺焦点）、右下角「行, 列」实时更新均正常。
- [ ] **编辑器字面渲染（无字体连字）**：编辑器内输入 `->`、`//`、`=>` 始终显示字面独立字符（不合成箭头或连字 glyph，避免桌面端 Chromium 字体 shaping 造成「丢字符」误判）；`.cm-content` computed `font-variant-ligatures: none`。
- [ ] **中文输入法（IME）**：中文拼写选词按回车仅确认上屏，**绝不误触发送**。
- [ ] **长对话 / 长草稿连按 60 fps 满帧（0.5.3 重点）**：在含大量历史消息的会话中，分别测试：
  - 空草稿长按 `Enter` 自动增高、长按 `Backspace` 连续删空；
  - 粘贴 ≥300 行长草稿后长按 `Enter` 连续换行、长按 `Backspace` 连续删行；
  - 开启「编辑 + 预览分屏」下长按 `Enter` / `Backspace`；
  - 判据：光标与画面跟手无顿挫；松手后自动增高高度收敛，分屏预览在停手约 140 ms 后刷新且按比例同步滚动。
- [ ] **草稿跨形态、跨会话与生命周期不丢字**：
  - **撤销历史跨形态**：打字 → 拖成悬浮 → 切到侧栏 → `Ctrl+Z` 仍能撤销刚才输入的内容；发送消息或官方补全回灌后按 `Ctrl+Z` **不会**把已发送内容拉回编辑器；
  - **极速切形态（`<500ms`）**：打字后未满 500 ms 立即拖动脱出悬浮 / 开关侧栏标签 / 拖回普通 → 文本一字不少，编辑器与官方草稿完全一致；
  - **同帧发送**：打字后同一帧立即点击发送钮（或按发送快捷键）→ 正常发送，不误判为空草稿；
  - **外部改写同步**：`/codinput` 退出后在官方输入框修改草稿 → 重新进入接管 → 编辑器显示最新草稿；
  - **会话切换与页面生命周期兜底**：会话 A 打字后立即切到会话 B 再切回 A → A 草稿完整且不串入 B；输入最后几个字符后 500 ms 内触发 `pagehide` / 最小化 / 刷新（桌面端），宿主草稿立即落盘不滞后。

## 3. 触发管线、候选菜单与指令弹层

- [ ] **官方 `MenuView`（`/`、`@`）与 `PopupSelectView`（`/model`、`/permission`）**：
  - **普通 `normal`**：浮层在 `.dci-overlay-anchor` 内卡片上方弹出（`bottom = card.top - 4`、与卡片等宽，无 `data-adaptive`）；
  - **悬浮 `float`**：锚点启用自适应宿主（`.dci-overlay-anchor[data-adaptive]`，`data-mode="dd"` + `data-placement="top|bottom|left|right"` + `--dci-overlay-maxh`）；将悬浮卡拖到视口顶部时自动改选 `bottom`/侧向（高度充足、绝不压成 0 高），与卡片零交叠、完整在视口内；菜单打开状态下拖动悬浮卡或缩放窗口时实时重排跟随；
  - **侧栏 `side`**：浮层优先落在右侧栏左侧的对话区（`data-placement="left"`，菜单右边缘 ≤ 右侧栏 pane 左边缘），不被侧栏裁剪、不遮挡侧栏编辑区。
- [ ] **候选分组与键盘/鼠标交互**：
  - 输入 `/` 空查询下「添加 / 指令 / 技能」各节连续，「文件」在添加节首，`/codinput` 按字典序排在指令节首；工具行 `+` 按钮可程序化唤起 `/` 菜单；
  - 输入 `@` 显示文件与会话候选，支持 `Tab` / 右向箭头钻取子目录与底部 crumbs 导航；
  - 菜单打开时 `↑↓` / `Enter` / `Tab` / `Esc` 由菜单消费；**菜单关闭时 `Enter` 正常换行**；鼠标点选或键盘确认均正确替换触发词（`draftRev` CAS 命中），退格删掉 `/` 后菜单立即关闭。
- [ ] **`/model` 与 `/permission` 弹层**：搜索过滤、清除按钮、`Tab` 确认 / `Shift+Tab` 关闭、`↑↓` 环绕、点外部关闭均与官方一致；`/permission` 选 Full access 时弹出官方风险确认模态。
- [ ] **切换会话后 `/` 菜单不失联（0.5.2 回归点）**：准备两个非空会话，执行 `A → B → A → B → A` 往返切换（普通 / 悬浮 / 侧栏三形态下皆可），每次回到会话后输入 `/` 候选菜单及 `/model`、`/permission` 弹层均须正常出现（注：该回归全程无报错，须以面板实际弹出为准；自动化探针为 `node scripts/verify/probe-switch.mjs`）。

## 4. 工具行、附件与数据行

- [ ] **工具行对齐与响应式**：`+` 指令钮（28×28）、权限、计划 chip、左/右扩展座、模型选择、语音按钮、发送/停止钮（34×34）；窄容器（`content-box ≤ 560px`）间距自动由 12px 收至 8px、模型文字 compact 收起。
- [ ] **模型选择器（官方 `ModelSelect` 镜像）**：点击触发钮无焦点环闪烁；两段式根菜单「模型 / 推理等级」、搜索框（目录 `>4` 条时）、分组吸顶标题、模型名旁 `1017` 等官方发布徽章子槽（`model.label` / `model.options`）、加载失败重试条带均与官方 `/model` 同步。
- [ ] **权限选择器**：三档预设 + 专属盾牌 glyph；选「完全权限」弹确认模态（portal 居中不裁切、勾选后生效）；只读或禁用态下不可点击。
- [ ] **语音按钮（桌面版）**：桌面版启用 `voice-input` 插件时，模型与发送钮之间渲染官方麦克风组件（录音波形、转写、未就绪引导全官方），关闭语音插件后按钮消失。
- [ ] **发送 / 停止 / 继续生成（Continue）主按钮**：
  - 草稿与附件皆空时发送钮禁用；键盘空草稿发送手势转为队列 Steer；
  - 流式回复运行中：sending 旋转态与独立停止方块按钮（含审批等待 blocked 态可中断），草稿非空时按官方 steer/queue 显示「排队发送 / 插话发送」；
  - **失败轮次继续生成（rc.3）**：会话出现失败轮次且输入面干净（草稿/附件/队列皆空、非运行中、无待回答问题）时，主按钮变为官方 **Continue 三角 + Tooltip「继续生成」**（普通 / 悬浮 / 侧栏三形态均生效），点击后调用 `retry(failureSeq)` 重试。
- [ ] **官方 Tooltip**：悬停工具行按钮、右上角编辑/预览开关、侧栏唤回小球、数据行胶囊、用户消息复制钮约 500 ms 后出现官方深色气泡提示（`aria-describedby` 生效，无原生 `title` 双重提示）。
- [ ] **附件行（官方 `ComposerAttachments` 镜像）与文档级粘贴路由**：
  - 三条入口：slash「添加 · 文件」、**粘贴图片/文件**（含编辑器聚焦内粘贴与未聚焦编辑器时的**文档级粘贴路由** `registerFileIntake`，普通与侧栏形态均生效）、**拖文件进卡片**（出现官方 DropOverlay；拖放 `.html` / `.txt` 等文本类文件进编辑区仅添加附件，源码不进入草稿）；
  - 渲染官方 64×64 图片缩略图与官方 FileCard（名称、扩展名、体积、上传进度条、失败红框重试），非回退态下自绘 `.dci-attach-*` 元素数为 0；
  - 点击图片缩略图打开官方原图预览灯箱（`Esc` / 背板点击 / 右上关闭钮可关，关闭后焦点归还缩略图）。
- [ ] **底部数据行（`composer.dock` 原样镜像 + 上下文占用小圈，0.6.0）**：
  - 底部数据行（`.dci-stat-root[data-composer-dock="true"]`）固定锚定在对话区底部原位，不随 `normal / float / side` 切换移动或重挂，窄窗自动折行防叠字，新会话 hero 态不渲染；
  - `<div data-slot="conversation.composer.dock" style="display: contents">` 原样镜像官方与第三方状态栏条目（不再自绘统计胶囊）；上下文占用小圈点击展开分段面板（portal 到 `body`、`position: fixed`、滚动/resize 跟随、`Escape` 或点外部关闭）。

## 5. Markdown 渲染与安全基线

可使用以下综合 Fixture 同时在「分屏预览」与「已发送用户消息（开启用户消息 Markdown）」中对照检验：

````markdown
## 标题
| 左 | 中 | 右 |
| :-- | :-: | --: |
| a | b | c |

- [x] 已完成
- [ ] 未完成
  - [ ] 嵌套

~~删除线~~ https://example.com

正文脚注[^1]。

[^1]: 脚注内容。

> [!note] 提示
> 正文
> [!warning]- 默认收起
> 折叠内容

==高亮== %%这是注释%% [[目标笔记|别名]] ![[图片.png]]

![图|300](https://example.com/a.png)

```js
const x = 1;
```

行内 $E=mc^2$ 与块级：

$$
\int_0^1 x^2\,dx
$$

```mermaid
flowchart LR
  A[Start] --> B[End]
```
````

- [ ] **双端管线一致性**：预览面板（`.dci-preview`）与用户消息气泡（`.dci-umsg-md`）渲染结构一致；用户消息里的 `@文件` / `@会话` / `//技能` 引用 chip、复制钮、时间戳与悬停显形正常。
- [ ] **带图用户消息与问答回执**：带图片附件的用户消息经官方 `conversation.chat.user.images` 渲染官方缩略图并可点开原图灯箱（不退化为文件卡）；`ask_user_question` 回答只渲染官方 `[data-question-reply]` 回执卡片。
- [ ] **GFM 与 Obsidian 语法**：表格列对齐与宽表横向滚动；任务清单只读勾选；脚注上标与文末回跳（预览与多条消息间 ID 独立不串）；8 类 Callouts 配色/折叠/浅深色对比度达标；`==高亮==` 底色；`%%注释%%` 隐藏（代码块内 `%%` 原样保留）；`[[wikilink|别名]]` 点击复制目标名；`![图|300](url)` 保留宽度属性且点击打开官方灯箱。
- [ ] **代码、公式与 Mermaid（零网络请求）**：highlight.js 46 种语言高亮 + 复制按钮；KaTeX 行内/块级公式渲染且 **DevTools Network 零外联字体请求**（`$5 and $10` 不误判为公式，错误公式回退源码）；Mermaid 12 类常用图表可见时懒渲染、切换浅/深色主题自动重绘，语法错误或未内置图类型（如 `sankey`）回退「源码 + 错误提示」。
- [ ] **Markdown 正文等宽连字开关**：开启（默认）时预览与用户消息正文及行内代码中的 `->`、`=>`、`//` 呈现连字字形（DOM `textContent` 与复制内容仍为原字符）；关闭后立即恢复普通阅读字体；**编辑器输入框始终保持字面字符**。
- [ ] **安全基线**：输入 `<script>`、`<img onerror>`、`<style>`、`<iframe>`、手写 `<span data-dci-wire="...">`、`[x](javascript:alert(1))`、`![x](data:image/png;base64,...)` → 全部被转义或净化，不执行脚本、不改写页面样式、不产生伪造会话 chip、非 `http(s)/mailto` 链接不可点；KaTeX `\href` 不生成链接（`trust: false`）；Mermaid 恶意 label 经 DOMPurify 净化。

## 6. 设置与偏好持久化

- [ ] **设置 → Codinput 控件**：启用接管（关闭即还原官方输入框且草稿不丢）、用户消息 Markdown 渲染（开关即时切换已落库消息形态，无需刷新）、显示行号、Markdown 等宽连字、**3D 悬浮**、编辑器字体（支持完整清空后重新输入）、发送/换行快捷键录制（支持任意组合键、冲突拒绝、自定义换行键可正确替换当前选区）、默认视图与一键恢复默认设置。
- [ ] **官方同款 Switch 与下拉菜单**：开关尺寸 `36×20`、`999px` 圆角、ON 轨道跟随 `--dsw-alias-brand-primary`、键盘 `focus-visible` 显示官方焦点环；设置页下拉菜单（`.dci-menu`）portal 到 `body`，滚动/缩放实时跟随且支持 `Escape` 与连点开合。
- [ ] **偏好存储与迁移**：刷新页面后偏好保持（`localStorage['dsh-codinput.prefs.v3']`）；多标签页修改自动同步；存储写入脏 JSON 不崩溃并回退默认值；旧版 `.v2` 键首次加载后一次性迁移至 `.v3`（自动修正历史坏值 `shift-enter` → `shift+enter`）并清理旧键。

## 7. 第三方插件与子座位兼容

官方 InputBar 的全部 9 个子座位（`left` / `right` / `model` / `permission` / `plan` / `activity` / `overlay` / `attachments` / `composer.dock`）均按官方语义镜像，单条目报错由 `EntryBoundary` 隔离并在切会话时自动复位：

- [ ] **`conversation.composer.dock`（如 `dsh-cost-meter`、`dsh-desktop-statusbar`）**：完整保留官方 `[data-composer-dock="true"]` 与 `<div data-slot="conversation.composer.dock">` 结构，官方 `ActivityPill` / `UsagePill` 与追加型插件（如 `dsh-cost-meter`）、替换型状态栏插件（如 `dsh-desktop-statusbar`）均按官方语义原样生效，普通 / 悬浮 / 侧栏切换不导致状态栏卸载重挂，卸载第三方插件后零残留。
- [ ] **`conversation.input.overlay` 与 `attachments`（如 `dsh-context`、`@knyazevai/dsh-client-ui-attachment`）**：在 `normal / float / side` 三形态下，`/context` 弹层与第三方附件 rail 均正常渲染且不被裁剪，`__dshCodinputErrs` 为空。
- [ ] **`conversation.input.left` 与 `right`（如 `dsh-prompt-enhancer`）**：第三方工具按钮按官方 order / priority 出现在工具行对应位置。
- [ ] **`conversation.input.model` 第三方替换与降级**：
  - 安装 `reasoning-slider` 或 `dsh-effort-dial` 等模型座插件 → 按官方单值座负优先级语义让位显示第三方控件，卸载后恢复官方 `ModelSelect`；
  - 安装 `dsh-model-accordion`（其 `inject` 闭包依赖宿主私有 `remote.session`，插件侧不可复现）→ 安全**降级回自绘模型芯片**（座位不留空、输入面不崩溃），`__dshCodinputErrs` 仅记录一条 `slot.inject` 诊断。

## 8. 隔离宿主自动化与宿主升级验证

日常回归或升级宿主版本时，优先运行隔离宿主 CDP 自动化探针（不触碰真实 `~/.dsh`）：

```bash
node scripts/verify/probe.mjs          # 三形态几何、/ 与 /model 浮层、跨形态草稿（23 项）
node scripts/verify/probe-switch.mjs   # 双会话 A↔B 往返切换后 / 与 /model 回归（6 项）
```

如需手动在独立环境中测试新宿主通道（如对比 `latest` / `next` / `alpha`）：

```bash
# 查看宿主当前 npm 通道版本（当前目标宿主为 0.2.2-rc.3 desktop）
npm view @deepseek-ai/dsh dist-tags

# 安装目标版本到临时目录并以独立 DSH_HOME 启动（见 scripts/verify/README.md）
npm i --prefix "%TEMP%/dsh-verify/rc" @deepseek-ai/dsh@0.2.2-rc.3
```

宿主大版本升级后，重点复验 **§1 三态与侧栏承载**、**§3 触发管线与浮层选位** 以及 **§4 官方座位镜像**——宿主槽位契约或 CSS token 变动最先反映在这三处。
