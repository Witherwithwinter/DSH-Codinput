/**
 * 草稿附件轨：复刻官方 `dsh-client-ui-attachment` 的展示（ComposerAttachments +
 * AttachmentRail + FileCard）。
 *
 * - 图片附件 → 64×64 圆角缩略图（`object-fit:cover`，`previewUrl` 由宿主给出），
 *   悬停（或触摸设备常显）出右上角圆形移除钮；
 * - 其它文件 → 240×64 文件卡：类型 glyph（28px，官方 28×28 viewBox 的文件图形）
 *   + 文件名（14/500）+ 元信息（扩展名 + 体积；上传中显示「上传中…」、失败显示
 *   「上传失败」并整卡可点重试、红色描边）；
 * - 上传中出 2px 进度条（有 loaded/total 时按比例，否则走官方同款往返动画）；
 * - 轨道横向溢出时两端出圆形翻页箭头（滚动条隐藏，滚轮横向平移）。
 *
 * 取值逐条对齐官方 CSS（FileCard.module.css / ComposerAttachments.module.css），
 * 类名换成 dci- 前缀；官方 glyph 路径逐字取自 primitives（MIT，见 LICENSE 归属段）。
 */

import { useEffect, useRef, useState } from 'react';
import type { ConversationFace, DraftAttachmentId, InputState } from '../host-types';
import { stash } from '../services';
import { useSnapshot } from './useSnapshot';
import { t } from '../i18n';

const FILE_BODY =
  'M8.48924 28H19.5108C21.6479 28 22.7165 28 23.5594 27.6509C24.6833 27.1853 25.5762 26.2924 26.0417 25.1685C26.3909 24.3256 26.3909 23.257 26.3909 21.1199V8.79443C26.3909 8.32877 26.3909 8.09593 26.3471 7.87507C26.2887 7.58058 26.173 7.30042 26.0067 7.05048C25.882 6.86303 25.7177 6.69799 25.3893 6.36792L20.0611 1.01354C19.7304 0.681235 19.5651 0.515081 19.3769 0.38885C19.126 0.220541 18.8443 0.103463 18.5481 0.0443412C18.3259 0 18.0915 0 17.6226 0H8.48924C6.35209 0 5.28351 0 4.4406 0.349145C3.31672 0.814671 2.4238 1.70759 1.95828 2.83147C1.60913 3.67438 1.60913 4.74296 1.60913 6.88011V21.1199C1.60913 23.257 1.60913 24.3256 1.95828 25.1685C2.4238 26.2924 3.31672 27.1853 4.4406 27.6509C5.28351 28 6.35209 28 8.48924 28Z';
const FILE_FOLD =
  'M26.3909 7.37445L19.0525 0V3.77445C19.0525 4.89271 19.0525 5.45184 19.2352 5.89289C19.4788 6.48096 19.946 6.94818 20.5341 7.19176C20.9751 7.37445 21.5342 7.37445 22.6525 7.37445H26.3909Z';

/** 官方 FileTypeIcon 的通用文件 glyph（28×28 视图框，fill 自带轮廓）。 */
function FileGlyph({ size = 28 }: { size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <path d={FILE_BODY} fill="currentColor" />
      <path d={FILE_FOLD} fill="var(--dsw-static-neutral-00, #fff)" fillOpacity="0.7" />
    </svg>
  );
}

/** 官方 fileExtension：取 basename 最后一个点之后的部分。 */
function fileExtension(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  const dot = base.lastIndexOf('.');
  return dot < 0 ? '' : base.slice(dot + 1);
}

