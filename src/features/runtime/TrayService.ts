import { injectable, inject } from "inversify";
import SysTray from "systray2";
import open from "open";
import path from "node:path";
import fs from "node:fs";
import { SYMBOLS } from "../../common/di/symbols.js";
import { LoggerService } from "./LoggerService.js";
import { VersionManager } from "./VersionManager.js";
import { PathResolverService } from "./PathResolverService.js";

@injectable()
export class TrayService {
  private tray: any = null;
  private isClosing = false;

  constructor(
    @inject(SYMBOLS.LoggerService) private readonly logger: LoggerService,
    @inject(SYMBOLS.VersionManager) private readonly versionManager: VersionManager,
    @inject(SYMBOLS.PathResolverService) private readonly pathResolver: PathResolverService
  ) {}

  /**
   * Initialize the system tray icon.
   */
  public async initialize(uiUrl: string, onExit: () => Promise<void>) {
    const appName = this.versionManager.appName;
    
    // Try to find an icon file
    const iconPath = this.resolveIconPath();
    let iconData: string | undefined;
    
    if (iconPath && fs.existsSync(iconPath)) {
      try {
        iconData = fs.readFileSync(iconPath).toString("base64");
      } catch (err) {
        this.logger.warn("TRAY", "Failed to read tray icon file", err);
      }
    }

    const menuItems = [
      {
        title: `Open ${appName} Dashboard`,
        tooltip: `Open the ${appName} web interface`,
        checked: false,
        enabled: true,
        click: () => open(uiUrl)
      },
      {
        title: "---",
        tooltip: "",
        checked: false,
        enabled: false,
        click: () => {}
      },
      {
        title: "Restart Service",
        tooltip: "Restart the backend process",
        checked: false,
        enabled: true,
        click: () => {
          this.logger.info("TRAY", "User requested service restart via tray");
          process.emit("SIGTERM" as any);
        }
      },
      {
        title: "Exit",
        tooltip: `Quit ${appName} completely`,
        checked: false,
        enabled: true,
        click: async () => {
          if (this.isClosing) return;
          this.isClosing = true;
          this.logger.info("TRAY", "User requested exit via tray");
          await onExit();
        }
      }
    ];

    try {
      const SysTrayConstructor = (SysTray as any).default || SysTray;
      this.tray = new SysTrayConstructor({
        menu: {
          icon: iconData || "", // Base64 icon
          title: appName,
          tooltip: `${appName} - Model Context Protocol Orchestrator`,
          items: menuItems
        },
        debug: false,
        copyDir: true
      });

      this.tray.onClick((action: any) => {
        const item = menuItems[action.seq];
        if (item && item.click) {
          item.click();
        }
      });

      this.tray.ready(() => {
        this.logger.info("TRAY", "System tray icon initialized successfully.");
      });
    } catch (err) {
      this.logger.error("TRAY", "Failed to initialize system tray", err);
    }
  }

  private resolveIconPath(): string | null {
    // Look for app icon in standard locations
    const searchPaths = [
      path.join(this.pathResolver.programRoot, "assets", "icon.ico"),
      path.join(this.pathResolver.programRoot, "ui", "assets", "icon.ico"),
      path.join(this.pathResolver.programRoot, "icon.ico")
    ];

    for (const p of searchPaths) {
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  /**
   * Shutdown the tray process.
   */
  public shutdown() {
    if (this.tray) {
      this.tray.kill();
      this.tray = null;
    }
  }
}
