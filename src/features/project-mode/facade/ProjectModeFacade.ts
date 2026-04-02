import { injectable, inject } from "inversify";
import { ProjectModeStatusService } from "../services/ProjectModeStatusService.js";
import { SwitchInput, ModeConfig } from "../types/ProjectModeTypes.js";
import { UsecaseBus } from "../../../common/bus/UsecaseBus.js";
import { SYMBOLS } from "../../../common/di/symbols.js";

/**
 * Facade for managing project modes and channels.
 */
@injectable()
export class ProjectModeFacade {
  constructor(
    @inject(SYMBOLS.ProjectModeStatusService) private readonly statusService: ProjectModeStatusService,
    @inject(SYMBOLS.UsecaseBus) private readonly bus: UsecaseBus
  ) {}

  /**
   * Get the mode configuration for a project.
   */
  public getModeConfig(projectId: string): ModeConfig {
    return this.statusService.getModeConfig(projectId);
  }

  /**
   * Switch the project mode.
   */
  public async setProjectMode(input: SwitchInput & { targetMode: string }) {
    return this.bus.execute(SYMBOLS.SwitchProjectModeUsecase, input);
  }

  /**
   * Switch the project's single agent channel.
   */
  public async setSingleAgentChannel(input: SwitchInput & { targetChannel: string }) {
    return this.bus.execute(SYMBOLS.SwitchProjectChannelUsecase, input);
  }

  /**
   * Get the current channel status for a project.
   */
  public getChannelStatus(projectId: string) {
    const config = this.getModeConfig(projectId);
    return {
      projectId: config.projectId,
      projectMode: config.projectMode,
      singleAgentChannel: config.singleAgentChannel,
      channelRuntime: {
        status: "running",
        lastErrorCode: "",
        lastErrorMessage: "",
        lastHeartbeatAt: new Date().toISOString(),
        version: "driver-skeleton-1"
      }
    };
  }
}
