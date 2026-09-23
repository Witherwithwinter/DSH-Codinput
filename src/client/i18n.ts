/**
 * 文案国际化：走宿主 locale 服务（`ctx.locale.register` + `bind`），
 * 宿主未就绪或形状漂移时退回内置词典（默认中文），绝不把 key 直接显示给用户。
 *
 * - 注册命名空间 `dsh-codinput` 的 zh / en 两份词典（宿主内置语言只有这两个）。
 * - `bind(ns)` 返回的函数**引用稳定、按调用当拍读当前语言**，所以组件里直接
 *   调 `t('key')` 即可；要跟随语言切换重渲染的地方用 `useT()`（内部订阅宿主
 *   locale 快照变化）。动态键（如候选菜单来源名）用 `tOptional()`，词典里没有
 *   就返回 undefined，交由调用方回退原名。
 * - 插值占位符用 `{name}`（与宿主 Translate 约定一致）。
 */

import { useEffect, useState } from 'react';

export type TranslateParams = Record<string, string | number>;
type Dict = Record<string, string>;

const NS = 'dsh-codinput';

/** 中文词典（默认语言，也是宿主缺词典键时的兜底）。 */
const ZH: Dict = {
  'head.edit': '编辑',
  'head.preview': '预览',
  'head.editOnly': '仅编辑',
  'head.previewOnly': '仅预览',
  'head.split': '编辑 + 预览',
  'editor.placeholder': '描述你想要构建的内容，/ 调用指令，@ 文件或对话',
  'preview.empty': '暂无可预览内容',
  'tool.command': '指令（/）',
  'tool.attach': '添加附件',
  'tool.send': '发送',
  'tool.model': '选择模型，当前 {name}',
  'tool.modelPlain': '选择模型',
  'tool.context': '上下文已用 {percent}%',
  'tool.contextTitle': '上下文已用',
  'attach.group': '草稿附件',
  'attach.uploading': '上传中…',
  'attach.failed': '上传失败',
  'attach.retry': '重试上传',
  'attach.remove': '移除附件 {name}',
  'attach.scrollLeft': '向左滚动附件',
  'attach.scrollRight': '向右滚动附件',
  'attach.channelUnavailable': '附件通道不可用',
  'attach.pending': '待上传文件 {name}',
  'stats.session': '会话统计',
  'stats.usage': 'Token 用量',
  'stats.turns': '{turns} 轮 {steps} 步',
  'stats.tps': '{tps} tok/s',
  'stats.modelTime': '模型用时',
  'stats.ttft': '首 token 平均（TTFT）',
  'stats.tpsLabel': '输出速度（TPS）',
  'stats.totalTokens': '{tokens} tok',
  'stats.cacheHit': '缓存命中 {percent}%',
  'stats.cacheHitLabel': '缓存命中',
  'stats.cacheRead': '缓存读取',
  'stats.cacheWrite': '缓存写入',
  'stats.output': '输出',
  'stats.uncached': '未缓存输入',
  'stats.breakdown': '上下文分段',
  'stats.prompt': '系统提示词',
  'stats.tools': '工具定义',
  'stats.messages': '对话消息',
  'menu.model': '模型',
  'menu.reasoning': '推理等级',
  'menu.reasoningNone': '当前模型未提供推理等级。',
  'menu.source.command': '指令',
  'menu.source.skill': '技能',
  'menu.source.subagent': '子智能体',
  'menu.drill': '进入目录',
  'menu.nav': '目录导航',
  'menu.triggerCandidates': '触发候选建议',
  'menu.empty': '没有匹配项',
  'menu.loading': '加载中…',
  'menu.loadFailed': '加载失败',
  'menu.refreshingModels': '正在刷新模型列表…',
  'menu.noModels': '没有可用的模型。',
  'menu.filter': '筛选选项…',
  'popup.ack': '我已了解该操作的影响',
  'perm.trigger': '访问模式，当前：{name}',
  'perm.confirmTitle': '确认启用完全权限？',
  'perm.confirmEnable': '启用完全权限',
  'perm.warning':
    '启用完全权限后，智能体将减少确认步骤，并且可以直接执行更多操作，包括敏感操作、文件修改或外部命令。仅建议在你信任当前任务时使用。',
  'perm.ack': '我已了解风险，并愿意继续',
  'perm.cancel': '取消',
  'perm.close': '关闭',
  'perm.switchFailed': '权限切换失败',
  'perm.channelRejected': '命令通道拒绝',
  'perm.noInputSurface': '无可用输入面',
  'perm.preset.read-only': '仅可查看',
  'perm.preset.workspace-write': '工作区内修改',
  'perm.preset.danger-full-access': '完全权限',
  'set.enabled': '启用接管',
  'set.enabledDesc': '关闭即恢复官方输入框，草稿不丢；/codinput 同样可切换',
  'set.lineNumbers': '显示行号',
  'set.lineNumbersDesc': '当前行与行号高亮常开',
  'set.font': '编辑器字体',
  'set.fontDesc': 'CSS font-family，留空恢复默认',
  'set.sendKey': '发送快捷键',
  'set.sendKeyDesc': '点击后按下任意组合完成录制；与换行快捷键不得相同',
  'set.lineBreakKey': '换行快捷键',
  'set.lineBreakKeyDesc': '点击后按下任意组合完成录制；与发送快捷键不得相同',
  'set.defaultView': '默认视图',
  'set.defaultViewDesc': '接管面板初始显示的形态',
  'set.recording': '按键…',
  'set.reset': '恢复默认',
  'set.resetAction': '重置',
  'set.resetAll': '清空全部 Codinput 偏好',
  'ball.label': '展开 Codinput 输入面板',
  'ball.title': '展开 Codinput',
  'side.notice': '本会话的输入面已在另一个分栏中打开（输入入口唯一）。',
  'side.guideDesc': '代码编辑器风格的输入面板；开启期间主输入框由本面板接管（共用同一台输入机）',
  'cmd.enter': '进入 Codinput 输入接管',
  'cmd.exit': '退出 Codinput，恢复官方输入框',
};

