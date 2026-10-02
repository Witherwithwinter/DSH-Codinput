<p align="center">
  <img src="./assets/icon.png" width="128" alt="DSH-Codinput" />
</p>

<h1 align="center">DSH-Codinput</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/dsh-codinput"><img src="https://img.shields.io/npm/v/dsh-codinput" alt="npm Version" /></a>
  <a href="https://github.com/deepseek-ai/deepseek-harness"><img src="https://img.shields.io/badge/DSH-0.1.5--rc.2%2B-blue" alt="DSH Version" /></a>
  <a href="https://www.npmjs.com/package/dsh-codinput"><img src="https://img.shields.io/npm/dm/dsh-codinput" alt="Downloads" /></a>
  <a href="https://github.com/Witherwithwinter/DSH-Codinput/stargazers"><img src="https://img.shields.io/github/stars/Witherwithwinter/DSH-Codinput" alt="GitHub Stars" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/github/license/Witherwithwinter/DSH-Codinput" alt="License" /></a>
</p>

<p align="center">中文 | <a href="./README.en.md">English</a></p>

<p align="center">把 DeepSeek Harness 的聊天输入框，换成编辑器式的输入面板。</p>

![普通模式](./assets/preview-normal.png)

<table>
  <tr>
    <td width="50%"><img src="./assets/preview-split.png" alt="编辑 + 预览分屏" /><br /><sub>编辑 + 预览分屏（严格对半）</sub></td>
    <td width="50%"><img src="./assets/preview-float.png" alt="悬浮模式" /><br /><sub>悬浮模式（可拖动位置、八向缩放）</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="./assets/preview-side.png" alt="侧栏标签模式" /><br /><sub>侧栏标签模式（VS Code 面板式全高）</sub></td>
    <td width="50%"><img src="./assets/preview-ball-detail.png" alt="右上角小球" /><br /><sub>侧栏收起时的唤出小球（特写）</sub></td>
  </tr>
</table>

<p align="center">
  <sub>界面语言跟随宿主设置（中文 / English）—— 文案全部走宿主 locale 服务，上图为中文界面；英文界面见 <a href="./README.en.md">English README</a></sub>
</p>

## 特性

**三态单实例**——输入入口只有三种形态，任一时刻恰好一个，绝不与官方输入框共存：

| 形态 | 进入方式 | 说明 |
| --- | --- | --- |
| 普通 `normal` | 默认 | 接管卡片在原输入位 |
| 悬浮 `float` | 按住卡片顶部行空白区拖动 | 脱出为悬浮窗：可拖动位置、可拖边界/角落缩放（位置与尺寸记忆） |
| 侧栏标签 `side` | 打开右侧栏的「Codinput」标签 | 输入在侧栏面板内；**侧栏收起不让位**，由标题栏下方的圆形小球唤回；侧栏里 `/codinput` 直接退回官方输入框并关闭本标签 |

- **编辑器**：行号（可关）、当前行与行号高亮、软换行、Tab 缩进、行列指示，**编辑 + 预览分屏**（markdown 实时渲染，严格对半）。
- **撤销历史跨形态保留**：拖成悬浮、切到侧栏再回来，`Ctrl+Z` 依旧有效——三态共用同一台官方输入机，草稿即唯一事实源（形态切换、插件禁用、重启都不丢）。
- **`/` `@` 触发管线**：完全走官方链路（track → 官方 menu store → 逐项复刻的 MenuView），候选菜单、钻取、crumbs、骨架屏与官方逐一对齐；`/codinput` 按字典序排入指令节首，其余保持官方使用序。
- **模型与权限**：模型与思考强度读官方共享目录（与 `/model` 同一状态源）；权限为官方三预设，含完全权限的风险确认模态。
- **附件**：slash「添加 · 文件」、**粘贴图片**、**拖文件进卡片**三条路径；点图片缩略图弹**原图预览**（官方 ImageLightbox 同构）；上传中/失败有状态芯片，失败可整卡重试。
- **语音输入同步（官方桌面版）**：官方桌面版的输入框带语音按钮时，Codinput 在一模一样的位置渲染**一模一样的按钮**——直接渲染官方语音组件本体（麦克风钮、录音波形、转写、未就绪引导与文案全部是官方代码）；原生没有语音按钮的宿主（web 端各版本）同样不渲染。
- **性能与用量**：复刻官方 stats dock——轮次/步数 · tok/s、累计 tok · 缓存命中、上下文占用小圈，取数与格式化逐值同官方，均可点开详情面板；三形态都有。
- **设置**：设置 → Codinput——启用接管、行号、字体、发送/换行快捷键**任意组合录制**、默认视图；未启用时**打开右侧栏的 Codinput 标签即直接启用**。

## 安装

