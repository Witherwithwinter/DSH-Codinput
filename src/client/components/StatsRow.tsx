/**
 * 底部数据行（卡片下方原位）：官方 InputBar `.dock[data-composer-dock="true"]` 复刻——
 *
 * 1. `conversation.composer.dock` 座位（`ComposerDockSlot`，含官方同款
 *    `<div data-slot="conversation.composer.dock" style="display: contents">` 包装）：
 *    完全交由官方槽位渲染（官方 ActivityPill/UsagePill、第三方追加型与替换型
 *    状态栏插件均按官方语义原样生效，本插件不再自绘统计胶囊）；
 * 2. 上下文占用小圈（`ContextGauge`）：官方 `ContextMeter` 不是独立槽位而是硬编码在
 *    `InputBar` `.dock` 内与 `composer.dock` 并列，故在此保留等价组件（并保留官方
 *    `aria-haspopup="dialog"` + 本地化上下文 `aria-label`，第三方状态栏插件可按官方
 *    选择器接管或隐藏）。
 */

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives';
import type { UseProjection } from '../host-types';
import { t, useT } from '../i18n';
import { listRows, useSlotEntries } from './slotEntry';
import { ComposerDockSlot, COMPOSER_DOCK_SLOT } from './ComposerDockSlot';

export interface StatsRowProps {
  useProjection: UseProjection | undefined;
  sessionId: string | undefined;
  /** 宿主下发给 bar 条目的 standard props 原样面（composer.dock 座位条目用）。 */
  standard?: Record<string, unknown> | undefined;
}

interface ContextPressureSnapshot {
  readonly contextWindow?: number;
  readonly pressureTokens?: number;
  readonly projectedTokens?: number;
}

interface BreakdownSnapshot {
  messageTokens?: number;
  systemTokens?: number;
  toolsTokens?: number;
}

function finiteNum(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readContextPressure(raw: unknown): ContextPressureSnapshot | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const contextWindow = finiteNum(r['contextWindow']);
  if (contextWindow === undefined) return undefined;
  return {
    contextWindow,
    pressureTokens: finiteNum(r['pressureTokens']),
    projectedTokens: finiteNum(r['projectedTokens']),
  };
}

/** 官方 useAnchoredPosition 的插件侧移植（primitives 不可 import）：fixed 面板按锚点
 * 视口矩形定位（side top / align start：面板左缘对齐锚点左缘、底距锚点顶 gap），
 * 两侧按 margin 夹取（顶边用官方 overlayTopMargin：帧顶 clearance+20 与 margin 取大），
 * 滚动（捕获相位）/resize/面板自身尺寸变化重算。返回 null = 尚未量得（面板隐藏）。 */
function useAnchoredPanel(
  open: boolean,
  anchorRef: React.RefObject<HTMLElement | null>,
  panelRef: React.RefObject<HTMLElement | null>,
  gap: number,
  margin: number,
): { left: number; top: number } | null {
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    // 官方 overlayTopMargin：帧顶 clearance（data-fullscreen 归零）+20，与 margin 取大。
    const topMargin = (): number => {
      const clearance = Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--dsh-frame-top-clearance'),
      );
      if (Number.isNaN(clearance)) return margin;
      return Math.max(margin, (document.documentElement.hasAttribute('data-fullscreen') ? 0 : clearance) + 20);
    };
    // 与官方 place() 同构：rect 存在就落位，宽/高为 0 时只跳过对应轴的夹取。
    const place = (): void => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (rect === undefined) return;
      const panel = panelRef.current;
      const width = panel?.offsetWidth ?? 0;
      const height = panel?.offsetHeight ?? 0;
      let left = rect.left;
      let top = rect.top - gap - height;
      if (width > 0) left = Math.min(Math.max(left, margin), window.innerWidth - width - margin);
      if (height > 0) top = Math.min(Math.max(top, topMargin()), window.innerHeight - height - margin);
      setPosition((prev) => (prev && prev.left === left && prev.top === top ? prev : { left, top }));
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    const panel = panelRef.current;
    const anchor = anchorRef.current;
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(place);
      if (panel !== null) observer.observe(panel);
      if (anchor !== null) observer.observe(anchor);
    }
    return () => {
      observer?.disconnect();
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, anchorRef, panelRef, gap, margin]);
  return position;
}

/** 官方 useStatDialog 的插件侧等价 seat（点外关闭 + Escape 关闭）。 */
function useStatDialogSeat(
  open: boolean,
  onClose: () => void,
): {
  rootRef: React.MutableRefObject<HTMLSpanElement | null>;
  panelRef: React.MutableRefObject<HTMLDivElement | null>;
  position: { left: number; top: number } | null;
} {
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const position = useAnchoredPanel(open, rootRef, panelRef, 8, 12);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent): void => {
      if (!(event.target instanceof Node)) return;
      if (rootRef.current?.contains(event.target) === true) return;
      if (panelRef.current?.contains(event.target) === true) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);
  return { rootRef, panelRef, position };
}

/** 面板定位样式（未量得前官方同款：隐藏在原点）。 */
function panelStyle(position: { left: number; top: number } | null): React.CSSProperties {
  return position ?? { visibility: 'hidden', left: 0, top: 0 };
}

