import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

export class RuntimeFsService {
  static processAlive(pid: number): boolean {
    if (!Number.isFinite(pid) || pid <= 0) return false;
    try {
      // On Windows, process.kill(pid, 0) might throw EPERM due to permissions even if process exists.
      // We need to handle it precisely: if ESRCH is thrown, process definitely does not exist; 
      // otherwise (including success), it's considered alive.
      process.kill(pid, 0);
      return true;
    } catch (err: any) {
      // ESRCH: No such process
      return err.code !== 'ESRCH';
    }
  }

  static async readJsonSafe(filePath: string): Promise<any | null> {
    try {
      return JSON.parse(await fs.readFile(filePath, "utf-8"));
    } catch {
      return null;
    }
  }

  static async writeJsonAtomic(filePath: string, data: any, mode?: number): Promise<void> {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    const tmpPath = `${filePath}.${process.pid}.${Math.random().toString(36).slice(2, 7)}.tmp`;
    try {
      await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), "utf-8");
      if (mode !== undefined) {
        await fs.chmod(tmpPath, mode);
      }
      await fs.rename(tmpPath, filePath);
    } catch (err: any) {
      await fs.unlink(tmpPath).catch(() => {});
      throw err;
    }
  }

  static async statMtimeSafe(filePath: string): Promise<number> {
    try {
      return (await fs.stat(filePath)).mtimeMs;
    } catch {
      return 0;
    }
  }
}

