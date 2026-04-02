import fs from "node:fs/promises";
import path from "node:path";

const projectRoot = process.cwd();
const defaultConfig = {
  enforceMaxLines: false,
  maxLines: 240,
  include: [
    "src/api",
    "src/features",
    "src/system-bus",
    "src/platform",
    "src/common",
    "src/startup"
  ],
  exclude: [
    "node_modules",
    "build",
    "dist",
    "src-tauri"
  ],
  legacyAllowList: []
};

function normalizeAllowEntry(item) {
  if (typeof item === "string") {
    return { path: item, owner: "", expiresAt: "" };
  }
  if (!item || typeof item !== "object") {
    return { path: "", owner: "", expiresAt: "" };
  }
  return {
    path: String(item.path || "").trim(),
    owner: String(item.owner || "").trim(),
    expiresAt: String(item.expiresAt || "").trim()
  };
}

async function loadConfig() {
  const configPath = path.join(projectRoot, "atomic-lint.config.json");
  try {
    const raw = await fs.readFile(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    const allowEntries = Array.isArray(parsed.legacyAllowList) ? parsed.legacyAllowList.map(normalizeAllowEntry) : defaultConfig.legacyAllowList;
    return {
      ...defaultConfig,
      ...parsed,
      include: Array.isArray(parsed.include) ? parsed.include : defaultConfig.include,
      exclude: Array.isArray(parsed.exclude) ? parsed.exclude : defaultConfig.exclude,
      legacyAllowList: allowEntries
    };
  } catch {
    return defaultConfig;
  }
}

async function existsDir(absPath) {
  try {
    const stat = await fs.stat(absPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function walk(dir, collector) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(abs, collector);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(entry.name)) continue;
    if (/\.d\.ts$/i.test(entry.name)) continue;
    collector.push(abs);
  }
}

function normalizeRel(absPath) {
  return path.relative(projectRoot, absPath).split(path.sep).join("/");
}

function countPrimaryExports(content) {
  const matches = content.match(/^\s*export\s+(default\s+)?(class|function|const|let|var)\b/gm);
  return matches ? matches.length : 0;
}

function detectViolations(relPath, content, config, allowPathSet) {
  const violations = [];
  const lines = content.split(/\r?\n/).length;
  if (config.enforceMaxLines === true && lines > config.maxLines && !allowPathSet.has(relPath)) {
    violations.push(`行数超限 ${lines} > ${config.maxLines}`);
  }

  const primaryExports = countPrimaryExports(content);
  if (primaryExports > 1 && !allowPathSet.has(relPath)) {
    violations.push(`主导出数量超限 ${primaryExports} > 1`);
  }

  const injectableClassCount = (content.match(/^\s*@injectable\(\)\s*[\r\n]+\s*export\s+class\s+\w+/gm) || []).length;
  if (injectableClassCount > 1 && !allowPathSet.has(relPath)) {
    violations.push(`可注入类数量超限 ${injectableClassCount} > 1`);
  }

  if (relPath.includes("src/api/controllers/")) {
    const importStore = /^\s*import\s+.*from\s+["'][^"']*stores\/[^"']*["'];?/gm.test(content);
    if (importStore) {
      violations.push("控制器禁止直接引用 stores 目录");
    }
    const importRepository = /^\s*import\s+.*from\s+["'][^"']*(platform\/repositories|runtime\/DatabaseService|runtime\/BaseRepository)[^"']*["'];?/gm.test(content);
    if (importRepository) {
      violations.push("控制器禁止直接依赖 Repository/Database");
    }
  }

  if (relPath.includes("/usecases/")) {
    const importControllerOrExpress = /^\s*import\s+.*from\s+["'][^"']*(api\/controllers|express)[^"']*["'];?/gm.test(content);
    if (importControllerOrExpress) {
      violations.push("Usecase 禁止依赖控制器或协议框架");
    }
  }

  if (relPath.includes("/stores/")) {
    const importControllerOrExpress = /^\s*import\s+.*from\s+["'][^"']*(api\/controllers|express)[^"']*["'];?/gm.test(content);
    if (importControllerOrExpress) {
      violations.push("Store 禁止依赖控制器或协议框架");
    }
  }

  if (relPath.includes("/services/")) {
    const importControllerOrExpress = /^\s*import\s+.*from\s+["'][^"']*(api\/controllers|express)[^"']*["'];?/gm.test(content);
    if (importControllerOrExpress) {
      violations.push("Service 禁止依赖控制器或协议框架");
    }
  }

  const featureMatch = relPath.match(/^src\/features\/([^/]+)\//);
  if (featureMatch) {
    const currentFeature = featureMatch[1];
    const importLines = content.match(/^\s*import\s+.*from\s+["']([^"']+)["'];?/gm) || [];
    for (const line of importLines) {
      const match = line.match(/from\s+["']([^"']+)["']/);
      if (!match) continue;
      const importPath = match[1];
      let resolvedPath = "";
      if (importPath.startsWith(".")) {
        resolvedPath = path.posix.join(path.posix.dirname(relPath), importPath);
      } else {
        resolvedPath = importPath;
      }
      const targetFeatureMatch = resolvedPath.match(/^(?:src\/)?features\/([^/]+)\/(services|stores)\//);
      if (targetFeatureMatch) {
        const targetFeature = targetFeatureMatch[1];
        if (targetFeature !== currentFeature) {
          violations.push(`禁止跨功能目录直接引用对方 services/stores: ${importPath} -> ${targetFeature}`);
        }
      }
    }
  }


  const canUseHubSchemaInitializer =
    relPath === "src/features/mcp/session/HubSchemaInitializer.ts" ||
    relPath === "src/common/di/container.ts" ||
    relPath === "src/common/di/symbols.ts" ||
    relPath.includes("/stores/");
  if (!canUseHubSchemaInitializer) {
    const importHubInitializer = /^\s*import\s+.*from\s+["'][^"']*mcp\/session\/HubSchemaInitializer[^"']*["'];?/gm.test(content);
    const useHubSymbol = /\bSYMBOLS\.HubSchemaInitializer\b/gm.test(content);
    if (importHubInitializer || useHubSymbol) {
      violations.push("HubSchemaInitializer 仅允许在 stores、初始化器本体与 DI 容器层使用");
    }
  }

  return violations;
}

async function main() {
  const config = await loadConfig();
  const normalizedAllowList = Array.isArray(config.legacyAllowList) ? config.legacyAllowList.map(normalizeAllowEntry) : [];
  const allowPathSet = new Set(normalizedAllowList.map((x) => x.path).filter(Boolean));
  const files = [];
  for (const dir of config.include) {
    const abs = path.join(projectRoot, dir);
    if (!(await existsDir(abs))) continue;
    await walk(abs, files);
  }

  const allViolations = [];
  for (const item of normalizedAllowList) {
    if (!item.path) {
      allViolations.push({ file: "atomic-lint.config.json", violations: ["例外项 path 不能为空"] });
      continue;
    }
    if (!item.owner || !item.expiresAt) {
      allViolations.push({ file: "atomic-lint.config.json", violations: [`例外项缺少 owner/expiresAt: ${item.path}`] });
      continue;
    }
    const absPath = path.join(projectRoot, item.path);
    try {
      await fs.stat(absPath);
    } catch {
      allViolations.push({ file: "atomic-lint.config.json", violations: [`例外项文件不存在: ${item.path}`] });
    }
  }

  for (const file of files) {
    const relPath = normalizeRel(file);
    const isExcluded = config.exclude.some((item) => relPath.startsWith(item.replace(/\\/g, "/")));
    if (isExcluded) continue;
    const content = await fs.readFile(file, "utf-8");
    const violations = detectViolations(relPath, content, config, allowPathSet);
    const filteredViolations = violations.filter(v => {
      if (allowPathSet.has(relPath)) {
        // 如果在例外清单中，则忽略除配置错误外的所有原子化违规
        return false;
      }
      return true;
    });
    if (filteredViolations.length > 0) {
      allViolations.push({ file: relPath, violations: filteredViolations });
    }

  }

  if (allViolations.length > 0) {
    process.stderr.write("Atomic lint failed\n");
    for (const item of allViolations) {
      process.stderr.write(`- ${item.file}\n`);
      for (const v of item.violations) {
        process.stderr.write(`  - ${v}\n`);
      }
    }
    process.exit(1);
  }

  process.stdout.write(`Atomic lint passed (${files.length} files checked)\n`);
}

main().catch((err) => {
  process.stderr.write(`Atomic lint crashed: ${String(err?.message || err)}\n`);
  process.exit(1);
});
