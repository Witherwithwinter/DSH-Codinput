/** 内联图标：lucide Outline 线性风格，对齐官方输入框视觉（stroke=currentColor）。 */

import type { JSX } from 'react';

interface IconProps {
  size?: number;
  className?: string;
}

function svg(paths: JSX.Element, size: number | undefined, className: string | undefined): JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size ?? 16}
      height={size ?? 16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {paths}
    </svg>
  );
}

/** 品牌：lucide file-code-corner。 */
export function IconBrand({ size, className }: IconProps): JSX.Element {
  return svg(
    <>
      <path d="M4 12.15V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2h-3.35" />
      <path d="M14 2v5a1 1 0 0 0 1 1h5" />
      <path d="m5 16-3 3 3 3" />
      <path d="m9 22 3-3-3-3" />
    </>,
    size,
    className,
  );
}

export function IconEdit({ size, className }: IconProps): JSX.Element {
  return svg(
    <>
      <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
      <path d="m15 5 4 4" />
    </>,
    size,
    className,
  );
}

export function IconEye({ size, className }: IconProps): JSX.Element {
  return svg(
    <>
      <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
      <circle cx="12" cy="12" r="3" />
    </>,
    size,
    className,
  );
}

export function IconTerminalSquare({ size, className }: IconProps): JSX.Element {
  return svg(
    <>
      <path d="m7 11 2-2-2-2" />
      <path d="M11 13h4" />
      <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
    </>,
    size,
    className,
  );
}

export function IconPaperclip({ size, className }: IconProps): JSX.Element {
  return svg(
    <path d="m16 6-8.414 8.586a2 2 0 0 0 2.829 2.829l8.414-8.586a4 4 0 1 0-5.657-5.657l-8.379 8.551a6 6 0 1 0 8.485 8.485l8.379-8.551" />,
    size,
    className,
  );
}

export function IconShield({ size, className }: IconProps): JSX.Element {
  return svg(
    <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />,
    size,
    className,
  );
}

export function IconChevronDown({ size, className }: IconProps): JSX.Element {
  return svg(<path d="m6 9 6 6 6-6" />, size, className);
}

export function IconArrowUp({ size, className }: IconProps): JSX.Element {
  return svg(
    <path d="m5 12 7-7 7 7" />,
    size,
    className,
  );
  // 竖线由外层圆形按钮构图补足：这里仅箭头，竖线单独画在按钮内。
}

export function IconArrowUpFull({ size, className }: IconProps): JSX.Element {
  return svg(
    <>
      <path d="m5 12 7-7 7 7" />
      <path d="M12 19V5" />
    </>,
    size,
    className,
  );
}

export function IconStop({ size, className }: IconProps): JSX.Element {
  return svg(<rect x="7" y="7" width="10" height="10" rx="1.5" />, size, className);
}

export function IconX({ size, className }: IconProps): JSX.Element {
  return svg(<path d="M18 6 6 18M6 6l12 12" />, size, className);
}

export function IconFile({ size, className }: IconProps): JSX.Element {
  return svg(
    <>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    </>,
    size,
    className,
  );
}

export function IconFolder({ size, className }: IconProps): JSX.Element {
  return svg(
    <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />,
    size,
    className,
  );
}

export function IconSearch({ size, className }: IconProps): JSX.Element {
  return svg(
    <>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </>,
    size,
    className,
  );
}

// ---------- 官方图标（路径逐字取自宿主 primitives / ui-conversation，保证与官方输入框一致） ----------

/** 官方 IconPlusOutline16（指令按钮，fill）。 */
export function IconPlusOfficial({ size }: { size?: number }): JSX.Element {
  return (
    <svg width={size ?? 14} height={size ?? 14} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8.64453 1.5V7.34961H14.5V8.65039H8.64453V14.5H7.34473V8.65039H1.5V7.34961H7.34473V1.5H8.64453Z"
        fill="currentColor"
      />
    </svg>
  );
}

