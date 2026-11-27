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
 *
 * 生命周期约定：所有重试定时器、槽位注册、全局事件监听、偏好/总线订阅
 * 与扩展注册均交由 `ctx.effect` 托管，确保热重载（`patchReload: live`）或
 * 插件禁用/卸载时不残留监听、定时器或样式/手势劫持。
 */

import { userMarkdownRegistrations, userTextMarkdownRegistration, userTextMarkdownRule } from './components/UserMessageMarkdown';
import type { ClientContext, UiConversationFace } from './host-types';
import { installServices } from './services';
import { setTakeoverActive, stopSeatAudit } from './seats';
import { injectStyles } from './styles';
import { diagError, diagWindow, runGuarded } from './diag';
import { loadPrefs, subscribePrefs } from './prefs';
import { isAnySidebarInputCarried, subscribeSidebarInput } from './sideinput';
import { barRegistration, CodinputBar } from './components/CodinputBar';
import { registerHeavyMarkdown } from './markdown/heavy';
import { sidebarBodyRegistration, sidebarTabDefinition, sidebarTitleRegistration } from './sidebar';
import { settingsRegistration } from './settings';
import { registerCodinputCommand } from './command';

export const name = 'dsh-codinput';

/** 客户端 inject：slots（槽位原语）+ conversation（输入机/会话装配）。 */
export const inject = ['slots', 'conversation'];

/**
 * 尝试注册；槽位未声明会 throw——短重试兜底，成功即停。
 * 返回可取消的清理函数（取消未到期定时器，并调用注册返回的 disposer）。
 */
function tryRegister(
  doRegister: () => (() => void) | void,
  label: string,
  attempts = 60,
): () => void {
  let cancelled = false;
  let timer = 0;
  let disposer: (() => void) | undefined;

  const attempt = (remaining: number): void => {
    if (cancelled) return;
    try {
      const off = doRegister();
      if (cancelled) {
        off?.();
        return;
      }
      disposer = typeof off === 'function' ? off : undefined;
      if (diagWindow().__dshCodinputShell[label] === undefined) {
        diagWindow().__dshCodinputShell[label] = 'registered';
      }
      return;
    } catch (error) {
      if (remaining <= 0) {
        diagError(label, error);
        diagWindow().__dshCodinputShell[label] = 'failed';
        return;
      }
    }
    timer = window.setTimeout(() => attempt(remaining - 1), 250);
  };

  attempt(attempts);
  return () => {
    cancelled = true;
    if (timer !== 0) {
      window.clearTimeout(timer);
      timer = 0;
    }
    const off = disposer;
    disposer = undefined;
    try {
      off?.();
    } catch (error) {
      diagError(`${label}.dispose`, error);
    }
  };
}

