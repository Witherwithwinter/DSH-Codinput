# 运行时验收探针（scripts/verify）

隔离宿主 + 无头 Edge（CDP，零新依赖）的 DSH-Codinput 运行时探针。它把本仓库以
"link:" 方式装进一个**临时 DSH_HOME** 的 web profile，起 "dsh web"，用 headless Edge
真实操作页面，验证三形态（normal / float / side）下官方 slash 菜单与 /model 弹层的
几何、自适应选位，以及草稿跨形态保留。

- 宿主版本：@deepseek-ai/dsh@0.2.2-rc.3（与 README/TESTING 的目标桌面版同版本）
- 浏览器：系统 Edge（默认 C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe）
- 依赖：Node >= 22（全局 fetch/WebSocket）；不装 playwright、不装新 npm 包
- 不触碰真实 ~/.dsh、不写仓库源码；只有 scripts/verify/out/ 会生成证据文件

## 一次性准备（本机已完成）

    # 隔离宿主 CLI（装到系统临时目录，不入仓库）
    npm i --prefix "%TEMP%/dsh-verify/rc" @deepseek-ai/dsh@0.2.2-rc.3

首次运行探针时会自动在 %TEMP%/dsh-verify/home 建隔离 DSH_HOME 的 web profile，
并执行等价于下面的 link 安装：

    DSH_HOME="%TEMP%/dsh-verify/home" node "%TEMP%/dsh-verify/rc/node_modules/@deepseek-ai/dsh/lib/bin.js" \
      plugin --profile web add "link:C:/.../DSH-Codinput"

## 运行

    # 自包含：自己起隔离宿主（:3099）、跑完自动关掉宿主与浏览器
    node scripts/verify/probe.mjs

    # 挂到已经起好的宿主机（例如 lead 自己起的 3099）
    node scripts/verify/probe.mjs --url "http://127.0.0.1:3099/?token=..."

    # 调试：保留浏览器/宿主、或显示窗口
    node scripts/verify/probe.mjs --keep-open
    node scripts/verify/probe.mjs --headful

**重建 lib/client.js 后必须重启宿主**（或直接用自包含模式，每次都会新起宿主）：
宿主在启动时从 link 路径装载插件产物，刷新页面不会换一份新 bundle。

退出码：0 全过；1 有断言失败；3 环境问题（宿主/浏览器起不来、页面没加载）。

参数与环境变量：

| 名称 | 默认 | 说明 |
|---|---|---|
| --url URL | 空 | 挂到运行中的宿主；省略则自己起 |
| --keep-open | false | 结束后保留浏览器与宿主 |
| --headful | false | 显示浏览器窗口 |
| DCI_HOST_DIR | %TEMP%/dsh-verify/rc | 宿主 CLI 安装目录 |
| DCI_HOST_HOME | %TEMP%/dsh-verify/home | 隔离 DSH_HOME |
| DCI_HOST_PORT | 3099 | 自起宿主端口 |
| CDP_PORT | 9342 | Edge DevTools 端口 |
| CODINPUT_EDGE | 系统 Edge 路径 | 浏览器可执行文件 |

## 断言矩阵