/** 官方 IconPaperclipOutline16（附件按钮；官方为 fill 路径自带描边轮廓，不得再叠 stroke）。 */
export function IconPaperclipOfficial({ size }: { size?: number }): JSX.Element {
  return (
    <svg width={size ?? 14} height={size ?? 14} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M5.5498 9.75V5H6.9502V9.75C6.9502 10.3299 7.4201 10.7998 8 10.7998C8.5799 10.7998 9.0498 10.3299 9.0498 9.75V4.5C9.0498 2.9536 7.7964 1.7002 6.25 1.7002C4.7036 1.7002 3.4502 2.9536 3.4502 4.5V9.75C3.4502 12.2629 5.4871 14.2998 8 14.2998C10.5129 14.2998 12.5498 12.2629 12.5498 9.75V4H13.9502V9.75C13.9502 13.0361 11.2861 15.7002 8 15.7002C4.71391 15.7002 2.0498 13.0361 2.0498 9.75V4.5C2.04981 2.1804 3.9304 0.299806 6.25 0.299805C8.5696 0.299805 10.4502 2.1804 10.4502 4.5V9.75C10.4502 11.1031 9.3531 12.2002 8 12.2002C6.6469 12.2002 5.5498 11.1031 5.5498 9.75Z"
        fill="currentColor"
      />
    </svg>
  );
}

const OFFICIAL_SHIELD =
  'M8.20554 0.899994L14.7901 3.36857V7.01026C14.7901 12 11.0466 14.2103 8.20554 15.3C5.36446 14.2103 1.62012 12 1.62012 7.01026V3.36857L8.20554 0.899994Z';
const OFFICIAL_SHIELD_CHECK =
  'M12.1654 5.7552L8.9447 9.41475C8.73044 9.65816 8.53628 9.8804 8.35774 10.0423C8.1713 10.2114 7.94235 10.3717 7.64016 10.4254C7.48207 10.4535 7.32 10.4552 7.16151 10.4294C6.85843 10.3801 6.62728 10.2223 6.43836 10.0559C6.25752 9.89653 6.06037 9.67732 5.84264 9.43705L4.72925 8.20897L5.63557 7.38707L6.74897 8.61594C6.98603 8.87755 7.12974 9.03533 7.24673 9.13839C7.31033 9.19443 7.34485 9.21476 7.35823 9.22122C7.38068 9.22484 7.40352 9.22515 7.42593 9.22122C7.40522 9.22502 7.42893 9.23294 7.53583 9.136C7.65132 9.03126 7.79316 8.87139 8.02643 8.60638L11.2479 4.94763L12.1654 5.7552Z';

/** 官方权限 glyph：read-only（盾+勾）。 */
export function IconShieldCheckOfficial({ size }: { size?: number }): JSX.Element {
  return (
    <svg width={size ?? 16} height={size ?? 16} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d={OFFICIAL_SHIELD} stroke="currentColor" strokeWidth="1.31831" strokeLinejoin="round" />
      <path d={OFFICIAL_SHIELD_CHECK} fill="currentColor" />
    </svg>
  );
}

/** 官方权限 glyph：workspace-write（盾+横线+铅笔，全 fill）。 */
export function IconShieldWriteOfficial({ size }: { size?: number }): JSX.Element {
  return (
    <svg width={size ?? 16} height={size ?? 16} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8.08887 0.251709C8.20479 0.23085 8.32486 0.241168 8.43652 0.282959L15.0215 2.75171C15.2787 2.84819 15.4492 3.09414 15.4492 3.3689V7.0105C15.4492 7.10986 15.4441 7.2081 15.4414 7.30542C15.0285 7.07175 14.5905 6.87695 14.1309 6.73022V3.82495L8.20508 1.60327L2.2793 3.82495V7.0105C2.27936 9.7171 3.4745 11.5379 5.02734 12.7947C5.01025 12.9942 5 13.1962 5 13.4001C5.00001 13.7617 5.02722 14.1169 5.08008 14.4636C2.91555 13.0393 0.961014 10.752 0.960938 7.0105V3.3689C0.960938 3.09417 1.13146 2.84821 1.38867 2.75171L7.97461 0.282959L8.08887 0.251709Z"
        fill="currentColor"
      />
      <path d="M11.3525 5.64688V6.85688H5V5.64688H11.3525Z" fill="currentColor" />
      <path d="M9.5824 8.29376V9.50376H5V8.29376H9.5824Z" fill="currentColor" />
      <path d="M14.6647 15.6852H10.0338C10.3878 15.3751 10.7567 15.0517 11.0772 14.7706C11.2531 14.6164 11.4144 14.4746 11.5511 14.3547H14.6647V15.6852Z" fill="currentColor" />
      <path d="M8.14852 14.1308L7.33925 15.4976C7.22458 15.6912 7.42245 15.9194 7.63037 15.8333L9.09785 15.2254L15.0399 10.0719L14.0905 8.97733L8.14852 14.1308Z" fill="currentColor" />
    </svg>
  );
}

