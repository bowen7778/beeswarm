/**
 * BeeSwarm 极速开发编排器 (Fast Dev Orchestrator)
 * 职责：并行启动后端增量 Watch 和 前端 Vite HMR
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

async function collectHealthState() {
  const uiOk = await probePort(5173);
  const backend3000 = await probePort(3000);
  const backend3001 = await probePort(3001);
  const backendOk = backend3000 || backend3001;
  return {
    uiOk,
    backendOk,
    ok: uiOk && backendOk
  };
}

function formatHealthState(state) {
  return `ui=${state.uiOk}, backend=${state.backendOk}`;
}

function runtimeHint(state) {
  if (!state.backendOk) {
    return '后端端口未就绪（3000/3001）。请检查后端日志是否被端口占用或被守护锁终止。';
  }
  if (!state.uiOk) {
    return '前端端口未就绪（5173）。请检查 Vite 启动日志。';
  }
  return '';
}

async function fastDev() {
  const manifest = readManifest();
  const appName = manifest.identity?.appName || 'BeeSwarm';
  const appIdentifier = manifest.identity?.appIdentifier || 'beeswarm';
  const envPrefix = appIdentifier.toUpperCase();

  console.log('\x1b[36m%s\x1b[0m', `>>> ${appName} 极速开发轨道启动 (Zero-Build Feedback) <<<`);
  syncVersionArtifacts(manifest);

  try {
    if (os.platform() === 'win32') {
      console.log('正在清理残留进程...');
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
  let backend = null;
  let ui = null;

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
  
  const onSuccessCmd = "node build/dist/cli.cjs";
  
  backend = spawn(nodeBin, [tsupCliPath, 'src/startup/cli.ts', '--watch', '--onSuccess', onSuccessCmd], {
    stdio: 'inherit',
    shell: false,
    cwd: root,
    env: {
      ...process.env,
      [`${envPrefix}_IS_DEV`]: '1',
      NODE_ENV: 'development'
    }

  });

  bindGuard(backend, 'BACKEND');

  const viteCliPath = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
  ui = startProcess(nodeBin, [viteCliPath], 'UI_HMR', '32');
  bindGuard(ui, 'UI_HMR');

  const warmupDeadlineMs = 600000; // 10 minutes
  warmupTimer = setTimeout(() => {
    if (healthyObserved || shuttingDown) return;
    collectHealthState().then((state) => {
      const hint = runtimeHint(state);
      const extra = hint ? `，${hint}` : '';
      shutdown(1, `启动超时：600s 内未达到完整健康状态（${formatHealthState(state)}）${extra}`);
    }).catch(() => {
      shutdown(1, '启动超时：600s 内未达到完整健康状态（UI+Backend）');
    });
  }, warmupDeadlineMs);

  for (let i = 0; i < 60; i++) { // Increased probe attempts
    if (shuttingDown) return;
    const state = await collectHealthState();
    console.log('\x1b[90m%s\x1b[0m', `[DEV_GUARD] 启动探测 ${i + 1}/60: ${formatHealthState(state)}`);
    if (state.ok) {
      healthyObserved = true;
      console.log('\x1b[32m%s\x1b[0m', '[DEV_GUARD] 健康检查通过：UI+Backend 已就绪');
      break;
    }
    await wait(5000); // 5 seconds between probes
  }

  healthTimer = setInterval(async () => {
    if (shuttingDown) return;
    const state = await collectHealthState();
    if (state.ok) {
      healthyObserved = true;
      unhealthyCount = 0;
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
  }, 4000);

  process.on('SIGINT', () => {
    console.log('\x1b[31m%s\x1b[0m', '\n正在关闭开发轨道...');
    shutdown(0);
  });
}

fastDev();
