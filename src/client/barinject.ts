/**
 * bar 条目注入面中转（侧栏形态用）。
 *
 * `conversation.composer.bar` 条目的 inject 面在 rc.3 提供 `retry` 与
 * `registerFileIntake`（文档级粘贴路由）——官方只注入 bar 条目本身。本插件的
 * side 形态把输入面渲染在另一棵 React 树（`sidebar.right.pane.tab` body），
 * 拿不到这两个注入面：0.5.0 因此出现「侧栏里没有继续生成、粘贴文件没有落点」。
 *
 * 遮蔽条目在 side 形态仍然挂载（渲染唤回小球 / 承载判定），把注入面原样按
 * 会话存下来，侧栏 body 取用即可。只做转存、不复制宿主逻辑；条目卸载或换
 * 会话时清空（卸载清理按对象身份判定，避免新条目被旧清理误删）。
 */

import { useEffect, useReducer } from 'react';
import type { ComposerFileIntakeTarget } from './host-types';

/** bar 条目注入面里插件需要跨树转存的部分（原样引用宿主函数）。 */
export interface BarInjectedFace {
  retry?: (failureSeq: number) => void;
  registerFileIntake?: (target: ComposerFileIntakeTarget) => () => void;
  /** 官方 bar owner props.occurrence：侧栏注册文档级粘贴路由时沿用（main/embedded）。 */
  occurrence?: 'main' | 'embedded';
}

const faces = new Map<string, BarInjectedFace>();

function keyOf(sessionId: string | undefined): string {
  return sessionId ?? 'hero';
}

/** bar 条目渲染时转存（同一会话后写覆盖：重挂载的条目是最新注入面）。 */
export function setBarInjected(sessionId: string | undefined, face: BarInjectedFace): void {
  faces.set(keyOf(sessionId), face);
  emit();
}

/** 取某会话的 bar 注入面（侧栏 body 调用；没有则 undefined）。 */
export function getBarInjected(sessionId: string | undefined): BarInjectedFace | undefined {
  return faces.get(keyOf(sessionId));
}


/** 订阅 bar 注入面变化（侧栏 body 用：条目晚于侧栏挂载时也能拿到 retry 等）。 */
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

function subscribeBarInjected(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** bar 条目卸载时清理——只清自己写的那一份（按对象身份）。 */
export function clearBarInjected(sessionId: string | undefined, face: BarInjectedFace): void {
  const key = keyOf(sessionId);
  if (faces.get(key) === face) {
    faces.delete(key);
    emit();
  }
}

/** 侧栏 body 的 react 侧读取：bar 条目晚于侧栏挂载时（开标签即启用）也能拿到面。 */
export function useBarInjected(sessionId: string | undefined): BarInjectedFace | undefined {
  const [, force] = useReducer((count: number) => count + 1, 0);
  useEffect(() => subscribeBarInjected(force), []);
  return getBarInjected(sessionId);
}
