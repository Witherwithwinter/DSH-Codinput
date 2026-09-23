/**
 * 侧栏输入承载总线：侧栏 Codinput 标签 body **挂载**即声明「本会话的输入由
 * 侧栏承载」（侧栏形态 = 三态里的 `side`），主输入遮蔽条目（conversation.
 * composer.bar）据此渲染 null，保证屏幕上只有一个输入组件。
 *
 * 关键：可见性不再参与承载判定。侧栏收起是 CSS 隐藏（body 仍挂载），若按
 * 可见性让位，收起侧栏会唤回普通模式/官方输入框——产品上不允许（收起只
 * 是「输入入口被收进侧栏且不可见」，入口仍是侧栏那一个，经右上角小球唤出）。
 * `visible` 与 `expanded` 仍逐拍上报，供小球判断「侧栏已收起」用。
 *
 * 总线是纯模块态：侧栏与主输入分属两棵 React 树，唯一的通信面就是这里。
 */

import { useEffect, useState } from 'react';

export interface SidebarCarryState {
  /** 官方可见判定（useTabInfo().tab.visible）：展开且为激活标签，或浮动面板。 */
  visible: boolean;
  /** 右侧栏是否展开（useTabInfo().sidebar.expanded）。 */
  expanded: boolean;
}

export interface SidebarCarry {
  /** 本次承载的令牌（同会话多 body 时，最早的持令牌者渲染编辑面）。 */
  readonly token: number;
  /** 可见性/展开态变化时更新（同一 body 生命周期内）。 */
  set(state: SidebarCarryState): void;
  /** body 卸载时释放。 */
  release(): void;
}

const claims = new Map<number, SidebarCarryState & { sessionId: string }>();
const listeners = new Set<() => void>();
let nextToken = 1;
/** 快照：被侧栏承载的会话（挂载即承载）→ 可见性/展开态 + 编辑面持有者令牌。 */
let snapshot: ReadonlyMap<string, SidebarCarryState & { owner: number }> = new Map();

function sameState(a: SidebarCarryState, b: SidebarCarryState): boolean {
  return a.visible === b.visible && a.expanded === b.expanded;
}

function sameSnapshot(next: Map<string, SidebarCarryState & { owner: number }>): boolean {
  if (next.size !== snapshot.size) return false;
  for (const [id, state] of next) {
    const prev = snapshot.get(id);
    if (!prev || !sameState(prev, state) || prev.owner !== state.owner) return false;
  }
  return true;
}

function recompute(): void {
  const next = new Map<string, SidebarCarryState & { owner: number }>();
  for (const [token, claim] of claims) {
    const prev = next.get(claim.sessionId);
    // 同一会话多 body（分栏里复制出第二个 Codinput 标签）时取「最可见」的一份，
    // 编辑面归属最早声明者（owner），其余 body 只出提示，杜绝双编辑面。
    if (!prev) {
      next.set(claim.sessionId, { visible: claim.visible, expanded: claim.expanded, owner: token });
    } else if (!prev.visible && claim.visible) {
      next.set(claim.sessionId, { ...prev, visible: true, expanded: claim.expanded });
    }
  }
  if (sameSnapshot(next)) return;
  snapshot = next;
  for (const fn of listeners) fn();
}

/** 侧栏 body 声明承载本会话输入；返回句柄，卸载时 release。 */
export function claimSidebarInput(sessionId: string, state: SidebarCarryState): SidebarCarry {
  const token = nextToken++;
  claims.set(token, { sessionId, ...state });
  recompute();
  let released = false;
  return {
    token,
    set(next: SidebarCarryState): void {
      const claim = claims.get(token);
      if (claim && !sameState(claim, next)) {
        claims.set(token, { sessionId: claim.sessionId, ...next });
        recompute();
      }
    },
    release(): void {
      if (released) return;
      released = true;
      if (claims.delete(token)) recompute();
    },
  };
}

/** 本会话的输入是否由侧栏承载（主输入应渲染 null；即形态 = side）。 */
export function isSidebarInputCarried(sessionId: string | undefined): boolean {
  return sessionId !== undefined && snapshot.has(sessionId);
}

/** 任一会话被侧栏承载（主遮蔽条目需保持挂载以执行隐藏）。 */
export function isAnySidebarInputCarried(): boolean {
  return snapshot.size > 0;
}

/** 本会话的侧栏承载态快照（未承载时 undefined）。 */
export function sidebarCarryState(sessionId: string | undefined): SidebarCarryState | undefined {
  return sessionId === undefined ? undefined : snapshot.get(sessionId);
}

/**
 * 编辑面归属：同会话被多个 body 承载（分栏里复制出第二个 Codinput 标签）时，
 * 只有最早声明者渲染编辑面。`token === 0`（尚未声明）一律返回 true——避免
 * 首帧把还没拿到令牌的自己判成非归属者。
 */
export function isSidebarCarryOwner(sessionId: string | undefined, token: number): boolean {
  if (token === 0 || sessionId === undefined) return true;
  return snapshot.get(sessionId)?.owner === token;
}

/** 归属订阅（body 用）：令牌变化、其他 body 挂载/卸载都会重渲染。 */
export function useSidebarCarryOwner(sessionId: string | undefined, token: number): boolean {
  const [owner, setOwner] = useState(() => isSidebarCarryOwner(sessionId, token));
  useEffect(() => {
    const sync = (): void => {
      const now = isSidebarCarryOwner(sessionId, token);
      setOwner((prev) => (prev === now ? prev : now));
    };
    sync();
    return subscribeSidebarInput(sync);
  }, [sessionId, token]);
  return owner;
}

export function subscribeSidebarInput(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** 主输入组件订阅：本会话输入是否已由侧栏承载。 */
export function useSidebarInputCarried(sessionId: string | undefined): boolean {
  const [carried, setCarried] = useState(() => isSidebarInputCarried(sessionId));
  useEffect(() => {
    const sync = (): void => {
      const now = isSidebarInputCarried(sessionId);
      setCarried((prev) => (prev === now ? prev : now));
    };
    sync();
    return subscribeSidebarInput(sync);
  }, [sessionId]);
  return carried;
}

/**
 * 侧栏承载态订阅（小球用）：`carried` = 本会话输入在侧栏里，
 * `collapsed` = 侧栏已收起（承载但不可见 → 输入入口需要小球唤出）。
 */
export function useSidebarCarry(sessionId: string | undefined): { carried: boolean; collapsed: boolean } {
  const read = (): { carried: boolean; collapsed: boolean } => {
    const state = sidebarCarryState(sessionId);
    return { carried: state !== undefined, collapsed: state !== undefined && state.expanded === false };
  };
  const [value, setValue] = useState(read);
  useEffect(() => {
    const sync = (): void => {
      const next = read();
      setValue((prev) => (prev.carried === next.carried && prev.collapsed === next.collapsed ? prev : next));
    };
    sync();
    return subscribeSidebarInput(sync);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);
  return value;
}
