/**
 * rc.3「继续生成 / 重试」信号的共享读取面。
 *
 * 官方 InputBar 用 `useProjection('conversationContinuation')` + useSession 的
 * openState / pendingSubmissions / removed / subagent，配合 bar 注入的
 * `retry(failureSeq)` 决定主按钮是否变成官方 Continue 三角。
 *
 * 本插件有两个入口渲染同一台输入机：`conversation.composer.bar` 遮蔽条目
 * （normal / float 形态）与右侧栏 Codinput 标签（side 形态）。两处必须读到
 * 同一组信号，否则侧栏形态永远没有「继续生成」（0.5.0 的 rc.3 补齐只落在
 * bar 条目上，side 形态漏了）。
 */

import type { ContinueState, UseProjection } from './host-types';

/** bar 注入面 / 转存面里的 retry。 */
export type ContinueRetry = ((failureSeq: number) => void) | undefined;

export interface ContinueSignals {
  /** 官方 bar 注入的 retry(failureSeq)；side 形态经 barinject 中转。 */
  readonly retry: ContinueRetry;
  /** standard kit 的 useProjection（bar 条目 / 侧栏 body 都有）。 */
  readonly useProjection: UseProjection | undefined;
  /** standard kit 的 useSession（两处都有；旧宿主可能缺席）。 */
  readonly useSession: (<S>(sel: (s: any) => S) => S | undefined) | undefined;
}

/** 安全读投影（rc.3 的 useProjection 支持选择器；旧宿主可能不认识该 key）。 */
function readProjection<T>(
  useProjection: UseProjection | undefined,
  key: string,
  selector?: (value: any) => T,
): T | undefined {
  try {
    return selector === undefined
      ? (useProjection?.(key) as T | undefined)
      : useProjection?.(key, selector);
  } catch {
    return undefined;
  }
}

/** 读取 rc.3 Continue/Retry 全量信号（官方 InputBar 同构；调用序稳定）。 */
export function useContinueState(signals: ContinueSignals): ContinueState {
  const { retry, useProjection, useSession } = signals;
  const retryableFailure = readProjection(useProjection, 'conversationContinuation') as number | undefined;
  const pendingHumanInput = readProjection(useProjection, 'inbox', (inbox: any) => (
    inbox?.['next-step']?.some((message: any) => message?.source?.kind === 'user') ?? false
  )) === true;
  const sessionSubagent = useSession ? useSession((s: any) => s?.subagent ?? null) : null;
  const sessionHistoryOpen = useSession ? useSession((s: any) => s?.openState === 'open') === true : false;
  const sessionSubmissionPending = useSession
    ? useSession((s: any) => (s?.pendingSubmissions?.length ?? 0) > 0) === true
    : false;
  const sessionRemoved = useSession ? useSession((s: any) => s?.removed === true) === true : false;
  return {
    retry,
    retryableFailure: typeof retryableFailure === 'number' ? retryableFailure : undefined,
    pendingHumanInput,
    historyOpen: sessionHistoryOpen,
    submissionPending: sessionSubmissionPending,
    removed: sessionRemoved,
    subagentActive: sessionSubagent !== null,
  };
}
