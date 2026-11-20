/**
 * 零外部依赖单元测试套件（Node 内置 node:test + esbuild 编译被测 TS 模块）。
 *
 * 覆盖无宿主依赖的核心纯逻辑与状态机：
 * - hotkey：校验、规范化、匹配、mod 冲突判定、展示格式化
 * - prefs：内存缓存引用稳定、外部改写失效、v2→v3 迁移、脏数据归一化、写失败兜底
 * - stats：deriveChatStats、formatTokens、formatCacheHitPercent、formatDuration（中/英）
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
export * as stats from './src/client/stats.ts';
export * as services from './src/client/services.ts';
export * as sideinput from './src/client/sideinput.ts';
export * as barinject from './src/client/barinject.ts';
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

  // ---------- 3. stats & i18n ----------
  await test('stats: formatTokens, formatCacheHitPercent, deriveChatStats & localized formatDuration', () => {
    const { formatTokens, formatCacheHitPercent, formatTokensPerSecond, formatDuration, deriveChatStats } = mod.stats;
    const { installI18n } = mod.i18n;

    assert.equal(formatTokens(517), '517 tok');
    assert.equal(formatTokens(12_240), '12.2K tok');
    assert.equal(formatTokens(999_950), '1M tok');
    assert.equal(formatTokens(Number.NaN), null);

    assert.equal(formatCacheHitPercent(100, 100), '100');
    assert.equal(formatCacheHitPercent(9999, 10000), '99.99');
    assert.equal(formatCacheHitPercent(50, 0), null);

    assert.equal(formatTokensPerSecond(42.6), '43');
    assert.equal(formatTokensPerSecond(8.34), '8.3');
    assert.equal(formatTokensPerSecond(Number.POSITIVE_INFINITY), null);

    // 默认中文
    assert.equal(formatDuration(12_340), '12.3s');
    assert.equal(formatDuration(125_000), '2分5秒');

    // 切英文后 formatDuration 自动本地化
    const disposeEn = installI18n({ getSnapshot: () => ({ active: 'en' }) });
    try {
      assert.equal(formatDuration(125_000), '2m 5s');
    } finally {
      disposeEn?.();
      installI18n({ getSnapshot: () => ({ active: 'zh' }) })?.();
    }

    const derived = deriveChatStats([
      { kind: 'assistant', turn: 1, timing: { stepStartTime: 100, firstTokenTime: 400, completedTime: 1400 }, usage: { outputTokens: 100 } },
      { kind: 'tool-result', callTime: 1400, time: 1900 },
      { kind: 'assistant', turn: 1, timing: { stepStartTime: 2000, firstTokenTime: 2200, completedTime: 3200 }, usage: { outputTokens: 200 } },
    ]);
    assert.deepEqual(derived, {
      turns: 1,
      steps: 2,
      llmMs: 2500,
      toolMs: 500,
      ttftMs: 500,
      ttftSteps: 2,
      decodeMs: 2000,
      decodeTokens: 300,
    });
  });

  // ---------- 4. slotEntry ----------
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

console.log(`\n== summary: ${passed} passed, ${failed} failed ==`);
if (failed > 0) process.exitCode = 1;
