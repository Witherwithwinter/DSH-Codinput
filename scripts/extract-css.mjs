import fs from 'node:fs';

// 从 primitives 编译产物里提取指定 CSS module 的原文（按 tagId 定位，向前找最近的 const cssN = "..."）。
const file = process.argv[2];
const wanted = process.argv[3];
const s = fs.readFileSync(file, 'utf8');
const tagIdx = s.indexOf(`"${wanted}"`);
if (tagIdx < 0) {
  console.error('tag not found:', wanted);
  process.exit(1);
}
// 该 tagId 的注入块在其 mapping 变量之后；mapping 里包含哈希类名，先找 mapping
const mapKey = wanted.split('/').pop().replace('.module.css', '');
const mapIdx = s.indexOf(`_module_css_default = {`, tagIdx - 200000);
// 向前找最近的 "const css" 声明（可能带 $N 后缀）
const declIdx = s.lastIndexOf('const css', mapIdx);
const strStart = s.indexOf('"', declIdx);
let j = strStart + 1;
let out = '';
while (j < s.length) {
  const ch = s[j];
  if (ch === String.fromCharCode(92)) {
    out += ch + s[j + 1];
    j += 2;
    continue;
  }
  if (ch === '"') break;
  out += ch;
  j++;
}
const css = JSON.parse('"' + out + '"');
console.log(css);