/** 官方 fileSizeText 逐值复刻。 */
function fileSizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)}KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)}MB`;
  const gb = mb / 1024;
  return `${gb < 10 ? gb.toFixed(1) : Math.round(gb)}GB`;
}

/** 上传状态（宿主 fileUploads 投影；缺席按 ready 处理）。 */
interface UploadLike {
  status?: string;
  loaded?: number;
  total?: number;
}

export interface AttachmentRailProps {
  state: InputState | undefined;
  sessionId: string | undefined;
  onRemove(id: DraftAttachmentId): void;
}

export function AttachmentRail(props: AttachmentRailProps): JSX.Element | null {
  const { state, sessionId, onRemove } = props;
  const conversation = stash.conversation as ConversationFace | undefined;
  const uploads = useSnapshot(conversation?.fileUploads) as Record<string, UploadLike> | undefined;
  const railRef = useRef<HTMLDivElement | null>(null);
  const [overflow, setOverflow] = useState<{ left: boolean; right: boolean }>({ left: false, right: false });

  const attachments =
    state === undefined || typeof conversation?.resolveDraftAttachments !== 'function'
      ? []
      : conversation.resolveDraftAttachments(state.attachmentIds) ?? [];

  // 溢出翻页箭头：滚动几何 + 尺寸变化（ResizeObserver，面板变宽也算）重算。
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const sync = (): void => {
      const maxScroll = rail.scrollWidth - rail.clientWidth;
      const next = { left: rail.scrollLeft > 1, right: maxScroll > 1 && rail.scrollLeft < maxScroll - 1 };
      setOverflow((prev) => (prev.left === next.left && prev.right === next.right ? prev : next));
    };
    sync();
    rail.addEventListener('scroll', sync, { passive: true });
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(sync) : null;
    observer?.observe(rail);
    // 纵向滚轮横向平移（官方同名行为：独占消费，非 passive）。
    const onWheel = (event: WheelEvent): void => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      event.preventDefault();
      rail.scrollLeft += event.deltaY;
    };
    rail.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      rail.removeEventListener('scroll', sync);
      rail.removeEventListener('wheel', onWheel);
      observer?.disconnect();
    };
  }, [attachments.length]);

  if (attachments.length === 0) return null;

  const page = (dir: -1 | 1): void => {
    railRef.current?.scrollBy({ left: dir * Math.max(120, (railRef.current?.clientWidth ?? 240) * 0.8), behavior: 'smooth' });
  };

  return (
    <div className="dci-attach-root">
      <div className="dci-attach-rail" ref={railRef} role="group" aria-label={t('attach.group')}>
        {attachments.map((att) => {
          const upload = uploads?.[att.id];
          const status = upload?.status ?? 'ready';
          const isImage = att.kind === 'image' || att.file.type.startsWith('image/');
          const percent =
            status === 'uploading' && upload?.total ? Math.min(100, Math.round(((upload.loaded ?? 0) / upload.total) * 100)) : null;
          if (isImage) {
            return (
              <div className="dci-attach-item" key={att.id}>
                <button type="button" className="dci-attach-thumb" title={att.file.name} aria-label={att.file.name}>
                  {att.previewUrl ? <img src={att.previewUrl} alt={att.file.name} /> : <FileGlyph size={28} />}
                </button>
                <button
                  type="button"
                  className="dci-attach-remove"
                  aria-label={t('attach.remove', { name: att.file.name })}
                  onClick={() => onRemove(att.id)}
                >
                  <RemoveGlyph />
                </button>
                {percent !== null ? (
                  <span className="dci-attach-progress">
                    <span className="dci-attach-progressBar" style={{ width: `${percent}%` }} />
                  </span>
                ) : null}
              </div>
            );
          }
          const failed = status === 'error';
          const meta =
            status === 'uploading'
              ? t('attach.uploading')
              : failed
                ? t('attach.failed')
                : [fileExtension(att.file.name).toUpperCase().slice(0, 8), fileSizeText(att.file.size)]
                    .filter((part) => part !== '')
                    .join(' ');
          const body = (
            <>
              <span className="dci-attach-name">{att.file.name}</span>
              <span className={failed ? 'dci-attach-meta dci-attach-metaFailed' : 'dci-attach-meta'}>{meta}</span>
            </>
          );
          return (
            <div className={failed ? 'dci-attach-card dci-attach-cardFailed' : 'dci-attach-card'} key={att.id} title={att.file.name}>
              <span className="dci-attach-icon" aria-hidden="true">
                {status === 'uploading' ? <span className="dci-attach-spinner" /> : <FileGlyph size={28} />}
              </span>
              {failed ? (
                <button
                  type="button"
                  className="dci-attach-body dci-attach-retry"
                  aria-label={t('attach.retry')}
                  onClick={() => retryUpload(sessionId, att.id)}
                >
                  {body}
                </button>
              ) : (
                <span className="dci-attach-body" aria-label={t('attach.pending', { name: att.file.name })}>
                  {body}
                </span>
              )}
              <button
                type="button"
                className={failed ? 'dci-attach-removeInline dci-attach-cardFailedRemove' : 'dci-attach-removeInline'}
                aria-label={t('attach.remove', { name: att.file.name })}
                onClick={() => onRemove(att.id)}
              >
                <RemoveGlyph />
              </button>
              {percent !== null ? (
                <span className="dci-attach-progress">
                  <span className="dci-attach-progressBar" style={{ width: `${percent}%` }} />
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
      {overflow.left ? (
        <button type="button" className="dci-attach-arrow dci-attach-arrowLeft" aria-label={t('attach.scrollLeft')} onClick={() => page(-1)}>
          <ArrowGlyph dir="left" />
        </button>
      ) : null}
      {overflow.right ? (
        <button type="button" className="dci-attach-arrow dci-attach-arrowRight" aria-label={t('attach.scrollRight')} onClick={() => page(1)}>
          <ArrowGlyph dir="right" />
        </button>
      ) : null}
    </div>
  );
}

function retryUpload(sessionId: string | undefined, id: DraftAttachmentId): void {
  const conversation = stash.conversation as ConversationFace | undefined;
  if (!sessionId || typeof conversation?.retryFileUpload !== 'function') return;
  try {
    conversation.retryFileUpload(sessionId, id);
  } catch {
    /* 通道缺席：静默（附件仍在草稿里） */
  }
}

/** 移除钮的 ×（官方为 fill 路径，16 视框内 18px 圆钮）。 */
function RemoveGlyph(): JSX.Element {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
      <path
        d="M1.6 1.6L8.4 8.4M8.4 1.6L1.6 8.4"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** 翻页箭头（细 chevron，随方向旋转）。 */
function ArrowGlyph({ dir }: { dir: 'left' | 'right' }): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" style={dir === 'left' ? { transform: 'scaleX(-1)' } : undefined}>
      <path d="M5.5 3.5L9 7L5.5 10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
