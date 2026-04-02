import { injectable, inject } from "inversify";
import type { Request, Response } from "express";
import { SYMBOLS } from "../../common/di/symbols.js";
import { SessionApplicationService } from "../../features/mcp/session/SessionApplicationService.js";
import { ConversationQueryService } from "../../features/mcp/session/ConversationQueryService.js";
import { MessageCoreService } from "../../features/mcp/message/MessageCoreService.js";
import { SessionContext } from "../../common/context/SessionContext.js";
import { BaseController } from "./BaseController.js";
import { LoggerService } from "../../features/runtime/LoggerService.js";
import { ProjectContextService } from "../../features/mcp/project/ProjectContextService.js";
import { UsecaseBus } from "../../common/bus/UsecaseBus.js";

/**
 * Controller for managing user sessions and project-specific chat history.
 */
@injectable()
export class SessionController extends BaseController {
  constructor(
    @inject(SYMBOLS.ProjectContextService) projectContext: ProjectContextService,
    @inject(SYMBOLS.SessionApplicationService) private readonly sessionService: SessionApplicationService,
    @inject(SYMBOLS.ConversationQueryService) private readonly queryService: ConversationQueryService,
    @inject(SYMBOLS.MessageCoreService) private readonly messageCore: MessageCoreService,
    @inject(SYMBOLS.LoggerService) protected readonly logger: LoggerService,
    @inject(SYMBOLS.UsecaseBus) private readonly bus: UsecaseBus
  ) {
    super(projectContext, logger);
  }

  /**
   * List available sessions/projects.
   */
  async listSessions(req: Request, res: Response) {
    try {
      const limit = Number(req.query.limit || 50);
      const activeWithinHours = Number(req.query.activeWithinHours || 7200);
      const sessions = await this.sessionService.listSessions({
        limit: Number.isFinite(limit) ? Math.max(5, Math.min(100, limit)) : 50,
        activeWithinHours: Number.isFinite(activeWithinHours) ? Math.max(1, Math.min(7200, activeWithinHours)) : 7200
      });
      this.sendOk(res, sessions);
    } catch (err: any) {
      this.sendInternalError(res, err, "SESSIONS_LIST_FAILED");
    }
  }

  /**
   * Get chat history for a specific project.
   */
  async getChatHistory(req: Request, res: Response) {
    try {
      const projectRoot = this.resolveProjectRoot(req);
      if (!projectRoot) {
        // If projectRoot cannot be resolved, return an empty array instead of global or fake data.
        this.logger.warn("API", `getChatHistory: Could not resolve projectRoot for request`);
        this.sendOk(res, []);
        return;
      }
      
      return SessionContext.run({ projectRoot }, async () => {
        // Explicitly passing context via SessionContext.run helps future scalability
        const history = await this.queryService.readChatHistory(null);
        this.sendOk(res, history);
      });
    } catch (e) {
      this.logger.error("API", `getChatHistory failed: ${e}`);
      this.sendOk(res, []);
    }
  }

  /**
   * Send a message from the UI to the current project session.
   */
  async sendMessage(req: Request, res: Response) {
    const projectRoot = this.resolveProjectRoot(req);
    try {
      await this.bus.execute(SYMBOLS.EnsureProjectModeAllowsMessageUsecase, {
        projectId: this.resolveProjectId(req),
        projectRoot
      });
    } catch (err: any) {
      this.sendError(res, 400, String(err?.code || "PROJECT_MODE_RESOLVE_FAILED"), String(err?.message || "Failed to resolve project mode"));
      return;
    }
    const payload = req.body;
    return SessionContext.run({ projectRoot }, async () => {
      const result = await this.messageCore.ingestFromUI(payload);
      this.sendOk(res, result);
    });
  }

  /**
   * Delete a project and its associated data.
   */
  async deleteProject(req: Request, res: Response) {
    try {
      const projectId = this.resolveProjectId(req);
      if (!projectId) {
        this.sendError(res, 400, "PROJECT_ID_REQUIRED", "Project ID is required");
        return;
      }
      
      const result = await this.sessionService.deleteProject(projectId);
      if (result.success) {
        this.sendOk(res, { success: true });
      } else {
        this.sendError(res, 400, "PROJECT_DELETE_FAILED", result.message || "Failed to delete project");
      }
    } catch (err: any) {
      this.sendInternalError(res, err, "PROJECT_DELETE_ERROR");
    }
  }
}
