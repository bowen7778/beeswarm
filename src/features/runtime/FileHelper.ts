import fs from "node:fs/promises";
import path from "node:path";

export class FileHelper {
  static async ensureDir(dirPath: string) {
    await this.mkdirSafe(dirPath);
  }

  static formatSize(bytes: number): string {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / 1024 / 1024).toFixed(1) + " MB";
  }

  static async writeJsonAtomic(filePath: string, data: any) {
    const dir = path.dirname(filePath);
    await this.mkdirSafe(dir);
    
    const maxRetries = 5;
    let lastError: any = null;

    for (let i = 0; i < maxRetries; i++) {
      const tmpPath = `${filePath}.${process.pid}.${Math.random().toString(36).slice(2, 7)}.tmp`;
      try {
        await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), "utf-8");
        await fs.rename(tmpPath, filePath);
        return; // Success
      } catch (e: any) {
        lastError = e;
        await fs.unlink(tmpPath).catch(() => {});
        
        // Windows-specific transient occupation errors: EPERM (Permission denied) or EBUSY (File busy)
        if (e.code === "EPERM" || e.code === "EBUSY") {
          const delay = Math.pow(2, i) * 100; // Exponential backoff: 100ms, 200ms, 400ms, 800ms...
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        throw e; // Other errors thrown directly
      }
    }

    process.stderr.write(`[FILE_WRITE_ERROR] ${filePath} after ${maxRetries} retries: ${lastError?.message || lastError}\n`);
    throw lastError;
  }

  /**
   * Robust synchronous directory creation logic
   */
  static mkdirSyncSafe(dirPath: string) {
    const fsSync = require("node:fs");
    const maxRetries = 5;
    let lastError: any = null;

    for (let i = 0; i < maxRetries; i++) {
      try {
        fsSync.mkdirSync(dirPath, { recursive: true });
        return;
      } catch (e: any) {
        lastError = e;
        if (e.code === "EEXIST") return;
        if (e.code === "EPERM" || e.code === "EBUSY" || e.code === "EACCES") {
          // Synchronous wait
          const delay = Math.pow(2, i) * 100;
          const start = Date.now();
          while (Date.now() - start < delay) { /* busy wait */ }
          continue;
        }
        throw e;
      }
    }
    throw lastError;
  }

  /**
   * Robust directory creation logic with exponential backoff for Windows EPERM/EBUSY errors
   */
  static async mkdirSafe(dirPath: string) {
    const maxRetries = 5;
    let lastError: any = null;

    for (let i = 0; i < maxRetries; i++) {
      try {
        await fs.mkdir(dirPath, { recursive: true });
        return; // Success or already exists
      } catch (e: any) {
        lastError = e;
        // If directory already exists, return immediately
        if (e.code === "EEXIST") return;

        if (e.code === "EPERM" || e.code === "EBUSY" || e.code === "EACCES") {
          const delay = Math.pow(2, i) * 100;
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        throw e;
      }
    }
    
    process.stderr.write(`[MKDIR_ERROR] ${dirPath} after ${maxRetries} retries: ${lastError?.message || lastError}\n`);
    throw lastError;
  }

  static async readJsonSafe(filePath: string): Promise<any> {
    try {
      const raw = await fs.readFile(filePath, "utf-8");
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  static async withLock<T>(filePath: string, action: () => Promise<T>): Promise<T> {
    const lockFile = `${filePath}.lock`;
    let acquired = false;
    const maxRetries = 20;
    const retryDelay = 200;

    for (let i = 0; i < maxRetries; i++) {
      try {
        await fs.writeFile(lockFile, process.pid.toString(), { flag: "wx" });
        acquired = true;
        break;
      } catch (err: any) {
        if (err.code === "EEXIST") {
          // Check if lock is stale
          try {
            const lockPid = parseInt(await fs.readFile(lockFile, "utf-8"), 10);
            if (isNaN(lockPid) || !this.processAlive(lockPid)) {
              await fs.unlink(lockFile).catch(() => {});
              continue; // Retry immediately after clearing stale lock
            }
          } catch {
            // If read fails, maybe it was just deleted
          }
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
        } else {
          throw err;
        }
      }
    }

    if (!acquired) {
      throw new Error(`Failed to acquire lock for ${filePath} after ${maxRetries} retries`);
    }

    try {
      return await action();
    } finally {
      await fs.unlink(lockFile).catch(() => {});
    }
  }

  private static processAlive(pid: number): boolean {
    if (!pid || pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }
}

