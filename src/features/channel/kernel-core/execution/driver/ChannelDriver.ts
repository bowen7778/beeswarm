import type { ChannelType } from "../types/ChannelType.js";
import type { ProjectModeType } from "../types/ProjectModeType.js";
import type { CommandEnvelope } from "../types/CommandEnvelope.js";
import type { ChannelRuntimeStatus } from "../types/ChannelRuntimeStatus.js";

export type ChannelCommandResult = {
  success: boolean;
  data?: any;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
};

export interface ChannelDriver {
  readonly channelType: ChannelType;
  supports(mode: ProjectModeType, channel: ChannelType): boolean;
  handleCommand(command: CommandEnvelope): Promise<ChannelCommandResult>;
  getStatus(projectId: string, mode: ProjectModeType): Promise<ChannelRuntimeStatus>;
}

