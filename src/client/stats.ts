/**
 * 数据行数据源（卡片下方）：逐值复刻官方 StatsPills 的取数与计算——
 * `sessionStats` 投影优先（turns/steps/llm/tool/ttft/decode 全量），缺席时
 * 从 chat legacy 节点按官方 deriveStats 派生；tok/s = decodeTokens ÷
 * decodeMs（会话级持久值，非流式采样），缓存命中/用量分桶同官方公式。
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
  /** 输出速度（tok/s）= decodeTokens ÷ (decodeMs/1000)；decodeMs>0 才有。 */
  tokensPerSecond?: number;
  totalTokens?: number;
  /** 官方 formatCacheHitPercent 文本（"88"/"99.9"/"100"）。 */
  cacheHitText?: string;
  /** 上下文占用百分比（projectedTokens ?? pressureTokens，除以 contextWindow）。 */
  contextPct?: number;
  /** 会话统计面板：模型用时 / 工具调用用时 / TTFT 均值（官方格式化）。 */
  llmMs?: number;
  toolMs?: number;
  ttftMs?: number;
  ttftSteps?: number;
  decodeMs?: number;
  decodeTokens?: number;
  /** Token 用量面板：原始分桶。 */
  uncachedInputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
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

/** 官方 sessionStats 投影/deriveStats 的输出形状。 */
interface ChatStats {
  turns?: number;
  steps?: number;
  llmMs?: number;
  toolMs?: number;
  ttftMs?: number;
  ttftSteps?: number;
  decodeMs?: number;
  decodeTokens?: number;
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

function readSessionStats(raw: unknown): ChatStats | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const stats: ChatStats = {
    turns: num(r['turns']),
    steps: num(r['steps']),
    llmMs: num(r['llmMs']),
    toolMs: num(r['toolMs']),
    ttftMs: num(r['ttftMs']),
    ttftSteps: num(r['ttftSteps']),
    decodeMs: num(r['decodeMs']),
    decodeTokens: num(r['decodeTokens']),
  };
  return Object.values(stats).some((v) => v !== undefined) ? stats : undefined;
}

/**
 * 官方 deriveStats 逐行复刻：assistant 节点计轮/步并带 timing（stepStartTime
 * →firstTokenTime→completedTime）与 usage.outputTokens；tool-result 以
 * callTime 起算工具用时。
 */
export function deriveChatStats(nodes: unknown): ChatStats | undefined {
  if (!Array.isArray(nodes)) return undefined;
  const turns = new Set<unknown>();
  let steps = 0;
  let llmMs = 0;
  let toolMs = 0;
  let ttftMs = 0;
  let ttftSteps = 0;
  let decodeMs = 0;
  let decodeTokens = 0;
  for (const raw of nodes) {
    if (!raw || typeof raw !== 'object') continue;
    const node = raw as Record<string, unknown>;
    if (node['kind'] === 'tool-result') {
      const callTime = num(node['callTime']);
      const time = num(node['time']);
      if (callTime !== undefined && time !== undefined) toolMs += Math.max(0, time - callTime);
      continue;
    }
    if (node['kind'] !== 'assistant') continue;
    turns.add(node['turn']);
    steps += 1;
    const timing = node['timing'] as Record<string, unknown> | undefined;
    const stepStartTime = num(timing?.['stepStartTime']);
    const firstTokenTime = num(timing?.['firstTokenTime']);
    const completedTime = num(timing?.['completedTime']);
    if (stepStartTime !== undefined && completedTime !== undefined) {
      llmMs += Math.max(0, completedTime - stepStartTime);
    }
    if (stepStartTime !== undefined && firstTokenTime !== undefined) {
      ttftMs += Math.max(0, firstTokenTime - stepStartTime);
      ttftSteps += 1;
    }
    if (firstTokenTime !== undefined && completedTime !== undefined) {
      decodeMs += Math.max(0, completedTime - firstTokenTime);
    }
    const usage = node['usage'] as Record<string, unknown> | undefined;
    const out = num(usage?.['outputTokens']);
    if (out !== undefined && out >= 0) decodeTokens += out;
  }
  if (nodes.length === 0) return undefined;
  return { turns: turns.size, steps, llmMs, toolMs, ttftMs, ttftSteps, decodeMs, decodeTokens };
}

