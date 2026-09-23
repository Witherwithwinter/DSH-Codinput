/**
 * dsh-codinput 客户端模块入口。
 *
 * 客户端产物为 esbuild bundle + cjs，banner/footer 包成
 * window.__ModuleLoader__.load({ id, factory })；模块导出 name / inject /
 * apply（docs/idea.md 附录工程要点）。
 *
 * 注册时序：第三方插件装载在宿主之后，目标槽位通常已声明——
 * slots.inject 锚点只对「声明晚于本插件」的场景触发，因此这里用
 * 直接注册 + 未声明短重试（槽位声明可能晚于首个 attempt 时仍兜底）。
 */

import type { ClientContext } from './host-types';
import { installServices } from './services';
import { injectStyles } from './styles';
import { diagError, diagWindow, runGuarded } from './diag';
import { loadPrefs, subscribePrefs } from './prefs';
import { isAnySidebarInputCarried, subscribeSidebarInput } from './sideinput';
import { barRegistration, CodinputBar } from './components/CodinputBar';
import { sidebarBodyRegistration, sidebarTabDefinition } from './sidebar';
import { settingsRegistration } from './settings';
import { registerCodinputCommand } from './command';

export const name = 'dsh-codinput';

/** 客户端 inject：slots（槽位原语）+ conversation（输入机/会话装配）。 */
export const inject = ['slots', 'conversation'];

/** 尝试注册；槽位未声明会 throw——短重试兜底，成功即停。 */
function tryRegister(doRegister: () => void, label: string, attempts = 60): void {
  try {
    doRegister();
    diagWindow().__dshCodinputShell[label] = 'registered';
    return;
  } catch (error) {
    if (attempts <= 0) {
      diagError(label, error);
      diagWindow().__dshCodinputShell[label] = 'failed';
      return;
    }
  }
  setTimeout(() => tryRegister(doRegister, label, attempts - 1), 250);
}