| 组 | 断言 | 关键判据 |
|---|---|---|
| H1-H3 | 装载健康 | __dshCodinputErrs.length === 0；__dshCodinputShell 含 apply/bar/settings/sidebar.body/sidebar.title/command；1 个 .dci-surface / .dci-card / .cm-editor |
| N1-N2 | normal 官方几何 | 菜单在 .dci-overlay-anchor 内；bottom = card.top - 4（±2.5）；width = card.width（±1.5）；不启用自适应（无 data-adaptive）；完整在视口内 |
| N3 | 关闭 | Escape 后 [data-trigger-menu] 消失 |
| N4-N5 | normal /model 弹层 | 输入 /model → 菜单选「模型」→ 官方 PopupSelectView 出现在 overlay 槽位、几何在视口内；Escape 关闭 |
| F1-F4 | float 自适应 | .dci-overlay-anchor[data-adaptive] + data-mode="dd" + data-placement + CSS 变量 --dci-overlay-maxh 均存在；卡片在顶部时 placement ∈ bottom/left/right 且菜单高度 >= 120（绝不 0 高）；卡片在底部时 ∈ top/left/right；卡片贴左时完整在视口内；任何方向都：不遮卡片、与卡片间距 4、完整在视口 |
| F5 | float /model 弹层 | 自适应宿主内可见、不遮卡片、不越视口 |
| F6 | 跟随拖拽 | 菜单打开状态下拖动悬浮卡，菜单仍打开且重排后仍满足上述几何 |
| D1 | 草稿 normal→float→normal | 编辑器文本与官方草稿（dsh.conversation.SID 的 draft.text）都等于标记 |
| S1 | side 承载 + 草稿 | 输入面在右侧栏 tab body 内（.dci-surface[data-side] 且 closest('[data-sidebar-right-tab]')）、单编辑器、live normal→side 后草稿仍在 |
| S2 | side 键入回写 | 侧栏编辑器追加文本后，官方草稿同步包含 |
| S3 | side→normal（关标签，live） | 关闭 [data-dockkit-tab-close] 后回 normal 形态，草稿不丢 |
| S4 | side 菜单位置 | placement = left；菜单右边缘 <= 右侧栏 pane 左边缘（在消息区）；完整在视口、不遮卡片、高度 >= 120 |
| S5 | side /model 弹层 | 同上左侧选位、可见、不遮卡片 |
| D2 | 快速切形态（<500ms） | 打字后 <500ms 内开始拖拽 → 悬浮，编辑器文本与官方草稿仍为标记（live remount 不丢字） |
| D3 | float→normal 拖回 | 拖到宿主自身 dock 区域松手回 normal，草稿不丢 |
| H4 | 全程无错 | 结束时 __dshCodinputErrs 仍为空；无提及插件的 console/page error |

几何断言都基于实时 getBoundingClientRect（视口 1410x805，窗口 1440x900、DPR 1）。
浮层判定契约（0.5.0 自适应宿主）：.dci-overlay-anchor[data-adaptive] 在浮层打开时带
data-mode="dd"、data-placement="top|bottom|left|right"，并用 CSS 变量 --dci-overlay-maxh
控制官方条目最大高度；下拉条目本身带 data-dci-overlay-dd 标记。

## 输出

- scripts/verify/out/latest.json：本次结果（artifact sha256/mtime、viewport、逐项 PASS/FAIL、耗时、控制台错误）
- scripts/verify/out/form-normal.png、form-float-top.png、form-float-bottom.png、
  form-float-popup.png、form-side.png、form-side-popup.png、probe-last.png
- out/ 已由 out/.gitignore 整体忽略（证据不进仓库）

## 已知边界 / 排错

- 隔离 DSH_HOME 无 API Key：/model 弹层内容为空态（「暂无可用模型」），但弹层本体是官方
  PopupSelectView，几何/选位照常可断言；这是刻意不接入模型的最小环境。
- 侧栏用快捷键 Ctrl+Shift+B 展开，再点侧栏指南页的 [data-sidebar-right-guide-entry="codinput"]
  打开 Codinput 标签（均为官方 UI，不走内部 store 注入）。
- 形态切换的两条路径都覆盖：normal<->float 的**刷新路径**（写 dsh-codinput.prefs.v3 + reload，
  D1）与**live 路径**（拖动、开关侧栏标签，S1/S3/D2/D3）。
- 数值（时间、浮动位置）每次略有差异；断言只卡几何关系与包含关系，不卡死像素。
- 宿主 3099 被占用：换 DCI_HOST_PORT；Edge 起不来：核对 CODINPUT_EDGE；残留无头 Edge：
  Get-CimInstance Win32_Process -Filter "name='msedge.exe'" | Where-Object { $_.CommandLine -match 'remote-debugging-port=93' } | Stop-Process -Force
- 维护入口：几何阈值与选择器在 lib/probe-core.mjs（assertMenu / assertPopup），页面侧取值在
  lib/page-helpers.mjs，宿主生命周期在 lib/probe-host.mjs，CDP 客户端在 lib/cdp.mjs。
