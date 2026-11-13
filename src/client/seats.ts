/**
 * 输入区座位清单与「未镜像座位」运行时审计。
 *
 * 宿主 0.2.x 的输入区是一棵所有权树：`conversation.composer.bar`（single）的
 * 官方条目在自己的 `children` 表里声明了 9 个子座位，而每个子座位的**唯一**
 * 渲染点都在官方 `InputBar` 体内。bar 被 Codinput 以 `priority:-1` 遮蔽后，
 * 未镜像的座位就失去渲染点——插件照常注册成功、不报错、永不上屏。官方 slot
 * 文档写明「每个声明只能有一个存活 owner」，且接管条目无法声明已被官方声明
 * 的 child，因此没有「原样 renderSlot 转发」这条路，只能逐座复刻。
 *
 * 本模块在接管生效期间订阅未镜像座位的条目变化：一旦发现「有**第三方**占用者
 * 但 Codinput 没有渲染点」，就在诊断口（`__dshCodinputErrs` 的 `slot.unmirrored`）
 * 与 console 各留一条，把静默失效变成可见告警（issue #8）。
 *
 * 为什么只报第三方：这两个座位的「官方自带占用者」（见 `SHIPPED_OCCUPANTS`，
 * 0.2.2-rc.1 的 slot catalog + 隔离宿主运行时 dump 取证）是接管设计的已知代价——
 * 它们的 UI（斜杠菜单 / 指令弹层 / 反馈弹窗 / 官方附件行）已由 Codinput 自绘面
 * 或官方其它渲染路径承担，逐个告警会在**每个干净宿主**上刷屏并污染
 * `__dshCodinputErrs`（运行时验证发现，见 docs/review/issue8-runtime.md）。
 *
 * 不在本清单里的座位：
 * - `conversation.input.dock` 在 bar 之外（`ConversationContent` 直接渲染），
 *   接管不影响它；
 * - 已镜像的座位见 `MIRRORED_SEATS`（含 `composer.dock`，由 StatsRow 的数据行
 *   按官方 list 合成渲染，且只镜像第三方条目）。
 */

import { diagDebug, diagError } from './diag';
import type { SlotEntryLike, SlotsService } from './host-types';

/** 已在自绘面按位置复刻的座位（与宿主 0.2.2-rc.1 的 bar children 表对齐）。 */
export const MIRRORED_SEATS: readonly string[] = [
  'conversation.input.left',
  'conversation.input.right',
  'conversation.input.model',
  'conversation.input.permission',
  'conversation.input.plan',
  'conversation.input.activity',
  'conversation.composer.dock',
];

/** 尚未镜像、但官方 bar 条目体内有声明的子座位。 */
export const UNMIRRORED_SEATS: readonly string[] = [
  'conversation.input.overlay',
  'conversation.input.attachments',
];

/**
 * 宿主自带的未镜像座位占用者（0.2.2-rc.1）。
 *
 * 取证：`@deepseek-ai/dsh-cordis-client-runner` 的 slot catalog `occupants`，
 * 以及隔离宿主运行时对 `slots.entries()` 的 dump：
 * - overlay：client-ui-commands `PopupSelectView` id `command-popup`、
 *   client-ui-input-trigger `MenuView` id `slash-menu`、
 *   client-ui-message-feedback `FeedbackDialog` id `feedback-dialog`；
 * - attachments（single）：client-ui-attachment `ComposerAttachments`（无 id）。
 *
 * 宿主升级后按新版 catalog 复核；若官方改了 id/组件名，这里的失配会表现为
 * 「干净宿主又开始告警」——可见回归，而不是静默漏报。
 */
const SHIPPED_OCCUPANTS: Record<string, { ids: readonly string[]; components: readonly string[] }> = {
  'conversation.input.overlay': {
    ids: ['slash-menu', 'command-popup', 'feedback-dialog'],
    components: ['MenuView', 'PopupSelectView', 'FeedbackDialog'],
  },
  'conversation.input.attachments': {
    ids: [],
    components: ['ComposerAttachments'],
  },
};

interface AuditState {
  /** 接管是否生效：未接管时官方输入框原样渲染，这些座位没有损失，不必告警。 */
  active: boolean;
  slots: SlotsService | undefined;
  disposers: Array<() => void>;
  /** 同座位 + 同第三方占用者集合只报一次，避免会话切换/重渲染刷屏。 */
  reported: Set<string>;
}

const state: AuditState = { active: false, slots: undefined, disposers: [], reported: new Set() };

