/**
 * 宿主服务面的本地结构类型。
 *
 * 插件对宿主零运行时依赖（模块表只认平台种子词与包工厂），这里的类型按
 * @deepseek-ai 0.1.5-rc.1 公开契约（.d.ts）抄录我们实际消费的最小切面；
 * 运行时全部为鸭子类型，形状漂移只影响功能降级，不会崩插件。
 */

// ---------- cordis ----------

export interface HostObservable<T> {
  getSnapshot(): T;
  subscribe(fn: () => void): () => void;
}

export interface ClientContext {
  /** 属性读取要求 fiber inject 声明；只通过 ctx.inject(...) 的 scope 消费。 */
  inject(services: readonly string[], fn: (scope: any) => void): void;
  effect(fn: () => (() => void) | void, label?: string): void;
  plugin(impl: unknown, config?: unknown): void;
  get(name: string): unknown;
  /** 客户端模块 inject 声明后可读（['slots', 'conversation']）。 */
  slots: SlotsService;
}

// ---------- slots ----------

export interface SlotRegisterOptions {
  name: string;
  key?: string;
  id?: string;
  order?: number;
  label?: string | (() => string);
  /** single/keyed/list：遮蔽秩，升序、最低者渲染。 */
  priority?: number;
  children?: Record<string, unknown>;
  inject?: (...args: unknown[]) => Record<string, unknown>;
  store?: unknown;
  locale?: string;
  registrant?: string;
}

export interface SlotsService {
  register(options: SlotRegisterOptions, component: unknown): () => void;
  /** 锚定槽位：当该槽被声明时运行工厂；工厂 yield 掉的可清理返回值统一登记生命周期。 */
  inject(slotName: string, factory: () => Generator<unknown> | (() => unknown)): void;
}

// ---------- input machine ----------

export type DraftAttachmentId = string;
export type InputPhase = 'plain' | 'adjudicating' | 'claimed' | 'submitting';

export interface InputState {
  readonly draft: string;
  readonly attachmentIds: readonly DraftAttachmentId[];
  readonly draftRev: number;
  readonly phase: InputPhase;
  readonly claim?: { readonly token: string; readonly hint?: string; readonly attachments?: boolean };
  readonly queue: readonly unknown[];
}

export interface InputActions {
  setDraft(text: string): void;
  addAttachments(ids: readonly DraftAttachmentId[]): boolean;
  removeAttachment(id: DraftAttachmentId): void;
  pruneAttachments(ids: readonly DraftAttachmentId[]): void;
  submit(): void;
}

export interface EditSelection {
  readonly start: number;
  readonly end: number;
}

export interface ComposerKeyboard {
  readonly snapshot: InputState;
  submit(mode: string): void;
  steerQueue(): void;
  paste(text: string): void;
  caretSpan(): EditSelection;
  arbitrate(key: string, composing: boolean): 'consumed' | 'pick-highlighted' | 'pass';
  space(): boolean;
  dismissPopup(): void;
}

// ---------- slash trigger pipeline ----------

export interface TokenSpan {
  readonly start: number;
  readonly end: number;
  readonly draftRev: number;
}

export interface TriggerHit {
  readonly trigger: '/' | '@';
  readonly query: string;
  readonly quoted: boolean;
  readonly position: 'leading' | 'inline';
  readonly span: TokenSpan;
}

export interface InputTriggerCandidate {
  readonly name: string;
  /** 官方本地化名（内置命令带，如「压缩/目标」）；官方主名渲染 label ?? name，label 与 name 不同时另出别名。 */
  readonly label?: string;
  readonly description?: string;
  /** 官方 MenuView 语义：字符串 = 引用类 kind（file/folder/session）；组件 = 命令 glyph（渲染 <icon size={16}/>）。 */
  readonly icon?: string | React.ComponentType<{ size?: number }>;
  readonly hint?: string;
  readonly section?: string;
  readonly value?: string;
  readonly drill?: boolean;
}

export interface InputTriggerCrumb {
  readonly label: string;
  readonly value: string;
  readonly current?: boolean;
}

