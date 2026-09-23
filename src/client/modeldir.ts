/**
 * 模型目录：对齐官方 ui-model-selection 的服务形状——
 * `ctx.modelDirectories.directoryFor(sessionId)` 返回 per-session 目录，
 * `.store` 是 { current, groups, failures, status, error } 快照源，
 * `.select(selection)` 走 selectModel RPC 写入。
 * 注入注意：ctx.inject 列出 remote/remote.session 会让回调挂起
 * （那些是目录服务自身的依赖）——这里用 ctx.get / 单服务 inject。
 */

import type { HostObservable, ModelCatalog, ModelDirectoriesFace, ModelSelection, UseProjection } from './host-types';
import { stash } from './services';
import { diagDebug } from './diag';

/** per-session 目录快照（官方 ModelDirectory.store）。 */
export interface DirectorySnapshot {
  current: ModelSelection | null;
  routable: boolean | null;
  groups: ModelCatalog['groups'];
  failures: readonly { id: string; name: string; message: string }[];
  status: 'idle' | 'loading' | 'ready' | 'selecting' | 'error';
  error: string | null;
}

export interface SessionDirectory {
  store: HostObservable<DirectorySnapshot>;
  load(): Promise<unknown>;
  select(selection: ModelSelection): Promise<void>;
}

/** 取 per-session 目录（官方 directoryFor）；服务或会话缺席返回 null。 */
export function getSessionDirectory(sessionId: string | undefined): SessionDirectory | null {
  const dir = stash.modelDirectories as (ModelDirectoriesFace & { directoryFor?(id: string): SessionDirectory }) | undefined;
  if (!dir || typeof dir.directoryFor !== 'function' || !sessionId) return null;
  try {
    return dir.directoryFor(sessionId);
  } catch (error) {
    diagDebug('directoryFor failed', error);
    return null;
  }
}

export type { ModelCatalog, ModelSelection, UseProjection };
