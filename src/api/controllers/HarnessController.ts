import { injectable, inject } from "inversify";
import type { Request, Response } from "express";
import { SYMBOLS } from "../../common/di/symbols.js";
import { BaseController } from "./BaseController.js";
import { HarnessExecutionService } from "../../features/harness/HarnessExecutionService.js";
import { HarnessEvaluationService } from "../../features/harness/HarnessEvaluationService.js";
import { HarnessReplayService } from "../../features/harness/HarnessReplayService.js";
import { HarnessGateService } from "../../features/harness/HarnessGateService.js";
import { HarnessQueryService } from "../../features/harness/HarnessQueryService.js";
import { ProjectContextService } from "../../features/mcp/project/ProjectContextService.js";
import { LoggerService } from "../../features/runtime/LoggerService.js";

@injectable()
export class HarnessController extends BaseController {
  constructor(
    @inject(SYMBOLS.ProjectContextService) projectContext: ProjectContextService,
    @inject(SYMBOLS.HarnessExecutionService) private readonly harnessExecution: HarnessExecutionService,
    @inject(SYMBOLS.HarnessQueryService) private readonly harnessQuery: HarnessQueryService,
    @inject(SYMBOLS.HarnessEvaluationService) private readonly harnessEvaluation: HarnessEvaluationService,
    @inject(SYMBOLS.HarnessReplayService) private readonly harnessReplay: HarnessReplayService,
    @inject(SYMBOLS.HarnessGateService) private readonly harnessGate: HarnessGateService,
    @inject(SYMBOLS.LoggerService) logger: LoggerService
  ) {
    super(projectContext, logger);
  }

  async execute(req: Request, res: Response) {
    try {
      const projectId = String(req.body?.projectId || "").trim();
      const mode = String(req.body?.mode || "single_agent").trim() as any;
      const channel = String(req.body?.channel || "mcp_ide").trim() as any;
      const traceId = String(req.body?.traceId || "").trim();
      const intent = String(req.body?.intent || "send").trim() as any;
      const payload = req.body?.payload || {};
      const data = await this.harnessExecution.execute({
        projectId,
        mode,
        channel,
        traceId,
        intent,
        payload,
        timeoutMs: Number(req.body?.timeoutMs || 0) || undefined
      });
      this.sendOk(res, data);
    } catch (err: any) {
      this.sendInternalError(res, err, "HARNESS_EXECUTE_FAILED");
    }
  }

  async readTrace(req: Request, res: Response) {
    try {
      const traceId = String(req.params.traceId || "").trim();
      const limit = this.readLimit(req.query.limit, 200, 1000);
      const offset = this.readOffset(req.query.offset);
      if (!traceId) {
        this.sendError(res, 400, "TRACE_ID_REQUIRED", "Trace ID is required");
        return;
      }
      this.sendOk(res, this.harnessQuery.readTrace(traceId, limit, offset));
    } catch (err: any) {
      this.handleDomainError(res, err, "HARNESS_TRACE_READ_FAILED");
    }
  }

  async listRuns(req: Request, res: Response) {
    try {
      const projectId = this.resolveProjectId(req);
      const limit = this.readLimit(req.query.limit, 50, 500);
      const offset = this.readOffset(req.query.offset);
      if (!projectId) {
        this.sendError(res, 400, "PROJECT_ID_REQUIRED", "Project ID is required");
        return;
      }
      const runs = this.harnessQuery.listRuns(projectId, limit, offset);
      this.sendOk(res, { projectId, runs, limit, offset });
    } catch (err: any) {
      this.handleDomainError(res, err, "HARNESS_RUNS_LIST_FAILED");
    }
  }

  async listMetrics(req: Request, res: Response) {
    try {
      const projectId = this.resolveProjectId(req);
      const traceId = String(req.query.traceId || "").trim();
      const limit = this.readLimit(req.query.limit, 100, 1000);
      const offset = this.readOffset(req.query.offset);
      if (!projectId) {
        this.sendError(res, 400, "PROJECT_ID_REQUIRED", "Project ID is required");
        return;
      }
      const metrics = this.harnessQuery.listMetrics({ projectId, traceId, limit, offset });
      this.sendOk(res, { projectId, traceId, metrics, limit, offset });
    } catch (err: any) {
      this.handleDomainError(res, err, "HARNESS_METRICS_LIST_FAILED");
    }
  }

