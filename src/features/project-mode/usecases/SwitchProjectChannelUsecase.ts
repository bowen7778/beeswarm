import { injectable, inject } from "inversify";
import { SYMBOLS } from "../../../common/di/symbols.js";
import { ProjectModeStore } from "../../mcp/stores/ProjectModeStore.js";
import { LoggerService } from "../../runtime/LoggerService.js";
import { ProjectModeStatusService } from "../services/ProjectModeStatusService.js";
import { ProjectModeLockStore } from "../stores/ProjectModeLockStore.js";
import { SwitchInput, ModeConfig } from "../types/ProjectModeTypes.js";

@injectable()
export class SwitchProjectChannelUsecase {
  constructor(
    @inject(SYMBOLS.ProjectModeStore) private readonly projectModeStore: ProjectModeStore,
    @inject(SYMBOLS.LoggerService) private readonly logger: LoggerService,
    @inject(ProjectModeStatusService) private readonly statusService: ProjectModeStatusService,
    @inject(ProjectModeLockStore) private readonly lockStore: ProjectModeLockStore
  ) {}

  public async execute(input: SwitchInput & { targetChannel: string }) {
    const id = String(input.projectId || "").trim();
    const requestedChannel = String(input.targetChannel || "").trim();
    const targetChannel = this.statusService.normalizeSingleAgentChannel(requestedChannel);
    
    if (!id) throw new Error("PROJECT_ID_REQUIRED");
    if (requestedChannel === "cli_codex" || requestedChannel === "cli_cc") {
      this.throwWithCode("CHANNEL_NOT_IMPLEMENTED", "Only mcp_ide channel is currently available");
    }
    if (!targetChannel) throw new Error("INVALID_CHANNEL");
    
    if (!this.lockStore.acquireLock(id)) throw new Error("PROJECT_SWITCH_LOCKED");
    
    let before: ModeConfig | null = null;
    try {
      before = this.statusService.getModeConfig(id);
      if (before.projectMode === "multi_agent") {
        throw new Error("PROJECT_MODE_CHANNEL_CONFLICT");
      }
      if (before.singleAgentChannel === targetChannel) {
        return this.getResult(id, before.singleAgentChannel, before.singleAgentChannel, input.traceId);
      }
      
      this.projectModeStore.updateSingleAgentChannel({
        projectId: id,
        channel: targetChannel,
        operator: String(input.operator || ""),
        traceId: String(input.traceId || ""),
        remark: String(input.auditRemark || "")
      });
      
      const after = this.statusService.getModeConfig(id);
      return this.getResult(id, before.singleAgentChannel, after.singleAgentChannel, input.traceId);
    } catch (err: any) {
      if (before) this.rollback(id, before, input);
      throw err;
    } finally {
      this.lockStore.releaseLock(id);
    }
  }

  private getResult(projectId: string, previousChannel: string, currentChannel: string, traceId: string) {
    return {
      projectId,
      previousChannel,
      currentChannel,
      switchedAt: new Date().toISOString(),
      traceId
    };
  }

  private rollback(projectId: string, before: ModeConfig, input: SwitchInput & { targetChannel: string }) {
    try {
      this.projectModeStore.updateSingleAgentChannel({
        projectId,
        channel: before.singleAgentChannel,
        operator: String(input.operator || ""),
        traceId: String(input.traceId || ""),
        remark: "ROLLBACK_APPLIED"
      });
    } catch (err: any) {
      this.logger.error("PROJECT_MODE", "Failed to rollback channel", err);
    }
  }

  private throwWithCode(code: string, message: string): never {
    const err: any = new Error(message);
    err.code = code;
    throw err;
  }
}
