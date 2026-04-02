import "reflect-metadata";
import { injectable, inject } from "inversify";
import fs from "node:fs";
import path from "node:path";
import { SYMBOLS } from "../../common/di/symbols.js";
import type { PathResolverService } from "./PathResolverService.js";
import type { LoggerService } from "./LoggerService.js";

export interface VersionManifest {
  version: string;
  name: string;
  releaseDate: string;
  description: string;
  protocols: {
    mcpServer: string;
    gateway: string;
    beemcp: string;
  };
  runtime: {
    node: string;
  };
  schemas: {
    appConfig: number;
    conversationHub: number;
    mcpDiscovery: number;
    messageStore: number;
    projectIdentity: number;
  };
}

export interface VersionInfo {
  version: string;
  releaseDate: string;
  path: string;
  isBuiltin: boolean;
  manifest: VersionManifest;
}

@injectable()
export class VersionManager {
  private readonly defaultManifest: VersionManifest = {
    version: "0.0.0",
    name: "beemcp-kernel",
    releaseDate: "",
    description: "BeeMCP Kernel",
    protocols: {
      mcpServer: "1.2.2",
      gateway: "5.0.0",
      beemcp: "7.0.0"
    },
    runtime: {
      node: "20.11.1"
    },
    schemas: {
      appConfig: 1,
      conversationHub: 10,
      mcpDiscovery: 1,
      messageStore: 11,
      projectIdentity: 1
    }
  };

  constructor(
    @inject(SYMBOLS.PathResolverService) private readonly pathResolver: PathResolverService,
    @inject(SYMBOLS.LoggerService) private readonly logger: LoggerService
  ) {}

  public getAvailableVersions(): VersionInfo[] {
    const versions: VersionInfo[] = [];
    const builtinVersion = this.getBuiltinVersion();
    if (builtinVersion) versions.push(builtinVersion);

    const binDir = path.join(this.pathResolver.userDataRoot, "bin");
    if (fs.existsSync(binDir)) {
      const dirs = fs.readdirSync(binDir);
      for (const dirName of dirs) {
        const fullPath = path.join(binDir, dirName);
        const runtimeRoot = this.resolveRuntimeRoot(fullPath);
        const manifest = runtimeRoot ? this.readManifest(runtimeRoot) : null;
        if (manifest && runtimeRoot) {
          versions.push(this.toVersionInfo(manifest, runtimeRoot, false));
        }
      }
    }

    return versions.sort((a, b) => this.compareVersions(b.version, a.version));
  }

  public getLatestVersion(): VersionInfo | undefined {
    const all = this.getAvailableVersions();
    return all[0];
  }

  public getCurrentVersionInfo(): VersionInfo {
    return this.getBuiltinVersion() || this.toVersionInfo(this.defaultManifest, this.pathResolver.programRoot, true);
  }

  public getCurrentVersion(): string {
    return this.getCurrentVersionInfo().version;
  }

  public getManifest(): VersionManifest {
    return this.getCurrentVersionInfo().manifest;
  }

  public getProtocolVersion(key: keyof VersionManifest["protocols"]): string {
    return this.getManifest().protocols[key];
  }

  public getSchemaVersion(key: keyof VersionManifest["schemas"]): number {
    return this.getManifest().schemas[key];
  }

  public getNodeRuntimeVersion(): string {
    return this.getManifest().runtime.node;
  }

  public getVersionSlotDir(version: string): string {
    return path.join(this.pathResolver.userDataRoot, "bin", `v${String(version || "").trim()}`);
  }

  private getBuiltinVersion(): VersionInfo | undefined {
    const builtinPath = this.resolveRuntimeRoot(this.pathResolver.programRoot) || this.pathResolver.programRoot;
    const manifest = this.readManifest(builtinPath);
    return manifest ? this.toVersionInfo(manifest, builtinPath, true) : undefined;
  }

  private resolveRuntimeRoot(basePath: string): string | null {
    const candidates = [basePath, path.join(basePath, "kernel")];
    for (const candidate of candidates) {
      const manifestPath = path.join(candidate, "manifest.json");
      if (!fs.existsSync(manifestPath)) continue;
      return candidate;
    }
    return null;
  }

  private readManifest(rootPath: string): VersionManifest | null {
    const manifestPath = path.join(rootPath, "manifest.json");
    if (!fs.existsSync(manifestPath)) {
      return null;
    }

    try {
      const raw = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      return {
        version: String(raw?.version || this.defaultManifest.version),
        name: String(raw?.name || this.defaultManifest.name),
        releaseDate: String(raw?.releaseDate || this.defaultManifest.releaseDate),
        description: String(raw?.description || this.defaultManifest.description),
        protocols: {
          ...this.defaultManifest.protocols,
          ...(raw?.protocols || {})
        },
        runtime: {
          ...this.defaultManifest.runtime,
          ...(raw?.runtime || {})
        },
        schemas: {
          ...this.defaultManifest.schemas,
          ...(raw?.schemas || {})
        }
      };
    } catch (err) {
      this.logger.error("VersionManager", `Failed to read manifest at ${manifestPath}`, err);
      return null;
    }
  }

  private toVersionInfo(manifest: VersionManifest, runtimePath: string, isBuiltin: boolean): VersionInfo {
    return {
      version: manifest.version,
      releaseDate: manifest.releaseDate || "",
      path: runtimePath,
      isBuiltin,
      manifest
    };
  }

  public compareVersions(v1: string, v2: string): number {
    const parts1 = v1.split(".").map(Number);
    const parts2 = v2.split(".").map(Number);

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const p1 = parts1[i] || 0;
      const p2 = parts2[i] || 0;
      if (p1 > p2) return 1;
      if (p1 < p2) return -1;
    }
    return 0;
  }
}

