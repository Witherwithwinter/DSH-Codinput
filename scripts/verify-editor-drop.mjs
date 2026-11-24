import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, openSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

// Keep logs outside the checkout. No Git history, source mutation, or GUI required.
const logs = mkdtempSync(join(tmpdir(), 'dsh-codinput-drop-'));
console.log('LOGS ' + logs);
for (const control of [true, false]) {
  const output = join(logs, control ? 'pre-fix-control-red.txt' : 'fixed-green.txt');
  const fd = openSync(output, 'w');
  let child;
  try {
    child = spawnSync(process.execPath, ['scripts/test-editor-drop.mjs', ...(control ? ['--pre-fix-control'] : [])], {stdio: ['ignore', fd, fd]});
  } finally {
    closeSync(fd);
  }
  if (child.error) throw child.error;
  const log = readFileSync(output, 'utf8');
  assert.ok(!log.includes('Error: Uncaught'), 'DOM environment must be clean');
  const summary = /\{\s*"passed": (\d+),\s*"failed": (\d+),\s*"fileReads": (\d+),/.exec(log);
  assert.ok(summary, 'suite must reach its behavioral summary (not fail on setup/dependencies)');
  if (control) {
    assert.equal(child.status, 1, 'pre-fix mutation control must fail behavior assertions');
    assert.deepEqual(summary.slice(1, 3).map(Number), [11, 7]);
    assert.ok(Number(summary[3]) > 0, 'control must exercise real FileReader');
    assert.ok(log.includes('FAIL official: HTML Files-only stays attachment-only'));
    assert.ok(log.includes('draft:<!doctype html><html><body>HTML_DROP_SENTINEL'));
    assert.ok(log.includes('PASS official: ordinary text drop remains literal'));
    assert.ok(log.includes('PASS official: ordinary paste remains literal'));
  } else {
    assert.equal(child.status, 0, log);
    assert.deepEqual(summary.slice(1).map(Number), [18, 0, 0]);
  }
  console.log(`${control ? 'EXPECTED CONTROL RED' : 'PASS GREEN'} exit=${child.status} ${output}`);
}
console.log('PASS pre-fix mutation-control RED -> working-tree GREEN; no source files changed');
