/**
 * BeeMCP 极速开发编排器 (Fast Dev Orchestrator)
 * 职责：并行启动后端增量 Watch、前端 Vite HMR 以及 Rust Master
 * 目标：保存即生效，1秒反馈。
 */

import { spawn, execSync, exec } from 'child_process';
import path from 'path';
import os from 'os';
import net from 'net';
import { promisify } from 'util';
import { readManifest, syncVersionArtifacts } from './release.mjs';

const root = process.cwd();
const nodeBin = process.execPath;
const execAsync = promisify(exec);

function isProcAlive(proc) {
  return !!proc && !proc.killed && proc.exitCode == null;
}

// 辅助函数：启动并继承 Stdio (保持 IDE 监控)
function startProcess(command, args, label, color) {
  console.log(`\x1b[${color}m%s\x1b[0m`, `[${label}] 启动中...`);
  const proc = spawn(command, args, {
    stdio: 'inherit',
    shell: false,
    cwd: root
  });

  proc.on('error', (err) => {
    console.error(`\x1b[31m%s\x1b[0m`, `[${label}] 启动失败: ${err.message}`);
  });

  return proc;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function probePort(port, host = '127.0.0.1', timeoutMs = 1200) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      try { socket.destroy(); } catch {}
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

async function hasAppProcess() {
  if (os.platform() !== 'win32') return true;
  try {
    const { stdout } = await execAsync('tasklist /FI "IMAGENAME eq app.exe" /FO CSV /NH');
    const text = String(stdout || '').trim().toLowerCase();
    if (!text || text.includes('no tasks are running')) return false;
    return text.includes('app.exe');
  } catch {
    return false;
  }
}

async function collectHealthState() {
  const uiOk = await probePort(5173);
  const backend3000 = await probePort(3000);
  const backend3001 = await probePort(3001);
  const backendOk = backend3000 || backend3001;
  const appOk = await hasAppProcess();
  return {
    uiOk,
    backendOk,
    appOk,
    ok: uiOk && backendOk && appOk
  };
}

function formatHealthState(state) {
  return `ui=${state.uiOk}, backend=${state.backendOk}, desktop=${state.appOk}`;
}

function runtimeHint(state) {
  if (!state.appOk) {
    return '桌面进程未检测到。若在 IDE 代理终端中运行，请改用本机 PowerShell 直接执行 npm run dev。';
  }
  if (!state.backendOk) {
    return '后端端口未就绪（3000/3001）。请检查后端日志是否被端口占用或被守护锁终止。';
  }
  if (!state.uiOk) {
    return '前端端口未就绪（5173）。请检查 Vite 启动日志。';
  }
  return '';
}

async function fastDev() {
  console.log('\x1b[36m%s\x1b[0m', '>>> BeeMCP 极速开发轨道启动 (Zero-Build Feedback) <<<');
  syncVersionArtifacts(readManifest());

  try {
    if (os.platform() === 'win32') {
      console.log('正在清理残留进程...');
      try { execSync('taskkill /F /IM app.exe /T', { stdio: 'ignore' }); } catch (e) {}
      const ports = [3000, 5173];
      for (const port of ports) {
        try {
          const portOut = execSync(`netstat -ano | findstr :${port}`).toString();
          const lines = portOut.split('\n');
          for (const line of lines) {
            if (line.includes('LISTENING')) {
              const pid = line.trim().split(/\s+/).pop();
              if (pid) execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
            }
          }
        } catch (e) {}
      }
    }
  } catch (e) {}

  let shuttingDown = false;
  let healthTimer = null;
  let warmupTimer = null;
  let healthyObserved = false;
  let unhealthyCount = 0;
  let desktopMissingCount = 0;
  let desktopRestartCount = 0;
  let desktopRestartWindowStartedAt = 0;
  let backend = null;
  let ui = null;
  let desktop = null;

  const shutdown = (code = 0, reason = '') => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (reason) {
      console.error('\x1b[31m%s\x1b[0m', `[DEV_GUARD] ${reason}`);
    }
    if (healthTimer) clearInterval(healthTimer);
    if (warmupTimer) clearTimeout(warmupTimer);
    try { if (isProcAlive(backend)) backend.kill(); } catch {}
    try { if (isProcAlive(ui)) ui.kill(); } catch {}
    try { if (isProcAlive(desktop)) desktop.kill(); } catch {}
    process.exit(code);
  };

  const bindGuard = (proc, label) => {
    proc.on('exit', (code, signal) => {
      if (shuttingDown) return;
      shutdown(1, `${label} 已退出 (code=${code ?? 'null'}, signal=${signal ?? 'null'})`);
    });
    proc.on('error', (err) => {
      if (shuttingDown) return;
      shutdown(1, `${label} 启动异常: ${err?.message || err}`);
    });
  };

  console.log(`\x1b[32m%s\x1b[0m`, `[BACKEND] 启动后端内核 (tsup watch + onSuccess)...`);
  const tsupCliPath = path.join(root, 'node_modules', 'tsup', 'dist', 'cli-default.js');
  backend = spawn(nodeBin, [tsupCliPath, 'src/startup/cli.ts', '--watch', '--onSuccess', 'node build/dist/cli.cjs'], {
    stdio: 'inherit',
    shell: false,
    cwd: root,
    env: {
      ...process.env,
      BEEMCP_IS_DEV: '1',
      NODE_ENV: 'development'
    }
  });

  bindGuard(backend, 'BACKEND');

  const viteCliPath = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
  ui = startProcess(nodeBin, [viteCliPath], 'UI_HMR', '32');
  bindGuard(ui, 'UI_HMR');

  const tauriCliPath = path.join(root, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');
  const spawnDesktop = () => {
    desktop = startProcess(nodeBin, [tauriCliPath, 'dev'], 'RUST_MASTER', '35');
    desktop.on('exit', (code, signal) => {
      if (shuttingDown) return;
      const now = Date.now();
      if (!desktopRestartWindowStartedAt || now - desktopRestartWindowStartedAt > 60000) {
        desktopRestartWindowStartedAt = now;
        desktopRestartCount = 0;
      }
      desktopRestartCount += 1;
      if (desktopRestartCount > 3) {
        shutdown(1, `RUST_MASTER 多次退出 (code=${code ?? 'null'}, signal=${signal ?? 'null'})`);
        return;
      }
      console.error('\x1b[33m%s\x1b[0m', `[DEV_GUARD] RUST_MASTER 已退出，正在尝试自动重启 (${desktopRestartCount}/3)`);
      setTimeout(() => {
        if (shuttingDown) return;
        spawnDesktop();
      }, 1500);
    });
    desktop.on('error', (err) => {
      if (shuttingDown) return;
      shutdown(1, `RUST_MASTER 启动异常: ${err?.message || err}`);
    });
  };
  spawnDesktop();

  const warmupDeadlineMs = 90000;
  warmupTimer = setTimeout(() => {
    if (healthyObserved || shuttingDown) return;
    collectHealthState().then((state) => {
      const hint = runtimeHint(state);
      const extra = hint ? `，${hint}` : '';
      shutdown(1, `启动超时：90s 内未达到完整健康状态（${formatHealthState(state)}）${extra}`);
    }).catch(() => {
      shutdown(1, '启动超时：90s 内未达到完整健康状态（UI+Backend+Desktop）');
    });
  }, warmupDeadlineMs);

  for (let i = 0; i < 15; i++) {
    if (shuttingDown) return;
    const state = await collectHealthState();
    console.log('\x1b[90m%s\x1b[0m', `[DEV_GUARD] 启动探测 ${i + 1}/15: ${formatHealthState(state)}`);
    if (state.ok) {
      healthyObserved = true;
      console.log('\x1b[32m%s\x1b[0m', '[DEV_GUARD] 健康检查通过：UI+Backend+Desktop 已就绪');
      break;
    }
    await wait(2000);
  }

  healthTimer = setInterval(async () => {
    if (shuttingDown) return;
    const state = await collectHealthState();
    if (state.ok) {
      healthyObserved = true;
      unhealthyCount = 0;
      desktopMissingCount = 0;
      return;
    }
    if (!healthyObserved) return;
    if (!state.uiOk || !state.backendOk) {
      unhealthyCount += 1;
    } else {
      unhealthyCount = 0;
    }
    if (unhealthyCount >= 3) {
      const hint = runtimeHint(state);
      const reason = `运行态健康检查失败：${formatHealthState(state)}${hint ? `，${hint}` : ''}`;
      shutdown(1, reason);
      return;
    }
    if (!state.appOk) {
      desktopMissingCount += 1;
      if (desktopMissingCount >= 3) {
        desktopMissingCount = 0;
        if (!isProcAlive(desktop)) {
          console.error('\x1b[33m%s\x1b[0m', '[DEV_GUARD] 桌面进程未检测到，触发重启 RUST_MASTER');
          spawnDesktop();
        }
      }
    } else {
      desktopMissingCount = 0;
    }
  }, 4000);

  process.on('SIGINT', () => {
    console.log('\x1b[31m%s\x1b[0m', '\n正在关闭开发轨道...');
    shutdown(0);
  });
}

fastDev();