  async listFailures(req: Request, res: Response) {
    try {
      const projectId = this.resolveProjectId(req);
      const traceId = String(req.query.traceId || "").trim();
      const limit = this.readLimit(req.query.limit, 100, 1000);
      const offset = this.readOffset(req.query.offset);
      if (!projectId) {
        this.sendError(res, 400, "PROJECT_ID_REQUIRED", "Project ID is required");
        return;
      }
      const failures = this.harnessQuery.listFailures({ projectId, traceId, limit, offset });
      this.sendOk(res, { projectId, traceId, failures, limit, offset });
    } catch (err: any) {
      this.handleDomainError(res, err, "HARNESS_FAILURES_LIST_FAILED");
    }
  }

  async runEvaluation(req: Request, res: Response) {
    try {
      const projectId = String(req.body?.projectId || "").trim();
      const traceId = String(req.body?.traceId || "").trim();
      const cases = Array.isArray(req.body?.cases) ? req.body.cases : undefined;
      const data = await this.harnessEvaluation.runEvaluation({ projectId, traceId, cases });
      this.sendOk(res, data);
    } catch (err: any) {
      this.handleDomainError(res, err, "HARNESS_EVAL_RUN_FAILED");
    }
  }

  async readEvaluationReport(req: Request, res: Response) {
    try {
      const evalId = String(req.params.evalId || "").trim();
      const data = this.harnessEvaluation.getReport(evalId);
      this.sendOk(res, data);
    } catch (err: any) {
      this.handleDomainError(res, err, "HARNESS_EVAL_READ_FAILED");
    }
  }

  async runReplay(req: Request, res: Response) {
    try {
      const projectId = String(req.body?.projectId || "").trim();
      const traceId = String(req.body?.traceId || "").trim();
      const policyVersion = String(req.body?.policyVersion || "").trim();
      const data = this.harnessReplay.runReplay({ projectId, traceId, policyVersion });
      this.sendOk(res, data);
    } catch (err: any) {
      this.handleDomainError(res, err, "HARNESS_REPLAY_RUN_FAILED");
    }
  }

  async readReplay(req: Request, res: Response) {
    try {
      const replayId = String(req.params.replayId || "").trim();
      const data = this.harnessReplay.getReplay(replayId);
      this.sendOk(res, data);
    } catch (err: any) {
      this.handleDomainError(res, err, "HARNESS_REPLAY_READ_FAILED");
    }
  }

  async gateCheck(req: Request, res: Response) {
    try {
      const evalId = String(req.query.evalId || "").trim();
      const thresholdRaw = req.query.threshold;
      const threshold = thresholdRaw == null ? undefined : Number(thresholdRaw);
      const data = this.harnessGate.checkGate(evalId, threshold);
      this.sendOk(res, data);
    } catch (err: any) {
      this.handleDomainError(res, err, "HARNESS_GATE_CHECK_FAILED");
    }
  }

  private handleDomainError(res: Response, err: any, fallbackCode: string) {
    const code = String(err?.code || "").trim();
    if (code === "PROJECT_ID_REQUIRED" || code === "TRACE_ID_REQUIRED" || code === "EVAL_ID_REQUIRED" || code === "HARNESS_INTENT_INVALID" || code === "HARNESS_TIMEOUT_INVALID" || code === "HARNESS_GATE_THRESHOLD_INVALID") {
      this.sendError(res, 400, code, String(err?.message || "Invalid request"));
      return;
    }
    if (code === "HARNESS_MODE_CHANNEL_MISMATCH") {
      this.sendError(res, 409, code, String(err?.message || "Mode/channel mismatch"), err?.details || {});
      return;
    }
    if (code === "PROJECT_NOT_FOUND" || code === "HARNESS_EVAL_NOT_FOUND" || code === "HARNESS_REPLAY_NOT_FOUND") {
      this.sendError(res, 404, code, String(err?.message || "Not found"));
      return;
    }
    if (code === "HARNESS_TIMEOUT") {
      this.sendError(res, 408, code, String(err?.message || "Harness timeout"), err?.details || {});
      return;
    }
    this.sendInternalError(res, err, fallbackCode);
  }

  private readLimit(value: any, fallback: number, max: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.min(max, Math.max(1, Math.floor(parsed)));
  }

  private readOffset(value: any): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return 0;
    return Math.floor(parsed);
  }
}

