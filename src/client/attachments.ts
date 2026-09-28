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


/**
 * 把接管面绑定为会话的文件拾取器（官方 bindFilePicker 契约：官方 InputBar
 * 挂载时绑自己、卸载解绑；slash「添加 · 文件」行的 available =
 * shell.canPickFiles——不绑则接管期间该行消失）。available 恒 true（接管
 * 面挂载期间才绑着），open 打开原生文件对话框、选定即入草稿。
 * @returns 解绑函数；shell 不可达或宿主无 bindFilePicker 时 undefined。
 */
export function bindSessionFilePicker(sessionId: string): (() => void) | undefined {
  let picker: HTMLInputElement | null = null;
  const shell = stash.conversation?.input.shell(sessionId) as
    | (Record<string, unknown> & { bindFilePicker?: (p: { available(): boolean; open(): void }) => () => void })
    | undefined;
  if (typeof shell?.bindFilePicker !== 'function') return undefined;
  return shell.bindFilePicker({
    available: () => true,
    open: () => {
      picker?.remove();
      const input = document.createElement('input');
      picker = input;
      input.type = 'file';
      input.multiple = true;
      input.style.display = 'none';
      input.addEventListener('change', () => {
        input.remove();
        if (picker === input) picker = null;
        addFilesToDraft(sessionId, stash.conversation?.input.shell(sessionId) ?? undefined, input.files);
      });
      document.body.appendChild(input);
      input.click();
    },
  });
}

/** 拖拽中是否带着文件（dragover 阶段 dataTransfer.files 还是空的，只有 types 可读）。 */
export function dragHasFiles(dataTransfer: DataTransfer | null): boolean {
  return dataTransfer !== null && Array.from(dataTransfer.types).includes('Files');
}
