/**
 * 附件入草稿的共用链路：工具行的文件选择、卡片内粘贴、拖文件进卡片三条路径
 * 都走这里，语义与失败处理完全一致（官方公开面：createDrafts + addAttachments，
 * 失败时释放草稿附件，不留悬挂）。
 */

import type { ConversationFace, InputActions } from './host-types';
import { stash } from './services';
import { t } from './i18n';

/**
 * 把文件加入草稿附件。
 * @returns 是否成功入草稿（false = 没有会话/通道、空文件、或宿主拒绝）。
 */
export function addFilesToDraft(
  sessionId: string | undefined,
  actions: InputActions | undefined,
  files: FileList | readonly File[] | null | undefined,
  onNotify?: (level: 'info' | 'error', text: string) => void,
): boolean {
  const list = files ? Array.from(files) : [];
  if (!sessionId || !actions || list.length === 0) return false;
  const conversation = stash.conversation as ConversationFace | undefined;
  if (!conversation) {
    onNotify?.('error', t('attach.channelUnavailable'));
    return false;
  }
  try {
    const drafts = conversation.createDrafts(sessionId, list);
    if (drafts.length === 0) return false;
    const added = actions.addAttachments(drafts.map((d) => d.id));
    if (!added) conversation.releaseDraftAttachments(drafts);
    return added;
  } catch (error) {
    onNotify?.('error', error instanceof Error ? error.message : String(error));
    return false;
  }
}

/** 拖拽中是否带着文件（dragover 阶段 dataTransfer.files 还是空的，只有 types 可读）。 */
export function dragHasFiles(dataTransfer: DataTransfer | null): boolean {
  return dataTransfer !== null && Array.from(dataTransfer.types).includes('Files');
}
