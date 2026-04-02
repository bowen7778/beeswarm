import { injectable, inject } from "inversify";
import { randomUUID } from "node:crypto";
import { SYMBOLS } from "../../common/di/symbols.js";
import { AppConfig } from "../runtime/AppConfig.js";
import { HarnessStore } from "./stores/HarnessStore.js";

@injectable()
export class HarnessGateService {
  constructor(
    @inject(SYMBOLS.HarnessStore) private readonly harnessStore: HarnessStore,
    @inject(SYMBOLS.AppConfig) private readonly config: AppConfig
  ) {}

  checkGate(evalId: string, thresholdOverride?: number) {
    const id = String(evalId || "").trim();
    if (!id) {
      this.throwWithCode("EVAL_ID_REQUIRED", "Eval ID is required");
    }
    const report = this.harnessStore.readHarnessEvalReport(id);
    if (!report) {
      this.throwWithCode("HARNESS_EVAL_NOT_FOUND", "Harness evaluation report not found");
    }
    const threshold = this.resolveThreshold(thresholdOverride);
    const successRate = Number(report.successRate || 0);
    const passed = successRate >= threshold;
    const reason = passed ? "PASS" : "SUCCESS_RATE_BELOW_THRESHOLD";
    const gateId = randomUUID();
    const resultPayload = {
      evalId: id,
      threshold,
      successRate,
      totalCases: Number(report.totalCases || 0),
      passedCases: Number(report.passedCases || 0)
    };
    this.harnessStore.appendHarnessGateResult({
      gateId,
      evalId: id,
      projectId: String(report.projectId || ""),
      passed,
      score: successRate,
      reason,
      resultPayload
    });
    return {
      gateId,
      evalId: id,
      passed,
      score: successRate,
      reason,
      resultPayload
    };
  }

  private resolveThreshold(thresholdOverride?: number): number {
    if (thresholdOverride == null) {
      return this.config.harnessGateMinSuccessRate;
    }
    const raw = Number(thresholdOverride);
    if (!Number.isFinite(raw)) {
      this.throwWithCode("HARNESS_GATE_THRESHOLD_INVALID", "Threshold must be a number");
    }
    if (raw < 0 || raw > 1) {
      this.throwWithCode("HARNESS_GATE_THRESHOLD_INVALID", "Threshold must be between 0 and 1");
    }
    return raw;
  }

  private throwWithCode(code: string, message: string): never {
    const err: any = new Error(message);
    err.code = code;
    throw err;
  }
}

