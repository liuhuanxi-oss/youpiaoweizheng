#!/usr/bin/env node
// scripts/dev/run-tests.js —— 跑 tests/ 下的全部 *.test.js
// 为什么要有这个：这些测试原先散落在系统临时目录里，被系统清理掉了一次，
// 白丢了几套断言。测试属于仓库资产，必须跟着代码走。
// 用法：npm test        （失败即非 0 退出，可直接挂 CI）
//       npm test detail （只跑文件名含 detail 的）
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const DIR = path.resolve(__dirname, '../../tests');
const filter = process.argv[2] || '';

if (!fs.existsSync(DIR)) {
  console.error('找不到测试目录：' + DIR);
  process.exit(1);
}

const files = fs.readdirSync(DIR)
  .filter((f) => f.endsWith('.test.js'))
  .filter((f) => !filter || f.includes(filter))
  .sort();

if (!files.length) {
  console.error(filter ? `没有匹配 "${filter}" 的测试` : 'tests/ 下没有 *.test.js');
  process.exit(1);
}

let ok = 0, bad = 0;
const failed = [];

for (const f of files) {
  console.log('\n══ ' + f + ' ' + '═'.repeat(Math.max(0, 44 - f.length)));
  const r = spawnSync(process.execPath, [path.join(DIR, f)], { stdio: 'inherit' });
  if (r.status === 0) ok++; else { bad++; failed.push(f); }
}

console.log('\n' + '═'.repeat(50));
console.log(`测试套件：${ok} 通过 / ${bad} 失败（共 ${files.length} 套）`);
if (bad) {
  console.log('失败：' + failed.join(', '));
  process.exit(1);
}
console.log('全部通过');