/** 官方权限 glyph：danger-full-access（盾+两道竖杠）。 */
export function IconShieldBarsOfficial({ size }: { size?: number }): JSX.Element {
  return (
    <svg width={size ?? 16} height={size ?? 16} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d={OFFICIAL_SHIELD} stroke="currentColor" strokeWidth="1.31831" strokeLinejoin="round" />
      <path d="M9.10094 4.5V8.75939H7.59888V4.5H9.10094Z" fill="currentColor" />
      <path d="M9.10094 9.8114V11.5H7.59888V9.8114H9.10094Z" fill="currentColor" />
    </svg>
  );
}

/** 官方 IconWarningOutline16（风险确认弹层的警示 glyph，viewBox 14）。 */
export function IconWarningOfficial({ size }: { size?: number }): JSX.Element {
  return (
    <svg width={size ?? 18} height={size ?? 18} viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M6.3002 3.32843L7.69986 3.32843L7.69986 7.79657H6.3002L6.3002 3.32843Z" fill="currentColor" />
      <path d="M6.3002 9.01935H7.69986V10.6711H6.3002V9.01935Z" fill="currentColor" />
      <path
        d="M12.6328 6.99976C12.6328 3.88874 10.111 1.36694 7 1.36694C3.88899 1.36695 1.3672 3.88875 1.36719 6.99976C1.36719 10.1108 3.88899 12.6326 7 12.6326C10.111 12.6326 12.6328 10.1108 12.6328 6.99976ZM13.8582 6.99976C13.8582 10.7873 10.7876 13.8579 7 13.8579C3.21244 13.8579 0.141846 10.7873 0.141846 6.99976C0.141857 3.2122 3.21245 0.141612 7 0.141602C10.7876 0.141602 13.8581 3.21219 13.8582 6.99976Z"
        fill="currentColor"
      />
    </svg>
  );
}

/** 官方发送箭头（primary 按钮，fill，viewBox 16）。 */
export function IconSendOfficial({ size }: { size?: number }): JSX.Element {
  return (
    <svg width={size ?? 16} height={size ?? 16} viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M8.3125 0.980183C8.66767 1.0531 8.97902 1.20418 9.2627 1.43233C9.48724 1.61297 9.73029 1.85793 9.97949 2.10714L14.707 6.83468L13.293 8.24874L9 3.95577V15.0417H7V3.95577L2.70703 8.24874L1.29297 6.83468L6.02051 2.10714C6.26971 1.85793 6.51277 1.61297 6.7373 1.43233C6.97662 1.23986 7.28445 1.04402 7.6875 0.980183C7.8973 0.947006 8.1031 0.95516 8.3125 0.980183Z"
        fill="currentColor"
      />
    </svg>
  );
}

/** 官方停止方块（primary 按钮的 busy 形态，fill）。 */
export function IconStopOfficial({ size }: { size?: number }): JSX.Element {
  return (
    <svg width={size ?? 16} height={size ?? 16} viewBox="0 0 16 16" aria-hidden="true">
      <rect x="3" y="3" width="10" height="10" rx="3" fill="currentColor" />
    </svg>
  );
}

