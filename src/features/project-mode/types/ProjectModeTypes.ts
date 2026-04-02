export type ProjectMode = "single_agent" | "multi_agent";
export type SingleAgentChannel = "mcp_ide" | "cli_codex" | "cli_cc";

export interface ModeConfig {
  projectId: string;
  projectMode: ProjectMode;
  singleAgentChannel: SingleAgentChannel;
  modeUpdatedAt: string;
  channelUpdatedAt: string;
  modeUpdatedBy: string;
  channelUpdatedBy: string;
  lastSwitchTraceId: string;
  lastSwitchRemark: string;
  orchestratorReserved: {
    enabled: boolean;
    provider: string;
    configVersion: number;
  };
}

export interface SwitchInput {
  projectId: string;
  operator: string;
  traceId: string;
  auditRemark?: string;
}
