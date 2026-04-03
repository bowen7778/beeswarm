import { injectable, inject } from "inversify";
import { SYMBOLS } from "../../common/di/symbols.js";
import { LoggerService } from "./LoggerService.js";
import { MasterSingletonService } from "./MasterSingletonService.js";
import { UIService } from "./UIService.js";
import { IMRuntimeOrchestrator } from "./IMRuntimeOrchestrator.js";
import { McpFacade } from "../mcp/facade/McpFacade.js";
import { AppConfig } from "./AppConfig.js";
import { PathResolverService } from "./PathResolverService.js";
import { MigrationService } from "./MigrationService.js";
import { DatabaseService } from "./DatabaseService.js";
import { UpdateWorkerService } from "./UpdateWorkerService.js";
import { McpDiscoveryService } from "./McpDiscoveryService.js";
import { TrayService } from "./TrayService.js";
import { PortOwnershipService } from "./PortOwnershipService.js";
import { VersionManager } from "./VersionManager.js";
import { PlatformHelper } from "./PlatformHelper.js";

/**
 * Manages the application lifecycle, including booting and shutting down services.
 */
@injectable()
export class LifecycleManager {
  private isBooted = false;

  constructor(
    @inject(SYMBOLS.LoggerService) private readonly logger: LoggerService,
    @inject(SYMBOLS.MasterSingletonService) private readonly masterSingleton: MasterSingletonService,
    @inject(SYMBOLS.PortOwnershipService) private readonly portOwnership: PortOwnershipService,
    @inject(SYMBOLS.UIService) private readonly ui: UIService,
    @inject(SYMBOLS.IMRuntimeOrchestrator) private readonly runtimeOrchestrator: IMRuntimeOrchestrator,
    @inject(SYMBOLS.McpFacade) private readonly mcp: McpFacade,
    @inject(SYMBOLS.AppConfig) private readonly config: AppConfig,
    @inject(SYMBOLS.PathResolverService) private readonly pathResolver: PathResolverService,
    @inject(SYMBOLS.MigrationService) private readonly migration: MigrationService,
    @inject(SYMBOLS.DatabaseService) private readonly db: DatabaseService,
    @inject(SYMBOLS.UpdateWorkerService) private readonly updateWorker: UpdateWorkerService,
    @inject(SYMBOLS.McpDiscoveryService) private readonly mcpDiscovery: McpDiscoveryService,
    @inject(SYMBOLS.TrayService) private readonly tray: TrayService,
    @inject(SYMBOLS.VersionManager) public readonly versionManager: VersionManager
  ) {}

  /**
   * Boot the application and its core services.
   */
  async boot(): Promise<void> {
    if (this.isBooted) return;

    const appName = this.versionManager.appName;
    const appIdentifier = this.versionManager.appIdentifier;
    
    // Initialize prefix for environment variables
    import("../../common/utils/UnifiedEnv.js").then(({ UnifiedEnv }) => {
      UnifiedEnv.setPrefix(appIdentifier);
    });

    this.logger.info("SYSTEM", `Booting ${appName} Server...`);

    try {
      // 1. Singleton Lock / Attach
      let isMaster = true;
      try {
        await this.masterSingleton.acquireOrThrow();
        this.logger.info("SYSTEM", "Master singleton lock acquired.");
      } catch (err: any) {
        if (err.message.includes("HOST_SINGLETON_ALREADY_RUNNING")) {
          const activePid = err.message.split(":")[1];
          // If already running and we are in Stdio mode, switch to Attach Mode and continue.
          // Otherwise (e.g. launching second instance), exit.
          const isStdio = !process.stdin.isTTY || process.env[`${appIdentifier.toUpperCase()}_ATTACH_MODE`] === '1';
          if (isStdio) {
            isMaster = false;
            this.logger.info("SYSTEM", `Host already running (PID: ${activePid}). Entering Attach Mode.`);
          } else {
            process.stderr.write(`[INFO] [SYSTEM] Host already running (PID: ${activePid}). Exiting current instance.\n`);
            process.exit(0);
          }
        } else {
          throw err;
        }
      }

      // 2. Start Infrastructure
      if (isMaster) {
        this.logger.info("SYSTEM", "Initializing Hub database and running migrations...");
        const hubDb = this.db.getConnection(this.pathResolver.getDatabasePath());
        await this.migration.migrate(hubDb, "HUB");

        this.logger.info("SYSTEM", "Initializing UI service...");
        await this.ui.initialize(this.pathResolver.userDataRoot);
        
        this.ui.setHostStatusProvider(() => ({
          booted: this.isBooted,
          master: true,
          pid: process.pid
        }));

        // Dynamic port negotiation
        let finalPort = this.config.uiPort;
        const isDev = process.env[`${appIdentifier.toUpperCase()}_IS_DEV`] === '1' || process.env.NODE_ENV === 'development';
        if (isDev) {
          this.logger.info("SYSTEM", `Dev mode: Attempting to use fixed port ${finalPort}`);
        }
        finalPort = await this.portOwnership.findAvailablePort(finalPort);
        
        this.logger.info("SYSTEM", `Starting UI on port ${finalPort}...`);
        await this.ui.start(finalPort);
        await this.masterSingleton.updateUiPort(finalPort);

        // Start MCP engine regardless of Master/Slave (Stdio is independent)
        await this.mcp.start();

        // 3. Async start background services (Slave mode skips some)
        this.mcpDiscovery.publishHost({
          pid: process.pid,
          state: "running",
          mode: "master",
          attachMode: false,
          lockFile: this.pathResolver.hostLockFile,
          uiBaseUrl: `http://127.0.0.1:${finalPort}`
        }).catch(e => this.logger.error("SYSTEM", "Discovery failed", e));

        this.updateWorker.startUpdateTicking();
        this.runtimeOrchestrator.start().catch(e => this.logger.error("SYSTEM", "Runtime orchestrator failed", e));
      } else {
        // Slave mode
        await this.mcp.start();
      }

      this.isBooted = true;
      this.logger.info("SYSTEM", `>>> ${appName} Core Booted (Zero-Binding Mode) <<<`);

      // 4. Standalone Service Extensions: Tray & Browser
      if (isMaster) {
        const finalPort = this.config.uiPort; // This might be negotiated, but masterSingleton has the latest
        const uiUrl = `http://127.0.0.1:${finalPort}`;
        
        // Initialize Tray
        this.tray.initialize(uiUrl, () => this.shutdown()).catch(e => {
          this.logger.error("SYSTEM", "Failed to initialize tray", e);
        });

        // Auto-launch browser if not in dev mode (dev mode usually has its own tab)
        const isDev = process.env[`${appIdentifier.toUpperCase()}_IS_DEV`] === '1' || process.env.NODE_ENV === 'development';
        if (!isDev && this.config.autoOpenBrowser) {
          this.logger.info("SYSTEM", `Opening dashboard: ${uiUrl}`);
          PlatformHelper.openBrowser(uiUrl);
        }
      }
    } catch (err: any) {
      this.logger.error("SYSTEM", "Boot failed", err);
      throw err;
    }
  }

  /**
   * Shut down the application and its services gracefully.
   */
  async shutdown(): Promise<void> {
    this.logger.info("SYSTEM", "Shutting down...");
    try {
      this.tray.shutdown();
      await this.runtimeOrchestrator.stop();
      await this.ui.stop();
      await this.mcp.stop();
      await this.masterSingleton.release();
      this.isBooted = false;
      this.logger.info("[LifecycleManager] Shutdown complete.");
    } catch (err) {
      this.logger.error("[LifecycleManager] Error during shutdown", err);
    }
  }
}
