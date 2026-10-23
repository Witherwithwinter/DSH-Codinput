# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与 [语义化版本](https://semver.org/lang/zh-CN/)。

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

## [0.3.3] — 2026-10-23

主题/皮肤插件兼容：错误色与预览链接逐值对齐官方；README 增补皮肤作者指南。

### 变更

- **错误色回退值逐值对齐官方**：`.dci-error` 与完全权限确认警示图标的错误色回退值由 `#ff6b6b` 改为官方同款 `#d54941`（token 仍走 `--dsw-alias-state-error-primary`，仅无该令牌的宿主回退时可见差异）。
- **预览链接走官方 alias-link token**：markdown 预览的链接色由写死 `#4c8dff` 改为 `var(--dsw-alias-link, #4c8dff)`，换肤下与官方 markdown 链接同进退。

### 新增

- **README 皮肤作者指南（中英）**：新增「主题 / 皮肤插件兼容」章节——覆写宿主 `--dsw-*` token 即全盘生效（含 token 定义在 body 层、覆写需写同层的注意点）；官方写死的值清单（发送钮图标前景白等，属预期不跟 token）；稳定的 `dci-` 前缀类名契约与注入顺序（皮肤后注入按常规 CSS 权重覆盖）。

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
