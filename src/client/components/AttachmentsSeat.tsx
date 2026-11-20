/**
 * 附件座位：`conversation.input.attachments`（single, session）——**镜像官方条目本体**。
 *
 * 官方条目存在且 inject 可复现时，直接渲染官方 `ComposerAttachments`——
 * 缩略图/文件卡/上传进度/失败重试、拖放 overlay、原图 lightbox、文档级拖放监听
 * 全部是宿主同一份实现。
 *
 * 兜底：条目缺失（旧宿主）、inject 在插件 fiber 里不可复现、组件崩溃 → 回退
 * 0.4.x 的自绘 AttachmentRail（`fallbackOnMissing` 让「已声明但无占用者」也回退）。
 */
import { useCallback, useMemo } from 'react';
import type {
  ConversationFace,
  DraftAttachmentId,
  InputActions,
  InputState,
  SlotEntryLike,
  UseProjection,
} from '../host-types';
import { addFilesToDraft } from '../attachments';
import { t } from '../i18n';
import { useService } from '../services';
import { AttachmentRail, fileSizeText } from './AttachmentRail';
import { InputSingleSlot } from './InputSlotSeat';
import { entryInjectFailed, firstComponentEntry, useSlotEntries } from './slotEntry';
import { useSnapshot } from './useSnapshot';

const ATTACHMENTS_SLOT = 'conversation.input.attachments';
const EMPTY_IDS: readonly DraftAttachmentId[] = [];

/** 官方 `DraftFileUploads` 切面（status/loaded/total/reason）。 */
export interface UploadLike {
  readonly status?: string;
  readonly loaded?: number;
  readonly total?: number;
  readonly reason?: string;
}

/** 官方 `imageLimits` 投影切面（附件 intake 的拖放文案用）。 */
interface ImageLimitsLike {
  readonly maxImagesPerMessage?: number;
  readonly maxImageBytes?: number;
}

/**
 * 官方附件条目当前是否可镜像（供卡片层的粘贴/拖放处理器让位）。
 * 不对 `entryInjectFailed` 做仅依赖 `[entries, sessionId]` 的 useMemo，
 * 确保会话绑定换代（generation 变更）后立刻重算。
 */
export function useOfficialAttachmentsActive(sessionId: string | undefined): boolean {
  const entries = useSlotEntries(ATTACHMENTS_SLOT);
  if (sessionId === undefined) return false;
  const occupant: SlotEntryLike | null = firstComponentEntry(entries);
  return occupant !== null && !entryInjectFailed(occupant, sessionId);
}

export interface AttachmentsSeatProps {
  sessionId: string | undefined;
  state: InputState | undefined;
  actions: InputActions | undefined;
  /** 宿主下发给本插件条目的 standard props 原样面（附件条目的 inject 需要）。 */
  standard: Record<string, unknown> | undefined;
  useProjection: UseProjection | undefined;
  /** 输入面惰性（disabled/blocked）：拖放/添加一并锁死。 */
  disabled?: boolean;
  /** 输入机 busy（adjudicating/submitting/sending）：不允许再入附件。 */
  machineBusy?: boolean;
  onNotify?: (level: 'info' | 'error', text: string) => void;
}

/**
 * 附件座位渲染：官方条目优先，回退自绘轨道。
 */
export function AttachmentsSeat(props: AttachmentsSeatProps): JSX.Element | null {
  const { sessionId, state, actions, standard, useProjection, disabled, machineBusy, onNotify } = props;
  const conversation = useService('conversation') as ConversationFace | undefined;
  const uploads = useSnapshot(conversation?.fileUploads) as Record<string, UploadLike> | undefined;
  // 组件订阅宿主投影（imageLimits）与 observable（fileUploads）必须在顶层、
  // 且只在 useProjection 存在时调用——bar 条目的 standard 面恒定，故调用序稳定。
  const imageLimits = useProjection ? (useProjection('imageLimits') as ImageLimitsLike | undefined) : undefined;

  const attachments = useMemo(() => {
    const ids = state?.attachmentIds ?? EMPTY_IDS;
    if (ids.length === 0 || typeof conversation?.resolveDraftAttachments !== 'function') return [];
    try {
      return conversation.resolveDraftAttachments(ids);
    } catch {
      return [];
    }
  }, [state?.attachmentIds, conversation]);

  const onRemove = useCallback(
    (id: DraftAttachmentId): void => {
      actions?.removeAttachment(id);
      try {
        conversation?.releaseDraftAttachment(id);
      } catch {
        /* 会话已换/宿主已卸载：下一拍投影自会收敛 */
      }
    },
    [actions, conversation],
  );

  const canAcceptDrop = sessionId !== undefined && disabled !== true && machineBusy !== true;

  const ownerProps = useMemo<Record<string, unknown>>(
    () => ({
      attachments,
      canAcceptDrop,
      onAddFiles: (files: readonly File[]) => {
        addFilesToDraft(sessionId, actions, files, onNotify);
      },
      onRemoveAttachment: onRemove,
      uploads: uploads ?? {},
      // 官方 retryFileUpload 是 shell 级回调（conversation.retryFileUpload(sessionId, id)）。
      onRetryFile: (id: DraftAttachmentId) => {
        try {
          if (sessionId !== undefined) conversation?.retryFileUpload?.(sessionId, id);
        } catch {
          /* 上传器缺席：保持失败态，不崩 */
        }
      },
      uploadFailureText: (_reason: string): string => t('attach.failed'),
      ...(typeof imageLimits?.maxImagesPerMessage === 'number' && typeof imageLimits.maxImageBytes === 'number'
        ? {
            dropLimits: {
              count: imageLimits.maxImagesPerMessage,
              size: fileSizeText(imageLimits.maxImageBytes),
            },
          }
        : {}),
    }),
    [attachments, canAcceptDrop, sessionId, actions, onNotify, onRemove, uploads, conversation, imageLimits],
  );

  const fallback = useMemo(
    () => <AttachmentRail state={state} sessionId={sessionId} onRemove={onRemove} />,
    [state, sessionId, onRemove],
  );

  return (
    <InputSingleSlot
      slot={ATTACHMENTS_SLOT}
      sessionId={sessionId}
      standard={standard}
      ownerProps={ownerProps}
      fallback={fallback}
      fallbackOnMissing
    />
  );
}
