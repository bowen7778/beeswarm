import { injectable, inject } from "inversify";
import { randomUUID } from "node:crypto";
import { SYMBOLS } from "../../common/di/symbols.js";
import { ChannelFacade } from "../channel/facade/ChannelFacade.js";
import { HarnessStore } from "./stores/HarnessStore.js";
import { HarnessFailureClassifierService } from "./HarnessFailureClassifierService.js";
import type { HarnessEvaluationCaseInput } from "./types/HarnessTypes.js";

@injectable()
export class HarnessEvaluationService {
  constructor(
    @inject(SYMBOLS.ChannelFacade) private readonly dispatchService: ChannelFacade,
    @inject(SYMBOLS.HarnessStore) private readonly harnessStore: HarnessStore,
    @inject(SYMBOLS.HarnessFailureClassifierService) private readonly failureClassifier: HarnessFailureClassifierService
  ) {}

  async runEvaluation(input: { projectId: string; traceId?: string; cases?: HarnessEvaluationCaseInput[] }) {
    const projectId = String(input.projectId || "").trim();
    if (!projectId) {
      this.throwWithCode("PROJECT_ID_REQUIRED", "Project ID is required");
    }
    const modeConfig = this.harnessStore.readProjectModeConfig(projectId);
    if (!modeConfig) {
      this.throwWithCode("PROJECT_NOT_FOUND", "Project not found");
    }
    const evalId = randomUUID();
    const traceId = String(input.traceId || "").trim() || randomUUID();
    const mode = String(modeConfig.projectMode || "single_agent");
    const channel = mode === "multi_agent" ? "orchestrator_reserved" : String(modeConfig.singleAgentChannel || "mcp_ide");
    const cases = this.createCases(projectId, mode, channel, input.cases);
    let passed = 0;
    let failed = 0;
    const results: any[] = [];
    const failureClassCount: Record<string, number> = {};

    for (const item of cases) {
      try {
        const status = await this.dispatchService.getStatus(projectId);
        let commandResult: any = null;
        let commandErrorCode = "";
        const commandType = this.resolveCommandType(item.commandType);
        const payload = item.payload ?? { content: item.payloadContent };
        try {
          if (commandType === "status") {
            commandResult = status;
          } else {
            commandResult = await this.dispatchService.dispatch({
              projectId,
              commandType,
              payload,
              traceId: `${traceId}-${item.caseId}`
            });
          }
        } catch (err: any) {
          commandErrorCode = String(err?.code || "CHANNEL_COMMAND_FAILED");
        }
        const pass = this.assertCase({
          mode,
          channel,
          commandErrorCode,
          commandResult,
          expectedErrorCode: item.expectedErrorCode,
          expectSuccess: item.expectSuccess
        });
        if (pass) passed += 1;
        if (!pass) {
          failed += 1;
          const errorClass = this.failureClassifier.classify(commandErrorCode || "HARNESS_EVAL_CASE_ASSERT_FAILED");
          failureClassCount[errorClass] = Number(failureClassCount[errorClass] || 0) + 1;
          this.harnessStore.appendHarnessFailure({
            runId: evalId,
            projectId,
            traceId,
            errorCode: commandErrorCode || "HARNESS_EVAL_CASE_ASSERT_FAILED",
            errorClass,
            failureStage: "evaluation",
            failurePayload: {
              caseId: item.caseId,
              mode,
              channel
            }
          });
        }
        results.push({
          caseId: item.caseId,
          pass,
          status,
          commandType,
          payload,
          expectedErrorCode: item.expectedErrorCode || "",
          expectSuccess: item.expectSuccess,
          commandErrorCode,
          commandResult
        });
      } catch (err: any) {
        failed += 1;
        const errorCode = String(err?.code || "HARNESS_EVAL_CASE_FAILED");
        const errorClass = this.failureClassifier.classify(errorCode);
        failureClassCount[errorClass] = Number(failureClassCount[errorClass] || 0) + 1;
        this.harnessStore.appendHarnessFailure({
          runId: evalId,
          projectId,
          traceId,
          errorCode,
          errorClass,
          failureStage: "evaluation",
          failurePayload: {
            caseId: item.caseId,
            mode,
            channel
          }
        });
        results.push({
          caseId: item.caseId,
          pass: false,
          errorCode,
          errorClass,
          message: String(err?.message || "Harness eval case failed")
        });
      }
    }

    const total = cases.length;
    const successRate = total > 0 ? passed / total : 0;
    const reportPayload = {
      totalCases: total,
      passedCases: passed,
      failedCases: Math.max(0, total - passed),
      failureClassCount,
      cases: results
    };
    this.harnessStore.appendHarnessEvalReport({
      evalId,
      projectId,
      mode,
      channel,
      traceId,
      totalCases: total,
      passedCases: passed,
      successRate,
      reportPayload
    });
    this.harnessStore.appendHarnessMetric({
      runId: evalId,
      projectId,
      traceId,
      metricName: "eval_success_rate",
      metricValue: successRate,
      metricPayload: {
        totalCases: total,
        passedCases: passed,
        failedCases: failed,
        failureClassCount
      }
    });
    return {
      evalId,
      projectId,
      traceId,
      mode,
      channel,
      totalCases: total,
      passedCases: passed,
      successRate,
      reportPayload
    };
  }