function optionIdOf(entry: unknown): string | undefined {
  const options = (entry as { options?: { id?: unknown } } | null | undefined)?.options;
  const id = options?.id;
  return typeof id === 'string' ? id : undefined;
}

function componentNameOf(entry: unknown): string | undefined {
  const component = (entry as { component?: unknown } | null | undefined)?.component;
  if (typeof component !== 'function') return undefined;
  const name = (component as { name?: unknown }).name;
  return typeof name === 'string' && name !== '' ? name : undefined;
}

function registrantOf(entry: unknown): string | undefined {
  const registrant = (entry as { registrant?: unknown } | null | undefined)?.registrant;
  return typeof registrant === 'string' && registrant !== '' ? registrant : undefined;
}

/** 占用者可读名：id → 组件名 → 归属名（宿主的 `fiber.name` 可能是压缩短名）。 */
function occupantName(entry: unknown): string {
  return optionIdOf(entry) ?? componentNameOf(entry) ?? registrantOf(entry) ?? 'unknown';
}

/**
 * 该条目是否属于宿主自带的、接管前由官方 InputBar 渲染的占用者：
 * 官方 UI 已由 Codinput 自绘替代 / 接管设计已知代价，不算「静默失效」。
 */
function isShippedOccupant(key: string, entry: unknown, index: number): boolean {
  const shipped = SHIPPED_OCCUPANTS[key];
  if (shipped === undefined) return false;
  const id = optionIdOf(entry);
  if (id !== undefined && shipped.ids.includes(id)) return true;
  const component = componentNameOf(entry);
  if (component !== undefined && shipped.components.includes(component)) return true;
  // single 座兜底：宿主在启动期注册自带条目，第三方只能后来追加/遮蔽，
  // 因此首位按官方处理（组件名被宿主压缩时仍保住「不刷屏」）。
  return key === 'conversation.input.attachments' && index === 0;
}

function inspect(key: string): void {
  const slots = state.slots;
  if (!state.active || !slots || typeof slots.entries !== 'function') return;
  let entries: readonly unknown[];
  try {
    entries = slots.entries(key);
  } catch {
    // 槽位未声明（旧宿主没有这个子座位）：既无渲染点也无占用者。
    return;
  }
  if (!Array.isArray(entries) || entries.length === 0) return;
  const thirdParty = entries.filter((entry, index) => !isShippedOccupant(key, entry, index));
  if (thirdParty.length === 0) return;
  const names = [...new Set(thirdParty.map(occupantName))];
  const signature = `${key}|${names.join(',')}`;
  if (state.reported.has(signature)) return;
  state.reported.add(signature);
  const message =
    `slot "${key}" has ${thirdParty.length} third-party occupant(s) (${names.join(', ')}) ` +
    'but Codinput renders no seat for it — their UI is invisible while takeover is active';
  diagError('slot.unmirrored', new Error(message));
  diagDebug({
    scope: 'slot.unmirrored',
    key,
    registrants: names,
    shippedSkipped: entries.length - thirdParty.length,
  });
  try {
    console.warn(`[dsh-codinput] ${message}`);
  } catch {
    // console 被宿主接管时不连坐插件。
  }
}

function inspectAll(): void {
  for (const key of UNMIRRORED_SEATS) inspect(key);
}

/** slots 服务就绪后调用：订阅各未镜像座位的条目变更并做首轮检查。 */
export function installSeatAudit(slots: SlotsService): void {
  state.slots = slots;
  if (state.disposers.length > 0) {
    inspectAll();
    return;
  }
  if (typeof slots.subscribe !== 'function' || typeof slots.entries !== 'function') return;
  for (const key of UNMIRRORED_SEATS) {
    try {
      const off = slots.subscribe(key, () => inspect(key));
      state.disposers.push(() => {
        try {
          off?.();
        } catch {
          // 宿主已卸载该订阅：无需处理。
        }
      });
    } catch {
      // 槽位未声明：旧宿主没有这个座位，无需订阅。
    }
  }
  inspectAll();
}

/** 接管条目挂载/卸载时切换审计开关。 */
export function setTakeoverActive(active: boolean): void {
  if (state.active === active) return;
  state.active = active;
  if (active) inspectAll();
}

/** 插件卸载：断开订阅（由 apply 的 ctx.effect 持有）。 */
export function stopSeatAudit(): void {
  for (const dispose of state.disposers.splice(0)) dispose();
  state.slots = undefined;
  state.active = false;
  state.reported.clear();
}
