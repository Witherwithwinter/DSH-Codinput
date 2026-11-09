# 冒烟清单

**本项目没有自动化测试**：这是 UI 插件，行为依赖宿主 alpha 的槽位遮蔽、输入机与侧栏内部结构，跑不起 DOM 级别的用例，成本收益不划算。

`.github/workflows/ci.yml` **不是测试套件，只做静态把关**——`npm ci` 装依赖、`tsc --noEmit` 类型检查、发布构建（压缩、无内联 sourcemap）、产物自检（bundle 非空、含 `__ModuleLoader__.load`、无内联 sourcemap）。它不加载页面、不连宿主、不跑任何交互，所以**运行时行为它是零覆盖**：CI 全绿只说明「类型对、构建得出、发出去的不是调试产物」。

凡是「功能到底对不对」的问题，都靠下面这份清单手动过。改完代码、升级宿主、发布前，在内置浏览器/浏览器里走一遍。

准备工作：`npm run build`（发布产物）或 `npm run build:dev`（调试用，源码可读），强刷页面（宿主 `patchReload: live` 下改 `lib/client.js` 只需刷新）。

> 推 GitHub / 发 npm 之前确保 `lib/client.js` 是**当前源码**构建出来的：仓库带构建产物，走源码安装的人是直接用这份的。CI 只重建、不比对，`git status lib/` 有改动就说明提交里的产物落后于源码（构建可复现，同源码两次构建哈希一致）。

## 0. 载入与健康

- [ ] 页面刷新后无报错：`window.__dshCodinputErrs.length === 0`
- [ ] `window.__dshCodinputShell` 含 `apply: 'done'`、`bar: 'registered'`、`settings: 'registered'`、`sidebar.body: 'registered'`、`md.user: 'mounted'`、`md.steering: 'mounted'`（用户消息 Markdown 开关关闭时为 `unmounted`）
- [ ] `__dshCodinputShell` 里没有 `failed` 项（槽位废黜会记 `slot.entry` 错误）

## 1. 三态单实例（核心不变式）

任何一步之后都断言：`document.querySelectorAll('.dci-surface').length === 1`，且官方输入框不存在（`[data-composer-seat]` 里除 `.dci-card` 外没有可编辑元素）。

- [ ] **普通**：接管卡片在原输入位，`.dci-surface[data-side]` / `[data-float]` 都不存在
- [ ] **悬浮**：按住卡片顶部行空白区拖动 → 脱出为 `.dci-float`，跟手；松手在底部输入区之外 → 保持悬浮
- [ ] **悬浮 → 普通**：拖回底部输入区松手 → 回到原位（位置/尺寸记忆保留）
- [ ] **悬浮缩放**：拖四个边与四个角落 → 1:1 跟手、对边不动、不越出视口、不小于 360×140；松手后刷新页面尺寸保持
- [ ] **侧栏**：展开右侧栏 → 从指南页点「Codinput」→ 输入面出现在侧栏，**主输入位为空**
- [ ] **浏览其他标签不让位**：同栏加开「工作区文件」并切过去 → 主输入**仍不**回来（Codinput 标签存在即承载，靠 `keepMounted:true` 保 body 挂载）
- [ ] **重载后激活一次**：重载页面（侧栏恢复 Codinput+文件双标签、文件选中）→ 主输入先回来；点一次 Codinput 标签再切走 → 主输入不再回来（dockkit 对重载恢复的标签是惰性挂载，激活过才保活）
- [ ] **侧栏收起不让位**：收起右侧栏 → 主输入**不**回来，右上角出现圆形小球（标题栏下方、右对齐、与官方侧栏按钮不重叠）
- [ ] **小球唤回**：点小球 → 侧栏展开且 Codinput 可见，小球消失
- [ ] **退出侧栏**：关闭 Codinput 标签 → 主输入按 `prefs.mode` 原样恢复（普通卡片或悬浮）
- [ ] **侧栏内 /codinput 退出**：侧栏编辑器输入 `/codinput` 回车 → 接管关闭，**官方输入框**回到原位且**草稿保留**（命令 token 消失、其余内容不丢），**Codinput 标签自动关闭**（经 tab 域 `actions.close`；关闭唯一标签时侧栏随之收起）；重开标签或 /codinput → 侧栏形态恢复（开标签自动启用）
- [ ] **复制标签**：右侧栏「分栏」后，两栏各开一个 Codinput 标签 → 编辑面跟随后被查看的一栏，两栏都可见时先开者持有、另一个只出提示；全局仍只有 1 个 `.cm-editor`

