import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const testsDir = path.join(root, 'ui', 'tests');

function collectTests(dir, list = []) {
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      collectTests(full, list);
    } else if (entry.endsWith('.test.js')) {
      list.push(full);
    }
  }
  return list;
}

if (!fs.existsSync(testsDir)) {
  process.stderr.write('UI 测试目录不存在\n');
  process.exit(1);
}

const tests = collectTests(testsDir).sort();
if (tests.length === 0) {
  process.stderr.write('未找到 UI 测试文件\n');
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...tests], {
  cwd: root,
  stdio: 'inherit'
});

process.exit(result.status ?? 1);
