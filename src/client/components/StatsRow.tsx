/** 数据行（卡片下方）：官方 composer stats 复刻（bOPqQW + bRhRbq）——两枚
 * 胶囊（仪表盘「轮/步 · tok/s」、数据库「累计 tok · 缓存命中」），点击弹出
 * 官方同构详情面板（会话统计 / Token 用量），锚点上方弹出、点外关闭。 */

import { useEffect, useRef, useState } from 'react';
import { useSessionStats, formatTokens, type SessionStats } from '../stats';
import type { UseProjection } from '../host-types';
import { t } from '../i18n';

export interface StatsRowProps {
  useProjection: UseProjection | undefined;
  sessionId: string | undefined;
  /** chat 树解析的轮次计时（模型用时 / TTFT）。 */
  chatTimings?: { modelMs?: number; ttftMs?: number };
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

function Pill(props: { stats: SessionStats; open: boolean; onToggle(): void }): JSX.Element {
  const { stats, open, onToggle } = props;
  const roundsPart =
    stats.turns !== undefined && stats.steps !== undefined
      ? t('stats.turns', { turns: stats.turns, steps: stats.steps })
      : stats.turns !== undefined
        ? t('stats.turns', { turns: stats.turns, steps: 0 })
        : t('stats.turns', { turns: 0, steps: 0 });
  const speedPart = stats.tokensPerSecond !== undefined ? `${Math.round(stats.tokensPerSecond)} tok/s` : null;
  const modelSec = stats.modelMs !== undefined ? stats.modelMs / 1000 : null;
  const ttftSec = stats.ttftMs !== undefined ? stats.ttftMs / 1000 : null;
  return (
    <span className="dci-stat-anchor">
      <button
        type="button"
        className="dci-stat-pill"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={onToggle}
      >
        <GaugeIcon />
        <span className="dci-stat-label">
          {roundsPart}
          {speedPart !== null ? (
            <>
              <span className="dci-stat-sep" aria-hidden="true">·</span>
              {speedPart}
            </>
          ) : null}
        </span>
      </button>
      {open ? (
        <StatPanel
          label={t("stats.session")}
          icon={<GaugeIcon />}
          rows={[
            [t('stats.modelTime'), modelSec !== null ? `${modelSec.toFixed(1)}s` : '—'],
            [t('stats.ttft'), ttftSec !== null ? `${ttftSec.toFixed(1)}s` : '—'],
            [t('stats.tpsLabel'), speedPart ?? '—'],
          ]}
        />
      ) : null}
    </span>
  );
}

function TokenPill(props: { stats: SessionStats; open: boolean; onToggle(): void }): JSX.Element | null {
  const { stats, open, onToggle } = props;
  if (stats.totalTokens === undefined) return null;
  const comma = (n: number): string => Math.round(n).toLocaleString('en-US');
  return (
    <span className="dci-stat-anchor">
      <button
        type="button"
        className="dci-stat-pill"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={onToggle}
      >
        <DatabaseIcon />
        <span className="dci-stat-label">
          {formatTokens(stats.totalTokens)}
          {stats.cacheHitPct !== undefined ? (
            <>
              <span className="dci-stat-sep" aria-hidden="true">·</span>
              缓存命中 {Math.round(stats.cacheHitPct)}%
            </>
          ) : null}
        </span>
      </button>
      {open ? (
        <StatPanel
          label={t("stats.usage")}
          icon={<DatabaseIcon />}
          titleValue={`${comma(stats.totalTokens)} tok`}
          rows={[
            [t('stats.cacheHitLabel'), stats.cacheHitPct !== undefined ? `${Math.round(stats.cacheHitPct)}%` : '—'],
            [t('stats.uncached'), `${comma(stats.uncachedInputTokens ?? 0)} tok`],
            [t('stats.cacheRead'), `${comma(stats.cacheReadTokens ?? 0)} tok`],
            [t('stats.output'), `${comma(stats.outputTokens ?? 0)} tok`],
          ]}
        />
      ) : null}
    </span>
  );
}

export function StatsRow(props: StatsRowProps): JSX.Element | null {
  const { useProjection, sessionId, chatTimings } = props;
  const [open, setOpen] = useState<'rounds' | 'tokens' | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const sampled = useSessionStats(useProjection, sessionId);
  // chat 树计时优先（历史会话也有值），采样值兜底。
  const stats = sampled
    ? {
        ...sampled,
        ...(chatTimings?.modelMs !== undefined ? { modelMs: chatTimings.modelMs } : {}),
        ...(chatTimings?.ttftMs !== undefined ? { ttftMs: chatTimings.ttftMs } : {}),
      }
    : sampled;

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

  if (!stats) return null;
  return (
    <div className="dci-stat-root" data-composer-stats="codinput" ref={rootRef}>
      <Pill stats={stats} open={open === 'rounds'} onToggle={() => setOpen(open === 'rounds' ? null : 'rounds')} />
      <TokenPill stats={stats} open={open === 'tokens'} onToggle={() => setOpen(open === 'tokens' ? null : 'tokens')} />
    </div>
  );
}