## 2. 编辑与草稿

- [ ] 输入中文（输入法）→ 选词回车**不发送**、正常上屏
- [ ] 行号/当前行高亮/软换行/行列指示正常；Tab 插入缩进不夺焦点
- [ ] **撤销历史跨形态**：打字 → 拖成悬浮 → `Ctrl+Z` 能撤销刚才的字（不是撤销成空）
- [ ] **侧栏键入回写**：在侧栏标签里打字 → 关掉标签，主输入位应带着刚打的内容；侧栏内移动光标，「行, 列」指示实时更新（回归点：编辑器 hooks 是模块级单槽，若卸载时无条件清空，晚卸载的旧实例会把新实例的 hooks 摘掉——症状就是侧栏里打字不落草稿、行列指示不动、发送手势失效）
- [ ] **官方侧灌入不进撤销栈**：发送一条消息后按 `Ctrl+Z`，不应把已发送内容拉回编辑器
- [ ] **`/codinput` 退出不丢草稿（0.4.0 回归点）**：先打一段草稿（如 `DRAFT-MARKER`），再经三条入口退出接管——① 行首输入 `/codinput` 后菜单内回车、② 鼠标点选 `/codinput` 候选行、③ 工具行指令按钮程序化唤起菜单后点选——退出后官方输入框应保留草稿（仅命令 token 不残留）；再次 `/codinput` 进入接管，编辑器里草稿仍在
- [ ] **编辑器字面渲染（0.4.0 起不做字体连字）**：编辑器里输入 `->`、`//` → 显示字面两个字符（不显示箭头/合并字形）；`.cm-content` computed `font-variant-ligatures: none`、`font-feature-settings` 含 `"calt" 0`；与预览 / 用户消息的纯文本一致；设置里不再有「字体连字」项
- [ ] **旧版偏好升级（0.4.0）**：浏览器 localStorage 里若只有旧键 `dsh-codinput.prefs.v2` → 首次加载后生成 `dsh-codinput.prefs.v3`（旧坏值 `shift-enter`→`shift+enter`、旧字段删除；遗留 `fontLigatures` 字段被忽略并丢弃）、旧键删除；用户自己改过的快捷键/字体/形态等偏好保留
- [ ] 草稿在 形态切换 / 刷新页面 / 切换会话 后都不丢

## 3. 触发管线与菜单

- [ ] 输入 `/` → normal 形态候选菜单在卡片上方弹出（`bottom = 卡片顶 − 4`、`max-height = min(400, 卡片 top − 16)`）；侧栏 / 悬浮态改为 portal 到 body 的 `position: fixed` 四向自适应浮层——落在卡片周围空位（右侧栏优先左侧对话区），**与卡片零交叠、不遮编辑区**、完整在视口内（margin 12）、内容超高时菜单内滚动；拖动悬浮卡 / 缩放窗口 / 拉伸侧栏时菜单跟随；组标题本地化
- [ ] 输入 `@` → 文件/会话候选、section 小节标题、钻取（Tab/chevron）、crumbs 正常
- [ ] 菜单打开时 ↑↓/Enter/Tab 由菜单消费；**菜单关闭时 Enter 是换行**（不被吞）
- [ ] 鼠标点击候选能补全；卡片内按下不关闭菜单
- [ ] 工具行 `plus` 按钮能程序化唤起 `/` 菜单

## 4. 工具行控件

