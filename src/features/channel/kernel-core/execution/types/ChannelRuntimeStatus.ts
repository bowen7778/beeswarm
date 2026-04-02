import type { ChannelType } from "./ChannelType.js";
import type { ProjectModeType } from "./ProjectModeType.js";

export type ChannelRuntimeStatus = {
  projectId: string;
  projectMode: ProjectModeType;
  channelType: ChannelType;
  status: "idle" | "running" | "error" | "disabled";
  lastErrorCode: string;
  lastErrorMessage: string;
  lastHeartbeatAt: string;
  version: string;
  details?: any;
};

