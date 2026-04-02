import type { ChannelType } from "./ChannelType.js";
import type { ProjectModeType } from "./ProjectModeType.js";

export type CommandType = "send" | "ask" | "dispatch" | "cancel" | "status";

export type CommandEnvelope = {
  projectId: string;
  projectMode: ProjectModeType;
  channelType: ChannelType;
  commandType: CommandType;
  payload: any;
  traceId: string;
  idempotencyKey?: string;
  projectRoot?: string;
};

