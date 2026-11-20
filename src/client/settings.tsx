/**
 * 设置 → Codinput 分组：启用接管、显示行号、编辑器字体、发送/换行快捷键、
 * 默认视图。行结构与控件对齐官方设置（T1PP：标题 + 描述 + 发丝线 +
 * 36px 选择器胶囊）；settings.section（list，须带 label/order——工程事实
 * #3），偏好经 usePrefs 与 localStorage 实时同步。
 */

import { IconChevronDownOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives';
import { useEffect, useRef, useState } from 'react';
import type { SlotRegisterOptions } from './host-types';
import { DEFAULT_PREFS, savePrefs, usePrefs, type CodinputPrefs, type Hotkey } from './prefs';
import { comboFromEventLike, formatCombo, hotkeysConflict } from './hotkey';
import { MenuSurface } from './components/MenuSurface';
import { t, useT } from './i18n';

export const SETTINGS_SECTION_ID = 'codinput';

export function settingsRegistration(): { options: SlotRegisterOptions; component: unknown } {
  return {
    options: {
      name: 'settings.section',
      id: SETTINGS_SECTION_ID,
      order: 60,
      label: () => 'Codinput',
      registrant: 'dsh-codinput',
    },
    component: CodinputSettingsSection,
  };
}

/** 快捷键录制器：点击进入录制态，按任意组合完成录入，Esc 取消，冲突时标红提示。 */
function HotkeyRecorder(props: {
  value: Hotkey;
  conflictWith?: Hotkey;
  ariaLabel: string;
  onChange(value: Hotkey): void;
}): JSX.Element {
  const { value, conflictWith, ariaLabel, onChange } = props;
  const [recording, setRecording] = useState(false);
  const [conflict, setConflict] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const conflictTimerRef = useRef<number>(0);

  useEffect(
    () => () => {
      if (conflictTimerRef.current !== 0) {
        window.clearTimeout(conflictTimerRef.current);
        conflictTimerRef.current = 0;
      }
    },
    [],
  );

  useEffect(() => {
    if (!recording) return;
    const onDown = (event: PointerEvent): void => {
      if (btnRef.current && event.target instanceof Node && btnRef.current.contains(event.target)) return;
      setRecording(false);
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [recording]);

  return (
    <button
      ref={btnRef}
      type="button"
      className="dci-set-selector"
      data-recording={recording || undefined}
      data-conflict={conflict || undefined}
      aria-label={ariaLabel}
      onClick={() => setRecording(true)}
      onBlur={() => setRecording(false)}
      onKeyDown={(e) => {
        if (!recording) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.key === 'Escape') {
          setRecording(false);
          return;
        }
        if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return;
        const combo = comboFromEventLike(e.nativeEvent, e.key);
        if (conflictWith !== undefined && hotkeysConflict(combo, conflictWith)) {
          setConflict(true);
          if (conflictTimerRef.current !== 0) window.clearTimeout(conflictTimerRef.current);
          conflictTimerRef.current = window.setTimeout(() => {
            conflictTimerRef.current = 0;
            setConflict(false);
          }, 1500);
          return;
        }
        if (conflictTimerRef.current !== 0) {
          window.clearTimeout(conflictTimerRef.current);
          conflictTimerRef.current = 0;
        }
        setConflict(false);
        onChange(combo);
        setRecording(false);
        btnRef.current?.blur();
      }}
    >
      {recording ? t('set.recording') : formatCombo(value)}
    </button>
  );
}

/** 官方设置行（标题 + 描述 + 右侧控件，发丝线分隔）。 */
function Row(props: { title: string; desc?: string; children: React.ReactNode }): JSX.Element {
  const { title, desc, children } = props;
  return (
    <div className="dci-set-row">
      <div className="dci-set-rowText">
        <div className="dci-set-title">{title}</div>
        {desc ? <div className="dci-set-desc">{desc}</div> : null}
      </div>
      <div className="dci-set-control">{children}</div>
    </div>
  );
}

/** 官方选择器：36px 胶囊触发器 + 官方 Menu 下拉（锚点下方弹出）。 */
function Selector(props: {
  value: string;
  options: readonly { value: string; label: string }[];
  onChange(value: string): void;
  ariaLabel: string;
}): JSX.Element {
  const { value, options, onChange, ariaLabel } = props;
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [anchorRect, setAnchorRect] = useState<{ left: number; top: number; right: number; bottom: number } | null>(null);
  const current = options.find((o) => o.value === value);
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="dci-set-selector"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => {
          if (!open) {
            const el = btnRef.current ?? null;
            setAnchor(el);
            setAnchorRect(el ? el.getBoundingClientRect() : null);
          }
          setOpen(!open);
        }}
      >
        {current?.label ?? value}
        <IconChevronDownOutlineRegular size={14} />
      </button>
      {open && anchor ? (
        <MenuSurface anchor={anchor} initialRect={anchorRect} side="bottom" alignEnd onClose={() => setOpen(false)} minWidth={200}>
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className="dci-item"
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
            >
              <span className="dci-itemLabel">{opt.label}</span>
            </button>
          ))}
        </MenuSurface>
      ) : null}
    </>
  );
}

