/** 数据行（卡片下方）：官方 composer dock 复刻——两枚胶囊（仪表盘「轮/步 · tok/s」、
 * 数据库「累计 tok · 缓存命中」）+ 上下文小圈（0.1.7-rc.2 起官方把它挪进本行，圈+百分比
 * 药丸），点击弹出官方同构详情面板（会话统计 / Token 用量 / 上下文分段），锚点上方弹出、
 * 点外关闭。 */

import { useEffect, useRef, useState } from 'react';
import { useSessionStats, formatTokens, formatTokensPerSecond, formatCacheHitPercent, formatDuration, type SessionStats } from '../stats';
import type { UseProjection } from '../host-types';
import { t } from '../i18n';

export interface StatsRowProps {
  useProjection: UseProjection | undefined;
  sessionId: string | undefined;
  /** chat legacy 节点数组（sessionStats 投影缺席时按官方 deriveStats 派生）。 */
  chatNodes?: unknown;
}

/** 官方仪表盘 glyph（弧 + 指针 + 中点，stroke 1.25）。 */
export function GaugeIcon({ size = 14 }: { size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3.49 13.26A6.375 6.375 0 1 1 12.51 13.26" stroke="currentColor" strokeWidth="1.25" />
      <path d="M8 8.75L11.4 5.35" stroke="currentColor" strokeWidth="1.25" />
      <circle cx="8" cy="8.75" r="1.55" fill="currentColor" />
    </svg>
  );
}

/** 官方数据库 glyph（椭圆柱，stroke 1.25）。 */
export function DatabaseIcon({ size = 14 }: { size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <ellipse cx="8" cy="3.6" rx="5.75" ry="2.4" stroke="currentColor" strokeWidth="1.25" />
      <path d="M2.25 3.6V12.3A5.75 2.4 0 0 0 13.75 12.3V3.6" stroke="currentColor" strokeWidth="1.25" />
      <path d="M2.25 7.95A5.75 2.4 0 0 0 13.75 7.95" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  );
}

