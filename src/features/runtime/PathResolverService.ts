import { injectable } from "inversify";
import path from "node:path";
import process from "node:process";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

@injectable()
export class PathResolverService {
  private readonly _programRoot: string;
  private readonly _userDataRoot: string;

  constructor() {
    this._programRoot = this.resolveProgramRoot();
    this._userDataRoot = this.resolveUserDataRoot();
  }

  private resolveProgramRoot(): string {
    const isSidecar = process.env.BEESWARM_IS_SIDECAR === "1";
    const envRoot = String(process.env.BEESWARM_PROGRAM_ROOT || "").trim();
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
    const envData = String(process.env.BEESWARM_USER_DATA_DIR || "").trim();
    if (envData) return path.resolve(envData);

    // 2. Check if local runtime directory exists (Portable Mode / Sandbox Friendly)
    const localRuntime = path.join(this.programRoot, ".beeswarm-runtime");
    const fsSync = require("node:fs");
    if (fsSync.existsSync(localRuntime)) {
      return localRuntime;
    }

    // 3. Standard system directory
    const appName = "beeswarm";
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
    return path.resolve(process.env.BEESWARM_PROJECT_ROOT || process.cwd());
  }

  get beeswarmDir(): string {
    return path.join(this._userDataRoot, "system");
  }

  get systemDir(): string {
    return this.beeswarmDir;
  }

  /**
   * Get global config directory (under APPDATA)
   */
  getGlobalConfigDir(): string {
    return path.join(this._userDataRoot, "config");
  }

  get configDir(): string {
    return this.getGlobalConfigDir();
  }

  get hostConfigFile(): string {
    const raw = String(process.env.BEESWARM_HOST_CONFIG_FILE || "").trim();
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
   * Get project-specific .beeswarm directory (project config and data strictly follow physical project path)
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

    return path.join(resolvedRoot, ".beeswarm");
  }

  /**
   * Get project-specific database path
   */
  getProjectDbPath(projectRoot: string): string {
    return path.join(this.getProjectDataDir(projectRoot), "message_manager.db");
  }
}
