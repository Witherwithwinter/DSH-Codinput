/**
 * 原图预览（官方 primitives ImageLightbox 逐值复刻）：点击附件图片缩略图
 * 打开；Esc、背板按下或右上角关闭钮关闭；挂载聚焦关闭钮、Tab 圈住焦点、
 * 卸载还原 opener 焦点。经 body portal 渲染——opener 处于 transform/filter
 * 祖先内时固定背板会被困在该祖先盒里，盖不满视口（官方同理由）。
 */

import { useEffect, useRef, type JSX } from 'react';
import { createPortal } from 'react-dom';

export interface ImageLightboxLabels {
  /** 预览对话框的可访问名。 */
  dialog: string;
  /** 关闭控件的可访问名。 */
  close: string;
}

/** 官方 IconCloseOutlineRegular（1px 描边 ×，16 视框，MIT，见 LICENSE 归属段）。 */
function CloseOutlineGlyph({ size = 16 }: { size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true" strokeWidth={1}>
      <path d="M2.5 2.5L13.5 13.5" stroke="currentColor" />
      <path d="M13.5 2.5L2.5 13.5" stroke="currentColor" />
    </svg>
  );
}

export function ImageLightbox(props: { src: string; alt: string; labels: ImageLightboxLabels; onClose(): void }): JSX.Element {
  const { src, alt, labels, onClose } = props;
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
      if (event.key === 'Tab') {
        event.preventDefault();
        closeRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      restoreRef.current?.focus();
    };
  }, [onClose]);
  return createPortal(
    <div className="dci-lightbox" role="dialog" aria-modal="true" aria-label={labels.dialog}>
      <div className="dci-lightbox-mask" aria-hidden="true" onMouseDown={onClose} />
      <img className="dci-lightbox-image" src={src} alt={alt} />
      <button ref={closeRef} type="button" className="dci-lightbox-close" aria-label={labels.close} onClick={onClose}>
        <CloseOutlineGlyph />
      </button>
    </div>,
    document.body,
  );
}
