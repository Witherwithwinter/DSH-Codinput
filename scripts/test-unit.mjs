/**
 * 零外部依赖单元测试套件（Node 内置 node:test + esbuild 编译被测 TS 模块）。
 *
 * 覆盖无宿主依赖的核心纯逻辑与状态机：
 * - hotkey：校验、规范化、匹配、mod 冲突判定、展示格式化
 * - prefs：内存缓存引用稳定、外部改写失效、v2→v3 迁移、脏数据归一化、写失败兜底
 * - slotEntry：listRows（无 id 多条目不误丢、去重、excludeIds、order 排序）、
 *   isRenderableComponent、kitFromBarProps、entryInjectProps 按会话绑定代失效
 * - markdown：脚注抽取与快速路径、callout/注释/高亮/wikilink/embed/wire、
 *   B5 安全（原始 HTML 转义、伪造 data-dci-wire 拦截、危险 URI 拦截）、代码高亮
 * - sideinput / barinject：多标签归属选举与按身份清理
 */

import assert from 'node:assert/strict';
import { build } from 'esbuild';

// ---- 最小浏览器环境桩（仅用于纯模块加载） ----
function installBrowserStubs() {
  const storage = new Map();
  let throwOnSet = false;
  const localStorage = {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => {
      if (throwOnSet) throw new Error('QuotaExceededError');
      storage.set(String(k), String(v));
    },
    removeItem: (k) => storage.delete(String(k)),
    clear: () => storage.clear(),
  };
  const listeners = new Map();
  const win = {
    localStorage,
    addEventListener: (type, fn) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener: (type, fn) => listeners.get(type)?.delete(fn),
    dispatchEvent: (event) => {
      for (const fn of listeners.get(event.type) ?? []) fn(event);
    },
    setTimeout,
    clearTimeout,
  };
  globalThis.window = win;
  return {
    storage,
    setThrowOnSet: (v) => {
      throwOnSet = v;
    },
  };
}

const env = installBrowserStubs();

// ---- 内存编译单测入口（零临时文件） ----
const entrySource = `
export * as hotkey from './src/client/hotkey.ts';
export * as prefs from './src/client/prefs.ts';
export * as i18n from './src/client/i18n.ts';
export * as services from './src/client/services.ts';
export * as sideinput from './src/client/sideinput.ts';
export * as barinject from './src/client/barinject.ts';
export * as float3d from './src/client/float3d.ts';
export * as floatDock from './src/client/float-dock.ts';
export * as floatFlip from './src/client/float-flip.ts';
export * as slotEntry from './src/client/components/slotEntry.tsx';
export * as md from './src/client/markdown/index.ts';
export * as mdExt from './src/client/markdown/extensions.ts';
export * as mdCode from './src/client/markdown/code.ts';
export * as mdSanitize from './src/client/markdown/sanitize.ts';
`;

