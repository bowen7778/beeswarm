import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const uiDir = path.join(root, 'ui');
const localeFiles = [
  path.join(uiDir, 'i18n', 'zh-CN.js'),
  path.join(uiDir, 'i18n', 'en-US.js')
];

function fail(lines) {
  for (const line of lines) {
    process.stderr.write(`${line}\n`);
  }
  process.exit(1);
}

function collectFiles(dir, list = []) {
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      collectFiles(full, list);
    } else {
      list.push(full);
    }
  }
  return list;
}

function parseLocaleKeys(filePath) {
  const code = fs.readFileSync(filePath, 'utf8');
  return new Set([...code.matchAll(/'([^']+)'\s*:/g)].map((match) => match[1]));
}

function collectUsedKeys() {
  const files = collectFiles(uiDir).filter((file) => /\.(js|html)$/.test(file));
  const keys = new Set();
  for (const file of files) {
    const code = fs.readFileSync(file, 'utf8');
    for (const match of code.matchAll(/data-i18n(?:-placeholder|-title)?="([^"]+)"/g)) {
      keys.add(match[1]);
    }
    for (const match of code.matchAll(/i18n\.t\(['"]([^'"]+)['"]\)/g)) {
      keys.add(match[1]);
    }
    for (const match of code.matchAll(/\bt\(['"]([^'"]+)['"]\)/g)) {
      keys.add(match[1]);
    }
  }
  return keys;
}

const localeSets = localeFiles.map((filePath) => ({
  filePath,
  keys: parseLocaleKeys(filePath)
}));

const baseline = localeSets[0].keys;
const violations = [];

for (const locale of localeSets.slice(1)) {
  for (const key of baseline) {
    if (!locale.keys.has(key)) {
      violations.push(`${path.relative(root, locale.filePath)} -> 缺少 key ${key}`);
    }
  }
  for (const key of locale.keys) {
    if (!baseline.has(key)) {
      violations.push(`${path.relative(root, locale.filePath)} -> 多余 key ${key}`);
    }
  }
}

const usedKeys = collectUsedKeys();
for (const locale of localeSets) {
  for (const key of usedKeys) {
    if (!locale.keys.has(key)) {
      violations.push(`${path.relative(root, locale.filePath)} -> 未提供已使用 key ${key}`);
    }
  }
  for (const key of locale.keys) {
    if (!usedKeys.has(key)) {
      violations.push(`${path.relative(root, locale.filePath)} -> 存在未使用 key ${key}`);
    }
  }
}

if (violations.length > 0) {
  fail(['UI i18n 门禁失败：', ...violations]);
}

process.stdout.write('UI i18n lint passed\n');
