/**
 * 权限菜单：官方 PermissionSelect 复刻。事实源是宿主投影
 * useProjection("permissions")（{ currentValue, options }），触发器
 * （模式 glyph + 标签 + chevron，open 时旋转）、上方 Menu（三项 +
 * glyph + 选中勾）与「完全权限」的 RiskConfirmation 模态确认都按官方
 * 流程：选完全权限先关菜单、弹确认框，勾选后才提交 /permission 命令。
 * 投影缺席时整个按钮不渲染（同官方 value === undefined 返回 null）。
 */

import { useEffect, useRef, useState } from 'react';
import type { InputActions, UseProjection } from '../host-types';
import { t } from '../i18n';
import {
  fullAccessConfirm,
  PERMISSION_PRESET_IDS,
  applyPermission,
  permissionLabel,
  type PermissionProjection,
} from '../permission';
import {
  IconChevronOfficial,
  IconShieldBarsOfficial,
  IconShieldCheckOfficial,
  IconShieldWriteOfficial,
  IconWarningOfficial,
  IconX,
} from '../icons';
import { MenuCheck, MenuSurface } from './MenuSurface';

export interface PermissionMenuProps {
  sessionId: string | undefined;
  actions: InputActions | undefined;
  currentDraft: string;
  useProjection: UseProjection | undefined;
  /** owner disabled（blocked/removed 场景锁住触发器）。 */
  disabled?: boolean;
  onNotify?(level: 'info' | 'error', text: string): void;
}

const FULL_ACCESS = 'danger-full-access';

/** 官方 permissionGlyphs：每个预设一枚专属盾 glyph；未知值无 glyph。 */
function glyph(value: string): JSX.Element | undefined {
  if (value === 'read-only') return <IconShieldCheckOfficial size={16} />;
  if (value === 'workspace-write') return <IconShieldWriteOfficial size={16} />;
  if (value === FULL_ACCESS) return <IconShieldBarsOfficial size={16} />;
  return undefined;
}

export function PermissionMenu(props: PermissionMenuProps): JSX.Element | null {
  const { sessionId, actions, currentDraft, useProjection, disabled, onNotify } = props;
  // 官方同款事实源：宿主投影（hook 顺序随 useProjection prop 存在性固定）。
  const permissions = useProjection
    ? (useProjection('permissions') as PermissionProjection | undefined)
    : undefined;
  const [pick, setPick] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [anchor, setAnchor] = useState<{ left: number; top: number; right: number; bottom: number } | null>(null);

  // locked/无值时收起（官方 useEffect 同语义）。
  useEffect(() => {
    if (disabled) return;
    if (permissions !== undefined) return;
    setOpen(false);
    setAcknowledged(false);
    setConfirmation(null);
  }, [disabled, permissions]);

  // alpha 权限投影只含 currentValue（选项目录移至宿主 permission catalog）：
  // 触发器以 currentValue 显示；选项用内建三预设，当前值不在其中时补入兜底。
  if (!permissions || typeof permissions.currentValue !== 'string') return null;

  const busy = pick !== null || confirmation !== null;
  const currentValue = pick ?? permissions.currentValue;
  const currentLabel = permissionLabel(currentValue, currentValue);

  // 官方顺序：内建三预设按目录序，当前值不在其中时附加兜底。
  const items = [...PERMISSION_PRESET_IDS, ...(PERMISSION_PRESET_IDS.includes(currentValue) ? [] : [currentValue])].map((id) => ({
    id,
    label: permissionLabel(id, id),
    icon: glyph(id),
  }));

  const close = (): void => setOpen(false);

  const submit = (id: string): void => {
    if (!sessionId) return;
    setPick(id);
    applyPermission(sessionId, id, actions, currentDraft)
      .then((outcome) => {
        if (!outcome.ok) onNotify?.('error', outcome.message ?? t('perm.switchFailed'));
      })
      .finally(() => setPick(null));
  };

  const choose = (id: string): void => {
    close();
    if (id === permissions.currentValue) return;
    if (id === FULL_ACCESS) {
      setAcknowledged(false);
      setConfirmation(id);
      return;
    }
    submit(id);
  };

  const closeConfirmation = (): void => {
    setAcknowledged(false);
    setConfirmation(null);
  };

  const confirmFullAccess = (): void => {
    if (disabled || !acknowledged || confirmation === null) return;
    const id = confirmation;
    closeConfirmation();
    submit(id);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="dci-trigger"
        aria-label={t("perm.trigger", { name: currentLabel })}
        title={undefined}
        disabled={disabled || busy}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (!open) setAnchor(triggerRef.current?.getBoundingClientRect() ?? null);
          setOpen(!open);
        }}
      >
        {glyph(currentValue) !== undefined ? (
          <span className="dci-triggerIcon" aria-hidden="true">
            {glyph(currentValue)}
          </span>
        ) : null}
        <span className="dci-triggerLabel">{currentLabel}</span>
        <span className="dci-chev" data-open={open}>
          <IconChevronOfficial size={14} />
        </span>
      </button>

      {open && anchor ? (
        <MenuSurface anchor={anchor} onClose={close}>
          {items.map((item) => {
            const active = item.id === currentValue;
            return (
              <button
                key={item.id}
                type="button"
                className="dci-item"
                disabled={busy}
                onClick={() => choose(item.id)}
              >
                {item.icon !== undefined ? (
                  <span className="dci-itemIcon" aria-hidden="true">
                    {item.icon}
                  </span>
                ) : null}
                <span className="dci-itemLabel">{item.label}</span>
                {active ? (
                  <span className="dci-check" aria-hidden="true">
                    <MenuCheck size={16} />
                  </span>
                ) : null}
              </button>
            );
          })}
        </MenuSurface>
      ) : null}

      <RiskConfirmation
        open={confirmation !== null}
        acknowledged={acknowledged}
        disabled={disabled === true}
        onAcknowledgedChange={setAcknowledged}
        onCancel={closeConfirmation}
        onConfirm={confirmFullAccess}
      />
    </>
  );
}

