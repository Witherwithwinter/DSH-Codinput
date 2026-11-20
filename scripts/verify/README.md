# 运行时验收探针（`scripts/verify`）

隔离宿主 + 无头 Edge（CDP，零额外 npm 依赖）的 DSH-Codinput 运行时自动化探针。它把本仓库以 `link:` 方式装进**临时 `DSH_HOME`** 的 web profile，拉起隔离宿主并用 headless Edge 真实操作页面：

- **`probe.mjs`（23 项断言）**：验证 `normal / float / side` 三形态装载健康、官方 `/` 候选菜单与 `/model` 弹层几何、四向自适应选位，以及草稿跨形态同步。
- **`probe-switch.mjs`（6 项断言）**：验证多会话往返切换（`A → B → A → B → A`）后，官方 `/` 候选菜单与 `/model` 弹层仍能正常唤出（卡住 0.5.2 会话绑定代缓存回归）。

最新实测基线见 [BASELINE.md](./BASELINE.md)。

## 环境要求

- **宿主版本**：`@deepseek-ai/dsh@0.2.2-rc.3`（与桌面版目标宿主同版本）
- **浏览器**：系统 Microsoft Edge（默认 `C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`）
- **运行时**：Node >= 22（使用内置全局 `fetch` / `WebSocket`，不安装 Playwright 等额外依赖）
- **隔离性**：不触碰真实 `~/.dsh`、不写仓库源码；运行证据仅输出到 `scripts/verify/out/`（已由 `.gitignore` 忽略）

## 一次性准备

```bash
# 将隔离宿主 CLI 安装到系统临时目录（不入仓库）
npm i --prefix "%TEMP%/dsh-verify/rc" @deepseek-ai/dsh@0.2.2-rc.3
```

首次运行探针时会自动在 `%TEMP%/dsh-verify/home` 创建隔离 `DSH_HOME` 的 web profile，并执行等价于下式的 `link:` 安装：

```bash
DSH_HOME="%TEMP%/dsh-verify/home" node "%TEMP%/dsh-verify/rc/node_modules/@deepseek-ai/dsh/lib/bin.js" \
  plugin --profile web add "link:C:/.../DSH-Codinput"
```

## 运行

```bash
# 自包含模式：自动拉起隔离宿主（:3099），跑完自动关闭宿主与浏览器
node scripts/verify/probe.mjs

# 会话切换回归探针：独立 home（端口 :3098），验证 A→B→A 后 slash 菜单与 /model 弹层
node scripts/verify/probe-switch.mjs

# 挂载到已运行的宿主实例
node scripts/verify/probe.mjs --url "http://127.0.0.1:3099/?token=..."

# 调试选项：结束后保留浏览器与宿主 / 显示有头浏览器窗口
node scripts/verify/probe.mjs --keep-open
node scripts/verify/probe.mjs --headful
```

> **注意**：重新构建 `lib/client.js` 后必须重启宿主（或直接用自包含模式，每次都会新起宿主）——宿主在启动时从 `link:` 路径装载插件产物，仅刷新页面不会换入新 bundle。

**退出码**：`0` 全部通过；`1` 存在断言失败；`3` 环境问题（宿主或浏览器未就绪）。

### 参数与环境变量

| 名称 | 默认值 | 说明 |
| --- | --- | --- |
| `--url URL` | 空 | 挂载到运行中的宿主；省略则自起隔离宿主 |
| `--keep-open` | `false` | 结束后保留浏览器与宿主进程 |
| `--headful` | `false` | 显示浏览器窗口 |
| `DCI_HOST_DIR` | `%TEMP%/dsh-verify/rc` | 宿主 CLI 安装目录 |
| `DCI_HOST_HOME` | `%TEMP%/dsh-verify/home` | 隔离 `DSH_HOME` 目录 |
| `DCI_HOST_PORT` | `3099` | `probe.mjs` 自起宿主端口 |
| `CDP_PORT` | `9342` | Edge DevTools 调试端口 |
| `CODINPUT_EDGE` | 系统 Edge 路径 | 浏览器可执行文件路径 |

## 会话切换探针（`probe-switch.mjs`）

复现并防止 0.5.2 修复的回归：宿主在会话「切走再切回」时会重建该会话的 `binding` / `scope`，官方触发管线控制器随之换代；插件镜像座位的 `inject` 结果若只按 `sessionId` 永久缓存，`MenuView` 会一直订阅上一代已关闭的 menu store——导致 `/` 菜单状态为 `open` 但面板永不渲染（无报错，刷新页面才恢复）。

- **独立 `DSH_HOME`**：`%TEMP%/dsh-verify-switch/home`（不与 `probe.mjs` 的单会话基线互相污染），宿主端口默认 `3098`。
- **种子会话构造**：首次运行自建默认 Workspace，并用**本地 mock Messages 端点** + `dsh headless` 各跑一轮，生成两个**非空**会话（空会话不出现在宿主侧栏列表）；全程不联网、不消耗真实凭据。
- **断言（`W1–W6`）**：`W1` 首个会话 `/` 菜单 → `W2` 切到第二会话 `/` 菜单 → `W3` **切回第一会话**（`A → B → A`，原报障点）→ `W4` 再一轮往返 → `W5` 切回后 `/model` 弹层 → `W6` 全程零插件错误；结果写入 `scripts/verify/out/switch-latest.json`。