export interface MenuState {
  readonly open: boolean;
  readonly hit: TriggerHit | null;
  readonly generation: number;
  readonly groups: readonly {
    readonly source: string;
    readonly showGroupTitle?: boolean;
    readonly status: 'pending' | 'ready';
    readonly items: readonly InputTriggerCandidate[];
  }[];
  readonly highlight: { readonly source: string; readonly index: number } | null;
}

/** ctx.conversation.input（InputHub）逐 id 服务面。 */
export interface InputTriggerController {
  readonly menu: HostObservable<MenuState>;
  readonly launcher: HostObservable<string | null>;
  readonly headers: HostObservable<ReadonlyMap<string, readonly InputTriggerCrumb[]>>;
  readonly lexicon: HostObservable<ReadonlyMap<string, readonly string[]>>;
  track(draft: string, caret: number, guard: { readonly tier: 'plain' | 'claimed' | 'frozen' }, draftRev: number): void;
  arbitrate(key: string, composing: boolean): 'consumed' | 'pick-highlighted' | 'pass';
  onSpace(): boolean;
  toggleSource(source: string, hit: TriggerHit): void;
  pick(source: string, index: number, action?: 'pick' | 'drill'): void;
  pickCrumb(source: string, index: number): void;
  hover(source: string, index: number): void;
  dismiss(): void;
}

// ---------- conversation / sessions ----------

export interface SessionInput {
  setDraft(text: string): void;
  addAttachments(ids: readonly DraftAttachmentId[]): boolean;
  removeAttachment(id: DraftAttachmentId): void;
  pruneAttachments(ids: readonly DraftAttachmentId[]): void;
  submit(): void;
  notify(level: 'info' | 'error', text: string): void;
  readonly state: HostObservable<InputState>;
}

export interface ComposerAttachment {
  kind: 'image' | 'file';
  id: DraftAttachmentId;
  file: File;
  previewUrl?: string;
}

/** ctx.conversation（IConversation）公开面里我们消费的切面。 */
export interface ConversationFace {
  readonly input: { for(actx: unknown): SessionInput; shell(id: string): SessionInput & Record<string, unknown>; keyboard(id: string): ComposerKeyboard; inputTriggers(id: string): InputTriggerController | undefined };
  createDrafts(sessionId: string, files: readonly File[]): readonly ComposerAttachment[];
  releaseDraftAttachment(id: DraftAttachmentId): void;
  releaseDraftAttachments(attachments: readonly ComposerAttachment[]): void;
  resolveDraftAttachments(ids: readonly DraftAttachmentId[]): readonly ComposerAttachment[];
  retryFileUpload(sessionId: string, id: DraftAttachmentId): void;
  readonly fileUploads: HostObservable<Record<string, unknown>>;
}

export interface SessionBinding {
  readonly session: {
    command(line: string): Promise<{ ok: boolean; value?: { matched?: boolean } }>;
  };
}

/** ctx.sessions（ISessions）公开面里我们消费的切面。 */
export interface SessionsFace {
  binding(id: string): SessionBinding | undefined;
  scope(id: string): unknown;
}

// ---------- 右侧栏控制器（ctx.sidebarRight / ISidebarRight） ----------

/** 一个已打开标签的记录（dockkit TabRecord 我们消费的切面）。 */
export interface TabRecordLike {
  readonly id: string;
  readonly kind: string;
}

/**
 * 右侧栏公开控制器。侧栏收起后要「唤回侧栏里的 Codinput」（展开 + 激活
 * 该标签）只能经它——`openTabIn` 一次完成展开与聚焦（store 的
 * openContent 内建 planSetExpanded(state, true)）；`toggleExpanded` 作为
 * 退路（openTabIn 缺失时）。全部按鸭子类型调用。
 */
export interface SidebarRightFace {
  isExpanded?(): boolean;
  toggleExpanded?(): void;
  openTab?(kind: string): void;
  openTabIn?(sessionId: string, kind: string): void;
  tabsIn?(sessionId: string): readonly TabRecordLike[];
  focus?(tabId: string): void;
}

// ---------- commandUi popupSelect ----------

