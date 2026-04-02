import { injectable } from "inversify";
import type { ChannelDriver, ChannelCommandResult } from "../../kernel-core/execution/driver/ChannelDriver.js";
import type { ProjectModeType } from "../../kernel-core/execution/types/ProjectModeType.js";
import type { ChannelType } from "../../kernel-core/execution/types/ChannelType.js";
import type { CommandEnvelope } from "../../kernel-core/execution/types/CommandEnvelope.js";
import type { ChannelRuntimeStatus } from "../../kernel-core/execution/types/ChannelRuntimeStatus.js";

@injectable()
export class CloudCodeCliChannelDriver implements ChannelDriver {
  readonly channelType: ChannelType = "cli_cc";

  supports(mode: ProjectModeType, channel: ChannelType): boolean {
    return mode === "single_agent" && channel === "cli_cc";
  }

  async handleCommand(command: CommandEnvelope): Promise<ChannelCommandResult> {
    return {
      success: false,
      error: {
        code: "CHANNEL_NOT_IMPLEMENTED",
        message: "Cloud Code CLI channel is reserved and not implemented yet",
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
      lastErrorCode: "CHANNEL_NOT_IMPLEMENTED",
      lastErrorMessage: "Cloud Code CLI channel is reserved and not implemented yet",
      lastHeartbeatAt: "",
      version: "cli-cc-driver-1"
    };
  }
}