## 断言矩阵（`probe.mjs`）

| 组 | 断言 | 关键判据 |
| --- | --- | --- |
| `H1–H3` | 装载健康 | `__dshCodinputErrs.length === 0`；`__dshCodinputShell` 含 `apply/bar/settings/sidebar.body/sidebar.title/command`；全局仅 1 个 `.dci-surface` / `.dci-card` / `.cm-editor`（穿透 `.dci-cm-host.shadowRoot` 计数） |
| `N1–N2` | `normal` 官方几何 | 菜单位于 `.dci-overlay-anchor` 内；`bottom = card.top - 4`（±2.5）；`width = card.width`（±1.5）；无 `data-adaptive`；完整在视口内 |
| `N3` | `normal` 关闭 | `Escape` 后 `[data-trigger-menu]` 消失 |
| `N4–N5` | `normal` `/model` 弹层 | 输入 `/model` → 菜单选「模型」→ 官方 `PopupSelectView` 出现在 overlay 槽位且在视口内；`Escape` 关闭 |
| `F1–F4` | `float` 自适应选位 | `.dci-overlay-anchor[data-adaptive]` 带 `data-mode="dd"`、`data-placement` 与 `--dci-overlay-maxh`；卡片贴顶时 `placement ∈ bottom/left/right` 且高度 `>= 120`；贴底时 `∈ top/left/right`；贴左时完整在视口内；任何方向均不遮卡片、间距 4px |
| `F5` | `float` `/model` 弹层 | 自适应宿主内可见、不遮卡片、不越视口 |
| `F6` | `float` 跟随拖拽 | 菜单打开时拖动悬浮卡，菜单保持打开且重排后几何仍合法 |
| `D1` | 草稿 `normal→float→normal` | 编辑器文本与官方草稿（`dsh.conversation.SID` 的 `draft.text`）均等于标记 |
| `S1` | `side` 承载 + 草稿 | 输入面位于右侧栏 tab body 内（`.dci-surface[data-side]` 且 `closest('[data-sidebar-right-tab]')`）、单编辑器、`normal→side` 后草稿保留 |
| `S2` | `side` 键入回写 | 侧栏编辑器追加文本后，官方草稿同步包含 |
| `S3` | `side→normal`（关标签） | 关闭 `[data-dockkit-tab-close]` 后回到 `normal` 形态，草稿不丢 |
| `S4` | `side` 菜单位置 | `placement = left`；菜单右边缘 `<=` 右侧栏 pane 左边缘（落在左侧消息区）；完整在视口、不遮卡片、高度 `>= 120` |
| `S5` | `side` `/model` 弹层 | 同上左侧选位、可见、不遮卡片 |
| `D2` | 快速切形态（`<500ms`） | 打字后 `<500ms` 内开始拖拽 → 悬浮，编辑器文本与官方草稿仍为标记 |
| `D3` | `float→normal` 拖回 | 拖到宿主底部 dock 区松手回 `normal`，草稿不丢 |
| `H4` | 全程无错 | 结束时 `__dshCodinputErrs` 仍为空；无提及插件的 console / page error |

几何断言均基于实时 `getBoundingClientRect`（视口 `1410×805`，窗口 `1440×900`、DPR 1）。

## 输出产物

- `scripts/verify/out/latest.json`：`probe.mjs` 运行结果（产物 sha256/mtime、视口、逐项 PASS/FAIL、耗时、控制台错误）
- `scripts/verify/out/switch-latest.json`：`probe-switch.mjs` 运行结果
- `scripts/verify/out/form-*.png`、`probe-last.png`、`switch-last.png`：各形态与终态实测截图
- `scripts/verify/out/` 已在仓库根 `.gitignore` 中忽略（证据文件不入库）

## 已知边界与排错

- **占位凭据避开首次凭据门**：`lib/probe-host.mjs` 启动隔离宿主时注入 `DEEPSEEK_API_KEY=dci-verify-placeholder` 与本地丢弃端口 `DEEPSEEK_BASE_URL=http://127.0.0.1:9`（不读真实凭据、不出本机），以避开首次运行遮挡输入面的凭据模态框。
- **侧栏开启路径**：使用快捷键 `Ctrl+Shift+B` 展开右侧栏，再点击指南页 `[data-sidebar-right-guide-entry="codinput"]` 打开标签（纯官方 UI 交互，不走内部 store 注入）。
- **清理残留无头 Edge 进程**（端口占用时）：
  ```powershell
  Get-CimInstance Win32_Process -Filter "name='msedge.exe'" |
    Where-Object { $_.CommandLine -match 'remote-debugging-port=93' } |
    Stop-Process -Force
  ```
- **代码结构**：几何阈值与选择器位于 `lib/probe-core.mjs`（`assertMenu` / `assertPopup`），页面取值位于 `lib/page-helpers.mjs`，宿主生命周期位于 `lib/probe-host.mjs`，会话种子构造位于 `lib/seed-sessions.mjs`，CDP 客户端位于 `lib/cdp.mjs`。
