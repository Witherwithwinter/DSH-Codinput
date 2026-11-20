/**
 * 服务面 stash：ctx 属性直读要求 fiber inject 声明（工程事实 #2），
 * 统一在 apply 里 ctx.inject(...) 拿 scope 后存此处，组件通过 `useService`
 * 响应式消费或直接读 `stash`。
 *
 * 相比旧版「只写对象不通知 + 组件层 300ms 轮询」，这里维护一份轻量订阅总线：
 * 任意服务异步就绪时立刻通知所有 `useService` 订阅方（含 React.memo 隔离的子
 * 座位组件），服务就绪即首帧生效，卸载时随 `ctx.effect` 清理。
 */

import { useCallback, useSyncExternalStore } from 'react';
import type {
  ClientContext,
  CommandUiFace,
  ConversationFace,
  ModelDirectoriesFace,
  SessionsFace,
  SidebarRightFace,
  SlotsService,
} from './host-types';
import { runGuarded } from './diag';
import { installSeatAudit } from './seats';
import { installI18n } from './i18n';

export interface ServiceStash {
  slots?: SlotsService;
  conversation?: ConversationFace;
  sessions?: SessionsFace;
  commandUi?: CommandUiFace;
  modelDirectories?: ModelDirectoriesFace;
  sidebarRight?: SidebarRightFace;
}

export const stash: ServiceStash = {};

const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

function setService<K extends keyof ServiceStash>(key: K, value: ServiceStash[K]): void {
  if (stash[key] === value) return;
  stash[key] = value;
  emit();
}

export function subscribeServices(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** 响应式读取单个宿主服务：服务异步就绪时仅当该服务引用变化才触发重渲染。 */
export function useService<K extends keyof ServiceStash>(name: K): ServiceStash[K] {
  const getSnapshot = useCallback(() => stash[name], [name]);
  return useSyncExternalStore(subscribeServices, getSnapshot, getSnapshot);
}

export function installServices(ctx: ClientContext): void {
  // 消费 conversation 服务（本模块 inject 声明已含 'slots' 与 'conversation'）。
  runGuarded('stash.conversation', () => {
    ctx.inject(['conversation'], (scope: Record<string, unknown>) => {
      setService('conversation', scope['conversation'] as ConversationFace);
    });
  });

  // sessions / commandUi：被消费服务自身的 static inject 链由宿主装配。
  // slots 一并取入 stash：座位镜像与语音按钮要检视槽位条目。
  runGuarded('stash.services', () => {
    ctx.inject(['slots', 'sessions', 'commandUi'], (scope: Record<string, unknown>) => {
      const slots = scope['slots'] as SlotsService;
      stash.slots = slots;
      stash.sessions = scope['sessions'] as SessionsFace;
      stash.commandUi = scope['commandUi'] as CommandUiFace;
      emit();
      // 未镜像子座位的运行时审计（issue #8）：有占用者却没有渲染点时告警。
      runGuarded('seat.audit', () => installSeatAudit(slots));
    });
  });

  // 右侧栏控制器（小球唤回侧栏 Codinput 用）。与 sidebarRightTabs 同批
  // inject——侧栏标签注册已经用过这个组合，服务面存在即成功。
  runGuarded('stash.sidebarRight', () => {
    ctx.inject(['slots', 'sidebarRightTabs', 'sidebarRight'], (scope: Record<string, unknown>) => {
      setService('sidebarRight', scope['sidebarRight'] as SidebarRightFace);
    });
  });

  // 共享模型目录（官方 ui-model-selection 的服务）。工程事实 #2：必须连带
  // 声明被消费服务自身的 static inject 链（sessions/remote/remote.session）——
  // directoryFor/select 内部经 cordis accessor 读 remote.session，accessor
  // 校验的是调用方 fiber 的 inject 声明，缺了会抛 "without inject"。
  runGuarded('stash.modelDirectories', () => {
    ctx.inject(['modelDirectories', 'sessions', 'remote', 'remote.session'], (scope: Record<string, unknown>) => {
      setService('modelDirectories', scope['modelDirectories'] as ModelDirectoriesFace);
    });
  });

  // 文案国际化：宿主 locale 服务就绪后注册词典并绑定翻译函数；
  // 返回的清理函数交由 ctx.effect 持有，热重载/卸载时释放旧监听与词典注册。
  runGuarded('i18n.install', () => {
    ctx.inject(['locale'], (scope: Record<string, unknown>) => {
      const disposeI18n = installI18n(scope['locale']);
      if (disposeI18n) ctx.effect(() => disposeI18n, 'dsh-codinput: i18n');
    });
  });
}
