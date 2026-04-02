import { injectable, inject } from "inversify";
import { SYMBOLS } from "../../common/di/symbols.js";
import { MemoryStore } from "../mcp/stores/MemoryStore.js";

@injectable()
export class MemoryCoreService {
  constructor(
    @inject(SYMBOLS.MemoryStore) private readonly memoryStore: MemoryStore
  ) {}

  readContext(projectId: string) {
    const id = String(projectId || "").trim();
    if (!id) return { facts: [], events: [] };
    return {
      facts: this.memoryStore.listMemoryFacts(id, 30),
      events: this.memoryStore.listMemoryEvents(id, 30)
    };
  }

  writeExecutionMemory(input: {
    projectId: string;
    traceId: string;
    intent: string;
    payload: any;
    success: boolean;
    errorCode?: string;
  }) {
    const projectId = String(input.projectId || "").trim();
    if (!projectId) return;
    const traceId = String(input.traceId || "").trim();
    const intent = String(input.intent || "").trim();
    this.memoryStore.appendMemoryEvent({
      projectId,
      traceId,
      eventType: "execution",
      eventPayload: {
        intent,
        success: !!input.success,
        errorCode: String(input.errorCode || ""),
        payload: input.payload || {}
      }
    });
    this.memoryStore.upsertMemoryFact({
      projectId,
      factKey: "last_execution_intent",
      factValue: intent,
      source: "harness",
      confidence: 0.8,
      traceId
    });
    this.memoryStore.upsertMemoryFact({
      projectId,
      factKey: "last_execution_status",
      factValue: input.success ? "success" : "failed",
      source: "harness",
      confidence: 0.9,
      traceId
    });
  }
}

