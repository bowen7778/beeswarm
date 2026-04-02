import { injectable, inject } from "inversify";
import { SYMBOLS } from "../../common/di/symbols.js";
import { HarnessTelemetryService } from "./HarnessTelemetryService.js";
import { HarnessStore } from "./stores/HarnessStore.js";

@injectable()
export class HarnessQueryService {
  constructor(
    @inject(SYMBOLS.HarnessTelemetryService) private readonly harnessTelemetry: HarnessTelemetryService,
    @inject(SYMBOLS.HarnessStore) private readonly harnessStore: HarnessStore
  ) {}

  public readTrace(traceId: string, limit: number, offset: number) {
    const normalizedTraceId = String(traceId || "").trim();
    const inMemoryEvents = this.harnessTelemetry.listByTrace(normalizedTraceId);
    const persistedSteps = this.harnessStore.listHarnessStepsByTrace(normalizedTraceId, limit, offset);
    return {
      traceId: normalizedTraceId,
      source: inMemoryEvents.length > 0 ? "memory" : "store",
      events: inMemoryEvents.length > 0 ? inMemoryEvents : persistedSteps
    };
  }

  public listRuns(projectId: string, limit: number, offset: number) {
    return this.harnessStore.listHarnessRuns(projectId, limit, offset);
  }

  public listMetrics(input: { projectId: string; traceId: string; limit: number; offset: number }) {
    return this.harnessStore.listHarnessMetrics(input);
  }

  public listFailures(input: { projectId: string; traceId: string; limit: number; offset: number }) {
    return this.harnessStore.listHarnessFailures(input);
  }
}