  getReport(evalId: string) {
    const report = this.harnessStore.readHarnessEvalReport(evalId);
    if (!report) {
      this.throwWithCode("HARNESS_EVAL_NOT_FOUND", "Harness evaluation report not found");
    }
    return report;
  }

  private createCases(projectId: string, mode: string, channel: string, rawCases?: HarnessEvaluationCaseInput[]): Array<{
    caseId: string;
    payloadContent: string;
    commandType: "send" | "ask" | "dispatch" | "cancel" | "status";
    payload: any;
    expectedErrorCode: string;
    expectSuccess?: boolean;
  }> {
    if (Array.isArray(rawCases) && rawCases.length > 0) {
      return rawCases.map((item, index) => {
        const caseId = String(item?.caseId || "").trim() || `${projectId}-custom-${index + 1}`;
        return {
          caseId,
          payloadContent: "",
          commandType: this.resolveCommandType(item?.commandType),
          payload: item?.payload ?? {},
          expectedErrorCode: String(item?.expectedErrorCode || "").trim(),
          expectSuccess: item?.expectSuccess
        };
      });
    }
    return [
      {
        caseId: `${projectId}-case-status-command`,
        commandType: "status",
        payloadContent: `health:${mode}:${channel}`,
        payload: {},
        expectedErrorCode: "",
        expectSuccess: true
      },
      {
        caseId: `${projectId}-case-send-command`,
        commandType: "send",
        payloadContent: `send:${Date.now()}`,
        payload: {},
        expectedErrorCode: "",
        expectSuccess: undefined
      }
    ];
  }

  private assertCase(input: {
    mode: string;
    channel: string;
    commandErrorCode: string;
    commandResult: any;
    expectedErrorCode?: string;
    expectSuccess?: boolean;
  }): boolean {
    const expectedErrorCode = String(input.expectedErrorCode || "").trim();
    if (expectedErrorCode) {
      return String(input.commandErrorCode || "") === expectedErrorCode;
    }
    if (typeof input.expectSuccess === "boolean") {
      return input.expectSuccess ? !input.commandErrorCode && !!input.commandResult : !!input.commandErrorCode;
    }
    if (input.mode === "multi_agent") {
      return input.commandErrorCode === "PROJECT_MODE_MULTI_AGENT_RESERVED";
    }
    if (input.channel === "cli_codex" || input.channel === "cli_cc") {
      return input.commandErrorCode === "CHANNEL_NOT_IMPLEMENTED";
    }
    if (input.channel === "mcp_ide") {
      return !!input.commandResult;
    }
    return false;
  }

  private resolveCommandType(commandType?: string): "send" | "ask" | "dispatch" | "cancel" | "status" {
    const value = String(commandType || "send").trim();
    if (value === "send" || value === "ask" || value === "dispatch" || value === "cancel" || value === "status") {
      return value;
    }
    return "send";
  }

  private throwWithCode(code: string, message: string): never {
    const err: any = new Error(message);
    err.code = code;
    throw err;
  }
}