- [ ] 模型下拉：显示当前模型与推理等级，切换后宿主 `/model` 一致
- [ ] **第三方模型座插件让位**：`dsh plugin --profile web add reasoning-slider`（或 dsh-effort-dial）后重载 → 模型座原位显示该插件的「模型 + 推理档位」触发器、**自绘模型芯片消失**；点开弹层能列出模型分组/档位；卸载插件重载 → 自绘芯片原样回来（issue #4 的修复路径）
- [ ] **模型座让位失败降级**：装 dsh-model-accordion（其 inject 依赖宿主 ctx，插件侧不可复现）→ 座位**降级回自绘芯片**（不留空、不崩输入面），`__dshCodinputErrs` 有且仅有一条 `slot.inject` 诊断，`__dshCodinputShell` 无 failed 项
- [ ] **模型座 locked**：会话不可交互（审批等待 / 权限拒绝等 `inert` 态）时，第三方模型座控件按自身 `locked` 语义置灰（不消费 `locked` 的插件不置灰属其契约）
- [ ] 权限下拉：三预设 + glyph；选「完全权限」弹确认模态（勾选后才能启用）
- [ ] 附件：slash「添加 · 文件」（接管期间**照常可用**——接管面绑定 shell filePicker）、**粘贴图片** / **拖文件进卡片**（拖入时有描边提示）都能入草稿并出现芯片；移除附件正常；工具行**无**附件按钮
- [ ] **图片预览**：点图片缩略图 → 原图预览层（全屏遮罩+大图+右上关闭钮），Esc/背板按下/关闭钮三种方式可关，关闭后焦点还原到缩略图
- [ ] slash 菜单分组：空查询下 添加/指令/技能 各节连续（节头不重复），「文件」在添加节首，`/codinput` 在指令节首（字典序）
- [ ] **开标签即启用**：/codinput 退出后关闭 Codinput 标签再重新打开 → 自动恢复接管
- [ ] 发送按钮：草稿与附件皆空时禁用；空草稿手势转队列 Steer
- [ ] **停止形态**：流式回复期间主按钮变停止（停止方块 glyph、aria「停止」，含 blocked 审批等待），点击即中断（会话尾部出官方「已停止」状态）；回复结束/中断后恢复发送；运行中草稿非空时按钮保持发送（提交走 steer/queue）
- [ ] 数据行与官方逐值一致：`{turns} 轮 {steps} 步 · {tps} tok/s`（tok/s = decodeTokens÷decodeMs，历史会话也有值）+ `{total} · 缓存命中 {pct}%` + 小圈；统计面板四行（模型用时/工具调用用时/TTFT 均值/TPS）与用量面板（缓存命中/未缓存输入/缓存读取/缓存写入(≠0)/输出）同官方语义
- [ ] 上下文小圈：百分比与分段面板数据合理
- [ ] **三枚详情面板互斥**：会话统计 / Token 用量 / 上下文分段任意时刻至多一个展开；开新面板关旧面板，再点同一枚收起
- [ ] **面板 portal 定位**：戳开面板后滚动页面、改窗口尺寸 → 面板跟随锚点、夹在视口内（margin 12 / 帧顶 clearance），不被输入卡片或 overflow 容器裁剪；点面板内部不关闭，Escape / 点外关闭；面板背景走 `--dsw-specific-menu`（旧宿主回退 `--dsw-menu-surface-fill`）、圆角 `--dsw-radius-lg`

## 5. 设置

- [ ] 设置 → Codinput：启用接管（关闭后官方输入框原样恢复、草稿不丢）、行号、字体、发送/换行快捷键录制（任意组合、冲突拒绝）
- [ ] **用户消息 Markdown 开关**：设置 → Codinput 打开/关闭「用户消息 Markdown 渲染」→ 已落库的用户消息即时在 Markdown / 官方纯文本间切换（不刷新页面），关闭状态刷新后保持
- [ ] **设置页开关样式**：36×20、999px 圆角；ON 轨道颜色随宿主 `--dsw-alias-brand-primary`（浅/深主题各自跟随）、滑块走 `--dsw-alias-switch-thumb`；disabled 半透明、键盘 focus-visible 出官方 focus ring
- [ ] 偏好刷新后保持（`localStorage['dsh-codinput.prefs.v3']`；旧键 `.v2` 只会被一次性迁移后删除）

