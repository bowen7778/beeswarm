import { injectable, inject } from "inversify";
import type { Request, Response } from "express";
import { SYMBOLS } from "../../common/di/symbols.js";
import { BaseController } from "./BaseController.js";
import { ProjectModeFacade } from "../../features/project-mode/facade/ProjectModeFacade.js";
import { ChannelFacade } from "../../features/channel/facade/ChannelFacade.js";
import { ProjectContextService } from "../../features/mcp/project/ProjectContextService.js";
import { LoggerService } from "../../features/runtime/LoggerService.js";

@injectable()
export class ProjectModeController extends BaseController {
  constructor(
    @inject(SYMBOLS.ProjectContextService) projectContext: ProjectContextService,
    @inject(SYMBOLS.ProjectModeFacade) private readonly projectMode: ProjectModeFacade,
    @inject(SYMBOLS.ChannelFacade) private readonly channelFacade: ChannelFacade,
    @inject(SYMBOLS.LoggerService) logger: LoggerService
  ) {
    super(projectContext, logger);
  }

  async getMode(req: Request, res: Response) {
    try {
      const projectId = String(req.query.projectId || req.headers["x-project-id"] || "").trim();
      if (!projectId) {
        this.sendError(res, 400, "PROJECT_ID_REQUIRED", "Project ID is required");
        return;
      }
      const data = this.projectMode.getModeConfig(projectId);
      this.sendOk(res, data);
    } catch (err: any) {
      this.handleDomainError(res, err, "PROJECT_MODE_GET_FAILED");
    }
  }

  async setMode(req: Request, res: Response) {
    try {
      const projectId = String(req.body?.projectId || "").trim();
      const targetMode = String(req.body?.targetMode || "").trim();
      const operator = String(req.body?.operator || "system").trim();
      const traceId = String(req.body?.traceId || "").trim();
      const auditRemark = String(req.body?.auditRemark || "").trim();
      const data = await this.projectMode.setProjectMode({
        projectId,
        targetMode,
        operator,
        traceId,
        auditRemark
      });
      this.sendOk(res, data);
    } catch (err: any) {
      this.handleDomainError(res, err, "PROJECT_MODE_SET_FAILED");
    }
  }

  async setSingleAgentChannel(req: Request, res: Response) {
    try {
      const projectId = String(req.body?.projectId || "").trim();
      const targetChannel = String(req.body?.targetChannel || "").trim();
      const operator = String(req.body?.operator || "system").trim();
      const traceId = String(req.body?.traceId || "").trim();
      const auditRemark = String(req.body?.auditRemark || "").trim();
      const data = await this.projectMode.setSingleAgentChannel({
        projectId,
        targetChannel,
        operator,
        traceId,
        auditRemark
      });
      this.sendOk(res, data);
    } catch (err: any) {
      this.handleDomainError(res, err, "PROJECT_CHANNEL_SET_FAILED");
    }
  }

  async getChannelStatus(req: Request, res: Response) {
    try {
      const projectId = String(req.query.projectId || req.headers["x-project-id"] || "").trim();
      if (!projectId) {
        this.sendError(res, 400, "PROJECT_ID_REQUIRED", "Project ID is required");
        return;
      }
      const data = await this.channelFacade.getStatus(projectId);
      this.sendOk(res, data);
    } catch (err: any) {
      this.handleDomainError(res, err, "PROJECT_CHANNEL_STATUS_FAILED");
    }
  }

  private handleDomainError(res: Response, err: any, fallbackCode: string) {
    const code = String(err?.code || "").trim();
    if (code === "PROJECT_ID_REQUIRED") {
      this.sendError(res, 400, code, String(err?.message || "Project ID is required"), err?.details || {});
      return;
    }
    if (code === "PROJECT_NOT_FOUND") {
      this.sendError(res, 404, code, String(err?.message || "Project not found"), err?.details || {});
      return;
    }
    if (code === "INVALID_MODE" || code === "INVALID_CHANNEL" || code === "INVALID_MODE_OR_CHANNEL" || code === "PROJECT_MODE_CHANNEL_CONFLICT" || code === "PROJECT_MODE_MULTI_AGENT_RESERVED" || code === "CHANNEL_NOT_IMPLEMENTED") {
      this.sendError(res, 400, code, String(err?.message || "Invalid request"), err?.details || {});
      return;
    }
    if (code === "PROJECT_SWITCH_LOCKED") {
      this.sendError(res, 409, code, String(err?.message || "Project switching is locked"), err?.details || {});
      return;
    }
    if (code === "PROJECT_SWITCH_ROLLBACK_APPLIED") {
      this.sendError(res, 500, code, String(err?.message || "Switch failed and rolled back"), err?.details || {});
      return;
    }
    this.sendInternalError(res, err, fallbackCode);
  }
}

