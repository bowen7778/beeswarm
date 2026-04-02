import { injectable } from "inversify";
import type { ChannelDriver, ChannelCommandResult } from "../../kernel-core/execution/driver/ChannelDriver.js";
import type { ProjectModeType } from "../../kernel-core/execution/types/ProjectModeType.js";
import type { ChannelType } from "../../kernel-core/execution/types/ChannelType.js";
import type { CommandEnvelope } from "../../kernel-core/execution/types/CommandEnvelope.js";
import type { ChannelRuntimeStatus } from "../../kernel-core/execution/types/ChannelRuntimeStatus.js";

@injectable()
export class OrchestratorReservedChannelDriver implements ChannelDriver {
  readonly channelType: ChannelType = "orchestrator_reserved";

  supports(mode: ProjectModeType, channel: ChannelType): boolean {
    return mode === "multi_agent" && channel === "orchestrator_reserved";
  }

  async handleCommand(command: CommandEnvelope): Promise<ChannelCommandResult> {
    return {
      success: false,
      error: {
        code: "PROJECT_MODE_MULTI_AGENT_RESERVED",
        message: "Multi-agent mode is reserved and not enabled yet",
        details: { projectId: command.projectId, channelType: this.channelType }
      }
    };
  }

  async getStatus(projectId: string, mode: ProjectModeType): Promise<ChannelRuntimeStatus> {
    return {
      projectId,
      projectMode: mode,
      channelType: this.channelType,
      status: "disabled",
      lastErrorCode: "PROJECT_MODE_MULTI_AGENT_RESERVED",
      lastErrorMessage: "Multi-agent mode is reserved and not enabled yet",
      lastHeartbeatAt: "",
      version: "orchestrator-reserved-1"
    };
  }
}

