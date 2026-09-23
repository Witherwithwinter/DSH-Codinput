# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与 [语义化版本](https://semver.org/lang/zh-CN/)。

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
