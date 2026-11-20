/**
 * /codinput 命令与「添加 · 文件」补位：经官方命令通道注册的 action 型客户端
 * 贡献。
 *
 * /codinput：输入回车即切换接管（进入/退出），菜单描述随当前状态变化；接管
 * 关闭（官方输入框）时输入同样生效——贡献注册是全局生命周期。命令 token 由
 * 宿主 consume-token 通道消费；插件只在残留时兜底剥离 token 本身，绝不整体
 * 清空草稿（否则「先有草稿再 /codinput 退出」会丢草稿）。侧栏里发起的退出会
 * 经总线请求 body 关掉自己的标签（见 sideinput）。
 */

import type { ClientContext } from './host-types';
import { stash } from './services';
import { loadPrefs, savePrefs } from './prefs';
import { carriedSessionIds, requestSidebarTabClose } from './sideinput';
import { t } from './i18n';
import { IconCodinputCommand16 } from './icons';
import { diagWindow, runGuarded } from './diag';

/** `/codinput` 命令 token 的规范拼写（宿主命令名即 `codinput`）。 */
const COMMAND_TOKEN = '/codinput';

/**
 * 清理 `/codinput` 命令 token 的残留，**只剥 token，不碰草稿其余内容**。
 *
 * 沿用宿主 bare-token guard 的判据：只有「token 本身」或「token 后跟空白」
 * 才当作命令 token 处理；"/codinputX" 这类真的用户文本不动。清理后余下的
 * 用户内容原样保留。
 */
function stripCommandToken(sessionId: string | undefined): void {
  if (!sessionId) return;
  try {
    const actx = stash.sessions?.scope(sessionId);
    if (!actx || !stash.conversation) return;
    const input = stash.conversation.input.for(actx);
    const draft = input.state?.getSnapshot?.().draft ?? '';
    const leading = draft.replace(/^\s+/, '');
    if (!leading.toLowerCase().startsWith(COMMAND_TOKEN)) return;
    const rest = leading.slice(COMMAND_TOKEN.length);
    // 宿主命令 token 语法：token 必须以行尾/空白收尾。
    if (rest !== '' && !/^\s/.test(rest)) return;
    const next = rest.replace(/^\s+/, '');
    if (next !== draft) input.setDraft(next);
  } catch {
    /* 会话作用域不可达时忽略（退出接管本身不受影响） */
  }
}

/**
 * 单行搬移：把 name 的行移动到 locate 给出的目标下标（其余行原序不动）。
 * 官方空查询走 sectionRows（「添加/指令」按使用序固定节构），贡献默认追加
 * 在「指令」节尾——整列排序会把小节排散、节头重复渲染，只能单行搬。
 */
function moveRow<T extends { name: string }>(
  list: readonly T[],
  name: string,
  locate: (rows: readonly T[]) => number,
): T[] {
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
        const hadOwn = Object.prototype.hasOwnProperty.call(commandUi, 'candidates');
        const original = commandUi.candidates;
        const patched = (session: unknown, req: { query: string }) =>
          Promise.resolve(original.call(commandUi, session, req)).then((rows) => {
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
        commandUi.candidates = patched;
        restoreOrder = () => {
          // 仅当仍是本插件挂的包装器时才还原，避免覆盖后装载插件的补丁；
          // 原方法来自原型链时直接 delete，避免在实例上残留遮蔽属性。
          if (commandUi.candidates !== patched) return;
          if (hadOwn) commandUi.candidates = original;
          else delete commandUi.candidates;
        };
      }
      ctx.effect(() => restoreOrder, 'dsh-codinput: slash order patch');
      ctx.effect(
        () =>
          commandUi.register({
            name: 'codinput',
            description: () => (loadPrefs().enabled ? t('cmd.exit') : t('cmd.enter')),
            // 官方命令菜单 glyph：icon 为 React 组件，菜单按 <icon size={16}/> 渲染。
            icon: IconCodinputCommand16,
            available: () => true,
            ui: {
              kind: 'action',
              run: () => {
                // 卸载会清掉诊断 sessionId，先捕获（清理必须在卸载前做完，
                // 否则官方输入框挂载时就会带上残留 token）。
                const sessionId = diagWindow().__dshCodinputSessionId ?? undefined;
                stripCommandToken(sessionId);
                const next = savePrefs({ enabled: !loadPrefs().enabled });
                // 侧栏里发起的退出：关掉承载会话的 Codinput 标签（body 经
                // tab 域 actions.close 关闭、卸载撤销承载），主输入回到官方
                // 输入框。承载会话从总线查——诊断 sessionId 可能为 null。
                if (!next.enabled) {
                  for (const carried of carriedSessionIds()) requestSidebarTabClose(carried);
                }
              },
            },
          }),
        'dsh-codinput: /codinput contribution',
      );
      diagWindow().__dshCodinputShell['command'] = 'registered';
    });
  });
}
