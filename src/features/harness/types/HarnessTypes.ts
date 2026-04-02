export type HarnessSpanLayer = "route" | "memory" | "tool" | "output";
export type HarnessConfidence = "high" | "medium" | "low";

export type HarnessExecutionEnvelope = {
  projectId: string;
  traceId: string;
  mode: "single_agent" | "multi_agent";
  channel: "mcp_ide" | "cli_codex" | "cli_cc" | "orchestrator_reserved";
  intent: "send" | "ask" | "dispatch" | "cancel" | "status";
  payload: any;
  timeoutMs?: number;
};

export type HarnessEvaluationCaseInput = {
  caseId: string;
  commandType?: "send" | "ask" | "dispatch" | "cancel" | "status";
  payload?: any;
  expectedErrorCode?: string;
  expectSuccess?: boolean;
};

export type HarnessSpanEvent = {
  traceId: string;
  spanId: string;
  projectId: string;
  layer: HarnessSpanLayer;
  eventType: string;
  timestamp: string;
  confidence: HarnessConfidence;
  payload: any;
};

