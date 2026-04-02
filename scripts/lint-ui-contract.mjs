import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const uiDir = path.join(root, 'ui');
const htmlPath = path.join(uiDir, 'index.html');
const domPath = path.join(uiDir, 'app', 'NebulaDom.js');

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

function parseConstValues(sectionName) {
  const code = fs.readFileSync(domPath, 'utf8');
  const sectionPattern = new RegExp(`export const ${sectionName} = Object\\.freeze\\(\\{([\\s\\S]*?)\\}\\);`);
  const match = code.match(sectionPattern);
  if (!match) {
    return new Map();
  }
  return new Map([...match[1].matchAll(/([A-Z0-9_]+)\s*:\s*'([^']+)'/g)].map(([, key, value]) => [key, value]));
}

function lintDomIds() {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const htmlIds = new Set([...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1]));
  const domIds = parseConstValues('DOM_IDS');
  const missing = [];
  for (const [key, value] of domIds.entries()) {
    if (!htmlIds.has(value)) {
      missing.push(`DOM_IDS.${key} -> index.html 缺少 id="${value}"`);
    }
  }
  return missing;
}

function lintActionEnumUsage() {
  const actionKeys = [...parseConstValues('CHAT_ACTIONS').keys()];
  const jsFiles = collectFiles(uiDir).filter((file) => file.endsWith('.js'));
  const source = jsFiles.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
  const missing = [];
  for (const key of actionKeys) {
    if (!source.includes(`CHAT_ACTIONS.${key}`)) {
      missing.push(`CHAT_ACTIONS.${key} 未在前端源码中使用`);
    }
  }
  return missing;
}

function lintRawDomLookup() {
  const jsFiles = collectFiles(uiDir).filter((file) => file.endsWith('.js'));
  const violations = [];
  for (const file of jsFiles) {
    const rel = path.relative(root, file);
    const code = fs.readFileSync(file, 'utf8');
    for (const match of code.matchAll(/getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      violations.push(`${rel} -> 禁止直接用字面量 getElementById("${match[1]}")，必须走 DOM_IDS`);
    }
    if (/Object\.assign\s*\(/.test(code)) {
      violations.push(`${rel} -> 禁止继续使用 Object.assign 聚合应用壳`);
    }
    if (/window\.nebula\b/.test(code)) {
      violations.push(`${rel} -> 禁止重新暴露 window.nebula 全局入口`);
    }
  }
  return violations;
}

const violations = [
  ...lintDomIds(),
  ...lintActionEnumUsage(),
  ...lintRawDomLookup()
];

if (violations.length > 0) {
  fail(['UI 契约门禁失败：', ...violations]);
}

process.stdout.write('UI contract lint passed\n');