/** 官方 formatTokensPerSecond：≥10 取整，<10 保留 1 位小数；NaN/Infinity → null。 */
export function formatTokensPerSecond(tps: number): string | null {
  if (!Number.isFinite(tps)) return null;
  const clamped = Math.max(0, tps);
  return clamped >= 10 ? String(Math.round(clamped)) : String(Math.round(clamped * 10) / 10);
}

/** 官方 roundedPercentUnits：把缓存占比四舍五入到精确百分比单位（正半分进位）。 */
function roundedPercentUnits(cacheReadTokens: number, promptTokens: number, decimalPlaces: number): number {
  const scale = (decimalPlaces === 0 ? 1 : 10) * 100;
  const doubledScale = scale * 2;
  const denominatorQuotient = Math.floor(promptTokens / doubledScale);
  const denominatorRemainder = promptTokens % doubledScale;
  let lower = 0;
  let upper = scale;
  while (lower < upper) {
    const candidate = Math.floor((lower + upper + 1) / 2);
    const factor = candidate * 2 - 1;
    if (
      cacheReadTokens >=
      factor * denominatorQuotient + Math.ceil((factor * denominatorRemainder) / doubledScale)
    ) {
      lower = candidate;
    } else {
      upper = candidate - 1;
    }
  }
  return lower;
}

/** 官方 displayPercentUnits：0 位 → 整数；>0 位 → 整数 + 一位小数（官方只支持 0/1）。 */
function displayPercentUnits(units: number, decimalPlaces: number): string {
  if (decimalPlaces === 0) return String(units);
  const whole = Math.floor(units / 10);
  const tenths = units % 10;
  return tenths === 0 ? String(whole) : `${whole}.${tenths}`;
}

/**
 * 官方 formatCacheHitPercent 完整算法（0.2.2-rc.1）：无计费输入 → null；
 * 全命中 → "100"；整数舍入仍 <100 → 整数文本；否则按官方「区分精度」规则
 * 返回 99.9…（不把部分命中断章取义成 99.99 或 100）。NaN/Infinity → null。
 *
 * @param decimalPlaces 官方只使用 0 / 1 两档；非 0 一律按 1 位处理。
 */
export function formatCacheHitPercent(
  cacheReadTokens: number,
  promptTokens: number,
  decimalPlaces = 0,
): string | null {
  if (!Number.isFinite(cacheReadTokens) || !Number.isFinite(promptTokens)) return null;
  const prompt = Math.trunc(promptTokens);
  if (prompt <= 0) return null;
  // 计数应为整数；脏值截断并夹到 [0, prompt]，保证算法整数语义且不越界。
  const cacheRead = Math.min(Math.max(0, Math.trunc(cacheReadTokens)), prompt);
  const missedInputTokens = prompt - cacheRead;
  if (missedInputTokens === 0) return '100';
  const places = decimalPlaces === 0 ? 0 : 1;
  const roundedUnits = roundedPercentUnits(cacheRead, prompt, places);
  if (roundedUnits < (places === 0 ? 100 : 1e3)) return displayPercentUnits(roundedUnits, places);
  let distinguishingPlaces = 1;
  let scaledDoubleGap = missedInputTokens * 200;
  const denominatorTens = Math.floor(prompt / 10);
  while (scaledDoubleGap <= denominatorTens) {
    scaledDoubleGap *= 10;
    distinguishingPlaces += 1;
  }
  const denominatorOnes = prompt % 10;
  let roundedLoss = 5;
  for (let loss = 1; loss < 5; loss += 1) {
    const factor = loss * 2 + 1;
    const threshold = factor * denominatorTens + Math.floor((factor * denominatorOnes) / 10);
    if (scaledDoubleGap <= threshold) {
      roundedLoss = loss;
      break;
    }
  }
  return `99.${'9'.repeat(distinguishingPlaces - 1)}${10 - roundedLoss}`;
}

/** 官方 formatDuration：<60s 一位小数秒，否则 分+秒；NaN/Infinity → null。 */
export function formatDuration(ms: number): string | null {
  if (!Number.isFinite(ms)) return null;
  const s = Math.max(0, ms) / 1000;
  if (s < 60) return `${Math.round(s * 10) / 10}s`;
  const whole = Math.round(s);
  return `${Math.floor(whole / 60)}分${whole % 60}秒`;
}