/** 官方 RiskConfirmation（Modal + 警示行 + 勾选 + 取消/启用）。 */
function RiskConfirmation(props: {
  open: boolean;
  acknowledged: boolean;
  disabled: boolean;
  onAcknowledgedChange(checked: boolean): void;
  onCancel(): void;
  onConfirm(): void;
}): JSX.Element | null {
  const { open, acknowledged, disabled, onAcknowledgedChange, onCancel, onConfirm } = props;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;
  return (
    <div className="dci-modal-root" role="presentation">
      <div className="dci-modal-mask" aria-hidden="true" onClick={onCancel} />
      <div className="dci-modal-dialog dci-confirm" role="dialog" aria-modal="true" aria-label={fullAccessConfirm().title}>
        <div className="dci-modal-content">
          <div className="dci-modal-header">
            <h2 className="dci-modal-title">{fullAccessConfirm().title}</h2>
            <button type="button" className="dci-modal-close" aria-label={t("perm.close")} onClick={onCancel}>
              <IconX size={14} />
            </button>
          </div>
          <div className="dci-modal-body">
            <div className="dci-confirm-warning">
              <span className="dci-confirm-warningIcon" aria-hidden="true">
                <IconWarningOfficial size={18} />
              </span>
              <p>{fullAccessConfirm().description}</p>
            </div>
            <label className="dci-confirm-ack">
              <input
                type="checkbox"
                checked={acknowledged}
                disabled={disabled}
                autoFocus
                onChange={(e) => onAcknowledgedChange(e.currentTarget.checked)}
              />
              <span>{fullAccessConfirm().acknowledgeLabel}</span>
            </label>
          </div>
        </div>
        <div className="dci-modal-footer">
          <button type="button" className="dci-btn dci-btn-outline dci-btn-cancel" onClick={onCancel}>
            {fullAccessConfirm().cancelLabel}
          </button>
          <button
            type="button"
            className="dci-btn dci-btn-primary dci-btn-confirm"
            disabled={disabled || !acknowledged}
            onClick={onConfirm}
          >
            {fullAccessConfirm().enableLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
