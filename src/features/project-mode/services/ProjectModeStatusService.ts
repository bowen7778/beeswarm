import { injectable, inject } from "inversify";
import { SYMBOLS } from "../../../common/di/symbols.js";
import { ProjectStore } from "../../mcp/stores/ProjectStore.js";
import { ModeConfig, ProjectMode, SingleAgentChannel } from "../types/ProjectModeTypes.js";

@injectable()
export class ProjectModeStatusService {
  constructor(
    @inject(SYMBOLS.ProjectStore) private readonly projectStore: ProjectStore
  ) {}

  public getModeConfig(projectId: string): ModeConfig {
    const project = this.projectStore.readProjectById(projectId);
    if (!project) throw new Error(`PROJECT_NOT_FOUND:${projectId}`);
    return this.toModeConfig(project);
  }

  public normalizeMode(mode: string): ProjectMode | "" {
    const normalized = String(mode || "").trim();
    if (normalized === "single_agent") return "single_agent";
    return "";
  }

  public normalizeSingleAgentChannel(channel: string): SingleAgentChannel | "" {
    const normalized = String(channel || "").trim();
    if (normalized === "mcp_ide") return "mcp_ide";
    return "";
  }

  private toModeConfig(project: any): ModeConfig {
    return {
      projectId: String(project.projectId || ""),
      projectMode: this.toSupportedMode(project.projectMode),
      singleAgentChannel: this.toSupportedSingleAgentChannel(project.singleAgentChannel),
      modeUpdatedAt: String(project.modeUpdatedAt || ""),
      channelUpdatedAt: String(project.channelUpdatedAt || ""),
      modeUpdatedBy: String(project.modeUpdatedBy || ""),
      channelUpdatedBy: String(project.channelUpdatedBy || ""),
      lastSwitchTraceId: String(project.lastSwitchTraceId || ""),
      lastSwitchRemark: String(project.lastSwitchRemark || ""),
      orchestratorReserved: {
        enabled: false,
        provider: "",
        configVersion: 0
      }
    };
  }

  private toSupportedMode(_mode: unknown): ProjectMode {
    return "single_agent";
  }

  private toSupportedSingleAgentChannel(_channel: unknown): SingleAgentChannel {
    return "mcp_ide";
  }
}
