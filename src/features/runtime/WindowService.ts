import { injectable, inject } from "inversify";
import fsSync from "node:fs";
import path from "node:path";
import os from "node:os";
import { SessionService } from "./SessionService.js";
import { PlatformHelper } from "./PlatformHelper.js";
import { AppConfig } from "./AppConfig.js";
import { PathResolverService } from "./PathResolverService.js";
import { SYMBOLS } from "../../common/di/symbols.js";

@injectable()
export class WindowService {
  private lastPopupTime: number = 0;
  private isOpening: boolean = false;
  private readonly POPUP_COOLDOWN: number = 10000;
  private isActiveProvider: () => boolean = () => false;

  constructor(
    @inject(SYMBOLS.SessionService) private session: SessionService,
    @inject(SYMBOLS.PathResolverService) private pathResolver: PathResolverService,
    @inject(SYMBOLS.AppConfig) private appConfig: AppConfig
  ) {}

  public setIsActiveProvider(provider: () => boolean): void {
    this.isActiveProvider = provider;
  }

  private hasRecentUIActivity(maxAgeMs: number = 120000): boolean {
    const activeLocks = [
      path.join(this.pathResolver.systemDir, "ui-active.lock"),
      path.join(os.tmpdir(), "beemcp_ui_active.lock")
    ];
    try {
      for (const activeLock of activeLocks) {
        if (!fsSync.existsSync(activeLock)) continue;
        const stats = fsSync.statSync(activeLock);
        if ((Date.now() - stats.mtimeMs) < maxAgeMs) return true;
      }
      return false;
    } catch (err: any) {
      process.stderr.write(`[WindowService] ui activity lock read failed: ${String(err?.message || err)}\n`);
      return false;
    }
  }

  public openDesktopWindow(force: boolean = false): void {
    if (this.isOpening) return;
    if (!force && this.hasRecentUIActivity(120000)) {
      process.stderr.write("[WindowService] Recent UI activity lock detected, skip popup\n");
      return;
    }
    const isActive = this.isActiveProvider();
    process.stderr.write(`[WindowService] Checking UI active status: ${isActive}\n`);
    if (!force && isActive) {
      return;
    }
    const now = Date.now();
    if (!force && (now - this.lastPopupTime < this.POPUP_COOLDOWN)) {
      return;
    }
    const lockFile = path.join(this.pathResolver.systemDir, "window.lock");
    let lockAcquired = false;
    try {
      if (fsSync.existsSync(lockFile)) {
        const stats = fsSync.statSync(lockFile);
        if (Date.now() - stats.mtimeMs < 10000) {
          process.stderr.write("[WindowService] Global lock detected. Another process is already opening the window.\n");
          return;
        }
        fsSync.unlinkSync(lockFile);
      }
      const fd = fsSync.openSync(lockFile, "wx");
      fsSync.writeFileSync(fd, process.pid.toString());
      fsSync.closeSync(fd);
      lockAcquired = true;
    } catch (err: any) {
      process.stderr.write(`[WindowService] acquire window lock failed: ${String(err?.message || err)}\n`);
      return;
    }
    this.isOpening = true;
    this.lastPopupTime = now;
    
    // In Tauri mode, window is managed by Rust master process, this is only a trigger signal if needed
    // In production environment, Tauri will automatically maintain a native window
    process.stderr.write(`[WindowService] Native Window managed by Tauri framework\n`);
    
    try {
      // Fallback: if not running in Tauri environment, use PlatformHelper to open browser
      if (!(globalThis as any).__TAURI__) {
        const url = `http://${this.appConfig.uiHost}:${this.appConfig.uiPort}`;
        PlatformHelper.openBrowser(url, true);
      }
    } finally {
      setTimeout(() => {
        this.isOpening = false;
        if (!lockAcquired) return;
        try {
          if (fsSync.existsSync(lockFile)) fsSync.unlinkSync(lockFile);
        } catch (err: any) {
          process.stderr.write(`[WindowService] release window lock failed: ${String(err?.message || err)}\n`);
        }
      }, 5000);
    }
  }
}