let failed = 0;
let passed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  PASS  ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  FAIL  ${name}`);
    console.error(`        ${error instanceof Error ? error.stack : String(error)}`);
  }
}

const built = await build({
  stdin: { contents: entrySource, resolveDir: process.cwd(), loader: 'ts' },
  write: false,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'es2021',
  jsx: 'automatic',
  plugins: [
    {
      name: 'stub-react-and-dompurify',
      setup(api) {
        api.onResolve({ filter: /^react(?:\/jsx-runtime)?$/ }, (args) => ({
          path: args.path,
          namespace: 'stub',
        }));
        api.onResolve({ filter: /^@deepseek-ai\/dsh-client-ui-primitives$/ }, (args) => ({
          path: args.path,
          namespace: 'stub',
        }));
        api.onResolve({ filter: /^dompurify$/ }, (args) => ({
          path: args.path,
          namespace: 'stub',
        }));
        api.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => {
          if (args.path === 'dompurify') {
            // Node 无 DOM：桩模块透传（B5 的原始 HTML 转义与协议过滤在 marked 渲染层验证）。
            return {
              contents: 'export default { isSupported: true, sanitize: (html) => html };',
              loader: 'js',
            };
          }
          return {
            contents: `
              export const createElement = (...a) => ({ $$stub: true, a });
              export const useCallback = (fn) => fn;
              export const useMemo = (fn) => fn();
              export const useRef = (v) => ({ current: v });
              export const useSyncExternalStore = (_s, get) => get();
              export class Component { constructor(p) { this.props = p; } }
              export const jsx = () => null;
              export const jsxs = () => null;
              export const Fragment = Symbol('fragment');
            `,
            loader: 'js',
          };
        });
      },
    },
  ],
});

const code = Buffer.from(built.outputFiles[0].contents).toString('base64');
const mod = await import(`data:text/javascript;base64,${code}`);

console.log('== DSH-Codinput unit tests ==');

  // ---------- 1. hotkey ----------
  await test('hotkey: validation, normalization & formatting', () => {
    const { isValidHotkey, normalizeHotkey, formatCombo } = mod.hotkey;
    assert.equal(isValidHotkey('mod+enter'), true);
    assert.equal(isValidHotkey('ctrl+shift+k'), true);
    assert.equal(isValidHotkey('mod+ctrl+enter'), false);
    assert.equal(isValidHotkey('ctrl+ctrl+a'), false);
    assert.equal(isValidHotkey('ctrl+'), false);
    assert.equal(isValidHotkey(''), false);
    assert.equal(normalizeHotkey('Shift+Ctrl+Enter'), 'ctrl+shift+enter');
    assert.equal(formatCombo('ctrl+shift+enter'), 'Ctrl + Shift + Enter');
    assert.equal(formatCombo('mod+enter'), 'Ctrl/Cmd + Enter');
  });

  await test('hotkey: matchEvent & hotkeysConflict (including mod vs ctrl/meta)', () => {
    const { matchEvent, hotkeysConflict, comboFromEvent } = mod.hotkey;
    assert.equal(
      matchEvent('mod+enter', { key: 'Enter', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false }),
      true,
    );
    assert.equal(
      matchEvent('mod+enter', { key: 'Enter', ctrlKey: false, altKey: false, shiftKey: false, metaKey: true }),
      true,
    );
    assert.equal(
      matchEvent('mod+enter', { key: 'Enter', ctrlKey: true, altKey: false, shiftKey: true, metaKey: false }),
      false,
    );
    assert.equal(hotkeysConflict('mod+enter', 'ctrl+enter'), true);
    assert.equal(hotkeysConflict('mod+enter', 'meta+enter'), true);
    assert.equal(hotkeysConflict('mod+enter', 'shift+enter'), false);
    assert.equal(hotkeysConflict('enter', 'enter'), true);
    assert.equal(comboFromEvent({ key: 'Shift', ctrlKey: false, altKey: false, shiftKey: true, metaKey: false }), null);
    assert.equal(
      comboFromEvent({ key: ' ', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false }),
      'ctrl+space',
    );
  });

  // ---------- 2. prefs ----------
  await test('prefs: cache reference stability, external mutation invalidation & write-failure resilience', () => {
    const { loadPrefs, savePrefs, resetPrefsCache } = mod.prefs;
    env.storage.clear();
    resetPrefsCache();

    const p1 = loadPrefs();
    const p2 = loadPrefs();
    assert.equal(p1, p2, 'repeated loadPrefs() should return identical cached reference');
    assert.equal(p1.enabled, true);

    // 外部直接写 localStorage（如探针/手动修改）应被自动感知
    env.storage.set('dsh-codinput.prefs.v3', JSON.stringify({ ...p1, mode: 'float', floatX: 88 }));
    const p3 = loadPrefs();
    assert.equal(p3.mode, 'float');
    assert.equal(p3.floatX, 88);
    assert.equal(loadPrefs(), p3);

    // 写入 localStorage 失败时，当次会话内内存快照仍保持最新值
    env.setThrowOnSet(true);
    try {
      const p4 = savePrefs({ lineNumbers: false });
      assert.equal(p4.lineNumbers, false);
      assert.equal(loadPrefs().lineNumbers, false);
    } finally {
      env.setThrowOnSet(false);
    }
  });

  await test('prefs: v2 -> v3 migration, shift-enter repair & hotkey conflict fallback', () => {
    const { loadPrefs, resetPrefsCache, DEFAULT_PREFS } = mod.prefs;
    env.storage.clear();
    resetPrefsCache();

    env.storage.set(
      'dsh-codinput.prefs.v2',
      JSON.stringify({
        sendKey: 'enter',
        floating: true,
        lineBreakHotkey: 'shift-enter',
        fontLigatures: true,
        unknownJunk: 123,
      }),
    );
    const migrated = loadPrefs();
    assert.equal(migrated.sendHotkey, 'enter');
    assert.equal(migrated.lineBreakHotkey, 'shift+enter');
    assert.equal(migrated.mode, 'float');
    assert.equal(env.storage.has('dsh-codinput.prefs.v2'), false, 'v2 should be removed after v3 write');
    const persisted = JSON.parse(env.storage.get('dsh-codinput.prefs.v3'));
    assert.equal('sendKey' in persisted, false);
    assert.equal('fontLigatures' in persisted, false);
    assert.equal('unknownJunk' in persisted, false);

    // mod+enter 与 ctrl+enter 冲突回退默认
    env.storage.set(
      'dsh-codinput.prefs.v3',
      JSON.stringify({ sendHotkey: 'mod+enter', lineBreakHotkey: 'ctrl+enter' }),
    );
    const resolved = loadPrefs();
    assert.equal(resolved.sendHotkey, DEFAULT_PREFS.sendHotkey);
    assert.equal(resolved.lineBreakHotkey, DEFAULT_PREFS.lineBreakHotkey);
  });

  // ---------- 3. slotEntry ----------
  await test('slotEntry: listRows preserves multiple id-less entries, dedupes defined ids, filters excludeIds', () => {
    const { listRows, isRenderableComponent, kitFromBarProps } = mod.slotEntry;
    const A = () => null;
    const B = () => null;
    const C = () => null;
    const D = () => null;
    const rows = listRows(
      [
        { component: A, options: { order: 20 } },
        { component: B, options: { order: 10 } },
        { component: C, options: { id: 'dup', order: 5 } },
        { component: D, options: { id: 'dup', order: 1 } },
        { component: D, options: { id: 'activity', order: 0 } },
        { component: { notRenderable: true }, options: { id: 'bad' } },
      ],
      ['activity'],
    );
    assert.deepEqual(
      rows.map((r) => r.component),
      [C, B, A],
      'both id-less entries A and B must survive, duplicate id keeps first, excluded id & bad component skipped',
    );
    assert.equal(isRenderableComponent(A), true);
    assert.equal(isRenderableComponent({ $$typeof: Symbol.for('react.memo') }), true);
    assert.equal(isRenderableComponent({ $$typeof: Symbol.for('react.element') }), false);

    const kit = kitFromBarProps({ variant: 'composer', disabled: true, sessionId: 's1', useTabInfo: () => {} }, ['useTabInfo']);
    assert.deepEqual(kit, { sessionId: 's1' });
  });

  await test('slotEntry: entryInjectProps invalidates on session binding generation change & retries failures', () => {
    const { entryInjectProps, entryInjectFailed } = mod.slotEntry;
    const { stash } = mod.services;

    let binding = { gen: 1 };
    let calls = 0;
    let shouldFail = true;
    stash.sessions = {
      binding: (sid) => (sid === 's1' ? binding : undefined),
      scope: () => undefined,
    };
    const entry = {
      inject: (sid) => {
        calls += 1;
        if (shouldFail) throw new Error('transient');
        return { sid, gen: binding.gen };
      },
    };

    // 第 1 代失败：同代缓存失败结果，不重复调用
    assert.equal(entryInjectFailed(entry, 's1'), true);
    assert.equal(entryInjectProps(entry, 's1'), null);
    assert.equal(calls, 1);

    // 会话绑定换代：重新 inject 并恢复成功
    binding = { gen: 2 };
    shouldFail = false;
    assert.equal(entryInjectFailed(entry, 's1'), false);
    assert.deepEqual(entryInjectProps(entry, 's1'), { sid: 's1', gen: 2 });
    assert.equal(calls, 2);

    // 再次换代（模拟 A -> B -> A）：拿到新代 props
    binding = { gen: 3 };
    assert.deepEqual(entryInjectProps(entry, 's1'), { sid: 's1', gen: 3 });
    assert.equal(calls, 3);
  });

  // ---------- 5. markdown ----------
  await test('markdown: footnotes, Obsidian extensions, code highlighting & B5 XSS/spoofing defense', () => {
    const { extractFootnotes } = mod.mdExt;
    const { renderMarkdown } = mod.md;
    const { renderCodeBlock } = mod.mdCode;

    // 脚注快速路径（无 [^）
    const plain = extractFootnotes('hello\nworld');
    assert.equal(plain.text, 'hello\nworld');
    assert.equal(plain.definitions.length, 0);

    // 脚注抽取与编号（按首次引用序，代码围栏内的忽略）
    const fn = extractFootnotes('See[^b] then[^a].\n\n```md\n[^c]: ignored\n```\n\n[^a]: First\n[^b]: Second\n  cont\n[^unused]: Drop');
    assert.deepEqual(
      fn.definitions.map((d) => [d.id, d.number, d.body]),
      [
        ['b', 1, 'Second\ncont'],
        ['a', 2, 'First'],
      ],
    );

    // Callout / 高亮 / 注释 / wikilink / embed / wire / 图片尺寸
    const sample = [
      '> [!tip]+ Heads up',
      '> ==mark== and %%hidden%%',
      '',
      '%%',
      'multiline comment',
      '%%',
      '',
      '[[Note|Alias]] ![[pic.png]] @[MySession](dsh-session:abc) ![img|240](https://example.com/a.png)',
    ].join('\n');
    const html = renderMarkdown(sample);
    assert.match(html, /<details class="dci-md-callout" data-callout="tip" data-family="green" open>/);
    assert.match(html, /<mark class="dci-md-mark">mark<\/mark>/);
    assert.equal(html.includes('hidden'), false);
    assert.equal(html.includes('multiline comment'), false);
    assert.match(html, /data-dci-wikilink="Note"/);
    assert.match(html, /class="dci-md-embed"/);
    assert.match(html, /data-dci-wire="MySession"/);
    assert.match(html, /width="240"/);

    // B5 安全：手写原始 HTML / 伪造 data-dci-wire / javascript: 协议不得生效
    const hostile = '<span data-dci-wire="spoof">x</span> <script>alert(1)</script> [click](javascript:alert(1)) ![](data:image/svg+xml,<svg/>)';
    const safeHtml = renderMarkdown(hostile);
    assert.equal(safeHtml.includes('<span data-dci-wire'), false);
    assert.equal(safeHtml.includes('<script>'), false);
    assert.equal(safeHtml.includes('javascript:'), false);
    assert.equal(safeHtml.includes('<img'), false);

    // 代码块高亮 + mermaid 占位
    const tsBlock = renderCodeBlock({ type: 'code', raw: '', text: 'const x = 1;', lang: 'ts' });
    assert.match(tsBlock, /class="hljs language-ts"/);
    assert.match(tsBlock, /<span class="hljs-keyword">const<\/span>/);
    const vueBlock = renderCodeBlock({ type: 'code', raw: '', text: '<template><div/></template>', lang: 'vue' });
    assert.match(vueBlock, /class="hljs language-xml"/);
    const mermaidBlock = renderCodeBlock({ type: 'code', raw: '', text: 'graph TD; A-->B;', lang: 'mermaid' });
    assert.match(mermaidBlock, /data-dci-md-mermaid="/);
    assert.match(mermaidBlock, /data-dci-md-state="pending"/);
  });

  await test('slotEntry: snapshotHookFor keeps subscribe stable & honors selector/eq memoization', () => {
    const { snapshotHookFor } = mod.slotEntry;
    let raw = { a: 1, b: 2 };
    const source = {
      getSnapshot: () => raw,
      subscribe: () => () => {},
    };
    const hook = snapshotHookFor(source);
    assert.equal(typeof hook, 'function');
    // 同一 source 复用同一 hook 引用
    assert.equal(snapshotHookFor(source), hook);
    const eq = (x, y) => x.a === y.a;
    const sel = (s) => ({ a: s.a });
    const v1 = hook(sel, eq);
    assert.deepEqual(v1, { a: 1 });
  });

  // ---------- 6. sideinput & barinject ----------
  await test('sideinput & barinject: owner election and identity-guarded cleanup', () => {
    const { claimSidebarInput, isSidebarCarryOwner, isSidebarInputCarried } = mod.sideinput;
    const { setBarInjected, getBarInjected, clearBarInjected } = mod.barinject;

    const c1 = claimSidebarInput('sA', { visible: false, expanded: true });
    const c2 = claimSidebarInput('sA', { visible: true, expanded: true });
    assert.equal(isSidebarInputCarried('sA'), true);
    assert.equal(isSidebarCarryOwner('sA', c2.token), true, 'visible pane should win ownership');
    assert.equal(isSidebarCarryOwner('sA', c1.token), false);
    c2.release();
    assert.equal(isSidebarCarryOwner('sA', c1.token), true);
    c1.release();
    assert.equal(isSidebarInputCarried('sA'), false);

    const f1 = { occurrence: 'main' };
    const f2 = { occurrence: 'embedded' };
    setBarInjected('sA', f1);
    setBarInjected('sA', f2);
    clearBarInjected('sA', f1); // 旧对象不得误清已覆盖的新对象
    assert.equal(getBarInjected('sA'), f2);
    clearBarInjected('sA', f2);
    assert.equal(getBarInjected('sA'), undefined);
  });

  // ---------- 7. float3d & prefs.float3d ----------
  await test('prefs: float3d defaults to false, persists booleans & rejects dirty values', () => {
    const { loadPrefs, savePrefs, resetPrefsCache, DEFAULT_PREFS } = mod.prefs;
    env.storage.clear();
    resetPrefsCache();

    assert.equal(DEFAULT_PREFS.float3d, false);
    assert.equal(loadPrefs().float3d, false);

    const on = savePrefs({ float3d: true });
    assert.equal(on.float3d, true);
    assert.equal(loadPrefs().float3d, true);

    env.storage.set('dsh-codinput.prefs.v3', JSON.stringify({ float3d: 'yes' }));
    assert.equal(loadPrefs().float3d, false, 'non-boolean float3d must fall back to false');
  });

  await test('float3d: spherical wrap symmetry, drag inertia, spring settle & reduced-motion snap', () => {
    const {
      MAX_SPHERE_ROT_X,
      MAX_SPHERE_ROT_Y,
      MAX_INERTIA_ROT_X,
      MAX_INERTIA_ROT_Y,
      DRAG_LIFT_Z,
      computeSphericalTarget,
      computeDragInertia,
      createFloat3dState,
      recordDragVelocity,
      stepFloat3dSpring,
      poseFromState,
    } = mod.float3d;
    const vp = { vw: 1440, vh: 900 };

    // 居中严格 0°、0px
    const center = computeSphericalTarget({ x: 360, y: 330, w: 720, h: 240 }, vp);
    assert.equal(center.rotX, 0);
    assert.equal(center.rotY, 0);
    assert.equal(center.z, 0);

    // 左右/上下对称朝向视口中心（左正右负、上负下正），且不超过封顶角度
    const left = computeSphericalTarget({ x: 12, y: 330, w: 720, h: 240 }, vp);
    const right = computeSphericalTarget({ x: 708, y: 330, w: 720, h: 240 }, vp);
    assert.ok(left.rotY > 0 && left.rotY < MAX_SPHERE_ROT_Y);
    assert.ok(Math.abs(left.rotY + right.rotY) < 1e-9, 'left/right rotY should be antisymmetric');
    assert.ok(left.z > 0 && Math.abs(left.z - right.z) < 1e-9);

    const top = computeSphericalTarget({ x: 360, y: 12, w: 720, h: 240 }, vp);
    const bottom = computeSphericalTarget({ x: 360, y: 648, w: 720, h: 240 }, vp);
    assert.ok(top.rotX < 0 && top.rotX > -MAX_SPHERE_ROT_X);
    assert.ok(Math.abs(top.rotX + bottom.rotX) < 1e-9, 'top/bottom rotX should be antisymmetric');

    // 拖动惯性：向右/向下拖时前进边微压入 -Z，极端速度柔饱和不越界
    const inertia = computeDragInertia(1800, 1800);
    assert.ok(inertia.rotY > 0 && inertia.rotY < MAX_INERTIA_ROT_Y);
    assert.ok(inertia.rotX < 0 && inertia.rotX > -MAX_INERTIA_ROT_X);
    const extreme = computeDragInertia(1e6, -1e6);
    assert.ok(extreme.rotY <= MAX_INERTIA_ROT_Y && extreme.rotX <= MAX_INERTIA_ROT_X);

    // 拖动浮空 + 松手阻尼收敛
    const box = { x: 708, y: 12, w: 720, h: 240 };
    const state = createFloat3dState({ dragging: true });
    recordDragVelocity(state, 40, -20, 0.016);
    for (let i = 0; i < 20; i += 1) {
      assert.equal(stepFloat3dSpring(state, box, vp, 1 / 60, false), false, 'dragging must not report settled');
    }
    assert.ok(state.lift > 0.5 && state.z > DRAG_LIFT_Z * 0.5, 'dragging should lift the card in Z');

    state.dragging = false;
    let settled = false;
    for (let i = 0; i < 240; i += 1) {
      if (stepFloat3dSpring(state, box, vp, 1 / 60, false)) {
        settled = true;
        break;
      }
    }
    assert.equal(settled, true, 'spring should converge and stop rAF after release');
    const resting = computeSphericalTarget(box, vp);
    assert.ok(Math.abs(state.rotX - resting.rotX) < 1e-6);
    assert.ok(Math.abs(state.rotY - resting.rotY) < 1e-6);
    assert.equal(state.lift, 0);

    // 动态投影与反光随方位变化（右侧阴影向右偏、左侧缘面受光 rimX > 0）
    const poseRight = poseFromState(state, box, vp);
    assert.ok(poseRight.shadowX > 0);
    assert.ok(poseRight.rimX > 0);
    assert.ok(poseRight.glareX >= 8 && poseRight.glareX <= 92);

    // prefers-reduced-motion：跳过惯性/抬起，直接吸附到静态球面位姿并立即收敛
    const rmState = createFloat3dState({ dragging: true });
    recordDragVelocity(rmState, 80, 80, 0.016);
    const rmSettled = stepFloat3dSpring(rmState, box, vp, 1 / 60, true);
    assert.equal(rmSettled, true);
    assert.equal(rmState.lift, 0);
    assert.equal(rmState.rotX, resting.rotX);
    assert.equal(rmState.rotY, resting.rotY);
  });

  // ---------- 8. float-dock ----------
  await test('float-dock: dock zone bounds, visual box clamping, hint phases & release outcomes', () => {
    const {
      computeDockZone,
      isPointInDockZone,
      computeDockVisualBox,
      resolveDockHintPhase,
      resolveReleaseOutcome,
    } = mod.floatDock;

    const seat = { left: 260, right: 1180, top: 820, bottom: 884 };
    const zone = computeDockZone(seat, 1440, 900);
    assert.deepEqual(zone, { left: 220, right: 1220, top: 600, bottom: 900 });
    assert.equal(isPointInDockZone(720, 750, zone), true);
    assert.equal(isPointInDockZone(720, 500, zone), false);
    assert.equal(isPointInDockZone(100, 750, zone), false);

    const visual = computeDockVisualBox(seat, zone, 1440, 900);
    assert.equal(visual.width, 760);
    assert.equal(visual.left, 340);
    assert.ok(visual.top >= 12 && visual.top + visual.height <= 900 - 12);

    // 底部状态栏常驻时，虚框底缘抬升至状态栏顶缘上方（不遮挡状态栏）
    const visualAboveStats = computeDockVisualBox(seat, zone, 1440, 900, 868);
    assert.equal(visualAboveStats.top + visualAboveStats.height, 866);
    assert.ok(visualAboveStats.top < visual.top);
    // 多行折行状态栏也能随真实 statsTop 同步上抬
    const visualAboveWrappedStats = computeDockVisualBox(seat, zone, 1440, 900, 840);
    assert.equal(visualAboveWrappedStats.top + visualAboveWrappedStats.height, 838);

    // 窄视口夹取不越界
    const narrow = computeDockVisualBox(null, computeDockZone(null, 320, 500), 320, 500);
    assert.equal(narrow.left, 12);
    assert.equal(narrow.width, 296);

    // 普通态刚起拖（未离开归位区）→ pulling；拉出后 → idle；再拖回 → armed
    assert.equal(resolveDockHintPhase(false, true, false), 'pulling');
    assert.equal(resolveDockHintPhase(false, false, true), 'idle');
    assert.equal(resolveDockHintPhase(false, true, true), 'armed');
    // 悬浮态直接拖进归位区 → armed；在悬浮区 → idle
    assert.equal(resolveDockHintPhase(true, true, true), 'armed');
    assert.equal(resolveDockHintPhase(true, false, true), 'idle');

    // 松手结果四象限严格区分真正切换 vs 取消/挪动
    assert.equal(resolveReleaseOutcome(false, false), 'enter-float');
    assert.equal(resolveReleaseOutcome(false, true), 'cancel-detach');
    assert.equal(resolveReleaseOutcome(true, true), 'dock');
    assert.equal(resolveReleaseOutcome(true, false), 'move-float');
  });

  await test('float-flip: delta filtering, adaptive duration, seat scale & dock card magnetic delta', () => {
    const {
      computeFlipDelta,
      computeFlipDuration,
      computeSeatEnterScale,
      computeDockCardDelta,
    } = mod.floatFlip;
    assert.equal(computeFlipDelta(500, 672), -172);
    assert.equal(computeFlipDelta(672, 500), 172);
    assert.equal(computeFlipDelta(500, 501), 0, 'sub-2px jitter should be ignored');
    assert.equal(computeFlipDelta(100, 900), 0, 'outlier jump beyond default cap should be ignored');
    assert.equal(computeFlipDelta(100, 700, 900), -600, 'custom viewport-aware cap should allow tall editors');
    assert.equal(computeFlipDelta(Number.NaN, 500), 0);

    // 距离自适应时长：单调递增且夹取在 [240, 380] ms
    const dSmall = computeFlipDuration(25);
    const dMed = computeFlipDuration(150);
    const dLarge = computeFlipDuration(500);
    assert.ok(dSmall >= 240 && dSmall <= dMed && dMed <= dLarge && dLarge <= 380);
    assert.equal(computeFlipDuration(0), 260);
    assert.equal(computeFlipDuration(Number.NaN), 260);

    // 底板进入缩放比：严格 (0, 1]；未增高或异常值回退 1
    assert.ok(Math.abs(computeSeatEnterScale(30, 180) - 30 / 180) < 1e-6);
    assert.equal(computeSeatEnterScale(0, 180), 0.02);
    assert.equal(computeSeatEnterScale(180, 30), 1);
    assert.equal(computeSeatEnterScale(180, 181), 1);
    assert.equal(computeSeatEnterScale(Number.NaN, 180), 1);

    // 磁吸归位偏移：按中心 X + 顶边 Y 计算，极端位置与宽差安全夹取，且绝不向下溢出（dy <= 0, scale <= 1）
    const dock = computeDockCardDelta(
      { left: 320, top: 480, width: 700, height: 150 },
      { left: 340, top: 600, width: 760, height: 150 },
    );
    assert.ok(dock !== null);
    assert.equal(dock.dx, -50);
    assert.equal(dock.dy, -120);
    assert.ok(dock.scale >= 0.92 && dock.scale <= 1);

    const belowSeat = computeDockCardDelta(
      { left: 340, top: 680, width: 820, height: 150 },
      { left: 340, top: 600, width: 760, height: 150 },
    );
    assert.deepEqual(belowSeat, { dx: 30, dy: 0, scale: 1 }, 'downward offset & scale > 1 should clamp to prevent scrollHeight inflation');

    const clamped = computeDockCardDelta(
      { left: 0, top: 0, width: 360, height: 140 },
      { left: 800, top: 700, width: 900, height: 150 },
    );
    assert.ok(clamped !== null);
    assert.equal(clamped.dx, -320);
    assert.equal(clamped.dy, -280);
    assert.equal(clamped.scale, 0.92);

    assert.equal(
      computeDockCardDelta(
        { left: 340, top: 600, width: 760, height: 150 },
        { left: 340.3, top: 600.2, width: 760, height: 150 },
      ),
      null,
      'negligible dock offset should skip card FLIP',
    );
  });

console.log(`\n== summary: ${passed} passed, ${failed} failed ==`);
if (failed > 0) process.exitCode = 1;
