import { injectable, inject } from "inversify";
import { randomUUID } from "node:crypto";
import { SYMBOLS } from "../../common/di/symbols.js";
import { HarnessTelemetryService } from "./HarnessTelemetryService.js";
import { HarnessStore } from "./stores/HarnessStore.js";

@injectable()
export class HarnessReplayService {
  constructor(
    @inject(SYMBOLS.HarnessStore) private readonly harnessStore: HarnessStore,
    @inject(SYMBOLS.HarnessTelemetryService) private readonly telemetry: HarnessTelemetryService
  ) {}

  runReplay(input: { projectId: string; traceId: string; policyVersion?: string }) {
    const projectId = String(input.projectId || "").trim();
    const traceId = String(input.traceId || "").trim();
    if (!projectId) this.throwWithCode("PROJECT_ID_REQUIRED", "Project ID is required");
    if (!traceId) this.throwWithCode("TRACE_ID_REQUIRED", "Trace ID is required");
    const replayId = randomUUID();
    const inMemoryEvents = this.telemetry.listByTrace(traceId);
    const persistedSteps = this.harnessStore.listHarnessStepsByTrace(traceId, 500);
    const events = inMemoryEvents.length > 0 ? inMemoryEvents : persistedSteps.map((x) => ({
      traceId: x.traceId,
      spanId: String(x.runId || ""),
      projectId: x.projectId,
      layer: x.layer,
      eventType: x.eventType,
      timestamp: x.createdAt,
      confidence: x.confidence || "high",
      payload: x.payload || {}
    }));
    const replayPayload = {
      traceId,
      eventCount: events.length,
      events
    };
    this.harnessStore.appendHarnessReplayRecord({
      replayId,
      projectId,
      sourceTraceId: traceId,
      policyVersion: String(input.policyVersion || ""),
      replayPayload
    });
    return {
      replayId,
      projectId,
      sourceTraceId: traceId,
      policyVersion: String(input.policyVersion || ""),
      replayPayload
    };
  }

  getReplay(replayId: string) {
    const replay = this.harnessStore.readHarnessReplayRecord(replayId);
    if (!replay) {
      this.throwWithCode("HARNESS_REPLAY_NOT_FOUND", "Harness replay record not found");
    }
    return replay;
  }

  private throwWithCode(code: string, message: string): never {
    const err: any = new Error(message);
    err.code = code;
    throw err;
  }
}

