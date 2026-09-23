/**
 * 数据行数据源（卡片下方）：会话统计投影探测 + 归一化。
 * 官方投影键（实测确认）：tokenUsage（cacheRead/cacheWrite/output/
 * uncachedInput）、contextPressure（contextWindow/pressureTokens/
 * projectedTokens）；轮/步按别名键探测。tok/s 为输出令牌的实时采样速率。
 * 注意：useProjection 是真实 hook，键探测必须是固定次数的顶层调用。
 */

import type { UseProjection } from './host-types';

const PROJECTION_KEYS = [
  'tokenUsage',
  'contextPressure',
  'sessionUsage',
  'usage',
  'sessionStats',
] as const;

export interface SessionStats {
  turns?: number;
  steps?: number;
  /** 实时输出速率（tok/s），运行期间采样更新，空闲时保留最后一次。 */
  tokensPerSecond?: number;
  totalTokens?: number;
  cacheHitPct?: number;
  /** 上下文占用百分比（pressureTokens / contextWindow）。 */
  contextPct?: number;
  /** 会话统计面板：模型用时（流式活跃累计毫秒）与首 token 延迟。 */
  modelMs?: number;
  ttftMs?: number;
  /** Token 用量面板：原始分段。 */
  uncachedInputTokens?: number;
  cacheReadTokens?: number;
  outputTokens?: number;
}

interface TokenUsage {
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  outputTokens?: number;
  uncachedInputTokens?: number;
}

interface ContextPressure {
  contextWindow?: number;
  pressureTokens?: number;
  projectedTokens?: number;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readTokenUsage(raw: unknown): TokenUsage | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const usage: TokenUsage = {
    cacheReadTokens: num(r['cacheReadTokens']),
    cacheWriteTokens: num(r['cacheWriteTokens']),
    outputTokens: num(r['outputTokens']),
    uncachedInputTokens: num(r['uncachedInputTokens']),
  };
  return Object.values(usage).some((v) => v !== undefined) ? usage : undefined;
}

function readContextPressure(raw: unknown): ContextPressure | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const cp: ContextPressure = {
    contextWindow: num(r['contextWindow']),
    pressureTokens: num(r['pressureTokens']),
    projectedTokens: num(r['projectedTokens']),
  };
  return cp.contextWindow !== undefined && cp.pressureTokens !== undefined ? cp : undefined;
}

function readTurnsSteps(raw: unknown): { turns?: number; steps?: number } {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const turns = num(r['turns']) ?? num(r['turnCount']);
  const steps = num(r['steps']) ?? num(r['stepCount']);
  return { turns, steps };
}

/** 实时速率与用时采样：模块级（按 sessionId 记录上次输出令牌数与时刻）。 */
const rateSamples = new Map<string, { tokens: number; time: number; rate?: number; modelMs: number }>();

export function sampleTokensPerSecond(
  sessionId: string | undefined,
  outputTokens: number | undefined,
): { rate?: number; modelMs?: number; ttftMs?: number } {
  if (!sessionId || outputTokens === undefined) return {};
  const now = Date.now();
  const last = rateSamples.get(sessionId);
  let rate: number | undefined = last?.rate;
  let modelMs = last?.modelMs ?? 0;
  let ttftMs: number | undefined;
  if (!last) {
    // 首个样本：无从计算速率；当前值即初始输出。
    rateSamples.set(sessionId, { tokens: outputTokens, time: now, modelMs: 0 });
    return {};
  }
  const dt = now - last.time;
  if (outputTokens > last.tokens && dt > 0) {
    rate = ((outputTokens - last.tokens) / dt) * 1000;
    modelMs += dt;
    // 空闲较久后恢复增长：这段等待近似 TTFT。
    if (dt > 600) ttftMs = dt;
  }
  rateSamples.set(sessionId, { tokens: outputTokens, time: now, rate, modelMs });
  return { rate, modelMs, ttftMs };
}

/** 每个键一个固定位置的 hook 调用——跨渲染的调用次数与顺序恒定。 */
export function useSessionStats(
  useProjection: UseProjection | undefined,
  sessionId: string | undefined,
): SessionStats | null {
  const k0 = useProjection ? useProjection(PROJECTION_KEYS[0]) : undefined;
  const k1 = useProjection ? useProjection(PROJECTION_KEYS[1]) : undefined;
  const k2 = useProjection ? useProjection(PROJECTION_KEYS[2]) : undefined;
  const k3 = useProjection ? useProjection(PROJECTION_KEYS[3]) : undefined;
  const k4 = useProjection ? useProjection(PROJECTION_KEYS[4]) : undefined;

  const usage = readTokenUsage(k0);
  const pressure = readContextPressure(k1);
  const { turns, steps } = readTurnsSteps(k2) ?? {};
  const alt = readTurnsSteps(k3) ?? {};
  const alt2 = readTurnsSteps(k4) ?? {};

  const stats: SessionStats = {};
  if (turns !== undefined || steps !== undefined) Object.assign(stats, { turns, steps });
  else if (alt.turns !== undefined || alt.steps !== undefined) Object.assign(stats, alt);
  else if (alt2.turns !== undefined || alt2.steps !== undefined) Object.assign(stats, alt2);
  if (usage) {
    const total =
      (usage.cacheReadTokens ?? 0) +
      (usage.cacheWriteTokens ?? 0) +
      (usage.outputTokens ?? 0) +
      (usage.uncachedInputTokens ?? 0);
    if (total > 0) {
      stats.totalTokens = total;
      stats.uncachedInputTokens = usage.uncachedInputTokens;
      stats.cacheReadTokens = usage.cacheReadTokens;
      stats.outputTokens = usage.outputTokens;
    }
    const inputTotal = (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0) + (usage.uncachedInputTokens ?? 0);
    if (inputTotal > 0) stats.cacheHitPct = ((usage.cacheReadTokens ?? 0) / inputTotal) * 100;
    const sample = sampleTokensPerSecond(sessionId, usage.outputTokens);
    if (sample.rate !== undefined && sample.rate > 0) stats.tokensPerSecond = sample.rate;
    if (sample.modelMs !== undefined && sample.modelMs > 0) stats.modelMs = sample.modelMs;
    if (sample.ttftMs !== undefined && sample.ttftMs > 0) stats.ttftMs = sample.ttftMs;
  }
  const window_ = pressure?.contextWindow;
  const pressured = pressure?.pressureTokens;
  if (window_ !== undefined && window_ > 0 && pressured !== undefined) {
    stats.contextPct = (pressured / window_) * 100;
  }
  return Object.keys(stats).length > 0 ? stats : null;
}

export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 === 0 ? 0 : 1)}M tok`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(tokens % 1_000 === 0 ? 0 : 1)}K tok`;
  return `${tokens} tok`;
}