## 6. 回归提示

- 宿主升级后，重点复验第 1 节的**三态与侧栏承载**、第 3 节**菜单**（宿主席位/令牌变化最先断在这里）。
- 槽位条目渲染崩溃会被「废黜」（本注册周期内永久改用下一条目）：症状是形态卡住/输入面消失，先看 `__dshCodinputErrs` 里的 `slot.entry`。

## 7. 换通道验证（rc / alpha）

宿主在 npm 上有三个通道，**普通用户拿到的不是 alpha**：

```bash
npm view @deepseek-ai/dsh dist-tags   # latest / next = 当前 rc（2026-11-06 同指 0.2.2-rc.1）；alpha = 更超前（0.2.2-alpha.3）
dsh --version                         # 你本机实际跑的那个
```

`latest` 通道发的是 rc（当前 `latest` / `next` 同指 `0.2.2-rc.1`），所以「装了 dsh 插件却跑不起来」的报障大概率发生在 rc 上。开发机可以待在 alpha，但**对外声称的兼容范围应当以 rc 为准**，至少在 rc 上跑一遍第 1、3 节。

> **已验记录**：web 宿主 `0.2.0-rc.2` 为 0.3.x/0.4.x 验证基线（0.3.5–0.3.7 均在本机 link 安装下以 Chromium 自动化探针实测，见 CHANGELOG）；桌面版 `0.2.1-rc.2` 的语音同步于 0.3.2 实测通过；现网 `latest` / `next` = `0.2.2-rc.1`（2026-11-06 实测）；web 宿主 `0.2.2-rc.1` 的菜单专项（0.3.9 / PR #5）已在隔离宿主以无头 Edge 自动化探针验收（33/33 断言通过：portal / 几何 / 跟随 / 开合 / resize）；0.4.0 的 `/codinput` 退出草稿保留、连字与悬浮/侧栏候选菜单四向浮层已在隔离 web `0.2.0-rc.2` 宿主以无头 Edge 探针验收；**0.4.0 的底部工具行逐值对齐 / 麦克风恢复 / 用户消息图片灯箱 / prefs 迁移与统计边界 / 编辑器字面渲染（移除连字）已在隔离 web `0.2.2-rc.1` 宿主以无头 Edge 探针验收**（宿主版本与用户桌面版 `0.2.2-rc.1` 相同）。换宿主版本后请重新走一遍下面这节。

不动现有安装的验证方式（独立 prefix + 独立 `DSH_HOME`，不碰你在用的 profile 与会话）：

```bash
# 1) 把另一个通道装到临时 prefix，不覆盖全局安装
npm i --prefix /tmp/dsh-rc @deepseek-ai/dsh@0.2.2-rc.1

# 2) 复制一份独立 home（含带 codinput 的 profile）
cp -r ~/.dsh /tmp/dsh-rc-home

# 3) 起在另一个端口，避免和正在跑的实例撞车
DSH_HOME=/tmp/dsh-rc-home /tmp/dsh-rc/node_modules/.bin/dsh web --port 3081 --no-open
```

重点复验：第 1 节**三态与侧栏承载**（`conversation.composer.bar` 遮蔽、`sidebar.right.pane.tab` 承载判定、收起后的唤回小球）与第 3 节**触发管线与菜单**——宿主契约变化最先断在这两处，其余功能是自绘的，跨通道风险低。

## 8. 0.3.8 / 0.3.9 / 0.4.0 新功能与回归

**0.4.0 桌面宿主 0.2.2-rc.1 对齐与修复**