export interface SelectOption {
  readonly value?: unknown;
  readonly label: string;
  readonly detail?: string;
  readonly [k: string]: unknown;
}

export interface PopupState {
  readonly open: boolean;
  readonly command: string | null;
  readonly status: 'pending' | 'ready' | 'failed';
  readonly options: readonly SelectOption[];
  readonly search: string;
  readonly active: number;
  readonly submitting: boolean;
  readonly confirming: SelectOption | null;
  readonly acknowledged: boolean;
  readonly error: string | null;
}

export interface PopupSelectController {
  readonly state: HostObservable<PopupState>;
  retry(): void;
  setSearch(search: string): void;
  move(dir: 1 | -1): void;
  highlight(index: number): void;
  select(index: number): Promise<void>;
  acknowledge(acknowledged: boolean): void;
  cancelConfirmation(): void;
  confirm(): Promise<void>;
  dismiss(opts?: { readonly focusComposer?: boolean }): void;
}

export interface CommandUiFace {
  popupFor(actx: unknown): PopupSelectController;
  bindComposerFocus(id: string, focus: () => void): () => void;
}

// ---------- model directory（web 外壳层服务，形状经防御归一化） ----------

export interface ModelReasoningEffort { readonly id: string; readonly name: string; readonly description?: string }
export interface ModelCatalogModel {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly reasoning?: { readonly efforts: readonly ModelReasoningEffort[]; readonly defaultEffort?: string };
}
export interface ModelProviderGroup { readonly id: string; readonly name: string; readonly models: readonly ModelCatalogModel[] }
export interface ModelCatalog {
  readonly default?: { readonly provider: string; readonly model: string; readonly reasoningEffort?: string };
  readonly groups: readonly ModelProviderGroup[];
}
export interface ModelSelection { readonly provider: string; readonly model: string; readonly reasoningEffort?: string }

/**
 * 共享模型目录：与官方 /model 弹层同一状态源。服务形状不在本地包内
 * （属 web 外壳层），读取按 ObservableSnapshot 兼容、写入按鸭子序探测。
 */
export interface ModelDirectoriesFace {
  getSnapshot?(): unknown;
  subscribe?(fn: () => void): () => void;
  [key: string]: unknown;
}

// ---------- standard kit / settings / sidebar ----------

export type SelectorHook<T> = <S>(sel: (s: T) => S) => S;

/** 草稿镜像宿主内建投影：{ lastUsed, next }，next 为下一次请求将用的选择。 */
export interface ModelSelectionProjection {
  readonly lastUsed: ModelSelection | null;
  readonly next: ModelSelection | null;
}

export interface UseProjection {
  (key: string): unknown;
}

/** session-maybe 槽位标准 props（我们消费的切面）。 */
export interface SessionMaybeStandard {
  useSession: <S>(sel: (s: any) => S) => S | undefined;
  sessionId: string | undefined;
  useInput: <S>(sel: (s: InputState) => S) => S | undefined;
  inputActions: InputActions | undefined;
  useConversation?: <S>(sel: (s: any) => S) => S | undefined;
  useProjection: UseProjection;
}

/** session 槽位标准 props（侧栏 body）。 */
export interface SessionStandard {
  useSession: <S>(sel: (s: any) => S) => S;
  sessionId: string;
  useInput: <S>(sel: (s: InputState) => S) => S;
  inputActions: InputActions;
  useProjection: UseProjection;
}

export interface SettingsSectionProps {
  close: () => void;
}

/**
 * sidebar.right.pane.tab 注入的 tabInfo hook（官方 useTabInfo）消费切面。
 * `tab.visible` 是官方的标签可见判定：浮动恒可见；停靠需侧栏展开且为
 * 激活标签（title 槽位才含未激活标签）。收起的侧栏是 CSS 隐藏、body
 * 仍挂载，因此「主输入是否让位」必须读 visible 而非 body 挂载。
 */
export interface SidebarTabInfo {
  readonly sidebar: { readonly expanded: boolean; readonly fullscreen: boolean };
  readonly tab: { readonly visible: boolean };
}