export function StatsRow(props: StatsRowProps): JSX.Element | null {
  const { useProjection, sessionId, standard } = props;
  // StatsRowMemo 被 React.memo 隔离，必须自行订阅语言变化，切 zh/en 时文案即时刷新。
  useT();
  const [gaugeOpen, setGaugeOpen] = useState(false);
  const closeGauge = useCallback(() => setGaugeOpen(false), []);
  const toggleGauge = useCallback(() => setGaugeOpen((v) => !v), []);

  const rawPressure = useProjection ? useProjection('contextPressure') : undefined;
  const pressure = useMemo(() => readContextPressure(rawPressure), [rawPressure]);

  // conversation.composer.dock 座位：原样镜像官方槽位，不再自绘统计胶囊。
  const dockEntries = useSlotEntries(COMPOSER_DOCK_SLOT);
  const hasDockSeat = useMemo(
    () => sessionId !== undefined && listRows(dockEntries).length > 0,
    [sessionId, dockEntries],
  );

  const hasGauge =
    pressure !== undefined &&
    typeof pressure.contextWindow === 'number' &&
    Number.isFinite(pressure.contextWindow) &&
    pressure.contextWindow > 0;
  useEffect(() => {
    if (gaugeOpen && !hasGauge) setGaugeOpen(false);
  }, [gaugeOpen, hasGauge]);

  if (!hasDockSeat && !hasGauge) return null;
  return (
    <div className="dci-stat-root" data-composer-dock="true" data-composer-stats="codinput">
      {hasDockSeat ? <ComposerDockSlot sessionId={sessionId} standard={standard} /> : null}
      <ContextGauge
        useProjection={useProjection}
        pressure={pressure}
        open={gaugeOpen}
        onToggle={toggleGauge}
        onClose={closeGauge}
      />
    </div>
  );
}

const GAUGE_CIRCUMFERENCE = 2 * Math.PI * 5.5;

/** 上下文分段 token 紧凑文本；NaN/Infinity/负值不渲染（"—"）。 */
function shortTokens(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}K`;
  return `${n}`;
}

/** 上下文占用小圈（官方 ContextMeter 复刻：双环仪表 + 百分比，点击展开分段面板）。 */
export function ContextGauge(props: {
  useProjection: UseProjection | undefined;
  pressure: ContextPressureSnapshot | undefined;
  open: boolean;
  onToggle(): void;
  onClose(): void;
}): JSX.Element | null {
  const { useProjection, pressure, open, onToggle, onClose } = props;
  const { rootRef, panelRef, position } = useStatDialogSeat(open, onClose);
  const breakdown = useProjection
    ? (useProjection('contextBreakdown') as BreakdownSnapshot | undefined)
    : undefined;

  const windowTokens = pressure?.contextWindow;
  if (windowTokens === undefined || !Number.isFinite(windowTokens) || windowTokens <= 0) return null;
  const projected = pressure?.projectedTokens;
  const pressureTokens = pressure?.pressureTokens;
  const usedRaw = projected !== undefined ? projected : pressureTokens !== undefined ? pressureTokens : 0;
  const usedTokens = Number.isFinite(usedRaw) && usedRaw >= 0 ? usedRaw : 0;
  const pct = Math.min(100, Math.max(0, Math.round((usedTokens / windowTokens) * 100)));
  const dash = (pct / 100) * GAUGE_CIRCUMFERENCE;
  const breakdownTokens = (value: number | undefined): number =>
    value !== undefined && Number.isFinite(value) && value > 0 ? value : 0;
  const systemTokens = breakdownTokens(breakdown?.systemTokens);
  const toolsTokens = breakdownTokens(breakdown?.toolsTokens);
  const messageTokens = breakdownTokens(breakdown?.messageTokens);
  const segments: readonly [string, number][] = [
    ['dci-gauge-colorSystem', systemTokens],
    ['dci-gauge-colorTools', toolsTokens],
    ['dci-gauge-colorMessages', messageTokens],
  ];
  return (
    <span className="dci-gauge-root" ref={rootRef}>
      <Tooltip label={t('tool.context', { percent: Math.round(pct) })} side="top" delayMs={500} portal>
        <button
          type="button"
          className="dci-gauge-trigger"
          aria-label={t('tool.context', { percent: Math.round(pct) })}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={onToggle}
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
      </Tooltip>
      {open
        ? createPortal(
            <div
              className="dci-gauge-panel"
              role="dialog"
              aria-label={t('tool.contextTitle')}
              ref={panelRef}
              style={panelStyle(position)}
            >
              <div className="dci-gauge-header">
                <span className="dci-gauge-headline">{t('tool.contextTitle')}</span>
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
                    <span className="dci-gauge-swatch dci-gauge-colorSystem" aria-hidden="true" />
                    {t('stats.prompt')}
                  </dt>
                  <dd>~{shortTokens(systemTokens)}</dd>
                </div>
                <div className="dci-gauge-row">
                  <dt>
                    <span className="dci-gauge-swatch dci-gauge-colorTools" aria-hidden="true" />
                    {t('stats.tools')}
                  </dt>
                  <dd>~{shortTokens(toolsTokens)}</dd>
                </div>
                <div className="dci-gauge-row">
                  <dt>
                    <span className="dci-gauge-swatch dci-gauge-colorMessages" aria-hidden="true" />
                    {t('stats.messages')}
                  </dt>
                  <dd>~{shortTokens(messageTokens)}</dd>
                </div>
              </dl>
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}

/**
 * memo 版数据行：宿主 kit 经 useStableKit 稳定后，按键只改变草稿，不改变
 * sessionId/standard/useProjection，`React.memo` 让本行在连续输入时完全不重渲染。
 */
export const StatsRowMemo = memo(StatsRow);
