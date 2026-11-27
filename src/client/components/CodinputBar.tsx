/**
 * 接管条目：conversation.composer.bar（single，priority -1 遮蔽官方条目）。
 * 卸载本条目即官方输入框原样恢复（槽位体系一等机制），草稿不丢。
 * 底部数据行（StatsRow）固定留在原位，按官方语义镜像 conversation.composer.dock。
 *
 * 三态单实例（任一时刻恰好一个入口，且不与官方输入框共存）：
 * - `normal`：接管卡片在原输入位；
 * - `float`：卡片经 FloatingShell portal 悬浮——拖顶部空白区移动、拖边角缩放；
 * - `side`：输入由右侧栏 Codinput 标签承载（本条目渲染小球或 null）。
 *
 * side 由 sideinput 总线的承载态派生（标签 body 挂载即承载），优先级
 * 高于持久化的 normal/float，因此不可能出现 side+float 并存或双实例。
 */

import { useEffect, useLayoutEffect, useRef } from 'react';
import type { SessionMaybeStandard, SlotRegisterOptions } from '../host-types';
import { usePref, type CodinputPrefs } from '../prefs';
import { useSidebarInputCarried } from '../sideinput';
import { setBarInjected, clearBarInjected } from '../barinject';
import { useContinueState } from '../continuation';
import { CodinputBall } from './ExpandBall';
import { CodinputSurface } from './CodinputSurface';
import { FloatingShell, FloatModeFeedback, beginFloatDrag } from './FloatingShell';
import { StatsRowMemo } from './StatsRow';
import { cancelChatFlip, playChatFlip } from '../float-flip';
import { useStableKit } from './slotEntry';

/** ComposerBarOwnerProps 切面（官方 bar owner）。 */
interface BarOwner {
  variant: 'hero' | 'composer';
  /** rc.3：同一文档里可挂载多个 composer（main / embedded），文档级粘贴路由据此选举。 */
  occurrence?: 'main' | 'embedded';
  blocked?: { readonly reason: string };
  disabled?: boolean;
  placeholder?: string;
}

/**
 * rc.3 bar 注入面切面：`retry`（失败轮次重试，配合 conversationContinuation
 * 投影驱动「继续生成」主按钮）与 `registerFileIntake`（文档级粘贴路由）。
 */
interface BarInjected {
  retry?: (failureSeq: number) => void;
  registerFileIntake?: (target: {
    card: HTMLElement;
    occurrence: 'main' | 'embedded';
    accepts: () => boolean;
    add: (files: readonly File[], directories?: ReadonlySet<File>) => void;
  }) => () => void;
}

/** 槽位作用域里的 bar 完整 props。 */
type BarProps = BarOwner & BarInjected & SessionMaybeStandard;

const selectMode = (p: CodinputPrefs): CodinputPrefs['mode'] => p.mode;

export function CodinputBar(props: BarProps): JSX.Element | null {
  const { variant, blocked, disabled, placeholder, sessionId, useInput, inputActions, useProjection, useSession } = props;
  const state = useInput((s) => s);
  const occurrence: 'main' | 'embedded' = props.occurrence ?? 'main';
  // ---- rc.3「继续生成 / 重试」信号（与侧栏形态共用同一读取面） ----
  const continueState = useContinueState({ retry: props.retry, useProjection, useSession });
  // bar 注入面转存给侧栏形态：side 时输入面渲染在另一棵 React 树，拿不到
  // retry / registerFileIntake（官方只注入 bar 条目）。
  useEffect(() => {
    const face = {
      retry: props.retry,
      registerFileIntake: props.registerFileIntake,
      occurrence,
    };
    setBarInjected(sessionId, face);
    return () => clearBarInjected(sessionId, face);
  }, [sessionId, props.retry, props.registerFileIntake, occurrence]);
  // conversation.input.left/.right 与 composer.dock 条目的 standard props 原样面（剔除 owner props）。
  const inputStandard = useStableKit(props as unknown as Record<string, unknown>);
  // 会话运行中（官方 useSession s.running）：空草稿时主按钮变停止。
  const running = useSession ? useSession((s: unknown) => (s as { running?: boolean } | undefined)?.running) === true : false;
  // 官方 InputBar L172：普通会话与可续跑子智能体支持运行中插话（steer）。
  const steeringAvailable = useSession
    ? useSession((s: unknown) => {
        const subagent = (s as { subagent?: { address?: { mode?: unknown } } | null } | undefined)?.subagent ?? null;
        return subagent === null || subagent.address?.mode === 'continuable';
      }) !== false
    : true;
  const sideCarried = useSidebarInputCarried(sessionId);
  const mode = usePref(selectMode);
  const activeMode: 'side' | 'normal' | 'float' = sideCarried ? 'side' : mode === 'float' ? 'float' : 'normal';

  const prevModeRef = useRef<'side' | 'normal' | 'float'>(activeMode);
  const prevSessionRef = useRef<string | undefined>(sessionId);

  // 模式切换（normal ↔ float / side）：布局只改一次，用全场景 GPU 合成层 FLIP
  // 协同平滑衔接聊天区位移、底部渐变底板、归位卡片与回底按钮，零逐帧回流、零闪动。
  useLayoutEffect(() => {
    const prevMode = prevModeRef.current;
    const prevSession = prevSessionRef.current;
    prevModeRef.current = activeMode;
    prevSessionRef.current = sessionId;
    if (prevSession === sessionId && prevMode !== activeMode && (prevMode === 'normal' || activeMode === 'normal')) {
      playChatFlip(prevMode, activeMode);
    } else {
      cancelChatFlip();
    }
  }, [activeMode, sessionId]);

  useEffect(() => () => cancelChatFlip(), []);

  // 底部状态栏（性能与用量 / composer.dock 第三方条目 / 上下文小圈）固定留在对话区底部原位，
  // 不随普通 ↔ 悬浮 ↔ 侧栏模式切换移动或卸载重挂：避免窄浮窗/侧栏挤爆第三方长状态栏，
  // 也避免切换形态时状态栏插件内部状态闪断重置。官方 hero 新会话态无状态栏。
  const floating = mode === 'float';
  const surface = !sideCarried ? (
    <CodinputSurface
      sessionId={sessionId}
      state={state}
      actions={inputActions}
      useProjection={useProjection}
      inputStandard={inputStandard}
      placeholder={placeholder}
      disabled={disabled === true}
      blocked={blocked !== undefined}
      running={running}
      steeringAvailable={steeringAvailable}
      float={floating}
      continueState={continueState}
      occurrence={occurrence}
      registerFileIntake={props.registerFileIntake}
      onDragZonePointerDown={beginFloatDrag}
    />
  ) : null;
  return (
    <div className="dci-bar-root" data-mode={activeMode}>
      {sideCarried ? (
        <CodinputBall sessionId={sessionId} />
      ) : floating ? (
        <FloatingShell>{surface!}</FloatingShell>
      ) : (
        surface
      )}
      {variant !== 'hero' ? (
        <StatsRowMemo
          useProjection={useProjection}
          sessionId={sessionId}
          standard={inputStandard}
        />
      ) : null}
      <FloatModeFeedback />
    </div>
  );
}

/** 注册选项（遮蔽条目必须 priority -1：升序最低者渲染）。 */
export function barRegistration(): { options: SlotRegisterOptions } {
  return {
    options: {
      name: 'conversation.composer.bar',
      priority: -1,
      registrant: 'dsh-codinput',
    },
  };
}
