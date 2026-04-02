import { injectable, inject } from "inversify";
import type { Request, Response } from "express";
import { SYMBOLS } from "../../common/di/symbols.js";
import { BaseController } from "./BaseController.js";
import { ChannelFacade } from "../../features/channel/facade/ChannelFacade.js";
import { ProjectContextService } from "../../features/mcp/project/ProjectContextService.js";
import { LoggerService } from "../../features/runtime/LoggerService.js";

@injectable()
export class ChannelController extends BaseController {
  constructor(
    @inject(SYMBOLS.ProjectContextService) projectContext: ProjectContextService,
    @inject(SYMBOLS.ChannelFacade) private readonly channel: ChannelFacade,
    @inject(SYMBOLS.LoggerService) logger: LoggerService
  ) {
    super(projectContext, logger);
  }

  async command(req: Request, res: Response) {
    try {
      const projectId = String(req.body?.projectId || req.headers["x-project-id"] || "").trim();
      const commandType = String(req.body?.commandType || "send").trim() as any;
      const payload = req.body?.payload || {};
      const traceId = String(req.body?.traceId || "").trim();
      const idempotencyKey = String(req.body?.idempotencyKey || "").trim();
      const data = await this.channel.dispatch({
        projectId,
        commandType,
        payload,
        traceId,
        idempotencyKey
      });
      this.sendOk(res, data);
    } catch (err: any) {
      this.handleDomainError(res, err, "CHANNEL_COMMAND_FAILED");
    }
  }

  async status(req: Request, res: Response) {
    try {
      const projectId = String(req.query.projectId || req.headers["x-project-id"] || "").trim();
      const data = await this.channel.getStatus(projectId);
      this.sendOk(res, data);
    } catch (err: any) {
      this.handleDomainError(res, err, "CHANNEL_STATUS_FAILED");
    }
  }

  private handleDomainError(res: Response, err: any, fallbackCode: string) {
    const code = String(err?.code || "").trim();
    if (code === "PROJECT_ID_REQUIRED" || code === "INVALID_MODE_OR_CHANNEL" || code === "PROJECT_MODE_CHANNEL_CONFLICT") {
      this.sendError(res, 400, code, String(err?.message || "Invalid request"), err?.details || {});
      return;
    }
    if (code === "PROJECT_NOT_FOUND") {
      this.sendError(res, 404, code, String(err?.message || "Project not found"), err?.details || {});
      return;
    }
    if (code === "PROJECT_SWITCH_LOCKED") {
      this.sendError(res, 409, code, String(err?.message || "Project switching is locked"), err?.details || {});
      return;
    }
    if (code === "PROJECT_MODE_MULTI_AGENT_RESERVED" || code === "CHANNEL_NOT_IMPLEMENTED" || code === "CHANNEL_COMMAND_UNSUPPORTED") {
      this.sendError(res, 400, code, String(err?.message || "Channel operation not available"), err?.details || {});
      return;
    }
    if (code === "CHANNEL_DRIVER_NOT_FOUND") {
      this.sendError(res, 500, code, String(err?.message || "Channel driver not found"), err?.details || {});
      return;
    }
    this.sendInternalError(res, err, fallbackCode);
  }
}

