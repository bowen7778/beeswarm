/**
 * BeeMCP 全量发布编排器 (Release Orchestrator)
 * 职责：版本管理 -> 全量构建 -> 影子打包 -> 验证准备
 * 目标：一键生成符合云端热更新规范的全量包。
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const root = process.cwd();
const manifestPath = path.join(root, 'manifest.json');
const releaseDir = path.join(root, 'releases');
const packageJsonPath = path.join(root, 'package.json');
const packageLockPath = path.join(root, 'package-lock.json');
const tauriConfigPath = path.join(root, 'src-tauri', 'tauri.conf.json');
const cargoTomlPath = path.join(root, 'src-tauri', 'Cargo.toml');
const releaseRepo = String(process.env.BEEMCP_RELEASE_REPO || 'bowen7778/beeswarm').trim();

function log(msg, color = '36') {
  console.log(`\x1b[${color}m%s\x1b[0m`, `[Release] ${msg}`);
}

function getReleaseBranch() {
  return 'stable';
}

export function readManifest() {
  if (!fs.existsSync(manifestPath)) {
    throw new Error('manifest.json 不存在');
  }
  return JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function updateCargoTomlVersion(content, version) {
  return content.replace(/(^version\s*=\s*")[^"]+(")/m, `$1${version}$2`);
}

function sha256File(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

function runGate(command, label) {
  log(`正在执行发布门禁校验 (${label})...`);
  execSync(command, { stdio: 'inherit', cwd: root });
}

export function syncVersionArtifacts(manifest = readManifest()) {
  const normalizedVersion = String(manifest.version || '').trim() || '0.0.0';

  if (fs.existsSync(packageJsonPath)) {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    packageJson.version = normalizedVersion;
    writeJson(packageJsonPath, packageJson);
  }

  if (fs.existsSync(packageLockPath)) {
    const packageLock = JSON.parse(fs.readFileSync(packageLockPath, 'utf-8'));
    packageLock.version = normalizedVersion;
    if (packageLock.packages && packageLock.packages['']) {
      packageLock.packages[''].version = normalizedVersion;
    }
    writeJson(packageLockPath, packageLock);
  }

  if (fs.existsSync(tauriConfigPath)) {
    const tauriConfig = JSON.parse(fs.readFileSync(tauriConfigPath, 'utf-8'));
    tauriConfig.version = normalizedVersion;
    writeJson(tauriConfigPath, tauriConfig);
  }

  if (fs.existsSync(cargoTomlPath)) {
    const cargoToml = fs.readFileSync(cargoTomlPath, 'utf-8');
    fs.writeFileSync(cargoTomlPath, updateCargoTomlVersion(cargoToml, normalizedVersion));
  }

  return normalizedVersion;
}

function bumpPatchVersion(version) {
  const versionParts = String(version || '0.0.0').split('.').map(Number);
  while (versionParts.length < 3) versionParts.push(0);
  versionParts[2] += 1;
  return versionParts.join('.');
}

async function release() {
  log('>>> 启动全量发布流程 <<<');
  const manifest = readManifest();
  const oldVersion = manifest.version;
  
  // Allow manual version override via --version X.Y.Z
  const versionArgIndex = process.argv.indexOf('--version');
  let newVersion = '';
  if (versionArgIndex !== -1 && process.argv[versionArgIndex + 1]) {
    newVersion = process.argv[versionArgIndex + 1];
  } else {
    newVersion = bumpPatchVersion(oldVersion);
  }

  manifest.version = newVersion;
  manifest.releaseDate = new Date().toISOString().split('T')[0];
  writeJson(manifestPath, manifest);
  syncVersionArtifacts(manifest);
  log(`版本状态: ${oldVersion} -> ${newVersion}`);

  try {
    runGate('pnpm run typecheck', 'typecheck');
    log('正在执行全量生产环境构建 (Server & UI)...');
    execSync('pnpm run build', { stdio: 'inherit', cwd: root });
  } catch (e) {
    log('门禁或构建失败，终止发布', '31');
    process.exit(1);
  }

  const currentReleaseDir = path.join(releaseDir, `v${newVersion}`);
  if (fs.existsSync(currentReleaseDir)) {
    fs.rmSync(currentReleaseDir, { recursive: true, force: true });
  }
  fs.mkdirSync(currentReleaseDir, { recursive: true });

  log('正在归档核心产物...');
  const distSource = path.join(root, 'build', 'dist');
  const packageRoot = path.join(currentReleaseDir, 'kernel');
  fs.mkdirSync(packageRoot, { recursive: true });
  fs.cpSync(distSource, path.join(packageRoot, 'dist'), { recursive: true });
  writeJson(path.join(packageRoot, 'manifest.json'), manifest);

  log('正在生成全量压缩包 (kernel.tar.gz)...');
  const archivePath = path.join(currentReleaseDir, 'kernel.tar.gz');
  try {
    execSync(`tar -czf "kernel.tar.gz" -C "${packageRoot}" .`, { cwd: root });
    fs.renameSync(path.join(root, 'kernel.tar.gz'), archivePath);
  } catch (e) {
    log('压缩失败', '31');
    process.exit(1);
  }

  const archiveSha256 = sha256File(archivePath);
  const latestInfo = {
    version: newVersion,
    releaseDate: manifest.releaseDate,
    url: `https://github.com/${releaseRepo}/releases/download/v${newVersion}/kernel.tar.gz`,
    sha256: archiveSha256,
    releaseNotes: `BeeMCP Kernel v${newVersion} released.`
  };
  fs.writeFileSync(path.join(releaseDir, 'latest.json'), JSON.stringify(latestInfo, null, 2));

  log(`>>> 发布准备就绪！`, '32');
  log(`全量包: ${archivePath}`, '32');
  log(`元数据: ${path.join(releaseDir, 'latest.json')}`, '32');

  if (process.argv.includes('--push')) {
    try {
      const branch = getReleaseBranch();
      log(`检测到发布指令，准备同步到发布分支: ${branch}`);
      execSync('git add .', { cwd: root });
      execSync(`git commit -m "release: v${newVersion}"`, { cwd: root });
      execSync(`git tag v${newVersion}`, { cwd: root });
      
      log(`正在推送到远程分支: ${branch}...`);
      // Force push current state to stable branch to ensure it matches current main exactly
      execSync(`git push origin main:${branch} --force`, { cwd: root });
      
      if (newVersion !== oldVersion || process.argv.includes('--version')) {
        execSync(`git push origin v${newVersion}`, { cwd: root });
        log(`>>> [状态 C] 官方版本发布已完成！版本: v${newVersion}`, '32');
      } else {
        log(`>>> [状态 B] 滚动更新发布已完成！`, '32');
      }
      
      log(`>>> 请前往 https://github.com/${releaseRepo}/actions 观察构建进度。`, '32');
    } catch (err) {
      log(`Git 推送失败: ${err.message}`, '31');
    }
  } else {
    log('默认不自动推送 Git。若需自动推送，请执行: npm run release:push', '33');
  }
}

async function main() {
  if (process.argv.includes('--sync-only')) {
    const manifest = readManifest();
    const version = syncVersionArtifacts(manifest);
    log(`版本制品已同步到 ${version}`, '32');
    return;
  }
  await release();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    log(err?.message || String(err), '31');
    process.exit(1);
  });
}
