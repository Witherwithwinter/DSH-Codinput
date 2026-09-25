# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.1.1] — 2026-09-25

适配宿主 `0.1.7-rc.2`（`next` 通道）的官方候选菜单亚克力改版；旧 rc 宿主经 token 回退链保持原样。

### 新增

- **候选框亚克力背景**：`/` `@` 候选菜单对齐官方 `0.1.7-rc.2`——官方此版起菜单表面改为 primitives `MenuSurface` 的 material 层（`--dsw-menu-surface-fill` ≈ 45% alpha + `backdrop-filter: blur(40px) saturate(150%)`），菜单本体不再自带背景。复刻菜单改为单元素合并两层，取值逐值一致；同一 token 链应用到指令菜单、数据行详情面板与上下文分段面板。
- **上下文小圈挪进数据行**：官方 `0.1.7-rc.2` 把上下文占用小圈从输入卡片工具行挪到卡片下方 dock 行（stats 胶囊之后），trigger 变为「双环仪表 + 百分比」药丸（padding 1px 8px、gap 6px、13px tabular-nums），且独立于 stats 胶囊渲染（无统计数据时也出现）。已逐值对齐。
- **候选菜单尺寸同步 rc.2**：max-height 320→400（`SlashMenu` 的 JS 上限常量同步修正——该常量以内联样式覆盖 CSS，仅改 CSS 不生效）、item 行 40px/14px→34px/13px（gap 8→6、radius→`--dsw-radius-md`）、图标 16→14px 且颜色走新的 `--dsw-alias-menu-icon`、分节标题/骨架屏/面包屑收紧值同步。

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
