/**
 * 侧边模式：官方 Sidebar（dockkit）标签页承载，入口与标签芯片同名
 * 「Codinput」。两段式注册——sidebarRightTabs.register（类型定义）+
 * sidebar.right.pane.tab（keyed，key = 定义 id）。停靠、分栏、全屏、
 * 浮动由官方 dockkit 承担；侧栏与主输入读写同一台输入机，草稿天然同源。
 *
 * 唯一输入组件约定：body **挂载**期间经 sideinput 总线声明承载本会话
 * 输入（形态 = side），主输入遮蔽条目随之隐藏——收起侧栏不让位（可见性
 * 只用于判断「需不需要右上角小球唤出」）。标签关闭（body 卸载）后撤销
 * 声明，主输入原样恢复。
 */

import { useEffect, useRef, useState } from 'react';
import type { SessionStandard, SidebarTabInfo, SlotRegisterOptions } from './host-types';
import { claimSidebarInput, useSidebarCarryOwner, type SidebarCarry } from './sideinput';
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
  const { sessionId, useInput, inputActions, useProjection, useTabInfo } = props;
  const state = useInput((s) => s);
  useT();
  // 注入 hook 的有无逐渲染稳定（渲染器 useMemo 绑定），条件调用合规。
  const info = useTabInfo ? useTabInfo() : undefined;
  const visible = info?.tab.visible === true;
  const expanded = info?.sidebar.expanded === true;

  // 承载声明挂在 body 生命周期上（挂载即承载，与可见性无关）；可见性与
  // 侧栏展开态随后续渲染实时上报（小球据此判断「已收起」）。
  const carryRef = useRef<SidebarCarry | null>(null);
  const [token, setToken] = useState(0);
  useEffect(() => {
    const carry = claimSidebarInput(sessionId, { visible, expanded });
    carryRef.current = carry;
    setToken(carry.token);
    return () => {
      carryRef.current = null;
      carry.release();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);
  useEffect(() => {
    carryRef.current?.set({ visible, expanded });
  }, [visible, expanded]);

  // 同一会话被复制出第二个 Codinput 标签（分栏）时，只有最早声明的 body
  // 渲染编辑面——输入入口唯一，另一个 body 出提示而不是第二个编辑器。
  const owner = useSidebarCarryOwner(sessionId, token);
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
        side={true}
      />
    </div>
  );
}
