// 开发辅助：列出某个宿主客户端产物里的 CSS module tagId（配合 extract-css.mjs 抽取）。
// 用法: node scripts/list-css-modules.mjs <path/to/client.js> [过滤子串]
import fs from 'node:fs';

const [, , file, filter] = process.argv;
if (!file) {
  console.error('usage: node scripts/list-css-modules.mjs <path/to/client.js> [substring]');
  process.exit(1);
}
const s = fs.readFileSync(file, 'utf8');
const ids = new Set();
const marker = '.module.css"';
let i = s.indexOf(marker);
while (i !== -1) {
  // 往左找 tagId 字符串的开头引号
  const start = s.lastIndexOf('"', i - 1);
  const candidate = s.slice(start + 1, i + marker.length - 1);
  if (candidate.length < 200 && candidate.includes('/')) ids.add(candidate);
  i = s.indexOf(marker, i + marker.length);
}
const list = [...ids].sort().filter((id) => !filter || id.includes(filter));
for (const id of list) console.log(id);
console.error(`\n共 ${list.length} 个 CSS module`);
