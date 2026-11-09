/**
 * 工具行：结构与样式逐条对齐官方 0.2.2 InputBar 底部 `.row`——
 *
 * ```
 * .row (container-type:inline-size; padding:2px 8px 6px; gap:12px)
 *   .tools [hidden=activity]        // 官方 InputBar：hidden 时 display:none
 *     button.add (28×28, selector 底, IconPlus size14)
 *     .modes                        // 0.2.2 新增容器
 *       renderSlot("conversation.input.permission", { locked })
 *       renderSlot("conversation.input.plan", { locked })
 *     renderSlot("conversation.input.left", {})
 *   .trailing (activity 时 .trailingActive: flex:1; margin-left:0)
 *     .standardControls [hidden=activity]
 *       renderSlot("conversation.input.right", {})
 *       renderSlot("conversation.input.model", { locked: modelSeatLocked })
 *     .activity / .activityExpanded → renderSlot("conversation.input.activity",
 *                                                { locked, onActiveChange })
 *     interruptible → 独立停止钮（官方 .primary 34×34 圆钮 + 16px 方块 icon）
 *     primary（官方 .primary 34×34、translateY(-2px)、data-sending 转圈、
 *              stop / sending / send.steer / send.queue / send 标签）
 * ```
 *
 * 官方事实源（0.2.2 包源码，逐行核对）：
 * - InputBar JSX：`dsh-client-ui-conversation/lib/client.js` L22066-22213；
 * - InputBar.module.css：同文件 CSS（.row/.tools/.modes/.trailing/.add/.primary/
 *   .standardControls/.activity/.trailingActive，逐值见 styles.ts）；
 * - 按钮语义：`primaryStops = running && subagent===null && !sending && (empty||blocked)`、
 *   `interruptible = running && (continuable || sending && subagent===null)`、
 *   `primaryLabel`、`resolveSubmitMode(busyEnter, running, "enter", steeringAvailable)`
 *   （同文件 L222-236、L16357-16361；插件侧 busyEnter 读不到宿主偏好，取官方
 *   默认值 "queue"）。
 *
 * permission / plan 是 0.2.2 新槽位：按座位镜像机制（InputSingleSlot）以
 * ownerProps `{ locked }` 镜像——槽位已声明但无占用者 → 按官方留空；宿主
 * 未声明该槽位（旧宿主，`slots.entries` 抛错）→ permission 回退自绘
 * PermissionMenu（保住旧宿主功能），plan 不渲染。
 *
 * 模型座保持既有 issue #4 行为（ModelSlot：第三方遮蔽者让位、出厂占用者由
 * 自绘芯片代表），locked 传官方 `modelSeatLocked = removed || inert || !live`
 * 的插件侧近似（removed 无对应信号按 false；live ≡ sessionId/state/actions 齐备）。
 *
 * 按钮沿用官方 keepFocus 语义（mousedown 不夺走编辑器焦点）；官方 Tooltip
 * 原语不引依赖，保留等价 `title`/`aria-label`。附件行/编辑器区不动，只动本行。
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { DraftAttachmentId, InputActions, InputState, InputTriggerController, UseProjection } from '../host-types';
import { openCommandMenu } from '../triggers';
import { t, useT } from '../i18n';
import { IconPlusOfficial, IconSendOfficial, IconStopOfficial } from '../icons';
import { ModelMenu } from './ModelMenu';
import { ModelSlot } from './ModelSlot';
import { PermissionMenu } from './PermissionMenu';
import { VoiceActivity } from './VoiceActivity';
import { InputLeftSlot } from './InputLeftSlot';
import { InputRightSlot } from './InputRightSlot';
import { InputSingleSlot } from './InputSlotSeat';
import { useSlotDeclaration } from './slotEntry';

/** 0.2.2 新增子槽位（官方 InputBar 声明、在其 `.modes` 内渲染）。 */
const PERMISSION_SLOT = 'conversation.input.permission';
const PLAN_SLOT = 'conversation.input.plan';
/** 语音座位槽位（0.2.x 起 InputBar 声明；旧宿主可能没有该子槽位）。 */
const ACTIVITY_SLOT = 'conversation.input.activity';

