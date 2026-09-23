/**
 * /codinput 命令：经官方命令通道注册的 action 型客户端贡献。
 * 输入 /codinput 回车即切换接管（进入/退出），菜单描述随当前状态变化。
 * 接管关闭（官方输入框）时输入同样生效——贡献注册是全局生命周期。
 * 菜单拾取路径会把 "/codinput" 插进草稿而不提交，切换后需清空当前草稿。
 */

import type { ClientContext } from './host-types';
import { stash } from './services';
import { loadPrefs, savePrefs } from './prefs';
import { t } from './i18n';
import { IconCodinputCommand16 } from './icons';
import { diagWindow, runGuarded } from './diag';

function clearDraftOf(sessionId: string | undefined): void {
  if (!sessionId) return;
  try {
    const actx = stash.sessions?.scope(sessionId);
    if (actx && stash.conversation) stash.conversation.input.for(actx).setDraft('');
  } catch {
    /* 会话作用域不可达时忽略（提交路径本就会清空草稿） */
  }
}

export function registerCodinputCommand(ctx: ClientContext): void {
  runGuarded('command.register', () => {
    ctx.inject(['commandUi'], (scope: Record<string, unknown>) => {
      const commandUi = scope['commandUi'] as {
        register(contribution: Record<string, unknown>): () => void;
        candidates?(session: unknown, req: { query: string }): Promise<unknown[]>;
      } | undefined;
      if (typeof commandUi?.register !== 'function') {
        diagWindow().__dshCodinputShell['command'] = 'commandUi-unavailable';
        return;
      }
      // 指令栏字典序：官方 rankByName 在空查询时保持「宿主列表 + 贡献注册序」，
      // 贡献的 /codinput 会被排在末尾。这里包装 candidates，仅在空查询（完整
      // 指令栏）时按名称字典序排序；非空查询保留官方的相关性排序。
      let restoreOrder: (() => void) | undefined;
      if (typeof commandUi.candidates === 'function') {
        const original = commandUi.candidates.bind(commandUi);
        commandUi.candidates = (session: unknown, req: { query: string }) =>
          Promise.resolve(original(session, req)).then((rows) => {
            if (req.query !== '' || !Array.isArray(rows)) return rows;
            return [...(rows as { name: string }[])].sort((a, b) =>
              a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
            );
          });
        restoreOrder = () => {
          commandUi.candidates = original;
        };
      }
      ctx.effect(() => restoreOrder, 'dsh-codinput: dictionary order patch');
      ctx.effect(
        () =>
          commandUi.register({
            name: 'codinput',
            description: () =>
              loadPrefs().enabled ? t('cmd.exit') : t('cmd.enter'),
            // 官方命令菜单 glyph：icon 为 React 组件，菜单按 <icon size={16}/> 渲染。
            icon: IconCodinputCommand16,
            available: () => true,
            ui: {
              kind: 'action',
              run: () => {
                // 卸载会清掉诊断 sessionId，先捕获再延迟清草稿。
                const sessionId = diagWindow().__dshCodinputSessionId ?? undefined;
                savePrefs({ enabled: !loadPrefs().enabled });
                setTimeout(() => clearDraftOf(sessionId), 80);
              },
            },
          }),
        'dsh-codinput: /codinput contribution',
      );
      diagWindow().__dshCodinputShell['command'] = 'registered';
    });
  });
}
