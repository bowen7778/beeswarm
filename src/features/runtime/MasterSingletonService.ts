import { injectable, inject } from "inversify";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import net from "node:net";
import { PathResolverService } from "./PathResolverService.js";
import { RuntimeFsService } from "./RuntimeFsService.js";
import { LoggerService } from "./LoggerService.js";
import { SYMBOLS } from "../../common/di/symbols.js";

type MasterLock = {
  pid: number;
  startedAt: string;
  updatedAt: string;
  host: string;
  cwd: string;
  entry: string;
  uiPort: number;
};

@injectable()
export class MasterSingletonService {
  private readonly lockFile: string;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private isOwner = false;
  private lockFd: number | null = null;

  constructor(
    @inject(SYMBOLS.PathResolverService) private readonly pathResolver: PathResolverService,
    @inject(SYMBOLS.LoggerService) private readonly logger: LoggerService
  ) {
    this.lockFile = this.pathResolver.hostLockFile;
  }

  private async readLock(): Promise<MasterLock | null> {
    try {
      const content = await fs.readFile(this.lockFile, "utf-8");
      if (!content.trim()) return null;
      const raw = JSON.parse(content);
      return {
        pid: Number(raw?.pid || 0),
        startedAt: String(raw?.startedAt || ""),
        updatedAt: String(raw?.updatedAt || ""),
        host: String(raw?.host || ""),
        cwd: String(raw?.cwd || ""),
        entry: String(raw?.entry || ""),
        uiPort: Number(raw?.uiPort || 0)
      };
    } catch {
      return null;
    }
  }

  private async writeLock(uiPort: number = 0): Promise<void> {
    const now = new Date().toISOString();
    const existing = await this.readLock();
    
    const row: MasterLock = {
      pid: process.pid,
      startedAt: existing?.pid === process.pid ? existing.startedAt : now,
      updatedAt: now,
      host: os.hostname(),
      cwd: process.cwd(),
      entry: String(process.argv[1] || ""),
      uiPort: uiPort || existing?.uiPort || 0
    };
    
    // Use atomic write to ensure lock file content integrity
    await RuntimeFsService.writeJsonAtomic(this.lockFile, row);
  }

  private isStale(lock: MasterLock | null): boolean {
    if (!lock) return true;
    // If process does not exist, lock must be stale
    if (!RuntimeFsService.processAlive(lock.pid)) return true;
    
    // Check heartbeat: if not updated for more than 30 seconds, consider Master as zombie
    const updatedAt = new Date(lock.updatedAt).getTime();
    const now = Date.now();
    return (now - updatedAt) > 30000;
  }

  private canReachPort(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      if (!Number.isFinite(port) || port <= 0) {
        resolve(false);
        return;
      }
      const socket = new net.Socket();
      let settled = false;
      const done = (ok: boolean) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve(ok);
      };
      socket.setTimeout(800);
      socket.once("connect", () => done(true));
      socket.once("timeout", () => done(false));
      socket.once("error", () => done(false));
      socket.connect(port, "127.0.0.1");
    });
  }

  private async isLockHealthy(lock: MasterLock | null): Promise<boolean> {
    if (!lock) return false;
    if (!RuntimeFsService.processAlive(lock.pid)) return false;
    if (lock.uiPort > 0) {
      return this.canReachPort(lock.uiPort);
    }
    const startedAt = new Date(lock.startedAt).getTime();
    if (!Number.isFinite(startedAt) || startedAt <= 0) return false;
    return (Date.now() - startedAt) < 45000;
  }

  /**
   * Attempt to acquire physical atomic lock
   */
  async acquireOrThrow(): Promise<void> {
    if (this.isOwner) return;
    
    // 1. Check existing lock status first
    const existing = await this.readLock();
    if (existing && !this.isStale(existing)) {
      if (existing.pid !== process.pid) {
        if (await this.isLockHealthy(existing)) {
          throw new Error(`HOST_SINGLETON_ALREADY_RUNNING:${existing.pid}`);
        }
        this.logger.warn("SYSTEM", `MasterSingleton: Reclaiming unhealthy lock from PID ${existing.pid}`);
        await fs.unlink(this.lockFile).catch(() => {});
        return this.acquireOrThrow();
      }
      this.isOwner = true;
    } else {
      // 2. Attempt to establish physical exclusive lock (leveraging OS filesystem atomicity)
      try {
        // Ensure parent directory exists before opening file
        const parentDir = path.dirname(this.lockFile);
        if (!fsSync.existsSync(parentDir)) {
          fsSync.mkdirSync(parentDir, { recursive: true });
        }
        // 'wx' mode: error if file already exists, this is atomic
        const fd = fsSync.openSync(this.lockFile, 'wx');
        this.lockFd = fd;
        fsSync.closeSync(fd);
        this.isOwner = true;
      } catch (err: any) {
        if (err.code === 'EEXIST') {
          // Re-check if it's a stale lock, overwrite if it is
          const reCheck = await this.readLock();
          if (this.isStale(reCheck)) {
            this.logger.warn("SYSTEM", `MasterSingleton: Overwriting stale lock from PID ${reCheck?.pid}`);
            await fs.unlink(this.lockFile).catch(() => {});
            return this.acquireOrThrow(); // Recursive retry
          }
          throw new Error(`HOST_SINGLETON_ALREADY_RUNNING:${reCheck?.pid}`);
        }
        throw err;
      }
    }

    // 3. Write current process info after successful acquisition or takeover
    await this.writeLock();
    
    // 4. Start high-frequency heartbeat (every 10 seconds) to enhance real-time status
    this.heartbeatTimer = setInterval(async () => {
      if (this.isOwner) {
        try {
          const currentLock = await this.readLock();
          // Self-termination protocol: if lock is found stolen or tampered with, exit immediately to prevent conflict
          if (currentLock && currentLock.pid !== process.pid) {
            this.logger.error("SYSTEM", `CRITICAL: Master lock stolen by PID ${currentLock.pid}. Self-terminating.`);
            process.exit(1);
          }
          await this.writeLock();
        } catch (err) {
          this.logger.error("SYSTEM", "MasterSingleton: Heartbeat failure", err);
        }
      }
    }, 10000);
    
    this.logger.info("SYSTEM", `MasterSingleton: Atomic lock acquired by PID ${process.pid}`);
  }

  async updateUiPort(port: number): Promise<void> {
    if (!this.isOwner) return;
    await this.writeLock(port);
  }

  public async getActiveUiPort(): Promise<number | null> {
    const lock = await this.readLock();
    return lock ? lock.uiPort : null;
  }

  async release(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.isOwner) {
      this.isOwner = false;
      await fs.unlink(this.lockFile).catch(() => {});
    }
  }
}

