import { injectable, inject } from "inversify";
import { SYMBOLS } from "../../../common/di/symbols.js";
import { ProjectModeStore } from "../../mcp/stores/ProjectModeStore.js";
import { LoggerService } from "../../runtime/LoggerService.js";
import { ProjectModeStatusService } from "../services/ProjectModeStatusService.js";
import { ProjectModeLockStore } from "../stores/ProjectModeLockStore.js";
import { SwitchInput, ModeConfig } from "../types/ProjectModeTypes.js";

@injectable()
export class SwitchProjectModeUsecase {
  constructor(
    @inject(SYMBOLS.ProjectModeStore) private readonly projectModeStore: ProjectModeStore,
    @inject(SYMBOLS.LoggerService) private readonly logger: LoggerService,
    @inject(ProjectModeStatusService) private readonly statusService: ProjectModeStatusService,
    @inject(ProjectModeLockStore) private readonly lockStore: ProjectModeLockStore
  ) {}

  public async execute(input: SwitchInput & { targetMode: string }) {
    const id = String(input.projectId || "").trim();
    const requestedMode = String(input.targetMode || "").trim();
    const targetMode = this.statusService.normalizeMode(requestedMode);
    
    if (!id) throw new Error("PROJECT_ID_REQUIRED");
    if (requestedMode === "multi_agent") {
      this.throwWithCode("PROJECT_MODE_MULTI_AGENT_RESERVED", "Multi-agent mode is reserved and not enabled yet");
    }
    if (!targetMode) throw new Error("INVALID_MODE");
    
    if (!this.lockStore.acquireLock(id)) throw new Error("PROJECT_SWITCH_LOCKED");
    
    let before: ModeConfig | null = null;
    try {
      before = this.statusService.getModeConfig(id);
      if (before.projectMode === targetMode) {
        return this.getResult(id, before.projectMode, before.projectMode, input.traceId);
      }
      
      this.projectModeStore.updateProjectMode({
        projectId: id,
        mode: targetMode,
        operator: String(input.operator || ""),
        traceId: String(input.traceId || ""),
        remark: String(input.auditRemark || "")
      });
      
      this.projectModeStore.appendProjectModeAudit({
        projectId: id,
        action: "mode_set",
        fromValue: before.projectMode,
        toValue: targetMode,
        operator: String(input.operator || ""),
        traceId: String(input.traceId || ""),
        remark: String(input.auditRemark || ""),
        result: "success"
      });
      
      const after = this.statusService.getModeConfig(id);
      return this.getResult(id, before.projectMode, after.projectMode, input.traceId);
    } catch (err: any) {
      if (before) this.rollback(id, before, input);
      throw err;
    } finally {
      this.lockStore.releaseLock(id);
    }
  }

  private getResult(projectId: string, previousMode: string, currentMode: string, traceId: string) {
    return {
      projectId,
      previousMode,
      currentMode,
      switchedAt: new Date().toISOString(),
      traceId
    };
  }

  private rollback(projectId: string, before: ModeConfig, input: SwitchInput & { targetMode: string }) {
    try {
      this.projectModeStore.updateProjectMode({
        projectId,
        mode: before.projectMode,
        operator: String(input.operator || ""),
        traceId: String(input.traceId || ""),
        remark: "ROLLBACK_APPLIED"
      });
    } catch (err: any) {
      this.logger.error("PROJECT_MODE", "Failed to rollback", err);
    }
  }

  private throwWithCode(code: string, message: string): never {
    const err: any = new Error(message);
    err.code = code;
    throw err;
  }
}
