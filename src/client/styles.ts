/**
 * 样式：dci- 前缀，注入一次。
 * 工具行/菜单/发送按钮的属性值逐条复刻官方 InputBar.module.css 与
 * PermissionSelect/ModelSelection 的触发器与菜单（含 --dsw-* 主题变量，
 * 随宿主主题自动切换）；编辑器/设置等自有部分用 currentColor 适配。
 */

const STYLE_ID = 'dsh-codinput-styles';

const CSS = `
/* ===== 拖文件入卡片：落区提示（粘贴/拖入附件入口）===== */
.dci-card[data-drop] { outline: 2px solid var(--dsw-alias-state-business-primary, currentColor); outline-offset: -2px; }

/* ===== 侧栏重复标签提示（同会话第二个 Codinput 标签不渲染第二个编辑面）===== */
.dci-side-notice { box-sizing: border-box; width: 100%; padding: 24px 16px; text-align: center;
  color: var(--dsw-alias-label-tertiary, currentColor); font-size: 13px; line-height: 20px; }

/* ===== 官方卡片（InputBar .card）：编辑器+预览+工具行合入一张卡 ===== */
.dci-surface { display: flex; flex-direction: column; gap: 6px; min-width: 0; color: inherit; }
/* 宽度默认继承空白态（hero）卡宽（官方 max-width 变量，回退 760px）：
   会话态（无包裹约束）不再被拉满，左右居中；拖边调节后由内联 max-width 接管。 */
.dci-card { box-sizing: border-box; width: 100%; max-width: var(--dsh-composer-card-max-width, 760px); margin-inline: auto;
  background: var(--dsw-specific-input-major, color-mix(in srgb, currentColor 4%, transparent));
  box-shadow: var(--dsw-elevation-soft, none); font-size: 14px; line-height: 24px;
  border: 0; border-radius: 22px; flex-direction: column; gap: 0; padding-top: 4px; display: flex; position: relative; min-width: 0; }
/* 卡片边缘调节把手：左右调宽、上下调高（对称灵敏度），悬停显形。 */
.dci-rip { position: absolute; z-index: 60; touch-action: none; }
.dci-rip[data-axis="y"] { left: 12px; right: 12px; height: 9px; cursor: ns-resize; }
.dci-rip[data-axis="y"][data-side="top"] { top: -4px; }
.dci-rip::after { content: ''; position: absolute; inset: 0; margin: auto; border-radius: 3px; background: transparent; transition: background 0.12s; }
.dci-rip[data-axis="y"]::after { height: 3px; width: 44px; }
.dci-rip:hover::after, .dci-rip[data-dragging="true"]::after { background: var(--dsw-alias-state-business-primary, currentColor); }
.dci-accessory { align-items: center; gap: 2px; padding: 6px 12px 0; display: flex; }
.dci-iconbtn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; padding: 0; border: none; border-radius: 6px;
  background: transparent; color: inherit; opacity: 0.62; cursor: pointer;
}
.dci-iconbtn:hover { opacity: 1; background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, currentColor 8%, transparent)); }
.dci-iconbtn[data-on="true"] { opacity: 1; background: var(--dsw-alias-interactive-bg-hover-solid, color-mix(in srgb, currentColor 12%, transparent)); }
.dci-iconbtn:disabled { opacity: 0.3; cursor: default; background: transparent; }

/* ===== 编辑区（无框，由卡片承担外观）===== */
/* 拖过上下缘后 body 固定高（--dci-body-h），未拖时高度随内容、46vh 封顶。 */
.dci-body { position: relative; display: flex; gap: 0; min-height: 60px; max-height: var(--dci-body-max, 46vh); overflow: hidden; }
.dci-body[style*="--dci-body-h"] { height: var(--dci-body-h); }
/* 分屏：grid 等宽两栏（fr 计入 padding/border，两栏边界严格居中；flex
 * 会把预览栏的横向 padding 泄漏进空间分配，做不到对半）。 */
.dci-body[data-split="true"] { display: grid; grid-template-columns: 1fr 1fr; }
.dci-body[data-split="true"] .dci-editor-wrap { border-right: 1px solid var(--dsw-alias-border-l2, color-mix(in srgb, currentColor 12%, transparent)); }
.dci-editor-wrap { position: relative; flex: 1 1 100%; min-width: 0; box-sizing: border-box; display: flex; flex-direction: column; }
.dci-editor-wrap[data-solo="true"] { flex-basis: 100%; }
.dci-cm-host { flex: 1; min-height: 0; overflow-y: auto; }
.dci-cm-host .cm-editor { height: 100%; background: transparent; }
.dci-pos { position: absolute; right: 10px; bottom: 6px; font-size: 11px; color: var(--dsw-alias-label-caption, currentColor); opacity: 0.75;
  pointer-events: none; font-variant-numeric: tabular-nums; z-index: 3; }

.dci-preview { flex: 1 1 100%; min-width: 0; box-sizing: border-box; overflow-y: auto; padding: 8px 14px 10px; font-size: 13px; line-height: 1.65; }
.dci-preview h1, .dci-preview h2, .dci-preview h3, .dci-preview h4 { margin: 0.7em 0 0.35em; line-height: 1.3; }
.dci-preview h1 { font-size: 1.35em; } .dci-preview h2 { font-size: 1.2em; } .dci-preview h3 { font-size: 1.08em; }
.dci-preview p { margin: 0.45em 0; } .dci-preview ul, .dci-preview ol { margin: 0.45em 0; padding-left: 1.5em; }
.dci-preview code { font-family: inherit; background: color-mix(in srgb, currentColor 9%, transparent);
  border-radius: 4px; padding: 0.1em 0.35em; font-size: 0.92em; }
.dci-preview pre { background: color-mix(in srgb, currentColor 7%, transparent); border-radius: 8px;
  padding: 10px 12px; overflow-x: auto; } .dci-preview pre code { background: transparent; padding: 0; }
.dci-preview blockquote { margin: 0.5em 0; padding: 0.1em 0.9em; border-left: 3px solid color-mix(in srgb, currentColor 22%, transparent); opacity: 0.85; }
.dci-preview table { border-collapse: collapse; margin: 0.6em 0; }
.dci-preview th, .dci-preview td { border: 1px solid color-mix(in srgb, currentColor 18%, transparent); padding: 4px 9px; }
.dci-preview a { color: #4c8dff; } .dci-preview img { max-width: 100%; } .dci-preview hr { border: none;
  border-top: 1px solid color-mix(in srgb, currentColor 14%, transparent); }

/* ===== 工具行（官方 InputBar .row / .tools / .trailing）===== */
.dci-row { flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 12px; min-width: 0; padding: 2px 8px 6px; display: flex; }
.dci-tools { align-items: center; min-width: 0; gap: 12px; display: flex; }
.dci-trailing { align-items: center; flex: none; min-width: 0; gap: 12px; margin-left: auto; display: flex; }

/* 圆形图标按钮（官方 .add）*/
.dci-add { background: var(--dsw-specific-selector, color-mix(in srgb, currentColor 8%, transparent));
  width: 28px; height: 28px; color: var(--dsw-alias-label-primary, currentColor); cursor: pointer; border: none;
  border-radius: 999px; flex: none; place-items: center; display: grid; }
.dci-add:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover-solid, color-mix(in srgb, currentColor 14%, transparent)); }
.dci-add:disabled { opacity: 0.5; cursor: default; }

/* 下拉触发（官方 PermissionSelect / ModelSelection .trigger）*/
.dci-trigger { min-width: 0; max-width: 220px; height: 28px; color: var(--dsw-alias-label-secondary, currentColor); cursor: pointer;
  background: transparent; border: none; border-radius: 24px; outline: none; align-items: center; gap: 4px;
  padding: 0 4px 0 8px; font-size: 13px; font-weight: 500; line-height: 20px; display: inline-flex; }
.dci-trigger:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, currentColor 8%, transparent)); }
.dci-trigger:focus-visible { box-shadow: 0 0 0 2px var(--dsw-alias-border-l3, transparent); }
.dci-trigger:disabled { color: var(--dsw-alias-label-dimmed, currentColor); cursor: default; opacity: 0.5; }
.dci-triggerIcon { flex: none; display: inline-flex; }
.dci-triggerIcon svg { width: 14px; height: 14px; }
.dci-triggerLabel { text-overflow: ellipsis; white-space: nowrap; min-width: 0; overflow: hidden; }
.dci-triggerEffort { color: var(--dsw-alias-label-caption, currentColor); flex-shrink: 1000; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.dci-chev { color: var(--dsw-alias-label-caption, currentColor); flex: none; transition: transform 0.12s; display: inline-flex; }
.dci-chev[data-open="true"] { transform: rotate(180deg); }

/* 发送（官方 .primary）*/
.dci-send { background: var(--dsw-alias-button-info-fill, color-mix(in srgb, currentColor 85%, transparent)); color: #fff; cursor: pointer;
  border: none; border-radius: 999px; flex: none; place-items: center; width: 34px; height: 34px;
  transition: background-color 0.1s; display: grid; transform: translateY(-2px); }
.dci-send:hover:not(:disabled) { background: var(--dsw-alias-button-info-hover, color-mix(in srgb, currentColor 70%, transparent)); }
.dci-send:disabled { opacity: 0.4; cursor: default; }

/* ===== 菜单（官方 primitives Menu：r20 卡片 / item r10 / side-top 弹出）===== */
.dci-menu { position: fixed; z-index: 1100; box-sizing: border-box; padding: 4px; display: flex; flex-direction: column;
  min-width: 218px; max-width: min(360px, 100vw - 24px); max-height: calc(100vh - 24px); overflow-y: auto;
  background: var(--dsw-menu-surface-fill, var(--dsw-specific-menu, rgba(28, 28, 32, 0.98)));
  backdrop-filter: var(--dsw-menu-backdrop-filter, none); color: var(--dsw-alias-label-primary, #ececf1);
  --dsw-elevation-stroke-color: var(--dsw-alias-border-l1, transparent);
  box-shadow: var(--dsw-elevation-prominent, 0 10px 34px rgba(0, 0, 0, 0.35)); border: 0; border-radius: var(--dsw-radius-lg, 20px); font-size: 13px; }
.dci-viewport { display: flex; flex-direction: column; min-height: 0; }
.dci-menuLabel { padding: 8px 10px; font-size: 12px; line-height: 16px; color: var(--dsw-alias-label-tertiary, currentColor);
  user-select: none; text-align: left; }
.dci-item { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 40px; padding: 8px 10px; border: none;
  border-radius: 10px; background: transparent; cursor: pointer; font-size: 14px; line-height: 22px;
  color: var(--dsw-alias-label-primary, inherit); text-align: left; }
.dci-item:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, currentColor 10%, transparent)); }
.dci-item:disabled { opacity: 0.4; cursor: not-allowed; }
.dci-itemIcon { display: inline-flex; flex: none; width: 16px; height: 16px; align-items: center; justify-content: center;
  color: var(--dsw-alias-label-tertiary, currentColor); }
.dci-itemIcon svg { width: 14px; height: 14px; }
.dci-itemLabel { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dci-check { flex: none; color: var(--dsw-alias-label-primary, currentColor); display: grid; place-items: center; }

/* ===== 候选菜单（官方 MenuView.module.css 逐值复刻：卡片顶锚定全宽浮层）
   0.1.7-rc.2 起菜单本体不再带背景，亚克力在 primitives MenuSurface 的 material 层
   （--dsw-menu-surface-fill + --dsw-menu-backdrop-filter）；单元素复刻把两层合并到这里，
   token 链兼容旧宿主（无新 token 时回退 rc.3 形态：不透明 --dsw-specific-menu、r20、无 blur）===== */
.dci-slash-menu { z-index: 100; box-sizing: border-box; --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2, transparent);
  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2, transparent);
  background: var(--dsw-menu-surface-fill, var(--dsw-specific-menu, rgba(30, 30, 34, 0.98)));
  backdrop-filter: var(--dsw-menu-backdrop-filter, none); color: var(--dsw-alias-label-primary, inherit);
  --dsw-elevation-stroke-color: var(--dsw-alias-border-l1, transparent);
  max-height: 400px; box-shadow: var(--dsw-elevation-prominent, 0 10px 34px rgba(0, 0, 0, 0.35));
  border: 0; border-radius: var(--dsw-radius-lg, 20px); flex-direction: column; padding: 4px; display: flex; position: absolute;
  bottom: calc(100% + 4px); left: 0; right: 0; overflow: hidden; }
.dci-slash-viewport { flex-direction: column; min-height: 0; display: flex; overflow-y: auto; }
.dci-slash-item { cursor: pointer; width: 100%; min-height: 34px; color: var(--dsw-alias-label-primary, inherit);
  text-align: left; background: transparent; border: none; border-radius: var(--dsw-radius-md, 10px); align-items: center; gap: 6px;
  padding: 6px 8px; font-size: 13px; line-height: 20px; display: flex; }
.dci-slash-item[data-active="true"], .dci-slash-item:hover { background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, currentColor 8%, transparent)); }
.dci-slash-sectionTitle { min-height: 23px; color: var(--dsw-alias-label-tertiary, currentColor); flex: none;
  padding: 5px 8px 2px; font-size: 11px; font-weight: 500; line-height: 16px; }
.dci-slash-sectionTitle:not(:first-child) { margin-top: 3px; }
.dci-slash-itemIcon { width: 14px; height: 14px; color: var(--dsw-alias-menu-icon, var(--dsw-alias-label-tertiary, currentColor)); flex: none;
  justify-content: center; align-items: center; display: inline-flex; }
.dci-slash-itemIcon svg { width: 14px; height: 14px; }
.dci-slash-itemName { text-overflow: ellipsis; white-space: nowrap; flex: none; max-width: 40%; overflow: hidden; }
.dci-slash-itemAlias { text-overflow: ellipsis; white-space: nowrap; max-width: 20%; color: var(--dsw-alias-label-tertiary, currentColor); flex: none;
  font-size: 12px; line-height: 18px; overflow: hidden; }
.dci-slash-itemDescription { text-overflow: ellipsis; white-space: nowrap; text-align: right; min-width: 0;
  color: var(--dsw-alias-label-tertiary, currentColor); flex: 1; font-size: 12px; line-height: 18px; overflow: hidden; }
.dci-slash-trailing { flex: none; align-items: center; gap: 3px; margin-left: auto; display: inline-flex; }
.dci-slash-drillHintText { color: var(--dsw-alias-label-caption, currentColor); white-space: nowrap; font-size: 10px;
  line-height: 16px; display: none; }
.dci-slash-drillHint { border-radius: var(--dsw-radius-xs, 4px); background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, currentColor 8%, transparent));
  color: var(--dsw-alias-label-caption, currentColor); padding: 0 4px; font-family: inherit;
  font-size: 10px; line-height: 16px; display: none; }
.dci-slash-item[data-active="true"] .dci-slash-drillHintText, .dci-slash-item[data-active="true"] .dci-slash-drillHint { display: inline-flex; }
.dci-slash-drill { width: 18px; height: 18px; border-radius: var(--dsw-radius-xs, 4px); color: var(--dsw-alias-menu-icon, var(--dsw-alias-label-caption, currentColor));
  flex: none; place-items: center; display: inline-grid; cursor: pointer; }
.dci-slash-drill:hover { background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, currentColor 8%, transparent));
  color: var(--dsw-alias-label-primary, inherit); }
.dci-slash-groupTitle { color: var(--dsw-alias-label-tertiary, currentColor); padding: 6px 8px; font-size: 11px; line-height: 15px; }
.dci-slash-skeletonRow { box-sizing: border-box; align-items: center; min-height: 34px; padding: 6px 8px; display: flex; }
.dci-slash-skeletonBar { background: var(--dsw-alias-bg-skeleton, color-mix(in srgb, currentColor 10%, transparent));
  border-radius: var(--dsw-radius-xs, 4px); height: 18px; animation: dci-slash-skeleton 2s cubic-bezier(0.36, 0, 0.64, 1) infinite; }
@keyframes dci-slash-skeleton { 0% { opacity: 1; } 40% { opacity: 0.6; } 80%, 100% { opacity: 1; } }
.dci-slash-crumbs { border-bottom: 0.5px solid var(--dsw-alias-border-l1, transparent); flex-wrap: wrap; flex: none;
  align-items: center; gap: 2px; margin-bottom: 2px; padding: 3px 3px 5px; display: flex; }
.dci-slash-crumb { max-width: 40%; color: var(--dsw-alias-label-tertiary, currentColor); cursor: pointer;
  text-overflow: ellipsis; white-space: nowrap; background: transparent; border: none; border-radius: var(--dsw-radius-sm, 6px);
  flex: 0 auto; padding: 2px 5px; font-family: inherit; font-size: 11px; line-height: 16px; overflow: hidden; }
.dci-slash-crumb:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, currentColor 8%, transparent));
  color: var(--dsw-alias-label-primary, inherit); }
.dci-slash-crumb:disabled { color: var(--dsw-alias-label-primary, inherit); cursor: default; background: transparent; }
.dci-slash-crumbSeparator { color: var(--dsw-alias-menu-icon, var(--dsw-alias-label-caption, currentColor)); flex: none; display: inline-flex; }

.dci-crumb-row { display: flex; flex-wrap: wrap; gap: 2px; padding: 4px 6px; }
.dci-crumb { border: none; background: transparent; color: var(--dsw-alias-label-secondary, inherit); cursor: pointer;
  padding: 2px 6px; border-radius: 5px; font-size: 11.5px; display: inline-flex; }
.dci-crumb:hover { background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, currentColor 9%, transparent)); }
.dci-crumb[data-current="true"] { color: var(--dsw-alias-label-primary, inherit); cursor: default; }
.dci-empty { padding: 10px; color: var(--dsw-alias-label-tertiary, currentColor); text-align: left; }
.dci-search { width: calc(100% - 8px); margin: 2px 4px 4px; padding: 5px 9px; font-size: 13px;
  border-radius: 8px; border: 1px solid var(--dsw-alias-border-l2, color-mix(in srgb, currentColor 18%, transparent));
  background: transparent; color: inherit; outline: none; }
.dci-error { padding: 6px 10px; color: var(--dsw-alias-state-error-primary, #ff6b6b); font-size: 12px; }

/* ===== 模型/推理等级 cell 行（官方 ModelSelection .cell）===== */
.dci-cell { box-sizing: border-box; width: auto; min-width: 100%; height: 40px; color: var(--dsw-alias-label-primary, inherit);
  cursor: pointer; text-align: left; background: transparent; border: none; border-radius: 10px;
  align-items: center; gap: 8px; padding: 0 10px; font-size: 14px; line-height: 22px; display: flex; }
.dci-cell:hover { background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, currentColor 10%, transparent)); }
.dci-cellLabel { white-space: nowrap; flex: none; }
.dci-cellValue { text-overflow: ellipsis; white-space: nowrap; text-align: right; min-width: 0;
  color: var(--dsw-alias-label-tertiary, currentColor); flex: auto; overflow: hidden; }
.dci-cellChevron { color: var(--dsw-alias-label-tertiary, currentColor); flex: none; display: inline-flex; }

/* ===== 完全权限确认（官方 RiskConfirmation 语义）===== */
.dci-confirm-warning { display: flex; align-items: flex-start; gap: 10px; color: var(--dsw-alias-label-secondary, currentColor);
  font-size: 14px; line-height: 22px; padding: 6px 8px 0; }
.dci-confirm-warning svg { flex: none; margin-top: 2px; color: var(--dsw-alias-state-error-primary, #ff6b6b); }
.dci-confirm-warning p { margin: 0; }
.dci-confirm-ack { display: flex; align-items: flex-start; gap: 10px; margin: 14px 8px 0; cursor: pointer;
  color: var(--dsw-alias-label-primary, inherit); font-size: 14px; line-height: 22px; }
.dci-confirm-ack input { flex: none; width: 16px; height: 16px; margin: 3px 0 0;
  accent-color: var(--dsw-alias-button-primary-fill, currentColor); cursor: pointer; }
.dci-confirm-actions { display: flex; justify-content: flex-end; gap: 8px; padding: 16px 8px 4px; }
.dci-confirm-actions .dci-btn { min-width: 72px; }
.dci-confirm-actions .dci-btn[data-primary="true"] { min-width: 136px; }
.dci-btn { border: 1px solid var(--dsw-alias-border-l2, color-mix(in srgb, currentColor 22%, transparent)); border-radius: 10px;
  background: transparent; color: inherit; padding: 6px 14px; cursor: pointer; font-size: 14px; line-height: 20px; }
.dci-btn[data-primary="true"] { background: var(--dsw-alias-button-primary-fill, color-mix(in srgb, currentColor 85%, transparent));
  color: #fff; border-color: transparent; }
.dci-btn:disabled { opacity: 0.4; cursor: default; }

/* ===== 草稿附件轨（官方 ComposerAttachments/AttachmentRail/FileCard 逐值复刻）=====
 * 值取自官方 dsh-client-ui-attachment：轨道 gap 10 / 隐藏滚动条 / 64px 项；
 * 图片缩略图 64×64 r16 cover；文件卡 240×64 r16（icon 28 + name 14/500 +
 * meta 12）；移除钮 18px 圆（button-contrast-fill，悬停显形）；翻页箭头 24px 圆。 */
.dci-attach-root { position: relative; min-width: 0; margin: 6px 12px 0; }
.dci-attach-rail { display: flex; align-items: stretch; gap: 10px; overflow: auto hidden;
  scrollbar-width: none; --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2, transparent);
  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2, transparent); }
.dci-attach-rail::-webkit-scrollbar { display: none; }
.dci-attach-item { position: relative; flex: none; height: 64px; }
.dci-attach-thumb { box-sizing: border-box; width: 64px; height: 64px; padding: 0; overflow: hidden;
  cursor: zoom-in; border: 0.5px solid var(--dsw-alias-border-l2-darkmode-thin, color-mix(in srgb, currentColor 12%, transparent));
  border-radius: 16px; background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, currentColor 8%, transparent));
  display: grid; place-items: center; color: var(--dsw-alias-label-tertiary, currentColor); }
.dci-attach-thumb img { display: block; width: 100%; height: 100%; object-fit: cover; }
/* 移除钮（图片项：卡片右上角浮层）。 */
.dci-attach-remove { position: absolute; top: 4px; right: 4px; z-index: 1; box-sizing: border-box;
  width: 18px; height: 18px; padding: 0; border: none; border-radius: 50%; corner-shape: round;
  background: var(--dsw-alias-button-contrast-fill, rgba(0, 0, 0, 0.72));
  color: var(--dsw-alias-label-primary-inverted, #fff); cursor: pointer; opacity: 0;
  display: grid; place-items: center; transition: opacity 0.2s ease-in-out; }
.dci-attach-item:hover .dci-attach-remove, .dci-attach-remove:focus-visible { opacity: 1; }
@media (pointer: coarse) { .dci-attach-remove { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .dci-attach-remove { transition: none; } }
/* 文件卡（非图片）。 */
.dci-attach-card { box-sizing: border-box; position: relative; display: inline-flex; align-items: center;
  gap: 10px; width: 240px; height: 64px; padding: 0 12px; text-align: left;
  border: 0.5px solid var(--dsw-alias-border-l2, color-mix(in srgb, currentColor 12%, transparent));
  border-radius: 16px; background: var(--dsw-specific-input-major, color-mix(in srgb, currentColor 4%, transparent)); }
.dci-attach-cardFailed { border-color: var(--dsw-alias-state-error-primary, #d54941); }
.dci-attach-icon { flex: none; display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; color: var(--dsw-alias-label-secondary, currentColor); }
.dci-attach-spinner { box-sizing: border-box; width: 20px; height: 20px; border: 2px solid; border-top-color: transparent;
  border-radius: 50%; corner-shape: round; animation: dci-attach-spin 0.8s linear infinite; }
@keyframes dci-attach-spin { to { transform: rotate(360deg); } }
.dci-attach-body { display: flex; flex-direction: column; flex: 1; min-width: 0; padding: 8px 0; }
button.dci-attach-body { color: inherit; font: inherit; text-align: left; background: none; border: 0; cursor: pointer; }
.dci-attach-name { overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
  color: var(--dsw-alias-label-primary, inherit); font-size: 14px; font-weight: 500; line-height: 22px; }
.dci-attach-card:hover .dci-attach-name, .dci-attach-card:focus-within .dci-attach-name { padding-right: 18px; }
.dci-attach-meta { overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
  color: var(--dsw-alias-label-tertiary, currentColor); font-size: 12px; line-height: 15px; }
.dci-attach-metaFailed { color: var(--dsw-alias-state-error-primary, #d54941); }
/* 文件卡的移除钮（卡内右下角，非浮层）。 */
.dci-attach-removeInline { position: absolute; top: 6px; right: 6px; box-sizing: border-box;
  width: 18px; height: 18px; padding: 0; border: none; border-radius: 50%; corner-shape: round;
  background: var(--dsw-alias-button-contrast-fill, rgba(0, 0, 0, 0.72));
  color: var(--dsw-alias-label-primary-inverted, #fff); cursor: pointer; opacity: 0;
  display: inline-flex; align-items: center; justify-content: center; transition: opacity 0.2s ease-in-out; }
.dci-attach-card:hover .dci-attach-removeInline, .dci-attach-removeInline:focus-visible { opacity: 1; }
.dci-attach-cardFailedRemove { background: var(--dsw-alias-state-error-primary, #d54941); color: #fff; opacity: 1; }
/* 上传进度（有 loaded/total 时按比例，否则官方同款往返动画）。 */
.dci-attach-progress { position: absolute; bottom: 5px; left: 12px; right: 12px; height: 2px;
  border-radius: 1px; background: var(--dsw-alias-fill-tertiary, color-mix(in srgb, currentColor 8%, transparent));
  overflow: hidden; }
.dci-attach-item .dci-attach-progress { left: 4px; right: 4px; }
.dci-attach-progressBar { display: block; height: 100%; border-radius: inherit;
  background: var(--dsw-alias-brand-primary, currentColor); animation: dci-attach-progress 1.2s ease-in-out infinite alternate; }
.dci-attach-progressBar[style*="width"] { animation: none; }
@keyframes dci-attach-progress { 0% { transform: translate(-70%); } to { transform: translate(220%); } }
/* 翻页箭头（轨道两端，溢出时才出现）。 */
.dci-attach-arrow { position: absolute; top: 50%; transform: translateY(-50%); z-index: 2; box-sizing: border-box;
  width: 24px; height: 24px; padding: 0; border: 0; border-radius: 999px; corner-shape: round;
  background: var(--dsw-specific-input-major, color-mix(in srgb, currentColor 8%, transparent));
  color: var(--dsw-alias-label-secondary, currentColor); box-shadow: var(--dsw-elevation-panel, none);
  --dsw-elevation-stroke-color: var(--dsw-alias-border-l2-darkmode-thin, transparent);
  cursor: pointer; display: grid; place-items: center; }
.dci-attach-arrow:hover { background: var(--dsw-alias-interactive-bg-hover-solid, color-mix(in srgb, currentColor 14%, transparent)); }
.dci-attach-arrowLeft { left: 4px; }
.dci-attach-arrowRight { right: 4px; }

/* ===== 数据行（卡片下方，官方 data-composer-stats 位置）===== */
.dci-stats { display: flex; align-items: center; gap: 4px; font-size: 11.5px; color: var(--dsw-alias-label-caption, currentColor);
  padding: 0 6px; font-variant-numeric: tabular-nums; user-select: none; }

/* ===== 悬浮模式（拖顶部行空白区脱出；拖回底部输入区回普通；prefs 记忆）===== */
.dci-float { position: fixed; z-index: 940; min-width: 0; display: flex; flex-direction: column; }
.dci-float .dci-surface { flex: 1 1 auto; min-height: 0; }
.dci-float .dci-card { max-width: none; margin-inline: 0; width: 100%; }
/* 手动缩放过高度后（data-sized）：卡片吃满外壳，编辑区吃满卡片剩余高度。 */
.dci-float[data-sized="true"] .dci-card { flex: 1 1 auto; min-height: 0; }
.dci-float[data-sized="true"] .dci-body { flex: 1 1 auto; max-height: none; min-height: 0; }
/* 缩放把手：四条边 + 四个角落，1:1 跟手（窗口式）；透明热区，骑在卡片边缘上。 */
.dci-float-grip { position: absolute; z-index: 61; touch-action: none; }
.dci-float-grip[data-dir="n"] { top: calc(-1 * var(--dci-grip-edge)); left: var(--dci-grip-corner); right: var(--dci-grip-corner);
  height: var(--dci-grip-edge); cursor: ns-resize; }
.dci-float-grip[data-dir="s"] { bottom: calc(-1 * var(--dci-grip-edge)); left: var(--dci-grip-corner); right: var(--dci-grip-corner);
  height: var(--dci-grip-edge); cursor: ns-resize; }
.dci-float-grip[data-dir="w"] { left: calc(-1 * var(--dci-grip-edge)); top: var(--dci-grip-corner); bottom: var(--dci-grip-corner);
  width: var(--dci-grip-edge); cursor: ew-resize; }
.dci-float-grip[data-dir="e"] { right: calc(-1 * var(--dci-grip-edge)); top: var(--dci-grip-corner); bottom: var(--dci-grip-corner);
  width: var(--dci-grip-edge); cursor: ew-resize; }
.dci-float-grip[data-dir="nw"] { top: calc(-1 * var(--dci-grip-edge)); left: calc(-1 * var(--dci-grip-edge));
  width: var(--dci-grip-corner); height: var(--dci-grip-corner); cursor: nwse-resize; }
.dci-float-grip[data-dir="ne"] { top: calc(-1 * var(--dci-grip-edge)); right: calc(-1 * var(--dci-grip-edge));
  width: var(--dci-grip-corner); height: var(--dci-grip-corner); cursor: nesw-resize; }
.dci-float-grip[data-dir="sw"] { bottom: calc(-1 * var(--dci-grip-edge)); left: calc(-1 * var(--dci-grip-edge));
  width: var(--dci-grip-corner); height: var(--dci-grip-corner); cursor: nesw-resize; }
.dci-float-grip[data-dir="se"] { bottom: calc(-1 * var(--dci-grip-edge)); right: calc(-1 * var(--dci-grip-edge));
  width: var(--dci-grip-corner); height: var(--dci-grip-corner); cursor: nwse-resize; }
/* 拖动区：accessory 行里开关右侧的空白，按住移动整卡（普通态拖出=悬浮）。 */
.dci-float-dragzone { flex: 1 1 auto; align-self: stretch; min-width: 24px; cursor: grab; touch-action: none; }
.dci-float-dragzone[data-dragging="true"] { cursor: grabbing; }
/* 悬浮卡片：数据行收进卡片底部；高度拖把不适用。 */
.dci-surface[data-float] .dci-rip { display: none; }
.dci-surface[data-float] .dci-stat-root { padding: 2px 16px 8px; }
.dci-surface[data-float] .dci-card { box-shadow: var(--dsw-elevation-prominent, 0 10px 34px rgba(0, 0, 0, 0.35)); }

/* ===== 右上角小球（侧栏收起后的 Codinput 唤出入口）=====
 * 位置由 JS 量标题栏（会话头部）后内联注入：标题栏下方、右对齐（与官方角落
 * 按钮同内缩 12px、贴头部底边下 8px）——不占官方槽位，因此官方侧栏展开/
 * 收起按钮原样留在标题栏里，小球不覆盖它。悬于内容之上，故带圆形描边与
 * 极淡底色（取值同官方控件的 resting 面色）以免被对话内容淹没；图标为品牌
 * glyph（lucide file-code-corner，README 图标）。
 * corner-shape: round 是必需的：宿主设计语言在根节点设了
 * corner-shape: superellipse(1.5)（全局超椭圆/squircle），只写 50% 会渲染
 * 成圆角方而非圆——官方自己的圆形控件（spinner/dot/tag/switch/thumb）也都
 * 逐条 opt-out 回 round，此处照同一约定。 */
.dci-ball { position: fixed; z-index: 900; box-sizing: border-box; width: 36px; height: 36px;
  color: var(--dsw-alias-label-secondary, currentColor); cursor: pointer;
  background: var(--dsw-alias-bg-module-platform, color-mix(in srgb, currentColor 6%, transparent));
  border: 2px solid var(--dsw-alias-border-l3, color-mix(in srgb, currentColor 30%, transparent));
  border-radius: 50%; corner-shape: round; flex: none; justify-content: center; align-items: center; padding: 0; display: inline-flex;
  transition: background-color 0.12s, border-color 0.12s; }
.dci-ball svg { width: 18px; height: 18px; }
/* 悬停：描边提亮到标签色 + 面色加深，指针在内容之上也能看出可点。 */
.dci-ball:hover { background: var(--dsw-alias-interactive-bg-hover-solid, color-mix(in srgb, currentColor 14%, transparent));
  border-color: var(--dsw-alias-label-tertiary, currentColor); color: var(--dsw-alias-label-primary, inherit); }
.dci-ball:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, currentColor); outline-offset: 2px; }

/* ===== 侧栏形态（dockkit 标签页）：适应整个面板而非照搬主输入卡片 =====
 * 卡片去壳铺满 paneBody（官方 _paneBody 为 position:relative + overflow:auto，
 * 包裹层 absolute inset:0 精确铺满），编辑区吃满剩余高度——VS Code 面板式。 */
.dci-surface[data-side] { flex: 1 1 auto; min-height: 0; }
.dci-surface[data-side] .dci-card { flex: 1 1 auto; min-height: 0; max-width: none; margin-inline: 0;
  background: transparent; box-shadow: none; border-radius: 0; padding-top: 0; }
.dci-surface[data-side] .dci-rip { display: none; }
.dci-surface[data-side] .dci-accessory { padding: 8px 12px 6px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l1, transparent); }
.dci-surface[data-side] .dci-body { flex: 1 1 auto; max-height: none; min-height: 0; }
.dci-surface[data-side] .dci-row { padding: 6px 8px;
  border-top: 0.5px solid var(--dsw-alias-border-l1, transparent); }
/* 候选菜单向下弹出（侧栏/悬浮形态：头部行下方），留在卡片边界内不被裁剪。 */
.dci-surface[data-side] .dci-slash-menu, .dci-surface[data-float] .dci-slash-menu { bottom: auto; }

/* ===== 设置分区（官方 T1PP 行结构 + 控件样式）===== */
.dci-settings { display: flex; flex-direction: column; font-size: 14px; color: inherit; }
.dci-set-row { border-bottom: 0.5px solid var(--dsw-alias-border-l2, color-mix(in srgb, currentColor 10%, transparent));
  align-items: center; gap: 8px; padding: 16px 0; display: flex; }
.dci-set-rowText { flex-direction: column; flex: 1 1 0%; gap: 4px; min-width: 0; padding-right: 48px; display: flex; }
.dci-set-title { color: var(--dsw-alias-label-primary, inherit); font-size: 14px; font-weight: 400; line-height: 22px; }
.dci-set-desc { color: var(--dsw-alias-label-tertiary, currentColor); font-size: 12px; font-weight: 400; line-height: 18px; }
.dci-set-control { display: flex; align-items: center; }
.dci-set-selector { background: var(--dsw-alias-bg-module-platform, color-mix(in srgb, currentColor 6%, transparent));
  height: 36px; color: var(--dsw-alias-label-primary, inherit); cursor: pointer; border: none; border-radius: 18px;
  align-items: center; gap: 12px; padding: 0 14px; font-size: 14px; line-height: 22px; display: inline-flex; }
.dci-set-selector:hover { background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, currentColor 10%, transparent)); }
.dci-set-selector[data-recording="true"] { color: var(--dsw-alias-state-business-primary, currentColor); }
.dci-set-selector[data-conflict="true"] { color: var(--dsw-alias-state-error-primary, currentColor); }
.dci-set-input { background: var(--dsw-alias-bg-module-platform, color-mix(in srgb, currentColor 6%, transparent));
  height: 36px; color: var(--dsw-alias-label-primary, inherit); border: none; border-radius: 18px; outline: none;
  padding: 0 14px; font-size: 13px; min-width: 260px; max-width: 320px; }
.dci-set-input:focus { outline: 2px solid var(--dsw-alias-border-l3, transparent); }
.dci-switch { box-sizing: border-box; position: relative; flex: none; width: 36px; height: 20px; padding: 2px;
  border: 0; border-radius: 10px; background: var(--dsw-alias-border-l3, color-mix(in srgb, currentColor 30%, transparent));
  cursor: pointer; }
.dci-switch[aria-checked="true"] { background: var(--dsw-alias-brand-primary, color-mix(in srgb, currentColor 70%, transparent)); }
.dci-switch:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, currentColor); outline-offset: 2px; }
.dci-switch::after { content: ''; display: block; width: 16px; height: 16px; border-radius: 50%;
  background: var(--dsw-alias-label-primary-foreground, #fff); transition: transform 120ms ease; }
.dci-switch[aria-checked="true"]::after { transform: translateX(16px); }

/* ===== 数据行（官方 bOPqQW 复刻：居中双胶囊）===== */
.dci-stat-root { max-width: var(--dsh-chat-content-width, 100%); box-sizing: border-box; width: 100%;
  padding: 4px calc(var(--dsh-composer-side-clearance, 0px) + 16px) 0; font-size: 13px; line-height: 20px;
  justify-content: center; gap: 12px; margin: 0 auto; display: flex; }
.dci-stat-anchor { min-width: 0; display: inline-flex; position: relative; }

/* 数据行详情面板（官方 bRhRbq 复刻：锚点上方弹出） */
.dci-stat-panel { z-index: 1100; box-sizing: border-box; background: var(--dsw-menu-surface-fill, var(--dsw-specific-menu, rgba(30, 30, 34, 0.98)));
  backdrop-filter: var(--dsw-menu-backdrop-filter, none);
  color: var(--dsw-alias-label-secondary, inherit); --dsw-elevation-stroke-color: var(--dsw-alias-border-l1, transparent);
  width: max-content; min-width: min(300px, 100vw - 24px); max-width: min(440px, 100vw - 24px); text-align: left;
  box-shadow: var(--dsw-elevation-prominent, 0 10px 34px rgba(0, 0, 0, 0.35)); cursor: default; border: 0;
  border-radius: 12px; padding: 16px; font-size: 12px; line-height: 18px; position: absolute; bottom: calc(100% + 8px); left: 0; }
.dci-stat-panelTitle { color: var(--dsw-alias-label-primary, inherit); justify-content: space-between; gap: 16px;
  margin-bottom: 8px; font-weight: 500; display: flex; }
.dci-stat-panelLabel { align-items: center; gap: 6px; min-width: 0; display: inline-flex; }
.dci-stat-panelLabel svg { flex: none; width: 14px; height: 14px; }
.dci-stat-panelValue { font-variant-numeric: tabular-nums; }
.dci-stat-panelRule { border-top: 0.5px solid var(--dsw-alias-border-l2, color-mix(in srgb, currentColor 10%, transparent)); margin-bottom: 10px; }
.dci-stat-details { color: var(--dsw-alias-label-tertiary, currentColor); grid-template-columns: minmax(76px, auto) minmax(0, 1fr);
  gap: 6px 16px; margin: 0; display: grid; }
.dci-stat-details dt, .dci-stat-details dd { min-width: 0; margin: 0; }
.dci-stat-details dd { color: var(--dsw-alias-label-secondary, inherit); font-variant-numeric: tabular-nums; text-align: right; }
.dci-stat-pill { box-sizing: border-box; max-width: 100%; color: var(--dsw-alias-label-tertiary, currentColor);
  white-space: nowrap; background: transparent; border: none; border-radius: 24px; align-items: center; gap: 6px;
  padding: 1px 8px; display: inline-flex; cursor: pointer; font-variant-numeric: tabular-nums; }
.dci-stat-pill svg { flex: none; width: 14px; height: 14px; }
.dci-stat-pill:hover { background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, currentColor 8%, transparent));
  color: var(--dsw-alias-label-secondary, inherit); }
.dci-stat-label { text-overflow: ellipsis; min-width: 0; overflow: hidden; }
.dci-stat-sep { color: var(--dsw-alias-separator-primary, currentColor); margin: 0 6px; }

/* ===== 上下文小圈（官方 JObwrW 复刻：双环仪表 + 分段面板）
   0.1.7-rc.2 起官方把它挪进卡片下方 dock 行（stats 胶囊之后），trigger 变为「圈+百分比」药丸 ===== */
.dci-gauge-root { flex: none; display: inline-flex; position: relative; }
.dci-gauge-trigger { border-radius: var(--dsw-radius-sm, 8px); color: var(--dsw-alias-label-tertiary, currentColor);
  font-family: inherit; font-size: 13px; font-variant-numeric: tabular-nums; line-height: 20px; white-space: nowrap;
  cursor: pointer; background: transparent; border: none; flex: none; align-items: center; gap: 6px; padding: 1px 8px; display: inline-flex; }
.dci-gauge-trigger:hover, .dci-gauge-trigger[aria-expanded="true"] { background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, currentColor 8%, transparent));
  color: var(--dsw-alias-label-secondary, inherit); }
.dci-gauge-track { fill: none; stroke: var(--dsw-alias-border-l3, currentColor); stroke-width: 2px; }
.dci-gauge-fill { fill: none; stroke: var(--dsw-alias-label-tertiary, currentColor); stroke-width: 2px; stroke-linecap: round; }
.dci-gauge-panel { z-index: 1100; box-sizing: border-box; background: var(--dsw-menu-surface-fill, var(--dsw-specific-menu, rgba(30, 30, 34, 0.98)));
  backdrop-filter: var(--dsw-menu-backdrop-filter, none);
  --dsw-elevation-stroke-color: var(--dsw-alias-border-l1, transparent); width: min(264px, 100vw - 24px);
  box-shadow: var(--dsw-elevation-prominent, 0 10px 34px rgba(0, 0, 0, 0.35));
  color: var(--dsw-alias-label-secondary, inherit); cursor: default; border: 0; border-radius: var(--dsw-radius-lg, 12px); padding: 12px;
  font-size: 12px; line-height: 20px; position: absolute; bottom: calc(100% + 8px); right: 0; }
.dci-gauge-header { align-items: center; gap: 6px; display: flex; }
.dci-gauge-figures { font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-primary, inherit); margin-left: auto; font-weight: 500; }
.dci-gauge-percent { color: var(--dsw-alias-label-primary, inherit); font-weight: 500; }
.dci-gauge-headline { color: var(--dsw-alias-label-tertiary, currentColor); }
.dci-gauge-bar { background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, currentColor 8%, transparent));
  border-radius: 999px; gap: 1px; height: 4px; margin: 10px 0 12px; display: flex; overflow: hidden; }
.dci-gauge-segment { background: var(--meter-tint, var(--dsw-alias-label-tertiary, currentColor)); border-radius: 1px;
  flex: 0 0 auto; min-width: 2px; height: 100%; }
.dci-gauge-swatch { background: var(--meter-tint, currentColor); vertical-align: baseline; border-radius: 2px;
  width: 8px; height: 8px; margin-right: 6px; display: inline-block; }
.dci-gauge-colorSystem { --meter-tint: var(--dsw-static-neutral-bluish-400, #7d8590); }
.dci-gauge-colorTools { --meter-tint: #a78bfa; }
.dci-gauge-colorMessages { --meter-tint: var(--dsw-static-blue-450, #4c8dff); }
.dci-gauge-rows { margin: 6px 0 0; }
.dci-gauge-row { justify-content: space-between; align-items: center; gap: 12px; padding: 2px 0; display: flex; }
.dci-gauge-row dt { color: var(--dsw-alias-label-secondary, inherit); }
.dci-gauge-row dd { font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-primary, inherit); margin: 0; }

/* ===== 完全权限确认（官方 Modal + RiskConfirmation 复刻）===== */
.dci-modal-root { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 24px; }
.dci-modal-mask { position: absolute; inset: 0; background: var(--dsw-alias-bg-mask-1, rgba(0, 0, 0, 0.5));
  backdrop-filter: var(--dsw-mask-blur, blur(2px)); }
.dci-modal-dialog { position: relative; z-index: 1; display: flex; flex-direction: column; gap: 20px;
  width: min(440px, 100%); max-height: calc(100vh - 48px); padding: 0 0 24px; overflow: hidden; border: 0;
  border-radius: 24px; background: var(--dsw-alias-bg-layer-2, #232327); color: var(--dsw-alias-label-primary, #ececf1);
  --dsw-elevation-stroke-color: var(--dsw-alias-border-l1, transparent);
  box-shadow: var(--dsw-elevation-prominent, 0 10px 34px rgba(0, 0, 0, 0.35)); }
.dci-modal-content { display: flex; flex-direction: column; width: 100%; min-height: 0; overflow-y: auto; }
.dci-modal-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 22px 14px 12px 24px; }
.dci-modal-title { margin: 0; font-size: 16px; line-height: 24px; font-weight: 500; color: var(--dsw-alias-label-primary, inherit); }
.dci-modal-close { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px;
  border: none; border-radius: 8px; background: transparent; cursor: pointer; color: var(--dsw-alias-label-secondary, inherit); }
.dci-modal-close:hover { background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, currentColor 8%, transparent)); }
.dci-modal-body { display: flex; flex-direction: column; min-width: 0; margin-top: 20px; padding: 0 24px; }
.dci-modal-footer { display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding: 0 24px; }
.dci-confirm-warning { display: flex; align-items: flex-start; gap: 10px; color: var(--dsw-alias-label-secondary, inherit);
  font-size: 14px; line-height: 22px; }
.dci-confirm-warning p { margin: 0; }
.dci-confirm-warningIcon { flex: none; margin-top: 2px; color: var(--dsw-alias-state-error-primary, #e5484d); }
.dci-confirm-ack { display: flex; align-items: flex-start; gap: 10px; margin-top: 20px; cursor: pointer;
  color: var(--dsw-alias-label-primary, inherit); font-size: 14px; line-height: 22px; }
.dci-confirm-ack input { flex: none; width: 16px; height: 16px; margin: 3px 0 0; cursor: pointer;
  accent-color: var(--dsw-alias-button-primary-fill, currentColor); }
.dci-btn { display: inline-flex; align-items: center; justify-content: center; gap: 4px; border: none; border-radius: 18px;
  cursor: pointer; font-size: 14px; line-height: 22px; color: var(--dsw-alias-label-primary, inherit);
  background: transparent; padding: 0 14px; height: 36px; }
.dci-btn:disabled { cursor: not-allowed; opacity: 0.4; }
.dci-btn-outline { border: 0.5px solid var(--dsw-alias-border-l3, color-mix(in srgb, currentColor 25%, transparent)); background: transparent; }
.dci-btn-outline:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, currentColor 8%, transparent)); }
.dci-btn-primary { background: var(--dsw-alias-button-primary-fill, currentColor); color: var(--dsw-alias-label-primary-foreground, #fff); }
.dci-btn-primary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover, currentColor); }
.dci-btn-cancel { min-width: 72px; }
.dci-btn-confirm { min-width: 136px; }
`;

export function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = CSS;
  document.head.appendChild(el);
}
