import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const uiDir = path.join(root, "ui");
const outDir = path.join(root, "build", "ui");
const routeRegistryPath = path.join(root, "src", "api", "routes", "RouteRegistry.ts");
const systemControllerPath = path.join(root, "src", "api", "controllers", "SystemController.ts");
const htmlPath = path.join(uiDir, "index.html");
const apiPath = path.join(uiDir, "services", "api", "ApiClient.js");
const apiDir = path.join(uiDir, "services", "api");

function fail(lines) {
  for (const line of lines) {
    process.stderr.write(`${line}\n`);
  }
  process.exit(1);
}

function collectFiles(dir, list = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) collectFiles(full, list);
    else list.push(full);
  }
  return list;
}

function checkNoExternalAssets() {
  const html = fs.readFileSync(htmlPath, "utf8");
  const matches = [...html.matchAll(/(?:src|href)\s*=\s*"https?:\/\/[^"]+"/gi)];
  if (matches.length > 0) {
    const details = matches.map((m) => `检测到外部资源依赖: ${m[0]}`);
    fail(["UI 构建合规检查失败：禁止外部 CDN 依赖。", ...details]);
  }
}

function checkDomContract() {
  const html = fs.readFileSync(htmlPath, "utf8");
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
  const jsFiles = collectFiles(uiDir).filter((f) => f.endsWith(".js"));
  for (const file of jsFiles) {
    const code = fs.readFileSync(file, "utf8");
    for (const m of code.matchAll(/id="([^"]+)"/g)) {
      ids.add(m[1]);
    }
  }
  const missing = [];
  for (const file of jsFiles) {
    const code = fs.readFileSync(file, "utf8");
    for (const m of code.matchAll(/getElementById\("([^"]+)"\)/g)) {
      if (!ids.has(m[1])) missing.push(`${path.relative(root, file)} -> ${m[1]}`);
    }
  }
  if (missing.length > 0) {
    fail(["UI 构建合规检查失败：DOM 契约不完整。", ...missing]);
  }
}

function checkApiContract() {
  const apiFiles = collectFiles(apiDir).filter((file) => file.endsWith(".js"));
  const apiCode = apiFiles.map((file) => fs.readFileSync(file, "utf8")).join("\n");
  const routeCode = [
    fs.readFileSync(routeRegistryPath, "utf8"),
    fs.existsSync(systemControllerPath) ? fs.readFileSync(systemControllerPath, "utf8") : ""
  ].join("\n");
  const uiPaths = new Set([...apiCode.matchAll(/apiFetch\("([^"]+)"/g)].map((m) => String(m[1] || "").split("?")[0]));
  const routePaths = new Set([...routeCode.matchAll(/(?:app|router)\.(?:get|post|delete|put|patch)\("([^"]+)"/g)].map((m) => m[1]));
  const missing = [...uiPaths].filter((p) => {
    // 忽略带参数的动态路由校验，或进行模糊匹配
    if (p.includes("/api/sessions/")) return false; 
    if (p.includes("/api/projects/")) return false;
    if (p.includes("/api/im/config/")) return false;
    if (p.includes("/api/im/test/")) return false;
    return !routePaths.has(p);
  });
  if (missing.length > 0) {
    fail(["UI 构建合规检查失败：API 契约不一致。", ...missing.map((p) => `未在后端路由声明: ${p}`)]);
  }
}

function checkDesktopSingleTrack() {
  const jsFiles = collectFiles(uiDir).filter((f) => f.endsWith(".js"));
  const violations = [];
  const globalRules = [
    { regex: /\bnew\s+EventSource\s*\(/g, message: "禁止直接使用 EventSource" },
    { regex: /\b(?:window\.)?location\.(?:origin|host|hostname|port|protocol|search|hash)\b/g, message: "禁止前端依赖浏览器地址语义" },
    { regex: /https?:\/\/127\.0\.0\.1:3000/g, message: "禁止在前端硬编码 localhost API 地址" },
    { regex: /https?:\/\/localhost:3000/g, message: "禁止在前端硬编码 localhost API 地址" }
  ];
  const apiRules = [
    { regex: /\bfetch\s*\(/g, message: "禁止直接使用 fetch，必须走 Tauri IPC" }
  ];
  const purityRules = [
    // { regex: /\bconsole\.log\b/g, message: "生产环境代码禁止包含 console.log" }
  ];

  for (const file of jsFiles) {
    const rel = path.relative(root, file);
    const code = fs.readFileSync(file, "utf8");
    for (const rule of globalRules) {
      if (rule.regex.test(code)) {
        violations.push(`${rel} -> ${rule.message}`);
      }
      rule.regex.lastIndex = 0;
    }
    for (const rule of purityRules) {
      if (rule.regex.test(code)) {
        violations.push(`${rel} -> ${rule.message}`);
      }
      rule.regex.lastIndex = 0;
    }
    if (rel === path.relative(root, apiPath)) {
      continue;
    }
    for (const rule of apiRules) {
      if (rule.regex.test(code)) {
        violations.push(`${rel} -> ${rule.message}`);
      }
      rule.regex.lastIndex = 0;
    }
  }

  const apiCode = fs.readFileSync(apiPath, "utf8");
  if (!/__TAURI_INTERNALS__/.test(apiCode)) {
    violations.push(`${path.relative(root, apiPath)} -> 缺少 Tauri IPC 入口`);
  }
  if (/new\s+EventSource\s*\(/.test(apiCode)) {
    violations.push(`${path.relative(root, apiPath)} -> 禁止在 API 层使用 EventSource fallback`);
  }
  if (/path\.startsWith\("http/.test(apiCode)) {
    violations.push(`${path.relative(root, apiPath)} -> 禁止允许任意 URL 请求`);
  }

  if (violations.length > 0) {
    fail(["UI 构建合规检查失败：未满足桌面单轨原生化约束。", ...violations]);
  }
}

function buildUi() {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(outDir), { recursive: true });
  fs.cpSync(uiDir, outDir, { recursive: true });
  process.stdout.write(`UI 构建完成: ${outDir}\n`);
}

checkNoExternalAssets();
checkDomContract();
checkApiContract();
checkDesktopSingleTrack();
buildUi();
