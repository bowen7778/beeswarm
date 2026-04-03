import { injectable, inject } from "inversify";
import { randomUUID } from "node:crypto";
import { SYMBOLS } from "../../common/di/symbols.js";
import { ChannelFacade } from "../channel/facade/ChannelFacade.js";
import { HarnessTelemetryService } from "./HarnessTelemetryService.js";
import { HarnessStore } from "./stores/HarnessStore.js";
import { HarnessFailureClassifierService } from "./HarnessFailureClassifierService.js";
import { MemoryCoreService } from "../memory/MemoryCoreService.js";
import type { HarnessExecutionEnvelope } from "./types/HarnessTypes.js";

@injectable()
export class HarnessExecutionService {
  constructor(
    @inject(SYMBOLS.ChannelFacade) private readonly dispatchService: ChannelFacade,
    @inject(SYMBOLS.HarnessTelemetryService) private readonly telemetry: HarnessTelemetryService,
    @inject(SYMBOLS.HarnessStore) private readonly harnessStore: HarnessStore,
    @inject(SYMBOLS.HarnessFailureClassifierService) private readonly failureClassifier: HarnessFailureClassifierService,
    @inject(SYMBOLS.MemoryCoreService) private readonly memoryCore: MemoryCoreService
  ) {}

  async execute(input: HarnessExecutionEnvelope) {
    const projectId = String(input.projectId || "").trim();
    if (!projectId) {
      this.throwWithCode("PROJECT_ID_REQUIRED", "Project ID is required");
    }
    const modeConfig = this.harnessStore.readProjectModeConfig(projectId);
    if (!modeConfig) {
      this.throwWithCode("PROJECT_NOT_FOUND", "Project not found");
    }
    const effectiveMode = String(modeConfig.projectMode || "single_agent");
    const effectiveChannel = effectiveMode === "multi_agent"
      ? "orchestrator_reserved"
      : String(modeConfig.singleAgentChannel || "mcp_ide");
    const requestedMode = String(input.mode || "").trim();
    const requestedChannel = String(input.channel || "").trim();
    if ((requestedMode && requestedMode !== effectiveMode) || (requestedChannel && requestedChannel !== effectiveChannel)) {
      this.throwWithCode("HARNESS_MODE_CHANNEL_MISMATCH", "Requested mode/channel does not match project runtime config", {
        requestedMode,
        requestedChannel,
        effectiveMode,
        effectiveChannel
      });
    }
    const timeoutMs = this.normalizeTimeoutMs(input.timeoutMs);
    const commandType = this.resolveCommandType(input.intent);
    const traceId = String(input.traceId || "").trim() || randomUUID();
    const runId = randomUUID();
    const startedAt = new Date().toISOString();
    const baseEvent = {
      traceId,
      projectId,
      confidence: "high" as const
    };
    this.harnessStore.createHarnessRun({
      runId,
      projectId,
      traceId,
      mode: effectiveMode,
      channel: effectiveChannel,
      intent: commandType,
      payload: input.payload || {},
      startedAt
    });
    this.telemetry.emit({
      ...baseEvent,
      spanId: randomUUID(),
      layer: "route",
      eventType: "harness.execute.started",
      timestamp: startedAt,
      payload: { mode: effectiveMode, channel: effectiveChannel, intent: commandType, timeoutMs }
    });
    this.harnessStore.appendHarnessStep({
      runId,
      traceId,
      projectId,
      layer: "route",
      eventType: "harness.execute.started",
      confidence: "high",
      payload: { mode: effectiveMode, channel: effectiveChannel, intent: commandType, timeoutMs },
      createdAt: startedAt
    });
    const memoryReadStartedAt = new Date().toISOString();
    this.harnessStore.appendHarnessStep({
      runId,
      traceId,
      projectId,
      layer: "memory",
      eventType: "memory.read.started",
      confidence: "high",
      payload: { phase: "pre_dispatch" },
      createdAt: memoryReadStartedAt
    });
    const memoryContext = this.memoryCore.readContext(projectId);
    this.harnessStore.appendHarnessStep({
      runId,
      traceId,
      projectId,
      layer: "memory",
      eventType: "memory.read.completed",
      confidence: "high",
      payload: {
        phase: "pre_dispatch",
        factCount: Array.isArray(memoryContext.facts) ? memoryContext.facts.length : 0,
        eventCount: Array.isArray(memoryContext.events) ? memoryContext.events.length : 0
      },
      createdAt: new Date().toISOString()
    });
    const startedTs = Date.now();
    try {
      const result = commandType === "status"
        ? await this.withTimeout(this.dispatchService.getStatus(projectId), timeoutMs)
        : await this.withTimeout(this.dispatchService.dispatch({
          projectId,
          commandType,
          payload: input.payload || {},
          traceId
        }), timeoutMs);
      const endedAt = new Date().toISOString();
      this.telemetry.emit({
        ...baseEvent,
        spanId: randomUUID(),
        layer: "output",
        eventType: "harness.execute.completed",
        timestamp: endedAt,
        payload: { success: true }
      });
      this.harnessStore.appendHarnessStep({
        runId,
        traceId,
        projectId,
        layer: "output",
        eventType: "harness.execute.completed",
        confidence: "high",
        payload: { success: true },
        createdAt: endedAt
      });
      this.harnessStore.runInTransaction(() => {
        this.harnessStore.completeHarnessRun({
          runId,
          status: "succeeded",
          outputPayload: result,
          endedAt
        });
        this.harnessStore.appendHarnessMetric({
          runId,
          projectId,
          traceId,
          metricName: "latency_ms",
          metricValue: Math.max(0, Date.now() - startedTs),
          metricPayload: {
            mode: effectiveMode,
            channel: effectiveChannel,
            commandType,
            success: true
          },
          createdAt: endedAt
        });
        this.harnessStore.appendHarnessMetric({
          runId,
          projectId,
          traceId,
          metricName: "success_rate",
          metricValue: 1,
          metricPayload: {
            mode: effectiveMode,
            channel: effectiveChannel,
            commandType
          },
          createdAt: endedAt
        });
      });
      this.memoryCore.writeExecutionMemory({
        projectId,
        traceId,
        intent: commandType,
        payload: input.payload || {},
        success: true
      });
      this.harnessStore.appendHarnessStep({
        runId,
        traceId,
        projectId,
        layer: "memory",
        eventType: "memory.write.completed",
        confidence: "high",
        payload: { phase: "post_dispatch", success: true },
        createdAt: endedAt
      });
      return {
        runId,
        traceId,
        startedAt,
        endedAt,
        result
      };
    } catch (err: any) {
      const endedAt = new Date().toISOString();
      const errorCode = String(err?.code || "HARNESS_EXECUTION_FAILED");
      const errorMessage = String(err?.message || "Harness execution failed");
      this.telemetry.emit({
        ...baseEvent,
        spanId: randomUUID(),
        layer: "output",
        eventType: "harness.execute.failed",
        timestamp: endedAt,
        payload: { success: false, errorCode, errorMessage }
      });
      this.harnessStore.appendHarnessStep({
        runId,
        traceId,
        projectId,
        layer: "output",
        eventType: "harness.execute.failed",
        confidence: "high",
        payload: { success: false, errorCode, errorMessage },
        createdAt: endedAt
      });
      const errorClass = this.failureClassifier.classify(errorCode);
      this.harnessStore.runInTransaction(() => {
        this.harnessStore.completeHarnessRun({
          runId,
          status: "failed",
          outputPayload: {},
          errorCode,
          errorMessage,
          endedAt
        });
        this.harnessStore.appendHarnessFailure({
          runId,
          projectId,
          traceId,
          errorCode,
          errorClass,
          failureStage: "execution",
          failurePayload: {
            mode: effectiveMode,
            channel: effectiveChannel,
            intent: commandType,
            timeoutMs
          },
          createdAt: endedAt
        });
        this.harnessStore.appendHarnessMetric({
          runId,
          projectId,
          traceId,
          metricName: "latency_ms",
          metricValue: Math.max(0, Date.now() - startedTs),
          metricPayload: {
            mode: effectiveMode,
            channel: effectiveChannel,
            commandType,
            success: false,
            errorClass
          },
          createdAt: endedAt
        });
        this.harnessStore.appendHarnessMetric({
          runId,
          projectId,
          traceId,
          metricName: "success_rate",
          metricValue: 0,
          metricPayload: {
            mode: effectiveMode,
            channel: effectiveChannel,
            commandType,
            errorClass
          },
          createdAt: endedAt
        });
      });
      this.memoryCore.writeExecutionMemory({
        projectId,
        traceId,
        intent: commandType,
        payload: input.payload || {},
        success: false,
        errorCode
      });
      this.harnessStore.appendHarnessStep({
        runId,
        traceId,
        projectId,
        layer: "memory",
        eventType: "memory.write.completed",
        confidence: "high",
        payload: { phase: "post_dispatch", success: false, errorCode },
        createdAt: endedAt
      });
      throw err;
    }
  }