/** 官方详情面板（bRhRbq：标题行 + 发丝线 + dt/dd 栅格）。 */
function StatPanel(props: {
  label: string;
  icon: JSX.Element;
  titleValue?: string;
  rows: readonly [string, string][];
}): JSX.Element {
  const { label, icon, titleValue, rows } = props;
  return (
    <div className="dci-stat-panel" role="dialog" aria-label={label}>
      <div className="dci-stat-panelTitle">
        <span className="dci-stat-panelLabel">
          {icon}
          {label}
        </span>
        {titleValue !== undefined ? <span className="dci-stat-panelValue">{titleValue}</span> : null}
      </div>
      <div className="dci-stat-panelRule" aria-hidden="true" />
      <dl className="dci-stat-details">
        {rows.map(([dt, dd]) => (
          <div key={dt} style={{ display: 'contents' }}>
            <dt>{dt}</dt>
            <dd>{dd}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** 官方 exactCount：千分位分组 + " tok"。 */
function exactCount(value: number | undefined): string {
  const digits = String(value ?? 0);
  const groups: string[] = [];
  for (let end = digits.length; end > 0; end -= 3) groups.unshift(digits.slice(Math.max(0, end - 3), end));
  return `${groups.join(',')} tok`;
}

/** 官方 TimePill：轮/步 + · tok/s（decodeMs>0 才出），面板 = 模型/工具用时、TTFT 均值、TPS。 */
function Pill(props: { stats: SessionStats; open: boolean; onToggle(): void }): JSX.Element {
  const { stats, open, onToggle } = props;
  const roundsPart = t('stats.turns', { turns: stats.turns ?? 0, steps: stats.steps ?? 0 });
  const tps =
    (stats.decodeMs ?? 0) > 0 ? formatTokensPerSecond((stats.decodeTokens ?? 0) / ((stats.decodeMs ?? 1) / 1000)) : null;
  const hasTimings =
    (stats.llmMs ?? 0) > 0 || (stats.toolMs ?? 0) > 0 || (stats.ttftSteps ?? 0) > 0 || (stats.decodeMs ?? 0) > 0;
  const label = (
    <span className="dci-stat-label">
      {roundsPart}
      {tps !== null ? (
        <>
          <span className="dci-stat-sep" aria-hidden="true">·</span>
          {t('stats.tps', { tps })}
        </>
      ) : null}
    </span>
  );
  // 官方：无任何计时数据时胶囊不可点（无面板可看）。
  if (!hasTimings) {
    return (
      <span className="dci-stat-anchor">
        <span className="dci-stat-pill">
          <GaugeIcon />
          {label}
        </span>
      </span>
    );
  }
  return (
    <span className="dci-stat-anchor">
      <button
        type="button"
        className="dci-stat-pill"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={tps !== null ? `${roundsPart} · ${t('stats.tps', { tps })}` : roundsPart}
        onClick={onToggle}
      >
        <GaugeIcon />
        {label}
      </button>
      {open ? (
        <StatPanel
          label={t("stats.session")}
          icon={<GaugeIcon />}
          rows={[
            [t('stats.modelTime'), (stats.llmMs ?? 0) > 0 ? formatDuration(stats.llmMs!) : '—'],
            [t('stats.toolTime'), (stats.toolMs ?? 0) > 0 ? formatDuration(stats.toolMs!) : '—'],
            [t('stats.ttft'), (stats.ttftSteps ?? 0) > 0 ? formatDuration(stats.ttftMs! / stats.ttftSteps!) : '—'],
            [
              t('stats.tpsLabel'),
              (stats.decodeMs ?? 0) > 0
                ? t('stats.tps', { tps: formatTokensPerSecond((stats.decodeTokens ?? 0) / ((stats.decodeMs ?? 1) / 1000)) })
                : '—',
            ],
          ]}
        />
      ) : null}
    </span>
  );
}

/** 官方 UsagePill：总量 · 缓存命中（缓存命中用官方百分比精度规则）。 */
function TokenPill(props: { stats: SessionStats; open: boolean; onToggle(): void }): JSX.Element | null {
  const { stats, open, onToggle } = props;
  if (stats.totalTokens === undefined) return null;
  const total = stats.totalTokens;
  const cacheHitText =
    stats.cacheHitText ??
    formatCacheHitPercent(
      stats.cacheReadTokens ?? 0,
      (stats.cacheReadTokens ?? 0) + (stats.cacheWriteTokens ?? 0) + (stats.uncachedInputTokens ?? 0),
    );
  return (
    <span className="dci-stat-anchor">
      <button
        type="button"
        className="dci-stat-pill"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={
          cacheHitText !== null
            ? `${formatTokens(total)} · ${t('stats.cacheHit', { percent: cacheHitText })}`
            : formatTokens(total)
        }
        onClick={onToggle}
      >
        <DatabaseIcon />
        <span className="dci-stat-label">
          {formatTokens(total)}
          {cacheHitText !== null ? (
            <>
              <span className="dci-stat-sep" aria-hidden="true">·</span>
              {t('stats.cacheHit', { percent: cacheHitText })}
            </>
          ) : null}
        </span>
      </button>
      {open ? (
        <StatPanel
          label={t("stats.usage")}
          icon={<DatabaseIcon />}
          titleValue={exactCount(total)}
          rows={[
            [t('stats.cacheHitLabel'), cacheHitText !== null ? `${cacheHitText}%` : '—'],
            [t('stats.uncached'), exactCount(stats.uncachedInputTokens)],
            [t('stats.cacheRead'), exactCount(stats.cacheReadTokens)],
            ...(stats.cacheWriteTokens
              ? [[t('stats.cacheWrite'), exactCount(stats.cacheWriteTokens)] as [string, string]]
              : []),
            [t('stats.output'), exactCount(stats.outputTokens)],
          ]}
        />
      ) : null}
    </span>
  );
}

export function StatsRow(props: StatsRowProps): JSX.Element | null {
  const { useProjection, sessionId, chatNodes } = props;
  const [open, setOpen] = useState<'rounds' | 'tokens' | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const stats = useSessionStats(useProjection, sessionId, chatNodes);

  // 点外面关闭（面板内/胶囊上不关）。
  useEffect(() => {
    if (open === null) return;
    const onDown = (event: PointerEvent): void => {
      if (rootRef.current && event.target instanceof Node && rootRef.current.contains(event.target)) return;
      setOpen(null);
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [open]);

  // 官方 rc.2：上下文小圈独立于 stats 胶囊渲染（无 stats 也要出圈）。
  const pressure = useProjection
    ? (useProjection('contextPressure') as PressureSnapshot | undefined)
    : undefined;
  const hasGauge = pressure !== undefined && !!pressure.contextWindow;
  if (!stats && !hasGauge) return null;
  return (
    <div className="dci-stat-root" data-composer-stats="codinput" ref={rootRef}>
      {stats ? (
        <>
          <Pill stats={stats} open={open === 'rounds'} onToggle={() => setOpen(open === 'rounds' ? null : 'rounds')} />
          <TokenPill stats={stats} open={open === 'tokens'} onToggle={() => setOpen(open === 'tokens' ? null : 'tokens')} />
        </>
      ) : null}
      <ContextGauge useProjection={useProjection} />
    </div>
  );
}

const GAUGE_CIRCUMFERENCE = 2 * Math.PI * 5.5;

interface PressureSnapshot {
  contextWindow?: number;
  pressureTokens?: number;
  projectedTokens?: number;
}

interface BreakdownSnapshot {
  messageTokens?: number;
  systemTokens?: number;
  toolsTokens?: number;
}

function shortTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}K`;
  return `${n}`;
}

/** 上下文占用小圈（官方 JObwrW 复刻）：双环仪表 + 百分比，点击展开分段面板。
 * 0.1.7-rc.2 起官方渲染在 dock 行 stats 胶囊之后（原先在工具行 trailing）。 */
export function ContextGauge(props: { useProjection: UseProjection | undefined }): JSX.Element | null {
  const { useProjection } = props;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const pressure = useProjection
    ? (useProjection('contextPressure') as PressureSnapshot | undefined)
    : undefined;
  const breakdown = useProjection
    ? (useProjection('contextBreakdown') as BreakdownSnapshot | undefined)
    : undefined;
  // 点外面关闭。
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent): void => {
      if (rootRef.current && event.target instanceof Node && rootRef.current.contains(event.target)) return;
      setOpen(false);
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [open]);

  if (!pressure || !pressure.contextWindow) return null;
  const windowTokens = pressure.contextWindow;
  // 官方 contextOccupancy 语义：优先 projectedTokens（含投影增长），缺失退 pressureTokens。
  const usedTokens = pressure.projectedTokens ?? pressure.pressureTokens ?? 0;
  const pct = Math.min(100, Math.round((usedTokens / windowTokens) * 100));
  const dash = (pct / 100) * GAUGE_CIRCUMFERENCE;
  const segments: readonly [string, number][] = [
    ['dci-gauge-colorSystem', breakdown?.systemTokens ?? 0],
    ['dci-gauge-colorTools', breakdown?.toolsTokens ?? 0],
    ['dci-gauge-colorMessages', breakdown?.messageTokens ?? 0],
  ];
  return (
    <span className="dci-gauge-root" ref={rootRef}>
      <button
        type="button"
        className="dci-gauge-trigger"
        aria-label={t("tool.context", { percent: Math.round(pct) })}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={t("tool.context", { percent: Math.round(pct) })}
        onClick={() => setOpen(!open)}
      >
        <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">
          <circle className="dci-gauge-track" cx="7" cy="7" r="5.5" />
          <circle
            className="dci-gauge-fill"
            cx="7" cy="7" r="5.5"
            strokeDasharray={`${dash} ${GAUGE_CIRCUMFERENCE}`}
            transform="rotate(-90 7 7)"
          />
        </svg>
        <span>{Math.round(pct)}%</span>
      </button>
      {open ? (
        <div className="dci-gauge-panel" role="dialog" aria-label={t("tool.contextTitle")}>
          <div className="dci-gauge-header">
            <span className="dci-gauge-headline">{t("tool.contextTitle")}</span>
            <span className="dci-gauge-percent">{Math.round(pct)}%</span>
            <span className="dci-gauge-figures">
              ~{shortTokens(usedTokens)} / {shortTokens(windowTokens)}
            </span>
          </div>
          <div className="dci-gauge-bar">
            {segments.map(([cls, tokens]) => (
              <div
                key={cls}
                className={`dci-gauge-segment ${cls}`}
                style={{ width: `${(tokens / windowTokens) * 100}%` }}
              />
            ))}
          </div>
          <dl className="dci-gauge-rows">
            <div className="dci-gauge-row">
              <dt>
                <span className={`dci-gauge-swatch dci-gauge-colorSystem`} aria-hidden="true" />
                {t("stats.prompt")}
              </dt>
              <dd>~{shortTokens(breakdown?.systemTokens ?? 0)}</dd>
            </div>
            <div className="dci-gauge-row">
              <dt>
                <span className={`dci-gauge-swatch dci-gauge-colorTools`} aria-hidden="true" />
                {t("stats.tools")}
              </dt>
              <dd>~{shortTokens(breakdown?.toolsTokens ?? 0)}</dd>
            </div>
            <div className="dci-gauge-row">
              <dt>
                <span className={`dci-gauge-swatch dci-gauge-colorMessages`} aria-hidden="true" />
                {t("stats.messages")}
              </dt>
              <dd>~{shortTokens(breakdown?.messageTokens ?? 0)}</dd>
            </div>
          </dl>
        </div>
      ) : null}
    </span>
  );
}