export interface ToolbarProps {
  sessionId: string | undefined;
  state: InputState | undefined;
  actions: InputActions | undefined;
  triggers: InputTriggerController | undefined;
  /** caret 偏移（指令按钮以当前 caret 构造 synthetic hit）。 */
  caretRef: { current: number | null };
  useProjection: UseProjection | undefined;
  /**
   * conversation.input.left / .right 条目的 standard props 原样面（宿主下发
   * 给本插件 bar/body 条目的 kit 减去 owner props），供各座位转发渲染用。
   * 它是条目 props 的一部分而非门控：缺席时条目仍按槽位条目渲染，只是
   * 拿不到这组标准面（见 InputSlotSeat）。
   */
  inputStandard?: Record<string, unknown> | undefined;
  /** owner disabled（官方 bar owner `inert`：模型运行器主动禁用整个输入面）。 */
  disabled?: boolean;
  /** 会话级阻塞（官方 bar owner `blocked`：消息输入惰性但模型选择保持可用）。 */
  blocked?: boolean;
  /** 会话运行中（官方 useSession s.running）：双按钮语义与标签用。 */
  running?: boolean;
  onNotify?(level: 'info' | 'error', text: string): void;
  /** 主发送手势（与编辑器发送键同一策略）。 */
  onSend(): void;
  /** 官方 primaryDisabled 的非停止分支（empty || disabled || machineBusy）。 */
  sendDisabled?: boolean;
  /** 官方 primaryStops：主按钮变停止（running && !sending && (empty || blocked)）。 */
  primaryStops?: boolean;
  /** 停止生成（官方 stop：conversation.cancel）。 */
  onStop?(): void;
}

/** 官方 keepFocus：mousedown 阻止默认，避免编辑器失焦。 */
function keepFocus(event: React.MouseEvent): void {
  event.preventDefault();
}

/**
 * 官方 `resolveSubmitMode(busyEnter, running, gesture, steeringAvailable)` 的
 * 插件侧等价（该函数在「running && steeringAvailable」时对 enter 手势原样返回
 * busyEnter 偏好）。宿主偏好藏在官方 bar 条目的 inject 面里，本插件拿不到，
 * 取官方默认值 `DEFAULT_BUSY_ENTER_BEHAVIOR = "queue"`（0.2.2
 * dsh-client-ui-conversation/lib/client.js L16334）。返回联合类型是为了让
 * 「steer/queue」两条标签分支都成为可达代码，后续宿主透传偏好时只改这里。
 */
function resolvePrimarySubmitMode(): 'steer' | 'queue' {
  return 'queue';
}

/**
 * 官方 `useMenuLauncher((source) => source === "command")` 的插件侧等价：
 * 指令候选菜单是否打开（add 按钮 aria-expanded）。launcher 是可选服务面，
 * 缺席时恒 false，不抛错。
 */
function useCommandMenuOpen(triggers: InputTriggerController | undefined): boolean {
  const launcher = triggers?.launcher;
  const subscribe = useCallback(
    (fn: () => void) => {
      if (!launcher || typeof launcher.subscribe !== 'function') return () => {};
      try {
        return launcher.subscribe(fn) ?? (() => {});
      } catch {
        return () => {};
      }
    },
    [launcher],
  );
  const getSnapshot = useCallback((): string | null => {
    if (!launcher || typeof launcher.getSnapshot !== 'function') return null;
    try {
      return launcher.getSnapshot() ?? null;
    } catch {
      return null;
    }
  }, [launcher]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot) === 'command';
}

/**
 * 官方 `observeControlRow(row)`（0.2.2 `lib/types/client/skeleton/control-row-layout.js`
 * 逐行复刻）：行内放不下时给 row 加 `data-model-compact`（CSS 隐藏模型文字、
 * 显示模型图标）；换行可用所以只有连图标都放不下才 compact。同步测量：
 * 每次通知先清属性再量两段 children + columnGap。
 */
function observeControlRow(row: HTMLDivElement | null): (() => void) | undefined {
  if (row === null) return undefined;
  const measure = (): void => {
    row.removeAttribute('data-model-compact');
    const style = getComputedStyle(row);
    const available = row.getBoundingClientRect().width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const widths = Array.from(row.children, (child) => child.getBoundingClientRect().width).filter((width) => width > 0);
    const needed = widths.reduce((sum, width) => sum + width, 0) + Math.max(0, widths.length - 1) * parseFloat(style.columnGap);
    row.toggleAttribute('data-model-compact', needed > available);
  };
  const resize = new ResizeObserver(measure);
  resize.observe(row);
  for (const child of row.children) resize.observe(child);
  const mutation = new MutationObserver(measure);
  mutation.observe(row, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['hidden'],
  });
  const fonts = document.fonts;
  fonts?.addEventListener('loadingdone', measure);
  measure();
  return () => {
    resize.disconnect();
    mutation.disconnect();
    fonts?.removeEventListener('loadingdone', measure);
  };
}