/** 英文词典（键集与中文一致）。 */
const EN: Dict = {
  'head.edit': 'Edit',
  'head.preview': 'Preview',
  'head.editOnly': 'Edit only',
  'head.previewOnly': 'Preview only',
  'head.split': 'Edit + Preview',
  'editor.placeholder': 'Describe what you want to build — / for commands, @ for files or chats',
  'preview.empty': 'Nothing to preview',
  'tool.command': 'Commands (/)',
  'tool.attach': 'Add attachment',
  'tool.send': 'Send',
  'tool.model': 'Select model, current {name}',
  'tool.modelPlain': 'Select model',
  'tool.context': 'Context used {percent}%',
  'tool.contextTitle': 'Context used',
  'attach.group': 'Draft attachments',
  'attach.uploading': 'Uploading…',
  'attach.failed': 'Upload failed',
  'attach.retry': 'Retry upload',
  'attach.remove': 'Remove attachment {name}',
  'attach.scrollLeft': 'Scroll attachments left',
  'attach.scrollRight': 'Scroll attachments right',
  'attach.channelUnavailable': 'Attachment channel unavailable',
  'attach.pending': 'Pending file {name}',
  'stats.session': 'Session stats',
  'stats.usage': 'Token usage',
  'stats.turns': '{turns} turns · {steps} steps',
  'stats.tps': '{tps} tok/s',
  'stats.modelTime': 'Model time',
  'stats.ttft': 'Avg first token (TTFT)',
  'stats.tpsLabel': 'Output speed (TPS)',
  'stats.totalTokens': '{tokens} tok',
  'stats.cacheHit': 'Cache hit {percent}%',
  'stats.cacheHitLabel': 'Cache hit',
  'stats.cacheRead': 'Cache read',
  'stats.cacheWrite': 'Cache write',
  'stats.output': 'Output',
  'stats.uncached': 'Uncached input',
  'stats.breakdown': 'Context breakdown',
  'stats.prompt': 'System prompt',
  'stats.tools': 'Tool definitions',
  'stats.messages': 'Conversation',
  'menu.model': 'Model',
  'menu.reasoning': 'Reasoning effort',
  'menu.reasoningNone': 'The current model exposes no reasoning effort.',
  'menu.source.command': 'Commands',
  'menu.source.skill': 'Skills',
  'menu.source.subagent': 'Subagents',
  'menu.drill': 'Open folder',
  'menu.nav': 'Folder navigation',
  'menu.triggerCandidates': 'Trigger suggestions',
  'menu.empty': 'No matches',
  'menu.loading': 'Loading…',
  'menu.loadFailed': 'Failed to load',
  'menu.refreshingModels': 'Refreshing model list…',
  'menu.noModels': 'No models available.',
  'menu.filter': 'Filter options…',
  'popup.ack': 'I understand the impact of this action',
  'perm.trigger': 'Access mode, current: {name}',
  'perm.confirmTitle': 'Enable full access?',
  'perm.confirmEnable': 'Enable full access',
  'perm.warning':
    'With full access the agent skips most confirmations and can perform more actions directly, including sensitive operations, file writes, or external commands. Only use it when you trust the current task.',
  'perm.ack': 'I understand the risk and want to continue',
  'perm.cancel': 'Cancel',
  'perm.close': 'Close',
  'perm.switchFailed': 'Failed to switch permission',
  'perm.channelRejected': 'Command channel rejected',
  'perm.noInputSurface': 'No input surface available',
  'perm.preset.read-only': 'Read only',
  'perm.preset.workspace-write': 'Write in workspace',
  'perm.preset.danger-full-access': 'Full access',
  'set.enabled': 'Take over composer',
  'set.enabledDesc': 'Turning it off restores the official composer; the draft is kept. /codinput toggles it too.',
  'set.lineNumbers': 'Show line numbers',
  'set.lineNumbersDesc': 'The current line and its gutter number stay highlighted',
  'set.font': 'Editor font',
  'set.fontDesc': 'CSS font-family; leave empty for the default',
  'set.sendKey': 'Send shortcut',
  'set.sendKeyDesc': 'Click, then press any combination to record it; must differ from the line-break shortcut',
  'set.lineBreakKey': 'Line-break shortcut',
  'set.lineBreakKeyDesc': 'Click, then press any combination to record it; must differ from the send shortcut',
  'set.defaultView': 'Default view',
  'set.defaultViewDesc': 'Initial layout of the takeover panel',
  'set.recording': 'Press keys…',
  'set.reset': 'Reset',
  'set.resetAction': 'Reset',
  'set.resetAll': 'Clear all Codinput preferences',
  'ball.label': 'Open the Codinput input panel',
  'ball.title': 'Open Codinput',
  'side.notice': "This session's input panel is already open in another split pane (only one input surface exists).",
  'side.guideDesc': 'Code-editor style input panel. While enabled it takes over the composer (sharing the same input machine).',
  'cmd.enter': 'Enable the Codinput composer takeover',
  'cmd.exit': 'Disable Codinput and restore the official composer',
};