export function apply(ctx: ClientContext): void {
  injectStyles();
  installServices(ctx);

  // 诊断：插件加载期即接管 console.error（应用首渲染在插件加载之后），
  // 抓取槽位边界的原始错误对象。
  runGuarded('console.hook', () => {
    const w = diagWindow() as unknown as Record<string, unknown> & { console: Console };
    if (!(w as Record<string, unknown>).__dshConsoleHooked) {
      (w as Record<string, unknown>).__dshConsoleHooked = true;
      const orig = w.console.error.bind(w.console);
      w.console.error = (...args: unknown[]): void => {
        const first = args.find((a) => a instanceof Error);
        if (first) (w.__dshCodinputErrs as unknown as Error[]).push(first as Error);
        orig(...args);
      };
    }
  });

  // alpha 槽位：条目渲染崩溃会被「废黜」（本次注册周期内永久除名）。
  // 尽早挂 onEntryError 监听，把崩溃堆栈留给诊断口。
  runGuarded('slots.entryErrorHook', () => {
    const slotsService = ctx.slots as unknown as Record<string, unknown>;
    const core = (slotsService._core ?? slotsService) as Record<string, unknown>;
    if (typeof core.onEntryError === 'function') {
      (core.onEntryError as (fn: (info: Record<string, unknown>) => void) => void)((info) => {
        const err = info?.error as Error | undefined;
        diagError('slot.entry', err ?? info);
        diagWindow().__dshCodinputErrs.push(
          err instanceof Error ? err : new Error(JSON.stringify(info).slice(0, 800)),
        );
      });
    }
  });

  // ---- 主输入接管：conversation.composer.bar（single，priority -1 遮蔽） ----
  // 挂载条件二选一：启用接管（渲染接管卡片），或有会话的输入被侧栏
  // Codinput 标签承载（渲染 null 以隐藏主输入，唯一输入组件约定）。
  const bar = barRegistration();
  let barDisposer: (() => void) | null = null;
  const mountBar = (): void => {
    if (barDisposer) return;
    try {
      barDisposer = ctx.slots.register(bar.options, CodinputBar);
      diagWindow().__dshCodinputShell['bar'] = 'mounted';
    } catch (error) {
      diagError('bar.register', error);
    }
  };
  const unmountBar = (): void => {
    const disposer = barDisposer;
    barDisposer = null;
    try {
      disposer?.();
      diagWindow().__dshCodinputShell['bar'] = 'unmounted';
    } catch (error) {
      diagError('bar.dispose', error);
    }
  };
  const barWanted = (): boolean => loadPrefs().enabled || isAnySidebarInputCarried();
  const reconcileBar = (): void => {
    if (barWanted()) mountBar();
    else unmountBar();
  };
  tryRegister(() => {
    if (barWanted()) mountBar();
  }, 'bar');

  runGuarded('bar.prefs', () => {
    subscribePrefs(reconcileBar);
  });

  // 侧栏标签挂载/卸载：入口（prefs 关闭时也要为隐藏主输入而挂载）与出口
  // （标签关闭后把主输入还给官方）。侧栏收起时小球由接管条目自己 portal
  // 渲染（见 components/ExpandBall），不占官方槽位。
  runGuarded('bar.sideinput', () => {
    subscribeSidebarInput(reconcileBar);
  });

  // ---- 侧边模式：sidebarRightTabs 两段式注册（dockkit 承担停靠/浮动） ----
  runGuarded('sidebar.register', () => {
    ctx.inject(['slots', 'sidebarRightTabs', 'sidebarRight'], (scope: Record<string, unknown>) => {
      const tabs = scope['sidebarRightTabs'] as { register(def: Record<string, unknown>): () => void } | undefined;
      if (typeof tabs?.register !== 'function') {
        diagError('sidebar', new Error('sidebarRightTabs unavailable'));
        return;
      }
      const body = sidebarBodyRegistration();
      // 标签类型定义 ride 调用方 fiber（官方约定：disposer 交 ctx.effect 持有）。
      ctx.effect(() => tabs.register(sidebarTabDefinition()), 'dsh-codinput: sidebar tab type');
      tryRegister(() => {
        ctx.slots.register(body.options, body.component);
      }, 'sidebar.body');
    });
  });

  // ---- 设置 → Codinput 分组（settings.section 必须带 label/order） ----
  runGuarded('settings.register', () => {
    const settings = settingsRegistration();
    tryRegister(() => {
      ctx.slots.register(settings.options, settings.component);
    }, 'settings');
  });

  // ---- /codinput 命令：官方命令通道的 action 贡献（进入/退出接管） ----
  registerCodinputCommand(ctx);

  // ---- 去掉 dockkit「拖动标签页→浮动/换位」手势（产品决策 2026-09-20：
  // 悬浮只经主输入卡片 pin 按钮进入）。capture 相位拦掉 tab chip 的
  // pointerdown，dockkit 的 press→drag 追踪不再启动；点击激活走独立
  // click 事件、关闭按钮有专属 pointerdown 处理，均不受影响。 ----
  runGuarded('draggate.install', () => {
    const w = window as unknown as { __dshCodinputDragGate?: boolean };
    if (w.__dshCodinputDragGate) return;
    w.__dshCodinputDragGate = true;
    document.addEventListener(
      'pointerdown',
      (event) => {
        if (!(event.target instanceof Element)) return;
        if (event.target.closest('[data-dockkit-tab-close]')) return;
        if (event.target.closest('[data-dockkit-tab]')) event.stopPropagation();
      },
      { capture: true },
    );
  });

  // ---- 诊断口 ----
  runGuarded('diag.boot', () => {
    diagWindow().__dshCodinputShell['apply'] = 'done';
    (window as unknown as Record<string, unknown>)['__dshCodinputCtx'] = ctx;
  });
}

export { CodinputBar };
