# 基线报告：v0.6.0 · 隔离宿主运行时验收

- 日期：2026-11-23（Asia/Shanghai）
- 宿主：`@deepseek-ai/dsh@0.2.2-rc.3`（隔离 `DSH_HOME`，web profile 以 `link:` 装载本仓库；`probe.mjs` 端口 `3099`，`probe-switch.mjs` 端口 `3098`）
- 浏览器：系统 Edge，headless，窗口 `1440×900` → 视口 **`1410×805`**，DPR 1
- 被测产物：`lib/client.js` **`3,539,025 B`**（gzip `1,158,827 B` / brotli `957,447 B`），md5 `0cd19246a28cf0588e655f3311f659c6`，sha256 `ffa78f1635ec49649505f836df785a2cca382641bf3357d10132fbf5482e0204`
- 结论：
  - `node scripts/verify/probe.mjs`：**23 / 23 PASS，0 FAIL**；`__dshCodinputErrs` 与 console 错误均为 0
  - `node scripts/verify/probe-switch.mjs`：**6 / 6 PASS，0 FAIL**；`__dshCodinputErrs` 与 console 错误均为 0
  - `npm test`（`scripts/test-unit.mjs`）：**13 / 13 PASS**

## 1. 装载健康（H1–H3）

| 断言 | 实测 |
| --- | --- |
| `window.__dshCodinputErrs` | `[]`（开始 / 结束各一次） |
| `__dshCodinputShell` | `apply=done`、`bar=mounted`、`settings/sidebar.body/sidebar.title/command/md.heavy=registered`、`md.user/md.steering=mounted`；session 条目 `{surface:true,side:false}` |
| 单实例不变式 | `.dci-surface=1`、`.dci-card=1`、`.cm-editor=1`（位于 `.dci-cm-host.shadowRoot` 内） |
| 控制台 | 无 `pageerror`、无 `console.error` |

## 2. normal 形态（官方几何，未启用自适应）

- slash 菜单：`[data-trigger-menu]` 在 `.dci-overlay-anchor` 内，rect = `(463.9, 84, 755.2×293.5)`，卡片 rect = `(463.9, 381.5, 755.2×138)` → **`bottom = card.top - 4`**、**`width = card.width`**，`data-adaptive` 不存在。
- `/model` 弹层：rect = `(463.9, 246.5, 755.2×131)`，`aria="/model 选项"`，在 overlay 槽位且完整在视口内。
- `Escape` 均能关闭（N3 / N5）。

## 3. float 形态（自适应宿主，`data-mode=dd` + `data-placement`）

| 场景 | 卡片 rect | 菜单 rect | 选位 | 证据 |
| --- | --- | --- | --- | --- |
| `floatY=16`（贴顶） | `(60, 16, 720×138)` | `(60, 158, 720×400)` | **`bottom`**，gap 4 | 高度 400 ≥ 120，不遮卡片，完整在视口 |
| `floatY=655`（贴底） | `(60, 655, 720×138)` | `(60, 251, 720×400)` | **`top`**，gap 4 | 同上 |
| `floatX=12`（贴左） | `(12, 300, 720×138)` | `(736, 300, 360×400)` | **`right`**，gap 4 | 同上，宽度 360（侧位上限） |
| `/model` 弹层（贴顶） | `(60, 16, 720×138)` | `(60, 158, 720×131)` | **`bottom`**，gap 4 | 可见、不遮卡片 |
| 菜单打开时拖卡 | `(120, 200)` → `(168, 77)` | 由 `right (844, 200, 360×400)` 重排为 `bottom (168, 219, 720×400)` | 逐帧跟手 | 拖动后菜单仍开且几何合法 |

## 4. side 形态（右侧栏承载 + 消息区左侧选位）

- 承载：`.dci-surface[data-side]` 位于 `[data-sidebar-right-tab]` 内，卡片 `(776, 38, 634×767)`，pane `(775, 0, 635×805)`；`shell.session.side === true`；全局仍只有 1 个 `.cm-editor`。
- slash 菜单：rect = `(412, 38, 360×400)`，`data-mode="dd"`、`data-placement="left"`、`--dci-overlay-maxh: 400px`；**右边缘 `772 ≤ pane 左边缘 775`**，落在对话区、不被裁剪。
- `/model` 弹层：rect = `(412, 38, 360×131)`，`data-placement="left"`，落在对话区。

## 5. 草稿与会话切换（D1–D3、S1–S3、W1–W6）

| 场景 | 结果 |
| --- | --- |
| `normal → float → normal`（prefs + reload） | 编辑器与官方草稿一致保留 |
| `normal → side` → 键入 `-SIDE` → 关标签回 `normal` | 全程草稿同步、不丢字 |
| 快速切形态：打字后 5 ms 开始拖动 → 悬浮 → 拖回 dock | 编辑器与官方草稿一致保留 |
| 会话切换往返 `A → B → A → B → A`（`probe-switch.mjs`） | 每次回到会话输入 `/` 均出现 99 项候选；`/model` 弹层照常打开；0 报错 |

## 6. 复跑

```bash
node scripts/verify/probe.mjs          # 三形态与跨形态草稿（23 项）
node scripts/verify/probe-switch.mjs   # 会话切换回归（6 项）
```

重建 `lib/client.js` 后请使用自包含模式（或重启宿主）；每次运行结果与产物指纹以 `scripts/verify/out/latest.json` 与 `switch-latest.json` 为准。