export function Toolbar(props: ToolbarProps): JSX.Element {
  const { sessionId, state, actions, triggers, caretRef, useProjection, disabled, blocked, running, onNotify, inputStandard } = props;
  useT();

  const rowRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => observeControlRow(rowRef.current), []);

  const attachments: readonly DraftAttachmentId[] = state?.attachmentIds ?? [];
  const draft = state?.draft ?? '';
  const phase = state?.phase;
  const sending = phase === 'sending';
  const empty = draft.trim() === '' && attachments.length === 0;
  /**
   * 官方 `locked` = removed || inert || !live || blocked || parentOffline
   * （插件侧 removed/parentOffline 无信号按 false）：消息动作全锁。
   */
  const locked = disabled === true || blocked === true;
  /** 「input 面活」近似官方 live = input/keyboard/inputActions 齐备。 */
  const live = sessionId !== undefined && state !== undefined && actions !== undefined;
  /**
   * 官方 `modelSeatLocked` = removed || inert || !live —— **不含 blocked**
   * （blocked 只惰性化消息输入，模型选择保持可用）。
   */
  const modelSeatLocked = disabled === true || !live;
  /** 官方 plainMessageDraft = !empty && phase === "plain" && 非 `/` 命令行。 */
  const plainMessageDraft = !empty && phase === 'plain' && !draft.trimStart().startsWith('/');
  /** 官方 interruptible（普通会话：subagent 不适用、continuable=false）= running && sending。 */
  const interruptible = running === true && sending;
  /**
   * 官方 resolveSubmitMode(busyEnter, running, "enter", steeringAvailable)：
   * gesture 是 "enter" → 返回 busyEnter 偏好。插件侧读不到宿主偏好（该值在
   * 官方 bar 条目自己的 inject 面里，不归本插件所有），取官方默认
   * DEFAULT_BUSY_ENTER_BEHAVIOR = "queue"（conversation client.js L16334）。
   * 留成函数返回联合类型：宿主未来透传偏好时只改这一处。
   */
  const primarySubmitMode = resolvePrimarySubmitMode();
  const primaryLabel = props.primaryStops
    ? t('tool.stop')
    : sending
      ? t('tool.sending')
      : running === true && !locked && plainMessageDraft
        ? t(primarySubmitMode === 'steer' ? 'tool.sendSteer' : 'tool.sendQueue')
        : t('tool.send');

  // 官方 activity 语义：语音展开时本行左侧工具与模型控件隐藏、capture 行伸展
  // （隐藏用官方 `hidden` 属性 + CSS display:none，而不是重排 DOM）。
  const [voiceActive, setVoiceActive] = useState(false);
  const onVoiceActiveChange = useCallback((active: boolean): void => setVoiceActive(active), []);
  // 官方同款：切换会话收起 activity。
  useEffect(() => {
    setVoiceActive(false);
  }, [sessionId]);

  const commandMenuOpen = useCommandMenuOpen(triggers);
  // 0.2.2 新槽位声明探测：「已声明无占用者」与「旧宿主未声明」必须分开处理。
  const permissionDeclaration = useSlotDeclaration(PERMISSION_SLOT);
  const planDeclaration = useSlotDeclaration(PLAN_SLOT);
  /**
   * activity 座位声明态：官方 0.2.x 的 renderSlot 即使槽位无占用者也会输出
   * `<div data-slot style="display:contents">` 包装，所以官方 `.activity` 永远
   * 不是 `:empty`——实测（隔离 0.2.2 宿主）无 voice 时 `.activity` 仍是 0×0 的
   * flex item，占一个 row gap（官方 trailing=306.6；隐藏则 294.6，少 12px）。
   * 因此「已声明」时座位必须保留（哪怕空）；「未声明」（旧宿主没有这个子槽位）
   * 时官方输入框本就没有该元素，我们也不渲染，避免多出一个 gap。
   */
  const activityDeclared = useSlotDeclaration(ACTIVITY_SLOT) === 'declared';

  const onCommandClick = (): void => {
    if (!triggers) return;
    openCommandMenu(triggers, undefined, caretRef.current ?? 0);
  };

  // 旧宿主（permission 槽位未声明）回退自绘菜单；0.2.2 声明后镜像官方条目。
  const permissionFallback = (
    <PermissionMenu
      sessionId={sessionId}
      actions={actions}
      currentDraft={draft}
      useProjection={useProjection}
      disabled={locked}
      onNotify={onNotify}
    />
  );

  return (
    <div className="dci-row" ref={rowRef}>
      <div className="dci-tools" hidden={voiceActive}>
        <button
          type="button"
          className="dci-add"
          aria-label={t('tool.command')}
          aria-haspopup="listbox"
          aria-expanded={commandMenuOpen}
          title={t('tool.command')}
          disabled={locked || !triggers}
          onMouseDown={keepFocus}
          onClick={onCommandClick}
        >
          <IconPlusOfficial size={14} />
        </button>
        {/* 官方 `.modes`：permission → plan 两枚 0.2.2 新单值座。 */}
        <div className="dci-modes">
          {permissionDeclaration === 'declared' ? (
            <InputSingleSlot
              slot={PERMISSION_SLOT}
              sessionId={sessionId}
              standard={inputStandard}
              ownerProps={{ locked }}
              fallback={permissionFallback}
            />
          ) : (
            permissionFallback
          )}
          {planDeclaration === 'declared' ? (
            <InputSingleSlot
              slot={PLAN_SLOT}
              sessionId={sessionId}
              standard={inputStandard}
              ownerProps={{ locked }}
            />
          ) : null}
        </div>
        {/* 官方左区同构：modes 之后是 renderSlot("conversation.input.left")。 */}
        {state !== undefined && sessionId !== undefined ? (
          <InputLeftSlot sessionId={sessionId} standard={inputStandard} />
        ) : null}
      </div>
      <div className={voiceActive ? 'dci-trailing dci-trailing-active' : 'dci-trailing'}>
        <div className="dci-standard-controls" hidden={voiceActive}>
          {/* 官方同款门槛：input === undefined || sessionId === undefined 时
              整个 input.right 座位不渲染（renderSlot 调用点的三元条件）。 */}
          {state !== undefined && sessionId !== undefined ? (
            <InputRightSlot sessionId={sessionId} standard={inputStandard} />
          ) : null}
          {/* 官方右区顺序：input.right → input.model。模型座单值槽的第三方
              遮蔽者（如 reasoning-slider / dsh-model-accordion / effort-dial）
              由 ModelSlot 镜像并让位；无遮蔽者时回退自绘模型芯片（issue #4）。 */}
          <ModelSlot
            sessionId={sessionId}
            standard={inputStandard}
            locked={modelSeatLocked}
            fallback={<ModelMenu sessionId={sessionId} onNotify={onNotify} />}
          />
        </div>
        {/* 官方 activity 座位：input/session 存在且槽位已声明才渲染（官方
            renderSlot 空槽也输出 display:contents 包装 → 空座位仍占一个 gap）。
            无占用者时 div 为空但保留为 0 宽 flex item，与官方几何一致。 */}
        {state !== undefined && sessionId !== undefined && activityDeclared ? (
          <div className={voiceActive ? 'dci-voice-seat dci-voice-seat-expanded' : 'dci-voice-seat'}>
            <VoiceActivity
              sessionId={sessionId}
              inputActions={actions}
              locked={locked}
              onActiveChange={onVoiceActiveChange}
            />
          </div>
        ) : null}
        {/* 官方 interruptible：运行中且正在 sending 时，主按钮之外单出停止钮。 */}
        {interruptible ? (
          <button
            type="button"
            className="dci-send"
            aria-label={t('tool.stop')}
            title={t('tool.stop')}
            disabled={!props.onStop}
            onMouseDown={keepFocus}
            onClick={props.onStop}
          >
            <IconStopOfficial size={16} />
          </button>
        ) : null}
        <button
          type="button"
          className="dci-send"
          aria-label={primaryLabel}
          title={primaryLabel}
          aria-busy={sending}
          data-sending={sending ? '' : undefined}
          disabled={props.sendDisabled}
          onMouseDown={keepFocus}
          onClick={() => (props.primaryStops ? props.onStop?.() : props.onSend())}
        >
          {props.primaryStops ? (
            <IconStopOfficial size={16} />
          ) : sending ? (
            <svg className="dci-sending-spinner" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="2" />
              <path d="M8 2a6 6 0 0 1 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          ) : (
            <IconSendOfficial size={16} />
          )}
        </button>
      </div>
    </div>
  );
}