function Switch(props: { on: boolean; label: string; onToggle(): void }): JSX.Element {
  const { on, label, onToggle } = props;
  return (
    <button
      type="button"
      role="switch"
      className="dci-switch"
      aria-checked={on}
      aria-label={label}
      onClick={onToggle}
    />
  );
}

export function CodinputSettingsSection(): JSX.Element {
  const prefs = usePrefs();
  useT();
  // 字体输入框用本地草稿态：允许自由清空与编辑，失焦/回车再提交；
  // 留空提交即恢复默认字体（旧版 onChange 直写会在清空瞬间把默认串填回来）。
  const [fontDraft, setFontDraft] = useState<string>(prefs.fontFamily);
  useEffect(() => {
    setFontDraft(prefs.fontFamily);
  }, [prefs.fontFamily]);

  const update = (patch: Partial<CodinputPrefs>): void => {
    savePrefs(patch);
  };

  const commitFont = (): void => {
    const trimmed = fontDraft.trim();
    const target = trimmed === '' ? DEFAULT_PREFS.fontFamily : trimmed;
    const saved = savePrefs({ fontFamily: target });
    setFontDraft(saved.fontFamily);
  };

  return (
    <div className="dci-settings">
      <Row title={t('set.enabled')} desc={t('set.enabledDesc')}>
        <Switch on={prefs.enabled} label={t('set.enabled')} onToggle={() => update({ enabled: !prefs.enabled })} />
      </Row>
      <Row title={t('set.userMarkdown')} desc={t('set.userMarkdownDesc')}>
        <Switch
          on={prefs.userMarkdown}
          label={t('set.userMarkdown')}
          onToggle={() => update({ userMarkdown: !prefs.userMarkdown })}
        />
      </Row>
      <Row title={t('set.lineNumbers')} desc={t('set.lineNumbersDesc')}>
        <Switch on={prefs.lineNumbers} label={t('set.lineNumbers')} onToggle={() => update({ lineNumbers: !prefs.lineNumbers })} />
      </Row>
      <Row title={t('set.markdownMono')} desc={t('set.markdownMonoDesc')}>
        <Switch
          on={prefs.markdownMono}
          label={t('set.markdownMono')}
          onToggle={() => update({ markdownMono: !prefs.markdownMono })}
        />
      </Row>
      <Row title={t('set.font')} desc={t('set.fontDesc')}>
        <input
          type="text"
          className="dci-set-input"
          value={fontDraft}
          placeholder={DEFAULT_PREFS.fontFamily}
          spellCheck={false}
          aria-label={t('set.font')}
          onChange={(e) => setFontDraft(e.target.value)}
          onBlur={commitFont}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.currentTarget.blur();
            } else if (e.key === 'Escape') {
              setFontDraft(prefs.fontFamily);
              e.currentTarget.blur();
            }
          }}
        />
      </Row>
      <Row title={t('set.sendKey')} desc={t('set.sendKeyDesc')}>
        <HotkeyRecorder
          value={prefs.sendHotkey}
          conflictWith={prefs.lineBreakHotkey}
          ariaLabel={t('set.sendKey')}
          onChange={(v) => update({ sendHotkey: v })}
        />
      </Row>
      <Row title={t('set.lineBreakKey')} desc={t('set.lineBreakKeyDesc')}>
        <HotkeyRecorder
          value={prefs.lineBreakHotkey}
          conflictWith={prefs.sendHotkey}
          ariaLabel={t('set.lineBreakKey')}
          onChange={(v) => update({ lineBreakHotkey: v })}
        />
      </Row>
      <Row title={t('set.defaultView')} desc={t('set.defaultViewDesc')}>
        <Selector
          value={prefs.defaultEdit && prefs.defaultPreview ? 'split' : prefs.defaultPreview ? 'preview' : 'edit'}
          ariaLabel={t('set.defaultView')}
          onChange={(v) =>
            update({
              defaultEdit: v !== 'preview',
              defaultPreview: v !== 'edit',
            })
          }
          options={[
            { value: 'edit', label: t('head.editOnly') },
            { value: 'split', label: t('head.split') },
            { value: 'preview', label: t('head.previewOnly') },
          ]}
        />
      </Row>
      <Row title={t('set.reset')} desc={t('set.resetAll')}>
        <button
          type="button"
          className="dci-set-selector"
          onClick={() => savePrefs({ ...DEFAULT_PREFS })}
        >
          {t('set.resetAction')}
        </button>
      </Row>
    </div>
  );
}
