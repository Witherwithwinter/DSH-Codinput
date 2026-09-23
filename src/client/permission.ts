/**
 * 权限预设：对齐官方 PermissionSelect——三个预设、文案与确认流程
 * （danger-full-access 需勾选已知风险的确认弹层）。提交仍走命令通道
 * 旁路（sessions.binding(id).session.command），缺失时草稿交换退化。
 */

import type { InputActions, SessionsFace } from './host-types';
import { stash } from './services';
import { saveAppliedPermission } from './prefs';
import { diagDebug } from './diag';
import { t, tOptional } from './i18n';

/** 官方三个预设 id（文案走 i18n 的 perm.preset.*，宿主目录缺席时的兜底）。 */
export const PERMISSION_PRESET_IDS: readonly string[] = ['read-only', 'workspace-write', 'danger-full-access'];

/** 预设标签：i18n 词典（perm.preset.*），缺键回退 id。 */
export function presetLabel(id: string): string {
  return tOptional(`perm.preset.${id}`) ?? id;
}

/** 官方 access.confirm.* 文案（取值函数：语言切换后按当拍语言重新取）。 */
export function fullAccessConfirm(): {
  title: string;
  description: string;
  acknowledgeLabel: string;
  cancelLabel: string;
  enableLabel: string;
} {
  return {
    title: t('perm.confirmTitle'),
    description: t('perm.warning'),
    acknowledgeLabel: t('perm.ack'),
    cancelLabel: t('perm.cancel'),
    enableLabel: t('perm.confirmEnable'),
  };
}

/** useProjection("permissions") 的宿主投影形状（官方 PermissionSelect 的 value prop）。 */
export interface PermissionProjection {
  readonly currentValue: string;
  readonly options: readonly { value: string; name: string; description?: string }[];
}

/**
 * 官方 permissionLabel：内建预设名映射产品文案；宿主自配的 kebab 名转
 * Title Case；其余（非 kebab）原样透传。
 */
export function permissionLabel(value: string, name: string): string {
  const builtIn = PERMISSION_PRESET_IDS.includes(value);
  if (builtIn && (name === value || name === presetLabel(value))) return presetLabel(value);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) return name;
  return name
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export interface PermissionOutcome {
  readonly ok: boolean;
  readonly via: 'command' | 'draft-exchange';
  readonly message?: string;
}

/** 命令通道：/permission <preset>。matched=false 视为该命令未被识别。 */
export async function applyViaCommand(sessionId: string, preset: string): Promise<PermissionOutcome | null> {
  const session = stash.sessions?.binding(sessionId)?.session;
  if (!session || typeof session.command !== 'function') return null;
  try {
    const result = await session.command(`/permission ${preset}`);
    if (result?.ok) {
      if (result.value?.matched === false) {
        return { ok: false, via: 'command', message: t('perm.channelRejected') };
      }
      saveAppliedPermission(preset);
      return { ok: true, via: 'command' };
    }
    return { ok: false, via: 'command', message: t('perm.channelRejected') };
  } catch (error) {
    diagDebug('permission command failed', error);
    return { ok: false, via: 'command', message: String(error) };
  }
}

/**
 * 草稿交换退化：原草稿 → 命令行 → 回写原草稿。official 提交是异步事务，
 * 命令被机器消费后按保存的原草稿恢复。
 */
export function applyViaDraftExchange(
  preset: string,
  actions: InputActions,
  currentDraft: string,
): PermissionOutcome {
  try {
    actions.setDraft(`/permission ${preset}`);
    actions.submit();
    setTimeout(() => {
      try {
        actions.setDraft(currentDraft);
      } catch (error) {
        diagDebug('permission draft restore failed', error);
      }
    }, 600);
    saveAppliedPermission(preset);
    return { ok: true, via: 'draft-exchange' };
  } catch (error) {
    diagDebug('permission draft-exchange failed', error);
    return { ok: false, via: 'draft-exchange', message: String(error) };
  }
}

export async function applyPermission(
  sessionId: string,
  preset: string,
  actions: InputActions | undefined,
  currentDraft: string,
): Promise<PermissionOutcome> {
  const viaCommand = await applyViaCommand(sessionId, preset);
  if (viaCommand) return viaCommand;
  if (!actions) return { ok: false, via: 'draft-exchange', message: t('perm.noInputSurface') };
  return applyViaDraftExchange(preset, actions, currentDraft);
}

export type { SessionsFace };
