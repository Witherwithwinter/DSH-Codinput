/**
 * 服务面 stash：ctx 属性直读要求 fiber inject 声明（工程事实 #2），
 * 统一在 apply 里 ctx.inject(...) 拿 scope 后存此处，组件只读 stash。
 */

import type {
  ClientContext,
  CommandUiFace,
  ConversationFace,
  ModelDirectoriesFace,
  SessionsFace,
  SidebarRightFace,
} from './host-types';
import { diagError, runGuarded } from './diag';
import { installI18n } from './i18n';

export interface ServiceStash {
  conversation?: ConversationFace;
  sessions?: SessionsFace;
  commandUi?: CommandUiFace;
  modelDirectories?: ModelDirectoriesFace;
  sidebarRight?: SidebarRightFace;
}

export const stash: ServiceStash = {};

export function installServices(ctx: ClientContext): void {
  // 消费 conversation 服务（本模块 inject 声明已含 'slots' 与 'conversation'）。
  runGuarded('stash.conversation', () => {
    ctx.inject(['conversation'], (scope: Record<string, unknown>) => {
      stash.conversation = scope['conversation'] as ConversationFace;
    });
  });

  // sessions / commandUi：被消费服务自身的 static inject 链由宿主装配。
  runGuarded('stash.services', () => {
    ctx.inject(['slots', 'sessions', 'commandUi'], (scope: Record<string, unknown>) => {
      stash.sessions = scope['sessions'] as SessionsFace;
      stash.commandUi = scope['commandUi'] as CommandUiFace;
    });
  });

  // 右侧栏控制器（小球唤回侧栏 Codinput 用）。与 sidebarRightTabs 同批
  // inject——侧栏标签注册已经用过这个组合，服务面存在即成功。
  runGuarded('stash.sidebarRight', () => {
    ctx.inject(['slots', 'sidebarRightTabs', 'sidebarRight'], (scope: Record<string, unknown>) => {
      stash.sidebarRight = scope['sidebarRight'] as SidebarRightFace;
    });
  });

  // 共享模型目录（官方 ui-model-selection 的服务）。工程事实 #2：必须连带
  // 声明被消费服务自身的 static inject 链（sessions/remote/remote.session）——
  // directoryFor/select 内部经 cordis accessor 读 remote.session，accessor
  // 校验的是调用方 fiber 的 inject 声明，缺了会抛 "without inject"。
  runGuarded('stash.modelDirectories', () => {
    ctx.inject(['modelDirectories', 'sessions', 'remote', 'remote.session'], (scope: Record<string, unknown>) => {
      stash.modelDirectories = scope['modelDirectories'] as ModelDirectoriesFace;
    });
  });

  // 文案国际化：宿主 locale 服务就绪后注册词典并绑定翻译函数。
  runGuarded('i18n.install', () => {
    ctx.inject(['locale'], (scope: Record<string, unknown>) => {
      installI18n(scope['locale']);
    });
  });
}

/** 服务缺席时统一报诊断口，不打断渲染。 */
export function requireService<K extends keyof ServiceStash>(name: K): ServiceStash[K] | undefined {
  const svc = stash[name];
  if (!svc) diagError('services', new Error(`service unavailable: ${String(name)}`));
  return svc;
}

export function safeCall(scope: string, fn: () => void): void {
  runGuarded(scope, fn);
}