interface LocaleFaceLike {
  register?(ns: string, locale: string, dict: Dict): (() => void) | void;
  bind?(ns: string): (key: string, params?: TranslateParams) => string;
  subscribe?(fn: () => void): () => void;
  getSnapshot?(): { active?: string };
}

let bound: ((key: string, params?: TranslateParams) => string) | null = null;
let activeLocale = 'zh';
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

function interpolate(text: string, params?: TranslateParams): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (whole, key: string) => {
    const value = params[key];
    return value === undefined ? whole : String(value);
  });
}

/** 当前语言的内置词典（宿主 bind 不可用时的兜底）。 */
function builtinDict(): Dict {
  return activeLocale.startsWith('zh') ? ZH : EN;
}

/** 安装：注册词典并绑定翻译函数（宿主 locale 服务就绪后调用一次）。 */
export function installI18n(locale: unknown): void {
  const face = locale as LocaleFaceLike | undefined;
  if (!face) return;
  try {
    face.register?.(NS, 'zh', ZH);
    face.register?.(NS, 'en', EN);
    bound = face.bind?.(NS) ?? null;
  } catch {
    // 重复注册（热重载）或形状漂移：退回内置词典
    try {
      bound = face.bind?.(NS) ?? null;
    } catch {
      bound = null;
    }
  }
  try {
    const snapshot = face.getSnapshot?.();
    if (snapshot?.active) activeLocale = snapshot.active;
    face.subscribe?.(() => {
      const next = face.getSnapshot?.();
      if (next?.active && next.active !== activeLocale) activeLocale = next.active;
      emit();
    });
  } catch {
    /* 快照不可用：语言切换不重渲染，但不影响首屏文案 */
  }
}

export function subscribeI18n(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function lookup(key: string, params?: TranslateParams): string | undefined {
  if (bound) {
    try {
      const text = bound(key, params);
      if (text && text !== key) return text;
    } catch {
      /* 落到内置词典 */
    }
  }
  const dict = builtinDict()[key] ?? ZH[key];
  return dict === undefined ? undefined : interpolate(dict, params);
}

/**
 * 翻译。优先级：宿主 bind（按当拍语言查，含宿主自己的回退链）→ 内置词典 →
 * 原 key。宿主词典缺键时 bind 原样返回 key，这里据此再落到内置词典。
 */
export function t(key: string, params?: TranslateParams): string {
  return lookup(key, params) ?? key;
}

/**
 * 可选翻译：词典里没有该键时返回 undefined——用于动态键（如候选菜单的
 * 来源名），调用方回退显示原名而不是把 key 摆到界面上。
 */
export function tOptional(key: string, params?: TranslateParams): string | undefined {
  return lookup(key, params);
}

/** 语言切换时重渲染的订阅钩子（返回稳定的 t）。 */
export function useT(): typeof t {
  const [, bump] = useState(0);
  useEffect(() => subscribeI18n(() => bump((n) => n + 1)), []);
  return t;
}
