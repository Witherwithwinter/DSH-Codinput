// 开发辅助：从宿主某个客户端包里提取指定 CSS module 的原文（用于逐值复刻官方样式）。
//
// 用法：
//   node scripts/extract-official-css.mjs <包内 client.js 路径> [输出路径]
// 例：
//   node scripts/extract-official-css.mjs \
//     node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js out.css
//
// 不硬编码任何本机路径：包路径由调用方给出（宿主装在全局或 profile 的
// node_modules 下，位置因人而异）。产物默认写到 .extract/（已在 .gitignore）。
import fs from 'node:fs';
import path from 'node:path';

const [, , pkgClientPath, outPath] = process.argv;
if (!pkgClientPath) {
  console.error('usage: node scripts/extract-official-css.mjs <path/to/client.js> [out.css]');
  process.exit(1);
}

const s = fs.readFileSync(pkgClientPath, 'utf8');
const mapIdx = s.indexOf('var InputBar_module_css_default =');
if (mapIdx < 0) {
  console.error('未找到 InputBar_module_css_default —— 宿主产物形状变了，请先确认变量名。');
  process.exit(1);
}
const before = s.lastIndexOf('const css = ', mapIdx);
const start = before + 'const css = '.length;
let j = start;
const q = s[j];
j++;
let out = '';
while (j < s.length) {
  const ch = s[j];
  if (ch === String.fromCharCode(92)) {
    out += ch + s[j + 1];
    j += 2;
    continue;
  }
  if (ch === q) break;
  out += ch;
  j++;
}
const css = JSON.parse(q + out + q);

const target = outPath ?? path.join('.extract', 'inputbar.official.css');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, css);
console.log('css length:', css.length, '→', target);
console.log(s.slice(mapIdx, mapIdx + 1200));
