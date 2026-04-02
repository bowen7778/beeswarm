import { injectable, inject } from "inversify";
import { SYMBOLS } from "../../../common/di/symbols.js";
import { ProjectModeFacade } from "../../project-mode/facade/ProjectModeFacade.js";
import { ChannelDriverRegistry } from "../kernel-core/execution/driver/ChannelDriverRegistry.js";
import type { ChannelType } from "../kernel-core/execution/types/ChannelType.js";
import type { ProjectModeType } from "../kernel-core/execution/types/ProjectModeType.js";
import type { CommandEnvelope } from "../kernel-core/execution/types/CommandEnvelope.js";

@injectable()
export class ChannelFacade {
  constructor(
    @inject(SYMBOLS.ProjectModeFacade) private readonly projectMode: ProjectModeFacade,
    @inject(SYMBOLS.ChannelDriverRegistry) private readonly driverRegistry: ChannelDriverRegistry
  ) {}

  public async dispatch(input: {
    projectId: string;
    commandType: "send" | "ask" | "dispatch" | "cancel" | "status";
    payload: any;
    traceId: string;
    idempotencyKey?: string;
  }) {
    const projectId = String(input.projectId || "").trim();
    if (!projectId) throw new Error("PROJECT_ID_REQUIRED");
    
    const config = this.projectMode.getModeConfig(projectId);
    const mode = config.projectMode as ProjectModeType;
    const channel = this.resolveChannel(mode, config.singleAgentChannel as ChannelType);
    const driver = this.driverRegistry.findDriver(mode, channel);
    
    if (!driver) throw new Error(`CHANNEL_DRIVER_NOT_FOUND:${mode}:${channel}`);

    const command: CommandEnvelope = {
      projectId,
      projectMode: mode,
      channelType: channel,
      commandType: input.commandType,
      payload: input.payload || {},
      traceId: String(input.traceId || ""),
      idempotencyKey: String(input.idempotencyKey || ""),
      projectRoot: String(input.payload?.projectRoot || "")
    };

    const result = await driver.handleCommand(command);
    if (!result.success) {
      throw new Error(String(result.error?.message || "Channel command failed"));
    }
    
    return {
      projectId,
      projectMode: mode,
      channelType: channel,
      traceId: command.traceId,
      data: result.data
    };
  }

  public async getStatus(projectId: string) {
    const id = String(projectId || "").trim();
    if (!id) throw new Error("PROJECT_ID_REQUIRED");
    
    const config = this.projectMode.getModeConfig(id);
    const mode = config.projectMode as ProjectModeType;
    const channel = this.resolveChannel(mode, config.singleAgentChannel as ChannelType);
    const driver = this.driverRegistry.findDriver(mode, channel);
    
    if (!driver) throw new Error(`CHANNEL_DRIVER_NOT_FOUND:${mode}:${channel}`);
    return driver.getStatus(id, mode);
  }

  private resolveChannel(mode: ProjectModeType, singleAgentChannel: ChannelType): ChannelType {
    if (mode === "multi_agent") return "orchestrator_reserved";
    return singleAgentChannel;
  }
}
