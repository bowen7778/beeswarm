import { injectable } from "inversify";
import path from "node:path";
import process from "node:process";
import os from "node:os";
import fsSync from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { UnifiedEnv } from "../../common/utils/UnifiedEnv.js";
import { SYMBOLS } from "../../common/di/symbols.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

@injectable()
export class PathResolverService {
  private readonly _programRoot: string;
  private readonly _userDataRoot: string;
  private _appIdentifier: string | null = null;

  constructor() {
    this._programRoot = this.resolveProgramRoot();
    this._userDataRoot = this.resolveUserDataRoot();
  }

  private get appIdentifier(): string {
    if (this._appIdentifier) return this._appIdentifier;

    const manifestPath = path.join(this.programRoot, "manifest.json");
    if (fsSync.existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(fsSync.readFileSync(manifestPath, "utf-8"));
        this._appIdentifier = manifest.identity?.appIdentifier || "beeswarm";
        return this._appIdentifier!;
      } catch {
        // Fallback
      }
    }
    
    this._appIdentifier = "beeswarm";
    return this._appIdentifier;
  }

  private resolveProgramRoot(): string {
    const isSidecar = UnifiedEnv.getBool("IS_SIDECAR");
    const envRoot = UnifiedEnv.get("PROGRAM_ROOT");
    if (envRoot) return path.resolve(envRoot);

    // In development environment, if not in Sidecar mode, we need to resolve from the code path
    if (!isSidecar) {
      const entry = String(process.argv[1] || "").trim();
      if (entry) {
        const entryPath = path.resolve(entry);
        const entryDir = path.dirname(entryPath);
        
        if (path.basename(entryDir).toLowerCase() === "dist") {
          const parent = path.resolve(entryDir, "..");
          if (path.basename(parent).toLowerCase() === "build") {
            return path.resolve(parent, "..");
          }
          return entryDir;
        }
        return entryDir;
      }
    }

    return path.resolve(process.cwd());
  }

  private resolveUserDataRoot(): string {
    const envData = UnifiedEnv.get("USER_DATA_DIR");
    if (envData) return path.resolve(envData);

    // 2. Check if local runtime directory exists (Portable Mode / Sandbox Friendly)
    const appIdentifier = this.appIdentifier;
    const localRuntime = path.join(this.programRoot, `.${appIdentifier}-runtime`);
    
    if (fsSync.existsSync(localRuntime)) {
      return localRuntime;
    }

    // 3. Standard system directory
    const appName = appIdentifier;
    const platform = process.platform;
    let standardPath = "";

    if (platform === "win32") {
      standardPath = path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), appName);
    } else if (platform === "darwin") {
      standardPath = path.join(os.homedir(), "Library", "Application Support", appName);
    } else {
      standardPath = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), appName);
    }

    try {
      if (!fsSync.existsSync(standardPath)) {
        fsSync.mkdirSync(standardPath, { recursive: true });
      }
      const testFile = path.join(standardPath, ".write-test");
      fsSync.writeFileSync(testFile, "ok");
      fsSync.unlinkSync(testFile);
      return standardPath;
    } catch (err) {
      process.stderr.write(`[PathResolver] Standard path ${standardPath} is not writable, falling back to local runtime.\n`);
      if (!fsSync.existsSync(localRuntime)) {
        fsSync.mkdirSync(localRuntime, { recursive: true });
      }
      return localRuntime;
    }
  }

  get programRoot(): string {
    return this._programRoot;
  }

  get userDataRoot(): string {
    return this._userDataRoot;
  }

  get workspaceRoot(): string {
    return path.resolve(UnifiedEnv.get("PROJECT_ROOT", process.cwd()));
  }

  /**
   * Get the system-level application data directory.
   */
  get appDataDir(): string {
    return this.userDataRoot;
  }

  get systemDir(): string {
    return this.appDataDir;
  }

  /**
   * Get global config directory (under APPDATA)
   */
  getGlobalConfigDir(): string {
    return path.join(this._userDataRoot, "config");
  }

  get configDir(): string {
    return path.join(this.appDataDir, "config");
  }

  get logDir(): string {
    return path.join(this.appDataDir, "logs");
  }

  /**
   * Get project-specific context directory (e.g., .beeswarm or .mcp)
   * project config and data strictly follow physical project path
   */
  getProjectContextDir(projectRoot: string): string {
    const resolvedRoot = path.resolve(projectRoot);
    if (!fsSync.existsSync(resolvedRoot)) {
      throw new Error(`PROJECT_ROOT_NOT_FOUND:${resolvedRoot}`);
    }
    
    if (resolvedRoot === "/" || resolvedRoot === "C:\\" || resolvedRoot === "c:\\") {
      throw new Error("FATAL: CANNOT_USE_SYSTEM_ROOT_AS_PROJECT_CONTEXT");
    }

    const appIdentifier = this.appIdentifier;
    return path.join(resolvedRoot, `.${appIdentifier}`);
  }

  get hostConfigFile(): string {
    const raw = UnifiedEnv.get("HOST_CONFIG_FILE");
    if (raw) return path.resolve(raw);
    return path.join(this.getGlobalConfigDir(), "host.config.json");
  }

  get hostLockFile(): string {
    return path.join(this.systemDir, "host.lock");
  }

  get hubDir(): string {
    return path.join(this.systemDir, "hub");
  }

  get hubDbPath(): string {
    return path.join(this.hubDir, "conversation_hub.db");
  }

  /**
   * Get main database path (unified entry point)
   */
  getDatabasePath(): string {
    return this.hubDbPath;
  }

  get sessionsDir(): string {
    return path.join(this._userDataRoot, "sessions");
  }

  get logsDir(): string {
    return path.join(this._userDataRoot, "logs");
  }

  /**
   * Get project-specific data directory (e.g., .beeswarm or .mcp)
   * project config and data strictly follow physical project path
   */
  getProjectDataDir(projectRoot: string): string {
    const root = String(projectRoot || "").trim();
    if (!root) {
      throw new Error("FATAL: PROJECT_ROOT_REQUIRED. Cannot resolve data directory without a valid project root.");
    }
    
    const resolvedRoot = path.resolve(root);
    const normalizedProgramRoot = path.resolve(this.programRoot);
    if (resolvedRoot === normalizedProgramRoot) {
      throw new Error("CANNOT_USE_PROGRAM_ROOT_AS_PROJECT_CONTEXT");
    }
    
    if (resolvedRoot === "/" || resolvedRoot === "C:\\" || resolvedRoot === "c:\\") {
      throw new Error("FATAL: CANNOT_USE_SYSTEM_ROOT_AS_PROJECT_CONTEXT");
    }

    const appIdentifier = this.appIdentifier;
    return path.join(resolvedRoot, `.${appIdentifier}`);
  }


  /**
   * Get project-specific database path
   */
  getProjectDbPath(projectRoot: string): string {
    return path.join(this.getProjectDataDir(projectRoot), "message_manager.db");
  }
}
