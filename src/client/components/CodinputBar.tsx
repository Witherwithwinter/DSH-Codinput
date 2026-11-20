/**
 * 接管条目：conversation.composer.bar（single，priority -1 遮蔽官方条目）。
 * 卸载本条目即官方输入框原样恢复（槽位体系一等机制），草稿不丢。
 * 另从 useChat 订阅官方 legacy 节点数组（sessionStats 投影缺席时按官方
 * deriveStats 派生轮次/decode 计时，见 stats.ts），供数据行使用。
 *
 * 三态单实例（任一时刻恰好一个入口，且不与官方输入框共存）：
 * - `normal`：接管卡片在原输入位；
 * - `float`：卡片经 FloatingShell portal 悬浮——拖顶部空白区移动、拖边角缩放；
 * - `side`：输入由右侧栏 Codinput 标签承载（本条目渲染小球或 null）。
 *
 * side 由 sideinput 总线的承载态派生（标签 body 挂载即承载），优先级
 * 高于持久化的 normal/float，因此不可能出现 side+float 并存或双实例。
 */

import { useEffect } from 'react';
import type { SessionMaybeStandard, SlotRegisterOptions } from '../host-types';
import { usePref, type CodinputPrefs } from '../prefs';
import { useSidebarInputCarried } from '../sideinput';
import { setBarInjected, clearBarInjected } from '../barinject';
import { useContinueState } from '../continuation';
import { CodinputBall } from './ExpandBall';
import { CodinputSurface } from './CodinputSurface';
import { FloatingShell, beginFloatDrag } from './FloatingShell';
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

/** 槽位作用域里的 chat 会话钩子（ui-session chat 源贡献）。 */
type BarProps = BarOwner & BarInjected & SessionMaybeStandard & { useChat?: <S>(sel: (s: unknown) => S) => S };

const selectMode = (p: CodinputPrefs): CodinputPrefs['mode'] => p.mode;

export function CodinputBar(props: BarProps): JSX.Element | null {
  const { variant, blocked, disabled, placeholder, sessionId, useInput, inputActions, useProjection, useChat, useSession } = props;
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
  // conversation.input.left/.right 第三方条目的 standard props 原样面（剔除 owner props）。
  const inputStandard = useStableKit(props as unknown as Record<string, unknown>);
  // 官方 StatsPills 同款数据源：chat store 的 legacy 节点数组。
  const chatNodes = useChat ? useChat((s: unknown) => (s as { legacy?: { nodes?: unknown } })?.legacy?.nodes) : undefined;
  // 会话运行中（官方 useSession s.running）：空草稿时主按钮变停止。
  const running = useSession ? useSession((s: unknown) => (s as { running?: boolean } | undefined)?.running) === true : false;
  const sideCarried = useSidebarInputCarried(sessionId);
  const mode = usePref(selectMode);

  // side 优先：侧栏标签承载本会话输入时，主输入（含悬浮卡片）整体让位；
  // 侧栏若已收起，则由标题栏下方的小球（portal）承担唯一入口。
  if (sideCarried) return <CodinputBall sessionId={sessionId} />;
  const floating = mode === 'float';
  const surface = (
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
      hero={variant === 'hero'}
      chatNodes={chatNodes}
      float={floating}
      continueState={continueState}
      occurrence={occurrence}
      registerFileIntake={props.registerFileIntake}
      onDragZonePointerDown={beginFloatDrag}
    />
  );
  if (floating) return <FloatingShell>{surface}</FloatingShell>;
  return surface;
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
