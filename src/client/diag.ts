/** 诊断口约定：window.__dshCodinput*（见 docs/idea.md 附录）。 */

import type { InputState, InputTriggerController, ComposerKeyboard } from './host-types';

interface DiagWindow {
  __dshCodinputDebug: unknown[];
  __dshCodinputErrs: unknown[];
  __dshCodinputSessionId: string | null;
  __dshCodinputTriggers: Record<string, InputTriggerController | undefined>;
  __dshCodinputKeyboard: Record<string, ComposerKeyboard | undefined>;
  __dshCodinputShell: Record<string, unknown>;
}

declare global {
  interface Window {
    __dshCodinputDebug?: unknown[];
    __dshCodinputErrs?: unknown[];
    __dshCodinputSessionId?: string | null;
    __dshCodinputTriggers?: Record<string, InputTriggerController | undefined>;
    __dshCodinputKeyboard?: Record<string, ComposerKeyboard | undefined>;
    __dshCodinputShell?: Record<string, unknown>;
  }
}

export function diagWindow(): DiagWindow {
  const w = window as Window & Partial<DiagWindow>;
  w.__dshCodinputDebug ??= [];
  w.__dshCodinputErrs ??= [];
  w.__dshCodinputTriggers ??= {};
  w.__dshCodinputKeyboard ??= {};
  w.__dshCodinputShell ??= {};
  return w as DiagWindow;
}

export function diagDebug(...parts: unknown[]): void {
  const w = diagWindow();
  w.__dshCodinputDebug.push(parts.length === 1 ? parts[0] : parts);
  if (w.__dshCodinputDebug.length > 400) w.__dshCodinputDebug.splice(0, w.__dshCodinputDebug.length - 400);
}

export function diagError(scope: string, error: unknown): void {
  const w = diagWindow();
  w.__dshCodinputErrs.push({ scope, error: error instanceof Error ? error.stack ?? error.message : String(error) });
  if (w.__dshCodinputErrs.length > 200) w.__dshCodinputErrs.splice(0, w.__dshCodinputErrs.length - 200);
}

export function diagSession(id: string | null): void {
  diagWindow().__dshCodinputSessionId = id;
}

/** Safe: 对外暴露的只读探测面。 */
export function runGuarded(scope: string, fn: () => void): void {
  try {
    fn();
  } catch (error) {
    diagError(scope, error);
  }
}
