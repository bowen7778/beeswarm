import { Request, Response } from "express";
import { ProjectContextService } from "../../features/mcp/project/ProjectContextService.js";
import { LoggerService } from "../../features/runtime/LoggerService.js";

export abstract class BaseController {
  constructor(
    protected readonly projectContext: ProjectContextService,
    protected readonly logger: LoggerService
  ) {}

  protected success(data: any = {}) {
    return { success: true, data };
  }

  protected error(code: string, message: string, details: any = {}) {
    return { success: false, error: { code, message, details } };
  }

  protected sendOk(res: Response, data: any) {
    res.json(this.success(data));
  }

  protected sendError(res: Response, status: number, code: string, message: string, details: any = {}) {
    res.status(status).json(this.error(code, message, details));
  }

  protected sendInternalError(res: Response, err: any, code: string = "INTERNAL_ERROR") {
    const message = String(err?.stack || err?.message || err || "unknown error");
    this.logger.error("Controller", `${code}: ${message}`, err);
    this.sendError(res, 500, code, err?.message || "Internal server error");
  }

  protected resolveProjectRoot(req: Request): string {
    return this.projectContext.resolveProjectRoot(req);
  }

  protected resolveProjectId(req: Request): string {
    return this.projectContext.resolveProjectId(req);
  }
}
