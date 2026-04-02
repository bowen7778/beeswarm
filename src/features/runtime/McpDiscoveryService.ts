import { injectable, inject } from "inversify";
import path from "node:path";
import fs from "node:fs/promises";
import process from "node:process";
import { AppConfig } from "./AppConfig.js";
import { PathResolverService } from "./PathResolverService.js";
import { RuntimeFsService } from "./RuntimeFsService.js";
import { SYMBOLS } from "../../common/di/symbols.js";
import type { VersionManager } from "./VersionManager.js";

type HostSnapshot = {
  pid: number;
  state: string;
  mode: string;
  attachMode: boolean;
  lockFile: string;
  uiBaseUrl: string;
};

@injectable()
export class McpDiscoveryService {
  private readonly filePath: string;

  constructor(
    @inject(SYMBOLS.AppConfig) private readonly config: AppConfig,
    @inject(SYMBOLS.PathResolverService) private readonly pathResolver: PathResolverService,
    @inject(SYMBOLS.VersionManager) private readonly versionManager: VersionManager
  ) {
    this.filePath = path.join(this.pathResolver.systemDir, "mcp-discovery.json");
  }

  private async resolveConnectorLaunch(): Promise<{ command: string; args: string[] }> {
    // 1. Get current Node executable path
    const command = process.execPath;
    
    // 2. Try to infer entry from runtime argv[1]
    let connectorEntry = path.resolve(String(process.argv[1] || ""));
    const entryExt = path.extname(connectorEntry).toLowerCase();
    
    // If it's a .ts file (development environment) or an unclear entry, try to find compiled .cjs
    if (entryExt !== ".cjs" || !connectorEntry.includes("cli.cjs")) {
      // programRoot should now point to project root directory
      const subBuildDist = path.resolve(this.pathResolver.programRoot, "build", "dist", "cli.cjs");
      const rootDist = path.resolve(this.pathResolver.programRoot, "dist", "cli.cjs");
      
      const checkExists = async (p: string) => {
        try { await fs.access(p); return true; } catch { return false; }
      };

      if (await checkExists(subBuildDist)) {
        connectorEntry = subBuildDist;
      } else if (await checkExists(rootDist)) {
        connectorEntry = rootDist;
      }
    }

    const args = [connectorEntry];
    return { command, args };
  }

  async read(): Promise<any> {
    return RuntimeFsService.readJsonSafe(this.filePath);
  }

  async publishHost(host: HostSnapshot): Promise<void> {
    const launcher = await this.resolveConnectorLaunch();
    const lock = await RuntimeFsService.readJsonSafe(this.pathResolver.hostLockFile);
    
    // Generate minimal config snippet
    const stdioConfig = {
      beemcp: {
        command: launcher.command,
        args: launcher.args,
        env: {
          // Do not hardcode project path in global discovery info.
          // Clients will automatically identify based on their own environment when connecting.
          BEEMCP_PROJECT_ROOT: "" 
        }
      }
    };
    
    const sseConfig = {
      beemcp: {
        url: `${host.uiBaseUrl}/api/mcp/sse`
      }
    };

    const payload = {
      schemaVersion: this.versionManager.getSchemaVersion("mcpDiscovery"),
      product: "BeeMCP",
      protocol: "mcp",
      updatedAt: new Date().toISOString(),
      discoveryFile: this.filePath,
      host: {
        pid: host.pid,
        state: host.state,
        mode: host.mode,
        attachMode: host.attachMode,
        lockFile: host.lockFile,
        uiBaseUrl: host.uiBaseUrl,
        alive: RuntimeFsService.processAlive(Number(host?.pid || 0)),
        lockPid: Number(lock?.pid || 0)
      },
      transports: {
        stdio: stdioConfig.beemcp,
        sse: sseConfig.beemcp
      },
      // Minimal universal config
      universalConfig: {
        method: "SSE (Recommended)",
        url: `${host.uiBaseUrl}/api/mcp/sse`,
        description: "Copy this URL to any MCP compatible client."
      },
      endpoints: {
        health: `${host.uiBaseUrl}/api/health`,
        hostStatus: `${host.uiBaseUrl}/api/host/status`,
        connectorStatus: `${host.uiBaseUrl}/api/mcp/connector_status`
      }
    };
    // Permission limited to 0o600, only current user can read/write (SEC-01)
    await RuntimeFsService.writeJsonAtomic(this.filePath, payload, 0o600);
  }

  async markStopped(reason: string): Promise<void> {
    const current = await this.read();
    if (!current || typeof current !== "object") return;
    const next = {
      ...current,
      updatedAt: new Date().toISOString(),
      host: {
        ...(current.host || {}),
        state: "stopped",
        alive: false,
        stopReason: String(reason || "stopped")
      }
    };
    await RuntimeFsService.writeJsonAtomic(this.filePath, next, 0o600);
  }

}