/** 官方风格下拉 chevron（14，描边，随 open 旋转由外层 CSS 控制）。 */
export function IconChevronOfficial({ size }: { size?: number }): JSX.Element {
  return (
    <svg width={size ?? 14} height={size ?? 14} viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M3.5 5.75L7 9.25L10.5 5.75"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * /codinput 命令图标（宿主命令菜单 glyph：文档+代码括号，fill
 * currentColor，与 primitives Icon*Outline16 同构——接受 size，命令
 * 菜单里按官方语义渲染为 <icon size={16}/>）。
 */
export function IconCodinputCommand16({ size = 16, className }: { size?: number; className?: string }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12.25 2.83422C11.7896 2.75598 11.162 2.75005 10.0298 2.75005C8.11311 2.75005 6.75075 2.75163 5.71785 2.88987C4.70596 3.0253 4.12453 3.27933 3.7019 3.70195C3.27869 4.12516 3.02502 4.70481 2.88976 5.7109C2.75159 6.73856 2.75 8.09323 2.75 10.0001V14.0001C2.75 15.9069 2.75159 17.2615 2.88976 18.2892C3.02502 19.2953 3.27869 19.8749 3.7019 20.2981C4.12511 20.7214 4.70476 20.975 5.71085 21.1103C6.73851 21.2485 8.09318 21.2501 10 21.2501H14C15.9068 21.2501 17.2615 21.2485 18.2892 21.1103C19.2952 20.975 19.8749 20.7214 20.2981 20.2981C20.7213 19.8749 20.975 19.2953 21.1102 18.2892C21.2484 17.2615 21.25 15.9069 21.25 14.0001V13.5629C21.25 12.0269 21.2392 11.2988 21.0762 10.7501H17.9463C16.8135 10.7501 15.8877 10.7501 15.1569 10.6518C14.3929 10.5491 13.7306 10.3268 13.2019 9.79815C12.6732 9.26945 12.4509 8.60712 12.3482 7.84317C12.25 7.1123 12.25 6.18657 12.25 5.05374V2.83422ZM13.75 3.6095V5.00005C13.75 6.19976 13.7516 7.0241 13.8348 7.64329C13.9152 8.24091 14.059 8.53395 14.2626 8.73749C14.4661 8.94103 14.7591 9.08486 15.3568 9.16521C15.976 9.24846 16.8003 9.25005 18 9.25005H20.0195C19.723 8.9625 19.3432 8.61797 18.85 8.17407L14.8912 4.61117C14.4058 4.17433 14.0446 3.85187 13.75 3.6095ZM10.1755 1.25002C11.5601 1.24965 12.4546 1.24942 13.2779 1.56535C14.1012 1.88129 14.7632 2.47735 15.7873 3.39955C15.8226 3.43139 15.8584 3.46361 15.8947 3.49623L19.8534 7.05912C19.8956 7.09705 19.9372 7.1345 19.9783 7.17149C21.162 8.23614 21.9274 8.92458 22.3391 9.84902C22.7508 10.7734 22.7505 11.8029 22.75 13.3949C22.75 13.4502 22.75 13.5062 22.75 13.5629V14.0565C22.75 15.8942 22.75 17.3499 22.5969 18.4891C22.4392 19.6615 22.1071 20.6104 21.3588 21.3588C20.6104 22.1072 19.6614 22.4393 18.489 22.5969C17.3498 22.7501 15.8942 22.7501 14.0564 22.7501H9.94359C8.10583 22.7501 6.65019 22.7501 5.51098 22.5969C4.33856 22.4393 3.38961 22.1072 2.64124 21.3588C1.89288 20.6104 1.56076 19.6615 1.40314 18.4891C1.24997 17.3499 1.24998 15.8942 1.25 14.0565V9.94363C1.24998 8.10587 1.24997 6.65024 1.40314 5.51103C1.56076 4.33861 1.89288 3.38966 2.64124 2.64129C3.39019 1.89235 4.34232 1.56059 5.51887 1.40313C6.66283 1.25002 8.1257 1.25003 9.97352 1.25005L10.0298 1.25005C10.0789 1.25005 10.1275 1.25004 10.1755 1.25002Z"
        fill="currentColor"
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M10.2633 13.2978C10.6512 13.4432 10.8477 13.8756 10.7022 14.2634L9.20225 18.2634C9.05681 18.6512 8.6245 18.8477 8.23666 18.7023C7.84882 18.5569 7.65231 18.1245 7.79775 17.7367L9.29775 13.7367C9.44319 13.3489 9.8755 13.1524 10.2633 13.2978ZM7.53033 13.4697C7.82322 13.7626 7.82322 14.2375 7.53033 14.5304L7.06066 15L7.53033 15.4697C7.82322 15.7626 7.82322 16.2375 7.53033 16.5304C7.23744 16.8233 6.76256 16.8233 6.46967 16.5304L5.46967 15.5304C5.17678 15.2375 5.17678 14.7626 5.46967 14.4697L6.46967 13.4697C6.76256 13.1768 7.23744 13.1768 7.53033 13.4697ZM10.9697 15.4697C11.2626 15.1768 11.7374 15.1768 12.0303 15.4697L13.0303 16.4697C13.3232 16.7626 13.3232 17.2375 13.0303 17.5304L12.0303 18.5304C11.7374 18.8233 11.2626 18.8233 10.9697 18.5304C10.6768 18.2375 10.6768 17.7626 10.9697 17.4697L11.4393 17L10.9697 16.5304C10.6768 16.2375 10.6768 15.7626 10.9697 15.4697Z"
        fill="currentColor"
      />
    </svg>
  );
}
