import { injectable } from "inversify";

/**
 * Service for collecting and aggregating runtime metrics and latencies.
 */
@injectable()
export class MetricsService {
  private readonly sendLatencyMs: number[] = [];
  private readonly streamIntervalsMs: number[] = [];
  private readonly startedAt: number = Date.now();
  private streamLastPushAt: number = 0;

  /**
   * Push a new metric value into a sliding window buffer.
   */
  private pushMetric(buffer: number[], value: number, cap: number = 300): void {
    buffer.push(value);
    if (buffer.length > cap) {
      buffer.splice(0, buffer.length - cap);
    }
  }

  /**
   * Calculate the p-th percentile of a given set of values.
   */
  private percentile(values: number[], p: number): number {
    if (values.length === 0) return 0;
    // Perform shallow copy and sort during calculation to avoid polluting original buffer
    const sorted = values.slice().sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
    return sorted[idx];
  }

  /**
   * Record message send latency.
   */
  recordSendLatency(durationMs: number): void {
    this.pushMetric(this.sendLatencyMs, durationMs);
  }

  /**
   * Record the interval between consecutive stream pushes.
   */
  recordStreamPush(nowMs: number): void {
    if (this.streamLastPushAt > 0) {
      this.pushMetric(this.streamIntervalsMs, nowMs - this.streamLastPushAt);
    }
    this.streamLastPushAt = nowMs;
  }

  /**
   * Build a status object from raw metrics input.
   */
  buildStatus(input: any) {
    return {
      hbRtt: input?.hbRtt ?? null,
      ackRtt: input?.ackRtt ?? null,
      streamLag: input?.streamLag ?? null,
      reconnects: input?.reconnects ?? 0,
      loss: input?.loss ?? 0,
      queued: input?.queued ?? 0
    };
  }

  /**
   * Build an aggregated runtime metrics report.
   */
  buildRuntimeMetrics(input: { streamClients: number; streamSeq: number; lastUIHeartbeat: number; uiLockAgeMs: number | null }) {
    const avgSend = this.sendLatencyMs.length
      ? Math.round(this.sendLatencyMs.reduce((a, b) => a + b, 0) / this.sendLatencyMs.length)
      : 0;
    const avgStreamInterval = this.streamIntervalsMs.length
      ? Math.round(this.streamIntervalsMs.reduce((a, b) => a + b, 0) / this.streamIntervalsMs.length)
      : 0;
    return {
      uptimeSec: Math.floor((Date.now() - this.startedAt) / 1000),
      streamClients: input.streamClients,
      streamSeq: input.streamSeq,
      sendLatencyAvgMs: avgSend,
      sendLatencyP50Ms: this.percentile(this.sendLatencyMs, 50),
      sendLatencyP95Ms: this.percentile(this.sendLatencyMs, 95),
      streamIntervalAvgMs: avgStreamInterval,
      streamIntervalP95Ms: this.percentile(this.streamIntervalsMs, 95),
      lastHeartbeatAgoMs: Date.now() - input.lastUIHeartbeat,
      uiLockAgeMs: input.uiLockAgeMs
    };
  }
}
