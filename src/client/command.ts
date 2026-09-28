/**
 * /codinput 命令与「添加 · 文件」补位：经官方命令通道注册的 action 型客户端
 * 贡献。
 *
 * /codinput：输入回车即切换接管（进入/退出），菜单描述随当前状态变化；接管
 * 关闭（官方输入框）时输入同样生效——贡献注册是全局生命周期。菜单拾取路径
 * 会把 "/codinput" 插进草稿而不提交，切换后需清空当前草稿。侧栏里发起的退
 * 出会经总线请求 body 关掉自己的标签（见 sideinput）。
 *
 */

import type { ClientContext } from './host-types';
import { stash } from './services';
import { loadPrefs, savePrefs, subscribePrefs } from './prefs';
import { carriedSessionIds, requestSidebarTabClose } from './sideinput';
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

/**
 * 单行搬移：把 name 的行移动到 locate 给出的目标下标（其余行原序不动）。
 * 官方空查询走 sectionRows（「添加/指令」按使用序固定节构），贡献默认追加
 * 在「指令」节尾——整列排序会把小节排散、节头重复渲染，只能单行搬。
 */
function moveRow<T extends { name: string }>(list: readonly T[], name: string, locate: (rows: readonly T[]) => number): T[] {
  const at = list.findIndex((row) => row.name === name);
  if (at === -1) return [...list];
  const target = locate(list);
  if (target === at || target === at + 1) return [...list];
  const moved = [...list];
  moved.splice(at, 1);
  moved.splice(target > at ? target - 1 : target, 0, list[at]);
  return moved;
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
      // 指令栏位置：codinput 按字典序插到「指令」节内第一个 name 大于它的行
      // 之前（codinput < compact → 节首）；file 补位插到「添加」节首（官方
      // 使用序里 file 排该节第一——节名是本地化的，用同节已知行反查）。
      let restoreOrder: (() => void) | undefined;
      if (typeof commandUi.candidates === 'function') {
        const original = commandUi.candidates.bind(commandUi);
        commandUi.candidates = (session: unknown, req: { query: string }) =>
          Promise.resolve(original(session, req)).then((rows) => {
            if (req.query !== '' || !Array.isArray(rows)) return rows;
            let list = rows as { name: string; section?: string }[];
            const addSection = list.find((row) => row.name === 'goal' || row.name === 'plan' || row.name === 'feedback')?.section;
            if (addSection !== undefined) {
              list = moveRow(list, 'file', (all) => {
                const first = all.findIndex((row) => row.section === addSection && row.name !== 'file');
                return first === -1 ? all.length : first;
              });
            }
            list = moveRow(list, 'codinput', (all) => {
              const own = all.find((row) => row.name === 'codinput');
              const first = all.findIndex(
                (row) => row.section === own?.section && row.name !== 'codinput' && row.name.toLowerCase() > 'codinput',
              );
              return first === -1 ? all.length : first;
            });
            return list;
          });
        restoreOrder = () => {
          commandUi.candidates = original;
        };
      }
      ctx.effect(() => restoreOrder, 'dsh-codinput: slash order patch');
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
                // 侧栏里发起的退出：关掉承载会话的 Codinput 标签（body 经
                // tab 域 actions.close 关闭、卸载撤销承载），主输入回到官方
                // 输入框。承载会话从总线查——诊断 sessionId 可能为 null。
                if (!loadPrefs().enabled) {
                  for (const carried of carriedSessionIds()) requestSidebarTabClose(carried);
                }
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
