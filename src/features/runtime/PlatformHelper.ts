import { spawn } from "node:child_process";
import os from "node:os";

export class PlatformHelper {
  private static spawnDetached(command: string, args: string[] = []): void {
    try {
      const child = spawn(command, args, {
        detached: true,
        stdio: "ignore",
        windowsHide: true
      });
      child.on("error", (err: any) => {
        process.stderr.write(`[PlatformHelper] child process error: ${String(err?.message || err)}\n`);
      });
      child.unref();
    } catch (err: any) {
      process.stderr.write(`[PlatformHelper] spawnDetached failed: ${String(err?.message || err)}\n`);
    }
  }

  static isWindows(): boolean {
    return os.platform() === "win32";
  }

  static isMacOS(): boolean {
    return os.platform() === "darwin";
  }

  static openBrowser(url: string): void {
    const validatedUrl = this.validateUrl(url);
    if (!validatedUrl) return;

    if (this.isWindows()) {
      this.spawnDetached("cmd.exe", ["/c", "start", validatedUrl]);
    } else if (this.isMacOS()) {
      this.spawnDetached("open", [validatedUrl]);
    } else {
      this.spawnDetached("xdg-open", [validatedUrl]);
    }
  }

  private static validateUrl(url: string): string | null {
    try {
      const u = new URL(url);
      if (u.protocol !== "http:" && u.protocol !== "https:") return null;
      return u.toString();
    } catch {
      return null;
    }
  }
}