要求：宿主 `@deepseek-ai/dsh`（版本见下方[兼容性](#兼容性)）。

### 方法 A：npm 包

```bash
dsh plugin --profile web add dsh-codinput
```

一条命令就够：`dsh plugin` 走官方 profile 包管理，装完会读这个包的 `dsh.bundle` 元数据、校验它自带的 `cordis.patch.yml`（`dsh.bundle.patch`），并把包名追加进 profile 的 `bundles`——不需要手写任何 patch 行。

然后 `dsh web` 启动（已在跑的话强刷页面即可，profile 默认 `patchReload: live`）。

### 方法 B：GitHub 源码

```bash
dsh plugin --profile web add github:Witherwithwinter/DSH-Codinput
```

仓库里带着构建产物 `lib/`，所以装源码同样**不需要本地构建**。如果 pnpm 提示需要构建授权（例如你换成自己的 fork 且删掉了 `lib/`），按它打印的键名写进 profile 的 `pnpm-workspace.yaml` 后重跑：

```yaml
allowBuilds:
  esbuild@0.25.12: true
```

### 方法 C：本地源码（开发）

```bash
git clone https://github.com/Witherwithwinter/DSH-Codinput.git
dsh plugin --profile web add link:/abs/path/to/DSH-Codinput
```

`link:` 安装不会复制文件，改完 `npm run build` 刷新页面即生效。

### 方法 D：等价的手写配置

想在 profile 里锁版本、或要手工维护时，等价于**方法 A** 的是（`~/.dsh/profiles/web/package.json`）：

```jsonc
{
  "dependencies": {
    "dsh-codinput": "^0.3.0"          // 本地开发用 "link:/abs/path/to/DSH-Codinput"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-codinput"                // ← 追加在最后
      ],
      "patchReload": "live"           // 改完 lib/client.js 强刷页面即生效
    }
  }
}
```

改完手工配置后，在 profile 目录里 `pnpm install`（或 `dsh plugin --profile web install`），再 `dsh web`。

## 兼容性

宿主通过 npm 发的是 **rc** 版本（`latest` 是当前稳定 rc，`next` 是下个 rc，`alpha` 是更超前的通道），所以普通用户装到的就是 rc。

| 宿主版本 | 状态 |
| --- | --- |
| 桌面版（Electron，`0.2.0-rc.2`） | ✅ 实机实测通过（官方语音输入按钮同步——授权 → 录音 → 转写端到端验证；语音插件缺席或关闭时按钮自动隐藏） |
| `0.1.7-rc.2` | ✅ 实机实测通过（`next` 通道当前版本；候选菜单亚克力、上下文小圈挪位、dock 行布局即为此版对齐） |
| `0.1.5-rc.2` | ✅ 实机实测通过 |
| `0.1.6-alpha.2` | ✅ 开发基线，全部功能端到端实测通过 |
| 其它（含 `latest` 现指向的 `0.1.5-rc.3`） | 未实测；旧宿主无 rc.2 新 token，回退链自动保持各版官方原形态 |

对 `0.1.7-rc.2` 除实机验证外，还从该版本的客户端包（`dsh-client-ui-theme` / `dsh-client-ui-input-trigger` / `dsh-client-ui-conversation` / `dsh-client-ui-chat`）逐值提取了候选菜单、上下文小圈与 stats dock 的官方 CSS 核对。插件依赖的契约按版本核对过：用到的 3 个槽位（`conversation.composer.bar`、`sidebar.right.pane.tab`、`settings.section`）、`sidebarRight` / `sidebarRightTabs` / `locale` 服务与 `openTabIn`、侧栏展开规划（dockkit `planSetExpanded`）、文件拾取与 tab 关闭契约（`shell.bindFilePicker` / `tab.actions.close`）、以及复刻所依据的官方原语（`fileSizeText` / `fileExtension` 与附件 glyph 路径，逐字一致）。插件对宿主内部结构的依赖较多（槽位遮蔽、`useTabInfo`、`sidebarRight`、`--dsw-*` 令牌），代码里处处用 `typeof` 守卫 + `try/catch` 降级，但宿主大版本升级仍可能失效。**升级宿主后请按 [TESTING.md](./TESTING.md) 走一遍冒烟清单。**

## 已知限制

- `/` `@` 的候选内容来自宿主目录（技能 / 命令 / 文件 / 会话）；宿主不提供时为空，插件侧无法补。
- **没有语法高亮**、**没有 Esc 功能**——产品决策（输入面板不是代码阅读器）。
- **Codinput 标签存在期间主输入整体隐藏**（唯一输入入口约定，浏览同栏其他标签也不恢复）；官方 stats dock 与上下文小圈都渲染在官方输入框内部，因此随之消失、由本插件的复刻数据行接管。
- 同一 pane 复制出第二个「Codinput」标签时，第二个面板只出提示、不渲染第二个编辑面（输入入口唯一）。
- 悬浮模式的手势只保留「拖回底部输入区 = 普通」；「拖入右侧栏 = 侧栏模式」已按产品决策舍弃。
- 页面重载后，若侧栏布局恢复了 Codinput 标签但尚未被点开过，主输入会先出现——dockkit 对重载恢复的标签是惰性挂载，点一次标签即恢复侧栏承载。

## 开发

```bash
npm install
npm run build        # 压缩产物 → lib/client.js（发布用）
npm run build:dev    # 未压缩 + 内联 sourcemap（浏览器里直接看 TS 源码）
npm run typecheck
```

- `src/client/` 是全部客户端源码；宿主 API 用本地结构类型描述（运行时零宿主依赖，只把 `react`/`react-dom` 当平台外部模块）。
- `lib/index.js` 是宿主半边（纯挂载载体）；`lib/client.js` 由构建产出，并**入库随源码一起发**（源码安装才能免构建）。
- **CI 只做静态把关**：`npm ci` + `tsc --noEmit` + 发布构建 + 产物自检（bundle 非空、含 `__ModuleLoader__.load`、无内联 sourcemap）。它不加载页面、不连宿主，**运行时行为零覆盖**——行为验证走 [TESTING.md](./TESTING.md) 的手动清单。
- 诊断口（调试用，生产也在）：`window.__dshCodinputDebug / __dshCodinputErrs / __dshCodinputSessionId / __dshCodinputTriggers / __dshCodinputKeyboard / __dshCodinputShell / __dshCodinputCtx`。
- 开发辅助脚本：`node scripts/extract-official-css.mjs <宿主某包 client.js> [out.css]` 抽取官方 CSS module 原文，用于逐值复刻。

### 改代码前值得先知道的宿主事实

- **接管点**：`conversation.composer.bar`（single 槽位，`priority:-1` 遮蔽官方条目）。卸载条目即官方输入框原样恢复。
- **唯一输入入口**：侧栏标签 body **挂载即承载**（不是按可见性——收起侧栏是 CSS 隐藏 + translate，body 仍挂载），主条目据此渲染 `null`；形态由 `承载 ? 'side' : prefs.mode` 派生，构造上不可能并存。承载声明挂在 body 生命周期上，因此标签定义必须 `keepMounted: true`：dockkit 默认会把非激活标签的 body 卸载，一旦切到同栏其他标签声明就消失、主输入回来（官方浏览器标签同款开关；注意重载后恢复的标签要**激活过一次** body 才挂载）。
- **撤销历史**：三态切换会重挂载编辑器，故按会话暂存 `EditorState`（`take/putEditorSnapshot`）；扩展回调走模块级 hooks 槽，避免复用旧 state 时调到已卸载实例的 props。
- **官方侧灌入**（pick/claim/提交清空）用 `externalAnnotation` + `Transaction.addToHistory.of(false)`：不进撤销栈，撤销只记用户自己敲的内容。
- **画圆要写 `corner-shape: round`**：宿主根节点设了 `corner-shape: superellipse(1.5)`（全局超椭圆），只写 `border-radius:50%` 会渲染成圆角方。
- **小球不占槽位**：`conversation.session.header.corner` 是官方侧栏展开按钮的座位（single，占它会把官方按钮顶掉），故小球 portal 到 body、量标题栏矩形定位到标题栏下方。
- **slash「文件」行靠 filePicker 绑定活着**：官方 file 贡献的 `available` 读 `shell.canPickFiles()`，而 filePicker 由官方 InputBar 挂载时 `bindFilePicker` 绑上、卸载解绑——接管面挂载时必须补绑（`attachments.bindSessionFilePicker`），否则该行消失。**不要注册同名 contribution**：宿主 `register` 时即查重、直接 fail-loud。
- **关标签走 tab 域动作面**：`useTabInfo().tab.actions.close()` 关自己标签（dockkit 语义，唯一 docked 标签时自动垫 guide）；会话定位别用诊断 `__dshCodinputSessionId`（表面卸载会清成 null），用 sideinput 总线的承载快照。

## 第三方归属

本项目的部分视觉素材与样式取值**复刻自 DeepSeek Harness**（`@deepseek-ai/dsh`，MIT License，Copyright (c) 2026 DeepSeek），包括若干 SVG 图标路径（权限盾牌系列、plus / paperclip / close / arrow-up 等）与输入框卡片、原图预览层的 CSS 取值。依 MIT 许可使用，原始版权与许可声明见仓库根目录 [NOTICE](./NOTICE) 与 [LICENSE](./LICENSE)。

内置第三方依赖：CodeMirror 6（MIT）、marked（MIT）、DOMPurify（Apache-2.0 / MPL-2.0 双许可）。

## 许可

[MIT](./LICENSE)
