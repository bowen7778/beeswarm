import { injectable } from "inversify";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { RuntimeFsService } from "./RuntimeFsService.js";

@injectable()
export class PortOwnershipService {
  private runPowerShell(command: string): string {
    const result = spawnSync("powershell", ["-NoProfile", "-Command", command], {
      encoding: "utf-8",
      windowsHide: true
    });
    return String(result.stdout || "").trim();
  }

  private runShell(command: string): string {
    const result = spawnSync("sh", ["-lc", command], {
      encoding: "utf-8",
      windowsHide: true
    });
    return String(result.stdout || "").trim();
  }

  private detectListeningPidOnPort(port: number): number | null {
    let output = "";
    if (process.platform === "win32") {
      output = this.runPowerShell(`$p = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess; if($p){$p}`);
    } else if (process.platform === "darwin") {
      output = this.runShell(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t | head -n 1`);
    } else if (process.platform === "linux") {
      output = this.runShell(`ss -ltnp "sport = :${port}" | grep -oP "pid=\\K\\d+" | head -n 1`);
      if (!output) {
        output = this.runShell(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t | head -n 1`);
      }
    } else {
      return null;
    }
    const pid = Number(output);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  }

  private readProcessCommandLine(pid: number): string {
    if (process.platform === "win32") {
      return this.runPowerShell(`$p = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty CommandLine; if($p){$p}`);
    }
    if (process.platform === "darwin" || process.platform === "linux") {
      return this.runShell(`ps -p ${pid} -o command=`);
    }
    return "";
  }

  private readProcessName(pid: number): string {
    if (process.platform === "win32") {
      return this.runPowerShell(`$p = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name; if($p){$p}`);
    }
    if (process.platform === "darwin" || process.platform === "linux") {
      return this.runShell(`basename "$(ps -p ${pid} -o comm=)"`);
    }
    return "";
  }

  private looksLikeOurServerCommandLine(commandLine: string): boolean {
    const text = String(commandLine || "").replace(/\\/g, "/").toLowerCase();
    if (!text) return false;
    const currentEntry = String(path.resolve(process.argv[1] || "")).replace(/\\/g, "/").toLowerCase();
    if (currentEntry && text.includes(currentEntry)) {
      return true;
    }
    if (text.includes("mcp-server-final") && (text.includes("/.artifacts/product/index.js") || text.includes("/dist/index.js"))) {
      return true;
    }
    return (text.includes("node.exe") || text.includes(" node "))
      && (text.includes(".artifacts/product/index.js") || text.includes("dist/index.js"));
  }

  private async waitForProcessExit(pid: number, rounds: number, delayMs: number): Promise<boolean> {
    for (let i = 0; i < rounds; i += 1) {
      if (!RuntimeFsService.processAlive(pid)) return true;
      await new Promise((r) => setTimeout(r, delayMs));
    }
    return !RuntimeFsService.processAlive(pid);
  }

  /**
   * Dynamically find an available port
   */
  async findAvailablePort(startPort: number): Promise<number> {
    const net = await import("node:net");
    return new Promise((resolve, reject) => {
      let port = startPort;
      const tryPort = () => {
        const server = net.createServer();
        server.unref();
        server.on("error", (err: any) => {
          if (err.code === "EADDRINUSE") {
            port += 1;
            tryPort();
          } else {
            reject(err);
          }
        });
        server.listen(port, "127.0.0.1", () => {
          server.close(() => {
            resolve(port);
          });
        });
      };
      tryPort();
    });
  }

  /**
   * Thoroughly cleanup leftover zombie processes (based on process name and command line features)
   */
  async cleanupZombieProcesses(): Promise<void> {
    if (process.platform !== "win32") return;
    
    try {
      // Terminate all processes named beemcp.exe (except current process)
      const pids = this.runPowerShell(`Get-Process beemcp -ErrorAction SilentlyContinue | Where-Object { $_.Id -ne ${process.pid} } | Select-Object -ExpandProperty Id`).split("\n").map(Number).filter(n => n > 0);
      
      for (const pid of pids) {
        await this.terminateProcess(pid);
      }

      // Terminate all node processes running cli.cjs (Windows environment cjs format)
      const nodePids = this.runPowerShell(`Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue | Where-Object { ($_.CommandLine -like '*build/dist/cli.cjs*' -or $_.CommandLine -like '*build/dist/cli.js*') -and $_.ProcessId -ne ${process.pid} } | Select-Object -ExpandProperty ProcessId`).split("\n").map(Number).filter(n => n > 0);
      
      for (const pid of nodePids) {
        await this.terminateProcess(pid);
      }
    } catch (err) {
      process.stderr.write(`[PortOwnershipService] Cleanup failed: ${String(err)}\n`);
    }
  }

  private async terminateProcess(pid: number): Promise<boolean> {
    try {
      process.kill(pid, "SIGTERM");
    } catch (err: any) {
      process.stderr.write(`[PortOwnershipService] SIGTERM failed for pid=${pid}: ${String(err?.message || err)}\n`);
    }
    if (await this.waitForProcessExit(pid, 12, 200)) {
      return true;
    }
    try {
      process.kill(pid, "SIGKILL");
    } catch (err: any) {
      process.stderr.write(`[PortOwnershipService] SIGKILL failed for pid=${pid}: ${String(err?.message || err)}\n`);
    }
    return this.waitForProcessExit(pid, 8, 200);
  }

  async takeoverPortIfNeeded(
    port: number,
    readLock: () => Promise<{ pid: number; port: number } | null>
  ): Promise<void> {
    const ownerPid = this.detectListeningPidOnPort(port);
    if (!ownerPid || ownerPid === process.pid) {
      return;
    }
    const lock = await readLock();
    const cmdline = this.readProcessCommandLine(ownerPid);
    const processName = this.readProcessName(ownerPid).toLowerCase();
    const lockMatched = !!(lock && lock.pid === ownerPid && lock.port === port);
    const looksLikeBeeByProcess = (processName === "node.exe" || processName === "node")
      && (String(cmdline || "").toLowerCase().includes(".artifacts/product/index.js")
        || String(cmdline || "").toLowerCase().includes("dist/index.js"));
    const lockSuggestsBee = !!(lock && lock.port === port);
    if (!lockMatched && !this.looksLikeOurServerCommandLine(cmdline) && !looksLikeBeeByProcess && !lockSuggestsBee) {
      throw new Error(`UI_PORT_IN_USE_BY_FOREIGN_PROCESS:${port}:${ownerPid}`);
    }
    process.stderr.write(`[UIService] Port ${port} occupied by stale BeeMCP process ${ownerPid}, taking over.\n`);
    const killed = await this.terminateProcess(ownerPid);
    if (!killed) {
      throw new Error(`UI_PORT_TAKEOVER_FAILED:${port}:${ownerPid}`);
    }
    process.stderr.write(`[UIService] Port ${port} takeover completed from process ${ownerPid}.\n`);
  }
}