  private resolveCommandType(intent: string): "send" | "ask" | "dispatch" | "cancel" | "status" {
    const normalized = String(intent || "").trim();
    if (normalized === "send" || normalized === "ask" || normalized === "dispatch" || normalized === "cancel" || normalized === "status") {
      return normalized;
    }
    this.throwWithCode("HARNESS_INTENT_INVALID", "Invalid harness intent");
  }

  private normalizeTimeoutMs(timeoutMs?: number): number | undefined {
    if (timeoutMs == null) return undefined;
    const value = Number(timeoutMs);
    if (!Number.isFinite(value) || value <= 0) {
      this.throwWithCode("HARNESS_TIMEOUT_INVALID", "Timeout must be a positive number");
    }
    return Math.max(100, Math.floor(value));
  }

  private async withTimeout<T>(task: Promise<T>, timeoutMs?: number): Promise<T> {
    if (!timeoutMs) return task;
    let timer: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<T>((_, reject) => {
      timer = setTimeout(() => {
        const err: any = new Error("Harness execution timeout");
        err.code = "HARNESS_TIMEOUT";
        reject(err);
      }, timeoutMs);
    });
    try {
      return await Promise.race([task, timeoutPromise]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private throwWithCode(code: string, message: string, details: any = {}): never {
    const err: any = new Error(message);
    err.code = code;
    err.details = details;
    throw err;
  }
}

