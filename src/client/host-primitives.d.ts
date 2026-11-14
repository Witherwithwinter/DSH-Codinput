/**
 * 官方平台模块 `@deepseek-ai/dsh-client-ui-primitives` 的最小结构类型面。
 *
 * 该包是宿主 PLATFORM_MODULES 共享模块表里的 baseline 模块（0.2.2-rc.3 取证：
 * 表键 react / react-dom / @deepseek-ai/cordis / zod / @tanstack/react-virtual /
 * @deepseek-ai/dsh-client-store / dsh-client-ui-slots / dsh-client-ui-primitives /
 * dsh-client-ui-dockkit）——客户端 bundle 直接 `require` 它即可在运行时解析，
 * 无需写进 `dsh.client.external`，也不随本包内置（构建 external）。
 *
 * 只声明本插件实际用到的面（必要时按官方 0.2.2-rc.3 源码补），避免把整包
 * 类型引成宿主依赖：本包「运行时零宿主依赖」的约定不变，这里只有类型。
 */
declare module '@deepseek-ai/dsh-client-ui-primitives' {
  import type { ReactElement } from 'react';

  /** 气泡相对锚点的方位（官方 tooltip-placement.ts 逐值）。 */
  export type TooltipSide = 'right' | 'left' | 'bottom' | 'top';

  export interface TooltipProps {
    /** 气泡文案，或仅在显示时求值的取值函数。 */
    label: string | (() => string);
    /** 快捷键标签（平台格式化 keycap，跟在文案后）。 */
    shortcutKeys?: readonly string[] | undefined;
    /** 首选方位，默认 'right'；放不下时依次尝试对侧、垂直侧。 */
    side?: TooltipSide;
    /** 'bottom'/'top' 气泡的水平对齐：'end' 贴锚点右缘，默认居中。 */
    align?: 'center' | 'end';
    /** hover 延迟（毫秒），默认 0。 */
    delayMs?: number;
    /** 键盘聚焦延迟（毫秒），默认 0。 */
    focusDelayMs?: number;
    /** 'bottom'/'top' 气泡与锚点的距离，默认 8（水平方位固定 10）。 */
    gap?: number;
    /** 挂起时完全不显示气泡（锚点渲染不变，避免重挂载切断 CSS 过渡）。 */
    disabled?: boolean;
    /** 气泡 portal 到 document.body（宿主官方工具行按钮用 true）。 */
    portal?: boolean;
    /** 气泡宽度上限（像素）。 */
    maxWidth?: number;
    /** 点击也钉住气泡（便于阅读）。默认 false。 */
    openOnClick?: boolean;
    /** 仅当锚点（或内部元素）横向溢出时才显示。默认 false。 */
    onlyWhenClipped?: boolean;
    /** 唯一子元素（锚点）：Tooltip 克隆它并转发 ref / 事件。 */
    children: ReactElement;
  }

  /** 悬停/聚焦提示（官方原语，样式走 --dsw-* token）。 */
  export function Tooltip(props: TooltipProps): ReactElement;

  /** 官方原图预览灯箱（与 InputBar/附件行同一个组件；labels 由调用方给文案）。 */
  export interface ImageLightboxLabels {
    dialog: string;
    close: string;
  }
  export function ImageLightbox(props: {
    src: string;
    alt: string;
    labels: ImageLightboxLabels;
    onClose: () => void;
    contextMenuProps?: Record<string, unknown>;
  }): ReactElement;

  /** 官方图标（产品图标表；size 与 className 与官方输入框同用法）。 */
  export interface IconProps {
    size?: number;
    className?: string;
  }
  export function IconPlusOutlineMedium(props: IconProps): ReactElement;
  export function IconTriangleRightFillRegular(props: IconProps): ReactElement;
  export function IconChevronDownOutlineRegular(props: IconProps): ReactElement;

  /** 移动端/粗指针判定（官方 focus.ts）。 */
  export function isMobileDevice(): boolean;
}