- [ ] **底部工具行逐值对齐**（对照官方输入框）：`+` 指令钮 28×28、`conversation.input.permission` / `.plan` 槽位镜像（官方权限选择器 / 计划 chip）、`input.left` / `.right` / `.model` 座位顺序、语音 activity 座位、发送钮 34×34 `translateY(-2px)`；行 padding `2px 8px 6px`、gap 12；窄容器（content-box ≤560）gap 8、模型文字 compact 收起；行内放不下时 `data-model-compact` 出现。
- [ ] **麦克风恢复**：桌面版（voice-input 插件启用）工具行右侧、模型与发送之间出现官方麦克风钮（28×28，点击进入录音/引导弹窗）；`__dshCodinputErrs` 无 `usePluginNavigation is not a function` 类错误；关掉语音插件后按钮消失。
- [ ] **sending / 停止双按钮**：发送瞬间主按钮进 `[data-sending]` 旋转态，运行中 sending 阶段另出独立停止钮；运行中草稿非空按官方 steer/queue 标签显示「排队发送 / 插话发送」。
- [ ] **带图用户消息（0.4.0 修复点）**：Markdown 渲染开启时，带图消息的图片以官方缩略图显示（不是 image.png 文件卡），点缩略图打开官方「原图预览」灯箱；文件附件仍为官方文件卡；关掉用户消息 Markdown 后行为不变。
- [ ] **问答回执**：回答 `ask_user_question` 后，对话里只出现官方 `[data-question-reply]` 卡片一处（这是宿主 0.2.2 官方行为，不是插件气泡）；userMarkdown 开/关对照应一致。
- [ ] **prefs 升级 / 校验 / 统计边界（B1–B4）**：旧 v2 存储迁移到 v3（坏值 `shift-enter`→`shift+enter`、旧字段删除、用户改过的快捷键不被覆盖）；脏 JSON 不崩；Shift+Enter 换行生效；统计/缓存命中不出现 `NaN tok`、`1000K tok`、`99.99` 之类边界文本。
- [ ] **桌面端字面渲染（0.4.0）**：桌面版（Electron 44 / Chromium 152）输入 `//`、`->`、`x -> y` → 编辑器与预览 / 复制文本都是字面字符，不再出现「合并字形 / 只剩第二个字符」；`__dshCodinputErrs` 为 0
- [ ] **安全**：用户消息里手写 `<span data-dci-wire=...>`、`<script>`、`<img onerror>`、`javascript:` 链接 → 全部按文本/被净化，不产生伪造 chip、不执行；插件自有的 `@[label](dsh-session:)` 仍正常生成会话 chip。

**0.4.0 草稿 / 连字 / 候选菜单浮层**

- [ ] **`/codinput` 退出草稿保留**：见第 1 节「侧栏内 /codinput 退出」与第 2 节「`/codinput` 退出不丢草稿」两条（三条退出入口都要过）。
- [ ] **字体连字**：0.4.0 起已移除（见第 2 节「编辑器字面渲染」）。
- [ ] **候选菜单四向浮层**：见第 3 节第一条；重点断言 float / side 下菜单为 body 直接子节点、`position: fixed`、与 `.dci-card` rect 零交叠；normal 形态几何不回归（0.3.9 已验收值）。
- [ ] **草稿跨退出/进入**：`/codinput` 退出 → 重新 `/codinput` 进入 → 编辑器恢复退出前草稿；无 `/codinput` token 残留。

**0.3.9 菜单定位与开合（PR #5）**