export function apply(ctx: ClientContext): void {
  injectStyles();
  installServices(ctx);
  // 未镜像座位的审计订阅随插件生命周期回收（热更新/卸载不残留监听）。
  ctx.effect(() => () => stopSeatAudit(), 'dsh-codinput: seat audit');

  // ---- Markdown 扩展渲染 heavy 扩展：代码高亮 / KaTeX / Mermaid（全内置离线）----
  runGuarded('md.heavy', () => {
    const disposeHeavy = registerHeavyMarkdown();
    diagWindow().__dshCodinputShell['md.heavy'] = 'registered';
    ctx.effect(() => disposeHeavy, 'dsh-codinput: md.heavy');
  });

  // 诊断：插件加载期即接管 console.error（应用首渲染在插件加载之后），
  // 抓取槽位边界的原始错误对象；卸载时若仍是本包装器则还原。
  runGuarded('console.hook', () => {
    const w = diagWindow() as unknown as Record<string, unknown> & { console: Console };
    if (w.__dshConsoleHooked) return;
    w.__dshConsoleHooked = true;
    const orig = w.console.error;
    const boundOrig = orig.bind(w.console);
    const wrapped = (...args: unknown[]): void => {
      const first = args.find((a) => a instanceof Error);
      if (first) {
        const errs = diagWindow().__dshCodinputErrs;
        errs.push(first);
        if (errs.length > 200) errs.splice(0, errs.length - 200);
      }
      boundOrig(...args);
    };
    w.console.error = wrapped;
    ctx.effect(
      () => () => {
        if (w.console.error === wrapped) w.console.error = orig;
        w.__dshConsoleHooked = false;
      },
      'dsh-codinput: console.error hook',
    );
  });

  // alpha 槽位：条目渲染崩溃会被「废黜」（本次注册周期内永久除名）。
  // 尽早挂 onEntryError 监听，把崩溃堆栈留给诊断口（仅记一条，避免重复堆积）。
  runGuarded('slots.entryErrorHook', () => {
    const slotsService = ctx.slots as unknown as Record<string, unknown>;
    const core = (slotsService._core ?? slotsService) as Record<string, unknown>;
    if (typeof core.onEntryError === 'function') {
      const off = (core.onEntryError as (fn: (info: Record<string, unknown>) => void) => (() => void) | void)((info) => {
        const err = info?.error as Error | undefined;
        diagError('slot.entry', err ?? info);
      });
      if (typeof off === 'function') {
        ctx.effect(() => off, 'dsh-codinput: slots.onEntryError');
      }
    }
  });

  // ---- 主输入接管：conversation.composer.bar（single，priority -1 遮蔽） ----
  // 挂载条件二选一：启用接管（渲染接管卡片），或有会话的输入被侧栏
  // Codinput 标签承载（渲染 null 以隐藏主输入，唯一输入组件约定）。
  const bar = barRegistration();
  let barDisposer: (() => void) | null = null;
  let cancelBarRetry: (() => void) | null = null;
  const mountBar = (): void => {
    if (barDisposer) return;
    barDisposer = ctx.slots.register(bar.options, CodinputBar);
    diagWindow().__dshCodinputShell['bar'] = 'mounted';
    setTakeoverActive(true);
  };
  const unmountBar = (): void => {
    cancelBarRetry?.();
    cancelBarRetry = null;
    const disposer = barDisposer;
    barDisposer = null;
    try {
      disposer?.();
      diagWindow().__dshCodinputShell['bar'] = 'unmounted';
      setTakeoverActive(false);
    } catch (error) {
      diagError('bar.dispose', error);
    }
  };
  const barWanted = (): boolean => loadPrefs().enabled || isAnySidebarInputCarried();
  const reconcileBar = (): void => {
    if (barWanted()) {
      if (!barDisposer && !cancelBarRetry) {
        let pending = true;
        const cancel = tryRegister(() => {
          if (barWanted()) mountBar();
          pending = false;
          cancelBarRetry = null;
        }, 'bar');
        if (pending) cancelBarRetry = cancel;
      }
    } else {
      unmountBar();
    }
  };
  reconcileBar();

  ctx.effect(() => {
    const offPrefs = subscribePrefs(reconcileBar);
    const offSide = subscribeSidebarInput(reconcileBar);
    return () => {
      offPrefs();
      offSide();
      unmountBar();
    };
  }, 'dsh-codinput: bar lifecycle');

  // ---- 用户消息 Markdown：0.2.2+ 优先 uiConversation.userText + conversation.user.text.node ----
  // 留出 conversation.chat.node（dsh-rewind 等外挂可继续包装官方 user 气泡）；
  // 旧 0.2.0 宿主无 uiConversation 时回退 conversation.chat.node（user / steering 遮蔽）。
  runGuarded('md.register', () => {
    const mdWanted = (): boolean => loadPrefs().userMarkdown;
    let userTextMode = false;
    let teardownLegacy: (() => void) | null = null;

    ctx.inject(['uiConversation'], (scope: Record<string, unknown>) => {
      const uiConv = scope['uiConversation'] as UiConversationFace | undefined;
      if (typeof uiConv?.userText?.register !== 'function') return;
      const registerRule = uiConv.userText.register.bind(uiConv.userText);
      userTextMode = true;
      teardownLegacy?.();
      teardownLegacy = null;
      diagWindow().__dshCodinputShell['md.mode'] = 'user-text';

      const textNodeSeat = userTextMarkdownRegistration();
      const rule = userTextMarkdownRule();
      let textNodeDisposer: (() => void) | null = null;
      let textNodeRetry: (() => void) | null = null;
      let ruleDisposer: (() => void) | null = null;

      const mountRule = (): void => {
        if (ruleDisposer || !textNodeDisposer || !mdWanted()) return;
        ruleDisposer = registerRule(rule);
        diagWindow().__dshCodinputShell['md.textRule'] = 'registered';
      };

      const unmountUserText = (): void => {
        // 先卸规则再卸节点槽，避免 UserText 在中间态把 node.id 当成无对应槽位的未知节点。
        const offRule = ruleDisposer;
        ruleDisposer = null;
        try {
          offRule?.();
          if (offRule) diagWindow().__dshCodinputShell['md.textRule'] = 'unmounted';
        } catch (error) {
          diagError('md.textRule.dispose', error);
        }
        textNodeRetry?.();
        textNodeRetry = null;
        const offNode = textNodeDisposer;
        textNodeDisposer = null;
        try {
          offNode?.();
          if (offNode) diagWindow().__dshCodinputShell['md.textNode'] = 'unmounted';
        } catch (error) {
          diagError('md.textNode.dispose', error);
        }
      };

      const reconcileUserText = (): void => {
        if (mdWanted()) {
          if (textNodeDisposer) {
            mountRule();
            return;
          }
          if (!textNodeRetry) {
            let pending = true;
            const cancel = tryRegister(() => {
              if (!mdWanted()) {
                pending = false;
                textNodeRetry = null;
                return;
              }
              textNodeDisposer = ctx.slots.register(textNodeSeat.options, textNodeSeat.component);
              diagWindow().__dshCodinputShell['md.textNode'] = 'mounted';
              pending = false;
              textNodeRetry = null;
              mountRule();
            }, 'md.textNode');
            if (pending) textNodeRetry = cancel;
          }
        } else {
          unmountUserText();
        }
      };

      reconcileUserText();
      ctx.effect(() => {
        const offPrefs = subscribePrefs(reconcileUserText);
        return () => {
          offPrefs();
          unmountUserText();
        };
      }, 'dsh-codinput: user markdown lifecycle');
    });

    if (!userTextMode) {
      diagWindow().__dshCodinputShell['md.mode'] = 'chat-node';
      const mdSeats = userMarkdownRegistrations();
      const mdMounted = new Map<string, () => void>();
      const mdRetries = new Map<string, () => void>();
      const mountMdSeat = (seat: (typeof mdSeats)[number]): void => {
        const key = seat.options.key ?? '';
        if (mdMounted.has(key) || !mdWanted()) return;
        mdMounted.set(key, ctx.slots.register(seat.options, seat.component));
        diagWindow().__dshCodinputShell[`md.${key}`] = 'mounted';
      };
      const unmountMdSeat = (key: string): void => {
        mdRetries.get(key)?.();
        mdRetries.delete(key);
        const disposer = mdMounted.get(key);
        if (!disposer) return;
        mdMounted.delete(key);
        try {
          disposer();
          diagWindow().__dshCodinputShell[`md.${key}`] = 'unmounted';
        } catch (error) {
          diagError('md.dispose', error);
        }
      };
      const reconcileMd = (): void => {
        for (const seat of mdSeats) {
          const key = seat.options.key ?? '';
          if (mdWanted()) {
            if (!mdMounted.has(key) && !mdRetries.has(key)) {
              let pending = true;
              const cancel = tryRegister(() => {
                mountMdSeat(seat);
                pending = false;
                mdRetries.delete(key);
              }, `md.${key}`);
              if (pending) mdRetries.set(key, cancel);
            }
          } else {
            unmountMdSeat(key);
          }
        }
      };
      reconcileMd();
      const offPrefs = subscribePrefs(reconcileMd);
      let disposed = false;
      teardownLegacy = () => {
        if (disposed) return;
        disposed = true;
        offPrefs();
        for (const seat of mdSeats) unmountMdSeat(seat.options.key ?? '');
      };
      ctx.effect(() => teardownLegacy ?? undefined, 'dsh-codinput: user markdown legacy lifecycle');
    }
  });

  // ---- 侧边模式：sidebarRightTabs 三段式注册（dockkit 承担停靠/浮动） ----
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
      const disposeBody = tryRegister(() => ctx.slots.register(body.options, body.component), 'sidebar.body');
      ctx.effect(() => disposeBody, 'dsh-codinput: sidebar.body');
      // chip 标题（品牌标 + 标签名）：官方 FilesTitle 同构的 keyed 注册。
      const title = sidebarTitleRegistration();
      const disposeTitle = tryRegister(() => ctx.slots.register(title.options, title.component), 'sidebar.title');
      ctx.effect(() => disposeTitle, 'dsh-codinput: sidebar.title');
    });
  });

  // ---- 设置 → Codinput 分组（settings.section 必须带 label/order） ----
  runGuarded('settings.register', () => {
    const settings = settingsRegistration();
    const disposeSettings = tryRegister(() => ctx.slots.register(settings.options, settings.component), 'settings');
    ctx.effect(() => disposeSettings, 'dsh-codinput: settings');
  });

  // ---- /codinput 命令：官方命令通道的 action 贡献（进入/退出接管） ----
  registerCodinputCommand(ctx);

  // ---- 去掉 dockkit「拖动标签页→浮动/换位」手势（产品决策 2026-09-20：
  // 悬浮只经主输入卡片拖动区进入）。capture 相位拦掉 tab chip 的
  // pointerdown，dockkit 的 press→drag 追踪不再启动；点击激活走独立
  // click 事件、关闭按钮有专属 pointerdown 处理，均不受影响。
  // 生命周期绑定到 ctx.effect：卸载插件即恢复宿主原手势。 ----
  runGuarded('draggate.install', () => {
    const onPointerDown = (event: PointerEvent): void => {
      if (!(event.target instanceof Element)) return;
      if (event.target.closest('[data-dockkit-tab-close]')) return;
      if (event.target.closest('[data-dockkit-tab]')) event.stopPropagation();
    };
    document.addEventListener('pointerdown', onPointerDown, { capture: true });
    ctx.effect(
      () => () => {
        document.removeEventListener('pointerdown', onPointerDown, { capture: true });
      },
      'dsh-codinput: dockkit drag gate',
    );
  });

  // ---- 诊断口 ----
  runGuarded('diag.boot', () => {
    diagWindow().__dshCodinputShell['apply'] = 'done';
    (window as unknown as Record<string, unknown>)['__dshCodinputCtx'] = ctx;
  });
}

export { CodinputBar };
