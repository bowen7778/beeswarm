import { exec, execSync, spawn } from "child_process";
import { promisify } from "util";
import net from "net";
import os from "os";
import path from "path";
import fs from "fs";

const execAsync = promisify(exec);
const root = process.cwd();
const nodeBin = process.execPath;

function parseArgValue(flag, defaultValue) {
  const hit = process.argv.find((x) => x.startsWith(`${flag}=`));
  if (!hit) return defaultValue;
  const value = hit.slice(flag.length + 1).trim();
  return value || defaultValue;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function color(text, code) {
  return `\x1b[${code}m${text}\x1b[0m`;
}

function ok(label, value) {
  console.log(color(`✔ ${label}: ${value}`, 32));
}

function warn(label, value) {
  console.log(color(`⚠ ${label}: ${value}`, 33));
}

function fail(label, value) {
  console.log(color(`✖ ${label}: ${value}`, 31));
}

function probePort(port, host = "127.0.0.1", timeoutMs = 1200) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      try { socket.destroy(); } catch {}
      resolve(v);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, host);
  });
}

async function hasAppProcess() {
  if (os.platform() !== "win32") return false;
  try {
    const { stdout } = await execAsync('tasklist /FI "IMAGENAME eq app.exe" /FO CSV /NH');
    const text = String(stdout || "").trim().toLowerCase();
    if (!text || text.includes("no tasks are running")) return false;
    return text.includes("app.exe");
  } catch {
    return false;
  }
}

function cmdExists(command) {
  try {
    execSync(command, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const probeMode = process.argv.includes("--probe");
  const probeLogMode = process.argv.includes("--probe-log");
  const probeWindowMsRaw = Number(parseArgValue("--probe-ms", "5000"));
  const probeWindowMs = Number.isFinite(probeWindowMsRaw) ? Math.max(1000, probeWindowMsRaw) : 5000;
  let score = 0;
  let total = 0;
  const track = (pass) => {
    total += 1;
    if (pass) score += 1;
  };

  console.log(color("=== BeeMCP Dev Doctor ===", 36));
  ok("platform", `${os.platform()} ${os.release()}`);
  ok("node", process.version);

  const cargoOk = cmdExists("cargo --version");
  track(cargoOk);
  if (cargoOk) ok("cargo", "可用");
  else fail("cargo", "不可用");

  const rustcOk = cmdExists("rustc --version");
  track(rustcOk);
  if (rustcOk) ok("rustc", "可用");
  else fail("rustc", "不可用");

  const tauriCli = path.join(root, "node_modules", "@tauri-apps", "cli", "tauri.js");
  const tauriOk = fs.existsSync(tauriCli);
  track(tauriOk);
  if (tauriOk) ok("tauri cli", tauriCli);
  else fail("tauri cli", "缺失，请先安装依赖 npm install");

  const webviewPossiblePaths = [
    path.join(process.env["ProgramFiles(X86)"] || "", "Microsoft", "EdgeWebView", "Application"),
    path.join(process.env["ProgramFiles"] || "", "Microsoft", "EdgeWebView", "Application")
  ];
  const webviewOk = webviewPossiblePaths.some((p) => p && fs.existsSync(p));
  track(webviewOk);
  if (webviewOk) ok("webview2 runtime", "检测到安装目录");
  else warn("webview2 runtime", "未检测到标准安装目录，可能导致桌面窗口无法弹出");

  const ui5173 = await probePort(5173);
  if (ui5173) ok("port 5173", "可连接");
  else warn("port 5173", "未监听（dev 未启动时属正常）");

  const backend3000 = await probePort(3000);
  const backend3001 = await probePort(3001);
  const backendOk = backend3000 || backend3001;
  if (backendOk) ok("backend port", backend3000 ? "3000 可连接" : "3001 可连接");
  else warn("backend port", "3000/3001 未监听（dev 未启动时属正常）");

  const appOk = await hasAppProcess();
  if (appOk) ok("app.exe", "运行中");
  else warn("app.exe", "未检测到运行实例");

  if (probeMode) {
    if (!tauriOk) {
      track(false);
      fail("probe", "无法执行，tauri cli 缺失");
    } else if (!ui5173) {
      track(false);
      fail("probe", "阻断：前端 dev server 未就绪（http://localhost:5173）。请先运行 npm run dev 后再执行 probe。");
    } else {
      const alreadyRunning = await hasAppProcess();
      let observed = alreadyRunning;
      let proc = null;
      let logFilePath = "";
      let stream = null;
      let probeExitCode = null;
      try {
        if (probeLogMode) {
          const logsDir = path.join(root, ".beemcp-runtime", "logs");
          fs.mkdirSync(logsDir, { recursive: true });
          const stamp = new Date().toISOString().replace(/[:.]/g, "-");
          logFilePath = path.join(logsDir, `dev-doctor-probe-${stamp}.log`);
          stream = fs.createWriteStream(logFilePath, { flags: "a" });
          stream.write(`[probe] started at ${new Date().toISOString()}\n`);
          stream.write(`[probe] windowMs=${probeWindowMs}\n`);
        }
        proc = spawn(nodeBin, [tauriCli, "dev"], {
          cwd: root,
          stdio: probeLogMode ? ["ignore", "pipe", "pipe"] : "ignore",
          shell: false,
          env: {
            ...process.env,
            BEEMCP_IS_DEV: "1",
            NODE_ENV: "development"
          }
        });
        if (probeLogMode && stream) {
          proc.stdout?.on("data", (chunk) => stream?.write(String(chunk)));
          proc.stderr?.on("data", (chunk) => stream?.write(String(chunk)));
        }
        proc.on("exit", (code) => {
          probeExitCode = code;
          if (probeLogMode && stream) {
            stream.write(`\n[probe] tauri exit code=${code}\n`);
          }
        });
        const startedAt = Date.now();
        while (Date.now() - startedAt < probeWindowMs) {
          if (probeExitCode !== null) break;
          if (await hasAppProcess()) {
            observed = true;
            break;
          }
          await wait(400);
        }
      } finally {
        try {
          if (proc && proc.pid && os.platform() === "win32") {
            execSync(`taskkill /F /T /PID ${proc.pid}`, { stdio: "ignore" });
          }
        } catch {}
        try { proc?.kill(); } catch {}
        if (probeLogMode && stream) {
          stream.write(`[probe] finished at ${new Date().toISOString()}\n`);
          stream.end();
        }
      }
      track(observed);
      if (observed) {
        ok("probe", `主动探测通过（${probeWindowMs}ms 内检测到 app.exe）`);
      } else {
        const exitInfo = probeExitCode !== null ? `，tauri 提前退出 code=${probeExitCode}` : "";
        const logInfo = logFilePath ? `，日志：${logFilePath}` : "";
        fail("probe", `主动探测失败（${probeWindowMs}ms 内未检测到 app.exe${exitInfo}${logInfo}）`);
      }
      if (probeLogMode && logFilePath) {
        ok("probe log", logFilePath);
      }
    }
  }

  const ciLike = process.env.CI === "true" || !process.stdout.isTTY;
  if (ciLike) {
    warn("terminal mode", "当前终端可能为非交互会话，GUI 不一定可见");
  } else {
    ok("terminal mode", "交互会话");
  }

  const summary = `${score}/${total}`;
  if (score === total) {
    ok("doctor result", `通过 ${summary}`);
    process.exit(0);
  }
  warn("doctor result", `部分检查未通过 ${summary}`);
  process.exit(1);
}

main().catch((err) => {
  fail("doctor crashed", String(err?.message || err));
  process.exit(1);
});