- [ ] **菜单 portal 到 body**：模型 / 权限 / 设置下拉打开后 `.dci-menu` 的父节点为 `body`、`position: fixed`；祖先带 `transform` / `filter` 的布局下（可用 DevTools 给卡片加 `transform: translateY(150px)`）仍与触发器对齐，不再整体偏移。
- [ ] **锚点实时跟随**：菜单打开时滚动页面 / 让布局发生位移（≥2px）→ 菜单在 2 帧内跟随触发器，上方弹出间距恒 8px、设置下拉间距恒 4px；窗口缩放后重算并夹在视口内（margin 12），不被输入卡片或设置容器裁剪。
- [ ] **开合（0.3.9 回归点）**：连点触发器两次 = 开→收（不再「点一次收不起来」）；点外部关闭、点菜单内部不关闭；模型菜单钻入子页 / 返回正常；权限菜单与设置页下拉同样开合正常。
- [ ] **0.2.2-rc.1 换通道**：按 §7 独立 prefix + `DSH_HOME` 起 `dsh@0.2.2-rc.1` → 上述菜单项与第 1、3 节冒烟全过，`__dshCodinputErrs` 为空。

- [ ] **用户消息 Markdown**：发送一条含 `**加粗**`、行内代码、围栏代码块、列表的消息 → 落库后右侧气泡按 Markdown 渲染，ARIA 语义（paragraph/strong/code/list）正确；@文件 / @会话 / //技能 引用 chip 显示并可点开；复制钮与时间戳、引用摘要行、悬停显形正常；`__dshCodinputErrs` 为空。设置开关即时切换（见第 5 节）。切换宿主语言后复制钮/引用摘要文案即时更新（不刷新）；连续复制后卸载/切形态无残留定时器报错。
- [ ] **带图用户消息（0.3.7 P0 回归点 / 0.4.0 修复）**：发一条带图片附件的消息（或打开历史带图消息）→ 图片经官方 `conversation.chat.user.images` 槽位渲染（官方缩略图，可点开官方大图灯箱），不出现文件卡降级、无 `data-slot-error` 崩溃面；此后继续发送的用户/插队消息仍是 Markdown 形态（条目未被废黜）；`__dshCodinputErrs` 为空。
- [ ] **Markdown 安全基线**：用户消息里输入 `<style>body{display:none}</style>`、`<form><input></form>`、`[x](javascript:alert(1))` → 气泡只显示纯文本/安全元素，页面样式不被改写、无表单/控件、非 http(s)/mailto 链接不可点；`![x](data:image/png;base64,...)` 不渲染为图片（降级为 alt 文本）。
- [ ] **插件页图标**：宿主插件列表/已装插件卡显示 `assets/icon.png`（与文件逐字节一致），不再落默认图；包的 `package.json` 顶层 `icon` 为相对路径。
- [ ] **数据行三面板互斥 + portal 定位**：见第 4 节两条新增条目（互斥、滚动跟随 / resize 夹取 / Escape 与点外关闭 / 不被输入卡片裁剪）。
- [ ] **桌面端开关样式**：桌面版（当前 `0.2.1-rc.3`）设置页开关与官方 primitives Switch 同款（ON 轨道随宿主品牌色，深色主题下为近白）——本项为 0.3.8 静态对齐项；桌面实机回归前按「待验」记录。
- [ ] **样式热更新（patchReload live）**：替换 `lib/client.js` 后强刷（或宿主原地更新插件）→ 新增的 `dci-` 类样式生效，不出现「旧 `<style>` 仍在、新类永不注入」；无需清缓存或重装插件。

## 9. 0.4.0 Markdown 渲染与正文连字

准备一份综合 fixture（可存为草稿，预览与用户消息各发一次对照）：

```markdown
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

​```js
const x = 1;
​```

行内 $E=mc^2$ 与块级：

$$
\int_0^1 x^2\,dx
$$

​```mermaid
flowchart LR
  A[Start] --> B[End]
​```
```

