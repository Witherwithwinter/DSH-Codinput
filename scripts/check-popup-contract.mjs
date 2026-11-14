/**
 * 输入面契约自检（v0.5.0 起：官方条目镜像版）。
 *
 * 打开发布前最容易静默回归的几个不变量，全部是**文本级**断言（源文件即契约，
 * 不做 AST 解析——这些结构在本仓库里都是固定写法，正文可读性优先）：
 *
 * 1. overlay 座位：CodinputSurface 必须在卡片里渲染与官方 InputBar 同构的
 *    `.dci-overlay-anchor`（零高绝对定位条），并把唯一一处 `InputSlotSeat`
 *    指向 `conversation.input.overlay`——`/` 候选与 `/model`、`/permission`
 *    等弹层由官方 MenuView / PopupSelectView 原样渲染；自绘副本必须消失。
 * 2. 样式：`.dci-overlay-anchor` 必须是 `position:absolute` + `inset:0 0 auto`
 *    + `height:0`（官方 .overlayAnchor 逐值），否则弹层锚点几何漂移。
 * 3. 模型座：ModelSlot 必须镜像 single 槽赢家（firstComponentEntry），并把
 *    官方组件需要的 `renderSlot` 子座合成（renderChildSlot 的 single-inline /
 *    list 两条分支）与 `locked` 一起经 ownerProps 下发。
 * 4. 平台原语：build.mjs 必须把 `@deepseek-ai/dsh-client-ui-primitives` 标为
 *    external（Tooltip 用宿主同一份官方实现，不随包内置、不入 dsh.client.external）。
 * 5. rc.3 适配：附件座改镜像官方 `ComposerAttachments`（CodinputSurface 不得直接
 *    渲染自绘 AttachmentRail）；主按钮实现官方 Continue/Retry（bar 读
 *    `conversationContinuation`、表面算 primaryRetries 并下发、工具栏出官方三角 +
 *    「继续生成」文案）；卡片注册宿主的文档级粘贴路由 `registerFileIntake`。
 */
import { readFile } from 'node:fs/promises';

const surfaceUrl = new URL('../src/client/components/CodinputSurface.tsx', import.meta.url);
const modelSlotUrl = new URL('../src/client/components/ModelSlot.tsx', import.meta.url);
const stylesUrl = new URL('../src/client/styles.ts', import.meta.url);
const buildUrl = new URL('./build.mjs', import.meta.url);
const [surface, modelSlot, styles, buildScript] = await Promise.all([
  readFile(surfaceUrl, 'utf8'),
  readFile(modelSlotUrl, 'utf8'),
  readFile(stylesUrl, 'utf8'),
  readFile(buildUrl, 'utf8'),
]);

const errors = [];

// ---- 1. overlay 座位 ----
if (!/<div className="dci-overlay-anchor" data-composer-overlay[\s>]/.test(surface)) {
  errors.push('CodinputSurface must render <div className="dci-overlay-anchor" data-composer-overlay> inside the card');
}
const overlaySeats = surface.match(/<InputSlotSeat\s+slot=\{OVERLAY_SLOT\}/g) ?? [];
if (overlaySeats.length !== 1) {
  errors.push(`CodinputSurface must render exactly one InputSlotSeat for OVERLAY_SLOT (found ${overlaySeats.length})`);
}
for (const replica of ['SlashMenu', 'PopupSelectView']) {
  if (new RegExp(`<${replica}\\b|from '\\./${replica}'`).test(surface)) {
    errors.push(`CodinputSurface must not render the self-drawn ${replica} replica any more (official overlay slot owns it)`);
  }
}

// ---- 2. 锚点样式 ----
const anchorRule = /\.dci-overlay-anchor\s*\{([^}]*)\}/.exec(styles);
if (!anchorRule) {
  errors.push('styles.ts is missing the .dci-overlay-anchor rule');
} else {
  const body = anchorRule[1].replace(/\s+/g, ' ');
  for (const prop of ['position: absolute', 'inset: 0 0 auto', 'height: 0']) {
    if (!body.includes(prop)) errors.push(`.dci-overlay-anchor must declare "${prop}" (official .overlayAnchor parity)`);
  }
}

// ---- 3. 模型座 ----
if (!/firstComponentEntry\(entries\)/.test(modelSlot)) {
  errors.push('ModelSlot must mirror the single-slot winner through firstComponentEntry(entries)');
}
if (!/ownerProps: \{ locked, renderSlot \}/.test(modelSlot)) {
  errors.push('ModelSlot must pass { locked, renderSlot } as owner props to the official ModelSelect');
}
for (const kind of ['single-inline', 'list']) {
  if (!modelSlot.includes(`renderChildSlot('${kind}'`)) {
    errors.push(`ModelSlot must synthesize child slot "${kind}" via renderChildSlot (official ModelSelect renderSlot contract)`);
  }
}

