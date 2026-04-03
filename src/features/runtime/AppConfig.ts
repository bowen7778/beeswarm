import { injectable, inject } from "inversify";
import fsSync from "node:fs";
import path from "node:path";
import { PathResolverService } from "./PathResolverService.js";
import { LoggerService } from "./LoggerService.js";
import { SYMBOLS } from "../../common/di/symbols.js";
import type { VersionManager } from "./VersionManager.js";
import { UnifiedEnv } from "../../common/utils/UnifiedEnv.js";

export type HostConfig = {
  schemaVersion: number;
  runtime: {
    instanceMode: "attach" | "exit-if-running";
    uiHost: string;
    uiPort: number;
    autoOpenBrowser: boolean;
  };
  logging: {
    level: string;
  };
  updatedAt: string;
};

@injectable()
export class AppConfig {
  private config: HostConfig;

  static projectRoot(): string {
    const envRoot = UnifiedEnv.get("PROJECT_ROOT");
    return envRoot ? path.resolve(envRoot) : "";
  }

  static programRoot(): string {
    const envRoot = UnifiedEnv.get("PROGRAM_ROOT");
    if (envRoot) return path.resolve(envRoot);

    const entry = String(process.argv[1] || "").trim();
    if (entry) {
      const entryPath = path.resolve(entry);
      const entryDir = path.dirname(entryPath);
      
      // Match build/dist structure
      if (path.basename(entryDir).toLowerCase() === "dist") {
        const parent = path.resolve(entryDir, "..");
        if (path.basename(parent).toLowerCase() === "build") {
          // If the structure is build/dist/cli.cjs, the project root is its grandparent directory
          return path.resolve(parent, "..");
        }
      }
      return entryDir;
    }
    
    return path.resolve(process.cwd());
  }

  constructor(
    @inject(SYMBOLS.PathResolverService) private readonly pathResolver: PathResolverService,
    @inject(SYMBOLS.LoggerService) private readonly logger: LoggerService,
    @inject(SYMBOLS.VersionManager) private readonly versionManager: VersionManager
  ) {
    this.config = this.loadConfig();
  }

  private defaultHostConfig(): HostConfig {
    return {
      schemaVersion: this.versionManager.getSchemaVersion("appConfig"),
      runtime: {
        instanceMode: "attach",
        uiHost: "127.0.0.1",
        uiPort: 3000,
        autoOpenBrowser: true
      },
      logging: {
        level: "info"
      },
      updatedAt: new Date().toISOString()
    };
  }

  private loadConfig(): HostConfig {
    const defaults = this.defaultHostConfig();
    const file = this.pathResolver.hostConfigFile;

    if (!fsSync.existsSync(file)) {
      try {
        fsSync.mkdirSync(path.dirname(file), { recursive: true });
        fsSync.writeFileSync(file, JSON.stringify(defaults, null, 2), "utf-8");
      } catch (err: any) {
        this.logger.error(`[AppConfig] Failed to create default config: ${err.message}`);
      }
      return defaults;
    }

    try {
      const raw = JSON.parse(fsSync.readFileSync(file, "utf-8"));
      return {
        ...defaults,
        ...raw,
        runtime: {
          ...defaults.runtime,
          ...(raw?.runtime || {})
        },
        logging: {
          ...defaults.logging,
          ...(raw?.logging || {})
        }
      };
    } catch (err: any) {
      this.logger.error(`[AppConfig] Failed to read config: ${err.message}. Using defaults.`);
      return defaults;
    }
  }

  get hostInstanceMode(): "attach" | "exit-if-running" {
    return this.config.runtime.instanceMode;
  }

  get uiPort(): number {
    return UnifiedEnv.getNumber("UI_PORT", this.config.runtime.uiPort || 3000);
  }

  get uiHost(): string {
    return UnifiedEnv.get("UI_HOST", this.config.runtime.uiHost || "127.0.0.1");
  }

  get autoOpenBrowser(): boolean {
    return this.config.runtime.autoOpenBrowser;
  }

  get logLevel(): string {
    return this.config.logging.level;
  }

  get harnessApiToken(): string {
    return UnifiedEnv.get("HARNESS_API_TOKEN");
  }

  get harnessAuthEnabled(): boolean {
    return this.harnessApiToken.length > 0;
  }

  get harnessGateMinSuccessRate(): number {
    const raw = UnifiedEnv.getNumber("HARNESS_GATE_MIN_SUCCESS_RATE", 0.85);
    return Math.min(1, Math.max(0, raw));
  }
}