- [ ] **管线一致性**：上述 fixture 在「预览 pane」与「用户消息（userMarkdown 开）」中渲染结构一致（脚注 id 归一化后比对）；`__dshCodinputErrs` 为空、console error 0。
- [ ] **Markdown 正文等宽连字（0.4.0，默认开）**：预览与用户消息正文（段落/标题/列表/表格单元格/callout 正文/脚注正文）computed `font-family` 首选 `JetBrains Mono`、字体连字生效 → `a -> b`、`x => y`、`// note` 视觉上显示为连字箭头（DOM `textContent` 仍是原文 `->`，无 Unicode 替换）；**预览与用户消息的行内代码同样显示连字箭头**；设置 → Codinput 关「Markdown 等宽连字」→ 两面立即恢复普通阅读字体/代码字体字面、箭头消失，重开恢复、刷新保持；代码块在 ON/OFF 下 computed 字体/特性一致；**编辑器输入框仍字面**；编辑器草稿、`Ctrl+A` 复制文本、实际发送内容仍是 `->`。桌面端（Electron 44.7/Chromium 152）预览/消息面应正常显示连字箭头且无「第一格空白/丢字符」。
- [ ] **GFM**：表格 3 列对齐（computed `text-align` 左/中/右 + `align` 属性）、宽表在预览里可横向滚动；任务清单勾选/未勾选/嵌套只读显示；删除线、自动链接（`target=_blank`、`rel=noopener noreferrer`）。
- [ ] **脚注**：正文上标可点 → 跳到文末脚注区对应项；重复引用正常；预览与用户消息各自独立不串 id。
- [ ] **Callouts**：`note/tip/warning/danger/info/success/question/quote` 8 类图标+配色+标题正确；`[!warning]-` 默认收起、`[!note]+` 展开；未知类型按 note 蓝族回退；普通 `>` 引用**不带** callout 样式；浅色/深色主题下标题与图标对比度足够（≥3:1）。
- [ ] **Obsidian 语法**：`==高亮==` 显示高亮底色；`%%注释%%`（单行/多行/连续）隐藏，代码块/行内代码里的 `%%` 原样保留，未闭合 `%%` 按普通文本；`[[目标]]` / `[[目标|别名]]` 为 chip，点击复制目标名（不允许导航跳转）；`![[图片.png]]` 显示为样式化文本、不尝试加载文件。
- [ ] **图片**：`![图|300](http)` 宽度 300（`width` 属性保留）；点击预览/用户消息中的图片打开 `.dci-lightbox[role=dialog]`，Esc 关闭；相对路径/`data:` 图片降级为 alt 文本（不破图）。
- [ ] **代码块（扩展渲染）**：46 种语言子集高亮（`code` 带 `hljs language-*`），语言标签正确，未知语言不高亮但正常显示；复制按钮点击后剪贴板内容 = 代码原文，有「已复制」反馈。
- [ ] **数学公式（扩展渲染）**：行内 `$E=mc^2$` 与块级 `$$\int$$` 渲染为 `.katex`；错误公式显示原文 + 错误样式不崩；`$5 and $10`、`\$9` 不误判为公式；**DevTools Network 无任何外联请求**（字体 data URI 内置）。
- [ ] **Mermaid（扩展渲染）**：```mermaid flowchart / sequence 渲染出 SVG；可见时才渲染（懒加载）；浅色/深色主题切换后图表重新渲染且可读；语法错误回退「源码 + 错误提示」；未内置图类型（如 sankey）同样回退不崩；渲染后滚动/高度正常、不遮挡后续内容。
- [ ] **安全**：`<script>`、`<img onerror>`、`<style>`、`<iframe>`、手写 `data-dci-wire`、`[x](javascript:)`、`[x](data:text/html,...)` → 全部按文本/被拦截，不执行、不产生伪造 chip；Mermaid 恶意 label 变纯文本；KaTeX `\href` 不生成可点链接（trust:false）。
- [ ] **回归**：编辑/预览分屏比例与同步滚动、预览开关与 `defaultPreview`、三形态（normal/float/side）渲染均正常；用户消息附件行仍为官方缩略图+灯箱，question-reply 让位仍成立；10 次连续切换预览无异常、无内存/定时器报错。
- [ ] **体积/离线**：`lib/client.js` ≈ 3.4MB（发布压缩），运行时零网络请求；`npm run build` 末尾 `node --check lib/client.js` 自检通过（坏 banner/语法错误会被构建阻断）。