// ---- 4. 官方原语 external ----
if (!buildScript.includes("'@deepseek-ai/dsh-client-ui-primitives'")) {
  errors.push('build.mjs must mark @deepseek-ai/dsh-client-ui-primitives as external (baseline platform module)');
}

// ---- 5. rc.3 适配：附件座镜像 + 继续生成/重试 + 文档级粘贴路由 ----
const barUrl = new URL('../src/client/components/CodinputBar.tsx', import.meta.url);
const attachmentsUrl = new URL('../src/client/components/AttachmentsSeat.tsx', import.meta.url);
const toolbarUrl = new URL('../src/client/components/Toolbar.tsx', import.meta.url);
const [bar, attachmentsSeat, toolbar] = await Promise.all([
  readFile(barUrl, 'utf8'),
  readFile(attachmentsUrl, 'utf8'),
  readFile(toolbarUrl, 'utf8'),
]);
if (!surface.includes('<AttachmentsSeat')) {
  errors.push('CodinputSurface must render the official attachments seat through <AttachmentsSeat>');
}
if (/<AttachmentRail\b|from '\.\/AttachmentRail'/.test(surface)) {
  errors.push('CodinputSurface must not render the self-drawn AttachmentRail directly (AttachmentsSeat owns the fallback)');
}
if (!attachmentsSeat.includes('fallbackOnMissing')) {
  errors.push('AttachmentsSeat must fall back to the self-drawn rail when the official entry is missing (fallbackOnMissing)');
}
if (!/registerFileIntake\(/.test(surface)) {
  errors.push('CodinputSurface must register the composer card with the host document paste route (rc.3 registerFileIntake)');
}
if (!/continueState=|primaryRetries=\{primaryRetries\}/.test(surface) || !/onRetry=\{onRetry\}/.test(surface)) {
  errors.push('CodinputSurface must implement rc.3 primaryRetries and pass {primaryRetries, onRetry} to the Toolbar');
}
if (!bar.includes("'conversationContinuation'")) {
  errors.push('CodinputBar must read the rc.3 conversationContinuation projection for Continue/Retry');
}
if (!toolbar.includes('IconTriangleRightFillRegular') || !toolbar.includes("tBar('tool.continue')")) {
  errors.push('Toolbar must render the official continue triangle primitive and the host-locale continue label when primaryRetries');
}

// ---- 6. 草稿写回按需（0.5.0 连打性能契约） ----
// 官方 setDraft 是整篇替换（O(草稿长度)）；每键上报会让长草稿下的连按
// Enter/Backspace 变成每键 O(n)（实测 600 行 ≈ 52ms/键）。因此写回只允许：
// 空闲去抖 + 宿主语义动作前 flush，且界面状态用本地镜像。
const editorPaneUrl = new URL('../src/client/components/EditorPane.tsx', import.meta.url);
const editorPane = await readFile(editorPaneUrl, 'utf8');
if (!/const IDLE_PUBLISH_MS = \d+/.test(editorPane)) {
  errors.push('EditorPane must debounce host draft publishing (IDLE_PUBLISH_MS) instead of publishing per keystroke');
}
if (!editorPane.includes('flushAndTrack') || !editorPane.includes('justStartedTrigger')) {
  errors.push('EditorPane must expose flushAndTrack() and sync the draft only when a trigger token starts');
}
if (!/editorCtlRef\.current\?\.flush\(\)/.test(surface)) {
  errors.push('CodinputSurface must flush the local draft before send (editorCtlRef.current?.flush())');
}
if (!surface.includes('onPointerDownCapture={onOverlayPointerDown}') || !surface.includes('onBeforeHostAction={onOverlayPointerDown}')) {
  errors.push('CodinputSurface must flush + re-track before host menu picks (overlay pointerdown capture / toolbar action)');
}
if (!toolbar.includes('onBeforeHostAction?.()')) {
  errors.push('Toolbar must call onBeforeHostAction() before opening the command menu');
}
if (!surface.includes('draftText={draftText}')) {
  errors.push('CodinputSurface must drive composer buttons from the local draft mirror (draftText)');
}

if (errors.length > 0) {
  for (const error of errors) console.error(error);
  process.exitCode = 1;
} else {
  console.log('Composer contract OK (official overlay + model + attachments seats, official Tooltip, rc.3 continue/retry + file intake, on-demand draft publishing)');
}