/** 每个键一个固定位置的 hook 调用——跨渲染的调用次数与顺序恒定。 */
export function useSessionStats(
  useProjection: UseProjection | undefined,
  sessionId: string | undefined,
  chatNodes: unknown,
): SessionStats | null {
  const k0 = useProjection ? useProjection(PROJECTION_KEYS[0]) : undefined;
  const k1 = useProjection ? useProjection(PROJECTION_KEYS[1]) : undefined;
  const k2 = useProjection ? useProjection(PROJECTION_KEYS[2]) : undefined;
  const k3 = useProjection ? useProjection(PROJECTION_KEYS[3]) : undefined;
  const k4 = useProjection ? useProjection(PROJECTION_KEYS[4]) : undefined;

  const usage = readTokenUsage(k0);
  const pressure = readContextPressure(k1);
  // 官方：sessionStats 投影优先，缺席从 chat legacy 节点派生。
  const chat = readSessionStats(k4) ?? deriveChatStats(chatNodes) ?? readTurnsSteps(k2, k3);

  const stats: SessionStats = {};
  if (chat) {
    if (chat.turns !== undefined || chat.steps !== undefined) {
      stats.turns = chat.turns;
      stats.steps = chat.steps;
    }
    if (chat.llmMs !== undefined) stats.llmMs = chat.llmMs;
    if (chat.toolMs !== undefined) stats.toolMs = chat.toolMs;
    if (chat.ttftMs !== undefined) stats.ttftMs = chat.ttftMs;
    if (chat.ttftSteps !== undefined) stats.ttftSteps = chat.ttftSteps;
    if (chat.decodeMs !== undefined) stats.decodeMs = chat.decodeMs;
    if (chat.decodeTokens !== undefined) stats.decodeTokens = chat.decodeTokens;
    if ((chat.decodeMs ?? 0) > 0) {
      stats.tokensPerSecond = (chat.decodeTokens ?? 0) / (chat.decodeMs! / 1000);
    }
  }
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
      stats.cacheWriteTokens = usage.cacheWriteTokens;
      stats.outputTokens = usage.outputTokens;
    }
    // 官方：分母 = 三段输入桶（缓存读+写+未缓存输入）。
    const inputTotal = (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0) + (usage.uncachedInputTokens ?? 0);
    if (inputTotal > 0) {
      const text = formatCacheHitPercent(usage.cacheReadTokens ?? 0, inputTotal);
      if (text !== null) stats.cacheHitText = text;
    }
  }
  const window_ = pressure?.contextWindow;
  // 官方 contextOccupancy：优先 projectedTokens。
  const used = pressure?.projectedTokens ?? pressure?.pressureTokens;
  if (window_ !== undefined && window_ > 0 && used !== undefined) {
    stats.contextPct = (used / window_) * 100;
  }
  void sessionId;
  return Object.keys(stats).length > 0 ? stats : null;
}

function readTurnsSteps(k2: unknown, k3: unknown): ChatStats | undefined {
  const pick = (raw: unknown): ChatStats | undefined => {
    if (!raw || typeof raw !== 'object') return undefined;
    const r = raw as Record<string, unknown>;
    const turns = num(r['turns']) ?? num(r['turnCount']);
    const steps = num(r['steps']) ?? num(r['stepCount']);
    return turns !== undefined || steps !== undefined ? { turns, steps } : undefined;
  };
  return pick(k2) ?? pick(k3);
}

/**
 * 官方紧凑 token 文本（517 / 12.2K / 1.2M，本地文案后缀 " tok"）：
 * <1e3 原值；<1e6 用 K（≥100 取整、<100 一位小数）；≥1e6 用 M。
 * K 位舍入到 1000 时进位到 M，永远不出现 "1000K"（如 999_950 → "1M"）。
 * NaN/Infinity 不渲染（返回 null）。
 */
export function formatTokens(tokens: number): string | null {
  if (!Number.isFinite(tokens)) return null;
  const value = Math.max(0, tokens);
  const scaled = (candidate: number): string =>
    candidate >= 100 ? String(Math.round(candidate)) : String(Math.round(candidate * 10) / 10);
  if (value < 1e3) return `${String(value)} tok`;
  if (value < 1e6) {
    const thousands = value / 1e3;
    const roundedK = thousands >= 100 ? Math.round(thousands) : Math.round(thousands * 10) / 10;
    if (roundedK < 1e3) return `${String(roundedK)}K tok`;
    return `${scaled(value / 1e6)}M tok`;
  }
  return `${scaled(value / 1e6)}M tok`;
}
