import { injectable, inject } from "inversify";
import type { Request, Response } from "express";
import path from "node:path";
import { SYMBOLS } from "../../common/di/symbols.js";
import { BaseController } from "./BaseController.js";
import { RuntimeFsService } from "../../features/runtime/RuntimeFsService.js";
import { StreamSnapshotService } from "../../features/runtime/sse/StreamSnapshotService.js";
import { MessageManagerStore } from "../../features/mcp/message/MessageManagerStore.js";
import { McpDiscoveryService } from "../../features/runtime/McpDiscoveryService.js";
import { PathResolverService } from "../../features/runtime/PathResolverService.js";
import { MessageOutboxService } from "../../features/mcp/message/MessageOutboxService.js";
import { IMPluginRegistry } from "../../features/im/IMPluginRegistry.js";
import { LoggerService } from "../../features/runtime/LoggerService.js";
import { SessionContext } from "../../common/context/SessionContext.js";

import { ConversationQueryService } from "../../features/mcp/session/ConversationQueryService.js";
import { ProjectIdentityService } from "../../features/mcp/project/ProjectIdentityService.js";
import { ProjectContextService } from "../../features/mcp/project/ProjectContextService.js";

@injectable()
export class MonitorController extends BaseController {
  private _lastUIHeartbeat: number = Date.now();
  private hostStatusProvider: () => any = () => ({ booted: true, master: true, pid: process.pid });

  constructor(
    @inject(SYMBOLS.ProjectContextService) projectContext: ProjectContextService,
    @inject(SYMBOLS.StreamSnapshotService) private readonly streamService: StreamSnapshotService,
    @inject(SYMBOLS.MessageManagerStore) private readonly manager: MessageManagerStore,
    @inject(SYMBOLS.McpDiscoveryService) private readonly mcpDiscovery: McpDiscoveryService,
    @inject(SYMBOLS.PathResolverService) private readonly pathResolver: PathResolverService,
    @inject(SYMBOLS.MessageOutboxService) private readonly outbox: MessageOutboxService,
    @inject(SYMBOLS.IMPluginRegistry) private readonly pluginRegistry: IMPluginRegistry,
    @inject(SYMBOLS.LoggerService) private readonly logger: LoggerService,
    @inject(SYMBOLS.ConversationQueryService) private readonly queryService: ConversationQueryService,
    @inject(SYMBOLS.ProjectIdentityService) private readonly projectIdentity: ProjectIdentityService
  ) {
    super(projectContext, logger);
  }

  setHostStatusProvider(provider: () => any) {
    this.hostStatusProvider = provider;
  }

  get lastUIHeartbeat() {
    return this._lastUIHeartbeat;
  }

  updateHeartbeat() {
    this._lastUIHeartbeat = Date.now();
  }

  /**
   * Heartbeat endpoint for the UI to signal it's still alive.
   */
  async heartbeat(req: Request, res: Response) {
    this.updateHeartbeat();
    this.sendOk(res, { 
      active: true, 
      serverTime: new Date().toISOString(),
      pid: process.pid 
    });
  }

  /**
   * Receive logs from the UI and pipe them to the backend logger.
   */
  async postLog(req: Request, res: Response) {
    try {
      const { level, module, message, error } = req.body;
      const lvl = String(level || "INFO").toUpperCase();
      const mod = String(module || "UI").toUpperCase();
      const msg = String(message || "");

      switch (lvl) {
        case "DEBUG": this.logger.debug(mod, msg); break;
        case "WARN": this.logger.warn(mod, msg); break;
        case "ERROR": this.logger.error(mod, msg, error); break;
        default: this.logger.info(mod, msg); break;
      }
      this.sendOk(res, { success: true });
    } catch (err: any) {
      this.sendInternalError(res, err, "LOG_POST_FAILED");
    }
  }

  /**
   * Get the health status of the stream service.
   */
  async getHealth(req: Request, res: Response) {
    this.sendOk(res, this.streamService.health());
  }

  /**
   * Get host and runtime status information.
   */
  async getHostStatus(req: Request, res: Response) {
    try {
      const lockFile = this.pathResolver.hostLockFile;
      const lock = await RuntimeFsService.readJsonSafe(lockFile);
      this.sendOk(res, {
        host: {
          pid: process.pid,
          hostLockFile: lockFile,
          hostLock: lock ? { ...lock, alive: RuntimeFsService.processAlive(lock.pid) } : null
        },
        runtime: this.hostStatusProvider(),
        checkedAt: new Date().toISOString()
      });
    } catch (err: any) {
      this.sendInternalError(res, err, "HOST_STATUS_FAILED");
    }
  }

  /**
   * Initialize a new project with a name and project root.
   */
  async initializeProject(req: Request, res: Response) {
    try {
      const name = String(req.body?.name || "").trim();
      const projectRoot = this.resolveProjectRoot(req);
      const identity = await this.projectIdentity.initializeProject(projectRoot, name);
      this.sendOk(res, { projectId: identity.projectId });
    } catch (err: any) {
      this.sendInternalError(res, err, "PROJECT_INIT_FAILED");
    }
  }

  /**
   * Get the MCP discovery configuration.
   */
  async getMcpDiscovery(req: Request, res: Response) {
    try {
      const discovery = await this.mcpDiscovery.read();
      this.sendOk(res, discovery);
    } catch (err: any) {
      this.sendInternalError(res, err, "DISCOVERY_READ_FAILED");
    }
  }

  /**
   * Handle incoming SSE stream connections.
   */
  async handleStream(req: Request, res: Response) {
    const projectRoot = this.resolveProjectRoot(req);
    const token = String(req.query.projectId || req.query.conversationId || req.query.sessionId || "");
    return SessionContext.run({ projectRoot }, () => this.streamService.stream(req, res, token));
  }
}

