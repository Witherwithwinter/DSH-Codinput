/** Behavioral integration, not a browser/UI test. Actual CM DOM listeners + jsdom FileReader. */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const preFixControl = process.argv.includes('--pre-fix-control');
// Mutation control, NOT a historical Git baseline. Remove only this fix in memory;
// fail closed if its exact import/handler or surrounding context has changed.
const controlPlugin = { name: 'pre-fix-control-cm-only', setup(api) {
  if (preFixControl) api.onLoad({filter: /[\\/]src[\\/]client[\\/]cm\.ts$/}, args => {
    let contents = readFileSync(args.path, 'utf8').replace(/\r\n/g, '\n');
    const importLine = "import { dragHasFiles } from './attachments';\n";
    const guardLines = '      // 文件归附件入口处理；阻止 CM 默认异步 readAsText 入正文，但保留冒泡给官方 document 监听。\n' +
      '      drop: (event) => dragHasFiles(event.dataTransfer),\n';
    const anchor = '    EditorView.domEventHandlers({\n' + guardLines +
      '      keydown: (event, view) => activeHooks?.onKeydown(view, event) ?? false,';
    for (const [name, exact] of [['import', importLine], ['guard', guardLines], ['context', anchor]]) {
      assert.equal(contents.split(exact).length - 1, 1, `pre-fix control requires exactly one ${name}`);
    }
    assert.equal((contents.match(/\bdragHasFiles\b/g) ?? []).length, 2, 'pre-fix control must not remove another use');
    contents = contents.replace(importLine, '').replace(guardLines, '');
    return {contents, loader: 'ts', resolveDir: path.dirname(args.path)};
  });
} };
console.log('SOURCE ' + (preFixControl ? 'pre-fix mutation control (guard removed in memory)' : 'working tree') + ' src/client/cm.ts');

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true, url: 'http://localhost/' });
const { window } = dom;
window.document.execCommand = () => false;
window.Range.prototype.getClientRects = () => [];
window.Range.prototype.getBoundingClientRect = () => new window.DOMRect(0, 0, 0, 0);
for (const key of ['window', 'Window', 'document', 'navigator', 'MutationObserver', 'HTMLElement', 'Element', 'Node', 'DOMRect', 'getComputedStyle', 'File', 'Blob', 'FileReader']) {
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: typeof window[key] === 'function' && key === 'getComputedStyle' ? window[key].bind(window) : window[key] });
}
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
let reads = 0;
const RealReader = window.FileReader;
globalThis.FileReader = class extends RealReader { readAsText(...args) { reads++; super.readAsText(...args); } };
const built = await build({ stdin: { contents: `export * from './src/client/cm.ts'; export {EditorView} from '@codemirror/view';`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'esm', platform: 'browser', plugins: [controlPlugin, {name: 'unused-prefs-hooks', setup(api) { api.onResolve({filter: /^react$/}, () => ({path: 'react', namespace: 'test'})); api.onLoad({filter: /.*/, namespace: 'test'}, () => ({contents: 'export const useCallback=f=>f; export const useSyncExternalStore=()=>{};'})); }}] });
const cm = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].contents).toString('base64'));
const original = '<!doctype html><html><body>HTML_DROP_SENTINEL</body></html>';
const html = new File([original], 'page.html', { type: 'text/html' });
const image = new File([new Uint8Array([137, 80, 78, 71, 0, 0])], 'image.png', { type: 'image/png' });
const textFile = new File(['file-content'], 'notes.txt', { type: 'text/plain' });
function transfer(files = [], text = '', types = files.length ? ['Files'] : ['text/plain'], items) {
  return { files, items: items ?? files.map(file => ({kind: 'file', getAsFile: () => file})), types, getData: type => /^(Text|text\/plain)$/i.test(type) ? text : '', dropEffect: 'none' };
}
function fire(target, type, data, clipboard = false) {
  const event = new window.Event(type, { bubbles: true, cancelable: true, composed: true });
  Object.defineProperty(event, clipboard ? 'clipboardData' : 'dataTransfer', {value: data});
  Object.defineProperties(event, {clientX: {value: 10}, clientY: {value: 10}});
  target.dispatchEvent(event);
  return event;
}
const wait = () => new Promise(resolve => setTimeout(resolve, 35));
let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (error) { failed++; console.error('FAIL ' + name + '\n' + error.stack); } }

