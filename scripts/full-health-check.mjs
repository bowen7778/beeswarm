/**
 * BeeSwarm 全量功能检测脚本 (Full Health Check)
 * 
 * 该脚本独立于运行时进程，用于全量化检测程序核心功能点：
 * 1. 静态环境与依赖检测 (Static & Dependencies)
 * 2. 数据库与 Schema 迁移检测 (Database & Migrations)
 * 3. 核心规则与门禁检测 (Rules & Atomic Lints)
 * 4. 关键服务初始化检测 (Services & DI)
 * 5. 资源文件与构建产物检测 (Resources & Build)
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

// 颜色输出辅助
const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  bold: "\x1b[1m"
};

const logger = {
  info: (msg) => console.log(`${colors.blue}[INFO]${colors.reset} ${msg}`),
  success: (msg) => console.log(`${colors.green}[PASS]${colors.reset} ${msg}`),
  warn: (msg) => console.log(`${colors.yellow}[WARN]${colors.reset} ${msg}`),
  error: (msg) => console.error(`${colors.red}[FAIL]${colors.reset} ${msg}`),
  section: (title) => console.log(`\n${colors.bold}${colors.cyan}=== ${title} ===${colors.reset}`)
};

async function runCheck() {
  logger.section("BeeSwarm Full Health Check Started");
  let hasError = false;

  // --- 1. 静态环境检测 ---
  logger.section("1. Static Environment & Dependencies");
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
    logger.success(`Package identity: ${pkg.name}@${pkg.version}`);
    
    if (!fs.existsSync(path.join(projectRoot, 'node_modules'))) {
      throw new Error("node_modules not found. Please run 'npm install'.");
    }
    logger.success("Dependencies installed.");
  } catch (err) {
    logger.error(err.message);
    hasError = true;
  }

  // --- 2. 数据库与 Schema 统一化检测 ---
  logger.section("2. Database & Schema Unification");
  const hubDbPath = path.join(process.env.APPDATA || '', 'beeswarm', 'system', 'hub', 'conversation_hub.db');
  // 模拟 PathResolver 逻辑，如果是本地开发模式可能在不同位置
  const possibleDbPaths = [
    hubDbPath,
    path.join(projectRoot, '.beeswarm-runtime', 'system', 'hub', 'conversation_hub.db')
  ];

  let dbPath = possibleDbPaths.find(p => fs.existsSync(p));
  if (dbPath) {
    logger.info(`Checking database at: ${dbPath}`);
    try {
      const db = new DatabaseSync(dbPath);
      // 检查统一元数据表
      const metadataTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='metadata'").get();
      if (!metadataTable) throw new Error("Unified 'metadata' table missing.");
      
      const version = db.prepare("SELECT value FROM metadata WHERE key = 'sys.version'").get();
      logger.success(`Database schema unified. Current Version: v${version?.value || 0}`);
      
      // 检查旧表是否已清理
      const legacyTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='_schema_metadata'").get();
      if (legacyTable) logger.warn("Legacy '_schema_metadata' table still exists. Cleanup recommended.");
      
      db.close();
    } catch (err) {
      logger.error(`Database Check Failed: ${err.message}`);
      hasError = true;
    }
  } else {
    logger.warn("Hub database not found. Skipping live DB checks (this is normal for clean installs).");
  }

  // --- 3. 核心规则与门禁检测 (Dry Run) ---
  logger.section("3. Rules & Atomic Enforcement");
  try {
    logger.info("Running Atomic Lint check...");
    execSync('npm run lint:atomic', { cwd: projectRoot, stdio: 'inherit' });
    logger.success("Atomic rules enforcement passed.");

    logger.info("Running Type check...");
    execSync('npx tsc --noEmit', { cwd: projectRoot, stdio: 'inherit' });
    logger.success("TypeScript integrity check passed.");
  } catch (err) {
    logger.error("Static analysis failed. Check logs above.");
    hasError = true;
  }

  // --- 4. 关键服务文件检测 ---
  logger.section("4. Core Service Integrity");
  const criticalFiles = [
    'src/features/runtime/BaseRepository.ts',
    'src/features/runtime/MigrationService.ts',
    'src/features/im/feishu/FeishuProvider.ts',
    'src/common/di/container.ts',
    'src/common/di/symbols.ts'
  ];

  for (const file of criticalFiles) {
    const fullPath = path.join(projectRoot, file);
    if (fs.existsSync(fullPath)) {
      logger.success(`Found critical file: ${file}`);
    } else {
      logger.error(`CRITICAL FILE MISSING: ${file}`);
      hasError = true;
    }
  }

  // --- 5. 构建产物检测 ---
  logger.section("5. Build Artifacts & UI");
  const buildDirs = ['dist', 'ui/dist']; // 根据实际构建配置调整
  for (const dir of buildDirs) {
    if (fs.existsSync(path.join(projectRoot, dir))) {
      logger.success(`Build directory exists: ${dir}`);
    } else {
      logger.warn(`Build directory missing: ${dir}. Run 'npm run build' if needed.`);
    }
  }

  // --- 总结 ---
  logger.section("Final Summary");
  if (hasError) {
    logger.error(`${colors.bold}Health check FAILED.${colors.reset} Please fix the issues above before proceeding.`);
    process.exit(1);
  } else {
    logger.success(`${colors.bold}All systems GO!${colors.reset} Project is in a healthy state.`);
    process.exit(0);
  }
}

runCheck();
