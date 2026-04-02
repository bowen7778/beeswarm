/**
 * BeeMCP Sidecar 自动化配置脚本
 * 职责：自动识别系统架构 -> 下载精简版 Node.js -> 按照 Tauri 规范重命名
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import os from 'os';
import { readManifest } from './release.mjs';

const root = process.cwd();
const sidecarDir = path.join(root, 'src-tauri', 'bin');

// 1. 获取当前系统的 Target Triple (Tauri 要求的命名后缀)
function getTargetTriple() {
  const platform = os.platform();
  const arch = os.arch();

  if (platform === 'win32') {
    return arch === 'x64' ? 'x86_64-pc-windows-msvc' : 'i686-pc-windows-msvc';
  } else if (platform === 'darwin') {
    return arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin';
  } else if (platform === 'linux') {
    return arch === 'x64' ? 'x86_64-unknown-linux-gnu' : 'aarch64-unknown-linux-gnu';
  }
  throw new Error(`Unsupported platform: ${platform}`);
}

function getNodeDownloadUrl() {
  const platform = os.platform();
  const arch = os.arch();
  const manifest = readManifest();
  const version = `v${String(manifest?.runtime?.node || '20.11.1').replace(/^v/, '')}`;

  if (platform === 'win32') {
    return `https://nodejs.org/dist/${version}/node-${version}-win-${arch}.zip`;
  } else if (platform === 'darwin') {
    return `https://nodejs.org/dist/${version}/node-${version}-darwin-${arch}.tar.gz`;
  } else if (platform === 'linux') {
    return `https://nodejs.org/dist/${version}/node-${version}-linux-${arch}.tar.xz`;
  }
}

async function setup() {
  const triple = getTargetTriple();
  const ext = os.platform() === 'win32' ? '.exe' : '';
  const targetName = `node-${triple}${ext}`;
  const targetPath = path.join(sidecarDir, targetName);

  if (fs.existsSync(targetPath)) {
    console.log(`\x1b[32m%s\x1b[0m`, `[Sidecar] ${targetName} 已存在，跳过下载。`);
    return;
  }

  if (!fs.existsSync(sidecarDir)) {
    fs.mkdirSync(sidecarDir, { recursive: true });
  }

  console.log('\x1b[36m%s\x1b[0m', `[Sidecar] 正在为 ${triple} 配置 Node.js 运行时...`);
  try {
    let nodePath = '';
    if (os.platform() === 'win32') {
      try {
        nodePath = execSync('where node').toString().trim().split('\r\n')[0];
      } catch (e) {
        nodePath = execSync('powershell -Command "(Get-Command node).Source"').toString().trim();
      }
    } else {
      nodePath = execSync('which node').toString().trim();
    }

    if (nodePath && fs.existsSync(nodePath)) {
      fs.copyFileSync(nodePath, targetPath);
      console.log('\x1b[32m%s\x1b[0m', `[Sidecar] 成功将系统 Node 映射为 Sidecar: ${targetName}`);
    } else {
      throw new Error('Could not find node path');
    }
  } catch (err) {
    console.error('\x1b[31m%s\x1b[0m', `[Sidecar] 无法自动配置 Sidecar，请手动将 node 复制到 ${targetPath}`);
  }
}

setup();