async function fixture(official, run) {
  const card = document.createElement('div'); card.dataset.composerCard = 'codinput';
  const host = document.createElement('div'); card.append(host); document.body.append(card);
  const {mount, shadow} = cm.ensureEditorShadow(host);
  const changes = [], attachments = [], seen = [];
  cm.setActiveEditorHooks({onKeydown: () => false, onLocalChange: doc => changes.push(doc.toString()), onCaret() {}, onCompositionChange() {}, onFocusChange() {}});
  const view = new cm.EditorView({ parent: mount, root: shadow, state: cm.createEditorState(cm.createEditorExtensions({lineNumbers: false, fontFamily: 'monospace', placeholder: '', editable: true}), 'draft:') });
  // jsdom has no layout engine. Fix hit-testing only; editor event handling and file reading remain real.
  view.posAtCoords = () => view.state.doc.length;
  view.dispatch({selection: {anchor: view.state.doc.length}});
  const accept = event => { seen.push({event, prevented: event.defaultPrevented, path: event.composedPath().includes(view.contentDOM)}); attachments.push(...event.dataTransfer.files); };
  // Mirror the existing surface's capture ownership, without importing its unrelated React UI.
  const capture = event => { if (!official && event.dataTransfer.files.length) { event.preventDefault(); event.stopPropagation(); attachments.push(...event.dataTransfer.files); } };
  card.addEventListener('drop', capture, true);
  // Installed rc.5 drop-events.ts:71-85 listens in document bubble, does NOT skip defaultPrevented.
  const documentDrop = event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); accept(event); } };
  if (official) document.addEventListener('drop', documentDrop);
  const beforeReads = reads;
  try { await run({view, attachments, changes, seen, beforeReads, drop: data => fire(view.contentDOM, 'drop', data), paste: text => fire(view.contentDOM, 'paste', {getData: type => type === 'text/plain' ? text : '', files: []}, true)}); }
  finally { document.removeEventListener('drop', documentDrop); view.destroy(); cm.setActiveEditorHooks(null); card.remove(); }
}

for (const official of [true, false]) {
  const mode = official ? 'official' : 'fallback';
  for (const [name, files, plain, types] of [
    ['HTML Files-only', [html], '', ['Files']],
    ['mixed Files+HTML+plain', [html], '<b>not-draft</b>', ['Files', 'text/html', 'text/plain']],
    ['text file', [textFile], '', ['Files']],
    ['image', [image], '', ['Files']],
    ['multiple files', [html, image, textFile], 'not-draft', ['Files', 'text/plain']],
    ['directory-shaped File', [new File([], 'folder')], '', ['Files']],
  ]) await test(mode + ': ' + name + ' stays attachment-only', () => fixture(official, async f => {
    const event = f.drop(transfer(files, plain, types)); await wait();
    console.log(JSON.stringify({case: mode + '/' + name, draft: f.view.state.doc.toString(), fileReads: reads-f.beforeReads, attached: f.attachments.map(file => file.name)}));
    assert.equal(f.view.state.doc.toString(), 'draft:', 'file contents must not enter draft');
    assert.equal(reads, f.beforeReads, 'CM must not schedule FileReader'); assert.deepEqual(f.changes, []);
    assert.deepEqual(f.attachments, files); assert.equal(event.defaultPrevented, true);
    if (official) { assert.equal(f.seen.length, 1); assert.equal(f.seen[0].event, event); assert.equal(f.seen[0].prevented, true); assert.equal(f.seen[0].path, true); }
  }));
  await test(mode + ': ordinary text drop remains literal', () => fixture(official, async f => { f.drop(transfer([], 'plain <tag>')); await wait(); assert.equal(f.view.state.doc.toString(), 'draft:plain <tag>'); assert.deepEqual(f.attachments, []); assert.equal(reads, f.beforeReads); }));
  await test(mode + ': ordinary paste remains literal', () => fixture(official, async f => { f.paste('paste <tag>'); await wait(); assert.equal(f.view.state.doc.toString(), 'draft:paste <tag>'); assert.deepEqual(f.attachments, []); }));
}
await test('official: Files advertised before files become readable does not insert text fallback', () => fixture(true, async f => {
  const item = {kind: 'file', getAsFile: () => html}; f.drop(transfer([], 'must-not-insert', ['Files', 'text/plain'], [item])); await wait();
  assert.equal(f.view.state.doc.toString(), 'draft:'); assert.deepEqual(f.changes, []); assert.equal(reads, f.beforeReads); assert.equal(f.seen.length, 1);
}));
await test('internal editor text move retains normal CodeMirror semantics', () => fixture(true, async f => {
  f.view.dispatch({selection: {anchor: 0, head: 5}});
  fire(f.view.contentDOM, 'dragstart', {files: [], items: [], types: ['text/plain'], clearData() {}, setData() {}, setDragImage() {}, effectAllowed: 'copyMove'});
  f.drop(transfer([], 'draft')); await wait(); assert.equal(f.view.state.doc.toString(), ':draft'); assert.deepEqual(f.attachments, []);
}));
console.log(JSON.stringify({passed, failed, fileReads: reads, environment: 'jsdom + real CodeMirror DOM handlers; synthetic composed drop/paste; no browser or GUI'}, null, 2));
dom.window.close();
if (failed) process.exitCode = 1;
