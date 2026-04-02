import { injectable } from "inversify";
import type { HarnessSpanEvent } from "./types/HarnessTypes.js";

@injectable()
export class HarnessTelemetryService {
  private readonly ringBuffer: HarnessSpanEvent[] = [];
  private readonly maxSize = 1000;

  emit(event: HarnessSpanEvent) {
    this.ringBuffer.push(event);
    if (this.ringBuffer.length > this.maxSize) {
      this.ringBuffer.shift();
    }
  }

  listByTrace(traceId: string): HarnessSpanEvent[] {
    const id = String(traceId || "").trim();
    if (!id) return [];
    return this.ringBuffer.filter((x) => x.traceId === id);
  }
}

