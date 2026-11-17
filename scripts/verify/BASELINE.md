# 基线报告：0.5.0 最终修复构建 · 隔离宿主运行时验收

- 日期：2026-11-17 19:26-19:42（Asia/Shanghai；两次运行：19:26 功能构建 + 19:39 终版构建，均为 23/23）
- 宿主：@deepseek-ai/dsh@0.2.2-rc.3（npm CLI，隔离 DSH_HOME=%TEMP%/dsh-verify/home，
  web profile 以 link: 方式装载本仓库；私端口 3099，独立 token）
- 浏览器：系统 Edge，headless，窗口 1440x900 → 视口 **1410x805**，DPR 1
- 被测产物（终版，本报告表格数据即此次运行）：lib/client.js **3,554,355 B**，sha256 c591bc1df3334e183d50b6d3cb5268b82e484ae01f437f796b391f4fdb8c2632，
  mtime 2026-11-17T11:39:48.059Z（= 19:39:48 +08，reviewer 修正后的终版构建；早前 19:26 构建 sha256 335b22d5… 的同一套断言同样 23/23 通过）
- 结论：**23 / 23 PASS，0 FAIL，exit 0**；__dshCodinputErrs 全程为空，无插件相关
  console/page error（唯一 console 错误数 = 0）
- 本机 Node v24.18.0；探针零新增依赖（自写 fetch+WebSocket CDP 客户端）

## 1. 装载健康（H1-H3）

| 断言 | 实测 |
|---|---|
| window.__dshCodinputErrs | []（开始/结束各一次） |
| __dshCodinputShell | apply=done、bar/settings/sidebar.body/sidebar.title/command=registered、md.heavy/md.user/md.steering=registered；session 条目 {surface:true,side:false} |
| 单实例不变式 | .dci-surface=1、.dci-card=1、.cm-editor=1 |
| 控制台 | 无 pageerror、无 console.error |

## 2. normal 形态（官方几何，未启用自适应）

- slash 菜单：[data-trigger-menu] 在 .dci-overlay-anchor 内，rect = **(463.9, 84, 755.2 x 293.5)**，
  卡片 rect = (463.9, 381.5, 755.2 x 138) => **bottom = card.top - 4**，**width = card.width**（差 0.0）；
  data-adaptive 不存在（官方几何路径未变）。
- /model 弹层：rect = **(463.9, 298.5, 755.2 x 79)**，aria=「/model 选项」，在 overlay 槽位、视口内。
- Escape 均能关闭（N3/N5）。

## 3. float 形态（自适应宿主，data-mode=dd + data-placement）

| 场景 | 卡片 rect | 菜单 rect | 选位 | 证据 |
|---|---|---|---|---|
| floatY=16（贴顶） | (60,16,720x138) | (60,158,720x400) | **bottom**，gap 4 | 高度 400 >= 120，不遮卡片，完整在视口 |
| floatY=655（贴底） | (60,655,720x138) | (60,251,720x400) | **top**，gap 4 | 同上 |
| floatX=12（贴左） | (12,300,720x138) | (736,300,360x400) | **right**，gap 4 | 同上，宽度 360（侧位上限） |
| /model 弹层（贴顶） | (60,16,720x138) | (60,158,720x79) | **bottom**，gap 4 | 可见、不遮卡片 |
| 菜单打开时拖卡 | (120,200) -> (112,77) | 由 right 位 (844,200,360x400) 重排为 bottom 位 (112,219,720x400) | 逐帧跟手 | 拖动后菜单仍开且几何合法 |

自适应宿主诊断锚点实测（例）：.dci-overlay-anchor[data-adaptive] style: left: 60px; top: 562px;
width: 720px; visibility: visible; --dci-overlay-maxh: 400px，data-mode="dd"、data-placement="bottom"。
**卡片贴顶时菜单不再被官方 useAnchoredMaxHeight 压成 0 高**（实测 400px）。

## 4. side 形态（右侧栏承载 + 消息区左侧选位）

- 承载：.dci-surface[data-side] 位于 [data-sidebar-right-tab] 内，卡片 (776,38,634x735)，
  pane rect (775,0,635x805)；shell.session.side === true；全页仍只有 1 个 .cm-editor。
- slash 菜单：rect = **(412, 38, 360 x 400)**，data-mode="dd"、data-placement="left"、--dci-overlay-maxh=400px；
  **菜单右边缘 772 <= pane 左边缘 775**，落在侧栏左侧消息区；完整在视口、不遮卡片、gap 4、高度 400
  （非 0、未被侧栏裁剪）。
- /model 弹层：rect = **(412, 38, 360 x 79)**，data-placement="left"，同上在消息区。

## 5. 草稿（跨形态 / 快速切换）

| 场景 | 结果 |
|---|---|
| normal->float->normal（写 prefs+reload） | 标记 DCI-DRAFT-* 在编辑器与官方草稿（dsh.conversation.SID.draft.text）中均保留 |
| normal->side（live 打开 Codinput 标签） | 进入侧栏后编辑器文本仍为标记（S1） |
| side 键入 -> 官方草稿 | 追加 -SIDE 后两侧一致：DCI-DRAFT-*-SIDE（S2） |
| side->normal（live 关闭标签） | 回 normal 形态，编辑器与官方草稿均为 ...-SIDE（S3） |
| **快速切换**：打字后 17ms 开始拖动 -> 悬浮 | 悬浮 mount 后编辑器/官方草稿仍为 FAST-*（拖拽开始 <500ms，实测 17ms；mount 延迟 895ms 属拖拽动画时间） |
| float->normal 拖回 dock 区 | 回 normal，草稿不丢 |

## 6. 与 lead 验收点的对应

| lead 要求 | 对应断言 | 结果 |
|---|---|---|
| normal slash 菜单在卡片上方（官方几何） | N1/N2 | PASS（bottom=card.top-4，width=card.width） |
| float 菜单可见、data-mode=dd + data-placement、视口内、不遮卡片、非 0 高 | F2/F3/F4/F6 | PASS（bottom/top/right 三向；高度 400） |
| 卡片贴顶时 placement 为 bottom/left/right | F2 | PASS（bottom，高 400） |
| side 菜单可见、data-placement=left、右缘 <= pane 左缘、不被裁剪 | S4 | PASS（772 <= 775，高 400） |
| float + side 的 /model 弹层可见 | F5/S5 | PASS（官方 PopupSelectView，几何合法） |
| 草稿 normal->float->normal->side + 快速切换 | D1/S1/S2/S3/D2/D3 | PASS |
| 各形态截图 | out/form-*.png | 已生成 |

## 7. 截图

- form-normal.png（normal + slash 菜单）
- form-float-top.png（悬浮贴顶 -> 菜单在下方）
- form-float-bottom.png（悬浮贴底 -> 菜单在上方）
- form-float-popup.png（悬浮 /model 弹层）
- form-side.png（侧栏 + 菜单在消息区）
- form-side-popup.png（侧栏 /model 弹层）
- probe-last.png（结束时全页）

均位于 scripts/verify/out/。

## 8. 复跑

    # 自包含（会自己起隔离宿主，跑完清理；推荐）
    node scripts/verify/probe.mjs

    # 若已有一个隔离宿主在跑
    node scripts/verify/probe.mjs --url "http://127.0.0.1:3099/?token=..."

注意：重建 lib/client.js 后请用自包含模式（或重启宿主），link 插件在宿主启动时装载。
本基线对应产物 sha256 335b22d5...551a03a7（3,553,958 B）；产物变化后以 out/latest.json
顶部的 artifact 指纹与逐项明细为准。
