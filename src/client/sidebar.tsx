/**
 * 侧边模式：官方 Sidebar（dockkit）标签页承载，入口与标签芯片同名
 * 「Codinput」。两段式注册——sidebarRightTabs.register（类型定义）+
 * sidebar.right.pane.tab（keyed，key = 定义 id）。停靠、分栏、全屏、
 * 浮动由官方 dockkit 承担；侧栏与主输入读写同一台输入机，草稿天然同源。
 *
 * 唯一输入组件约定：body **挂载**期间经 sideinput 总线声明承载本会话
 * 输入（形态 = side），主输入遮蔽条目随之隐藏——收起侧栏不让位（可见性
 * 只用于判断「需不需要右上角小球唤出」）。声明以 prefs.enabled 为前提：
 * 侧边模式下 /codinput 关闭接管即撤销声明、主输入回到官方输入框，标签
 * 内只出提示；重新开启自动恢复。标签关闭（body 卸载）后撤销声明，主输入
 * 原样恢复。
 */

import { useEffect, useRef, useState } from 'react';
import type { SessionStandard, SidebarTabInfo, SlotRegisterOptions } from './host-types';
import { claimSidebarInput, subscribeSidebarTabClose, useSidebarCarryOwner, type SidebarCarry } from './sideinput';
import { loadPrefs, savePrefs, subscribePrefs } from './prefs';
import { diagError, diagWindow } from './diag';
import { CodinputSurface } from './components/CodinputSurface';
import { t, useT } from './i18n';

export const SIDEBAR_TAB_ID = 'dsh-codinput';
export const SIDEBAR_TAB_KIND = 'codinput';

/** 第一段：标签类型定义（页面型：无 patterns，经指南页打开）。 */
export function sidebarTabDefinition(): Record<string, unknown> {
  return {
    id: SIDEBAR_TAB_ID,
    kind: SIDEBAR_TAB_KIND,
    priority: 'extension',
    title: () => 'Codinput',
    // 非激活也保持 body 挂载（官方浏览器标签同款开关）：承载声明挂在 body
    // 生命周期上，若切到同栏其他标签（如工作区文件）body 被 dockkit 卸载，
    // 声明随之消失、主输入回来——「标签存在即唯一输入入口」就不成立了。
    keepMounted: true,
    guide: [
      {
        order: 0,
        title: () => 'Codinput',
        description: () => t('side.guideDesc'),
      },
    ],
  };
}

/** 第二段：keyed 槽位 body 注册选项与组件（key = 定义 id）。 */
export function sidebarBodyRegistration(): { options: SlotRegisterOptions; component: unknown } {
  return {
    options: {
      name: 'sidebar.right.pane.tab',
      key: SIDEBAR_TAB_ID,
      registrant: 'dsh-codinput',
    },
    component: SidebarCodinputBody,
  };
}

/**
 * session 槽位标准 props 直达官方输入机。useTabInfo 是槽位声明的注入
 * hook（宿主按 use<Name> 约定随 props 下发，缺席说明宿主形状漂移——
 * 此时按 visible=false 处理，退回「不隐藏主输入」的旧行为）。
 * useTabInfo 内部订阅 dockkit store，展开/激活/浮动变化都会重渲染。
 */
export function SidebarCodinputBody(props: SessionStandard & { useTabInfo?: () => SidebarTabInfo }): JSX.Element {
  const { sessionId, useInput, inputActions, useProjection, useSession, useTabInfo } = props;
  const state = useInput((s) => s);
  // 会话运行中：侧栏形态的主按钮同样变停止（官方同款）。
  const running = useSession ? useSession((s: unknown) => (s as { running?: boolean } | undefined)?.running) === true : false;
  useT();
  // 注入 hook 的有无逐渲染稳定（渲染器 useMemo 绑定），条件调用合规。
  const info = useTabInfo ? useTabInfo() : undefined;
  const visible = info?.tab.visible === true;
  const expanded = info?.sidebar.expanded === true;

  // /codinput 从侧栏退出 → 命令侧广播关闭请求，这里经 tab 域动作面的
  // actions.close() 关掉自己的标签。关闭即卸载 body、撤销承载，主输入按
  // 退出后的 prefs 恢复官方输入框。
  const closeSelf = info?.tab.actions?.close;
  const closeRef = useRef(closeSelf);
  closeRef.current = closeSelf;
  // 诊断：tabId/关闭面是否可得（宿主形状漂移时链路断在哪一目了然）。
  useEffect(() => {
    const shell = diagWindow().__dshCodinputShell;
    shell['sidebar.tabId'] = info?.tab.id ?? 'none';
    shell['sidebar.closeFace'] = closeSelf ? 'yes' : 'none';
  }, [info, closeSelf]);
  useEffect(() => {
    return subscribeSidebarTabClose((requested) => {
      if (requested !== sessionId || !closeRef.current) return;
      try {
        closeRef.current();
      } catch (error) {
        diagError('sidebar.closeTab', error);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // 接管开关是承载的前提：侧边模式下输入 /codinput（或设置里关闭）要能
  // 退回官方输入框——body 撤销承载声明（主输入位随之恢复），标签里只出
  // 提示；重新开启后自动恢复侧栏形态。
  const [enabled, setEnabled] = useState(() => loadPrefs().enabled);
  useEffect(() => subscribePrefs(() => setEnabled(loadPrefs().enabled)), []);
  // 打开标签即启用：body 挂载（首次激活/重载后激活/关掉重开）时若接管
  // 未开，直接开启——用户点开这个标签就是要用它。body 在 keepMounted 下
  // 常驻，/codinput 退出后不会重挂，不会把退出顶回去。
  const bootRef = useRef(false);
  useEffect(() => {
    if (bootRef.current) return;
    bootRef.current = true;
    if (!loadPrefs().enabled) savePrefs({ enabled: true });
  }, []);

  // 承载声明挂在 body 生命周期上（挂载即承载，与可见性无关），但以
  // enabled 为前提；可见性与侧栏展开态随后续渲染实时上报（小球据此
  // 判断「已收起」）。
  const carryRef = useRef<SidebarCarry | null>(null);
  const [token, setToken] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const carry = claimSidebarInput(sessionId, { visible, expanded });
    carryRef.current = carry;
    setToken(carry.token);
    return () => {
      carryRef.current = null;
      carry.release();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, enabled]);
  useEffect(() => {
    carryRef.current?.set({ visible, expanded });
  }, [visible, expanded]);

  // 同一会话被复制出第二个 Codinput 标签（分栏）时，只有最早声明的 body
  // 渲染编辑面——输入入口唯一，另一个 body 出提示而不是第二个编辑器。
  const owner = useSidebarCarryOwner(sessionId, token);
  if (!enabled) {
    return (
      <div className="dci-side-notice" role="note">
        {t('side.disabled')}
      </div>
    );
  }
  if (!owner) {
    return (
      <div className="dci-side-notice" role="note">
        {t("side.notice")}
      </div>
    );
  }

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <CodinputSurface
        sessionId={sessionId}
        state={state}
        actions={inputActions}
        useProjection={useProjection}
        running={running}
        side={true}
      />
    </div>
  );
}
