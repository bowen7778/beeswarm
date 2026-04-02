import { injectable, inject } from "inversify";
import { ProjectContextService } from "../project/ProjectContextService.js";
import { ProjectModeFacade } from "../../project-mode/facade/ProjectModeFacade.js";
import { SYMBOLS } from "../../../common/di/symbols.js";

/**
 * Usecase to ensure the current project mode allows message processing.
 */
@injectable()
export class EnsureProjectModeAllowsMessageUsecase {
  constructor(
    @inject(SYMBOLS.ProjectContextService) private readonly projectContext: ProjectContextService,
    @inject(SYMBOLS.ProjectModeFacade) private readonly projectMode: ProjectModeFacade
  ) {}

  /**
   * Execute the mode check. Throws an error if the mode is not allowed.
   */
  public execute(input: { projectId?: string; projectRoot?: string }) {
    const projectId = this.resolveProjectId(input);
    if (!projectId) return;
    try {
      const mode = this.projectMode.getModeConfig(projectId);
      if (mode.projectMode === "multi_agent") {
        this.throwWithCode("PROJECT_MODE_MULTI_AGENT_RESERVED", "Multi-agent mode is reserved and not enabled yet");
      }
    } catch (err: any) {
      const code = this.resolveErrorCode(err);
      if (code === "PROJECT_NOT_FOUND") return;
      this.throwWithCode(code || "PROJECT_MODE_RESOLVE_FAILED", String(err?.message || "Failed to resolve project mode"));
    }
  }

  private resolveProjectId(input: { projectId?: string; projectRoot?: string }): string {
    const direct = String(input.projectId || "").trim();
    if (direct) return direct;
    const byRoot = this.projectContext.resolveProjectIdByRoot(String(input.projectRoot || ""));
    return String(byRoot || "").trim();
  }

  private resolveErrorCode(err: any): string {
    const code = String(err?.code || "").trim();
    if (code) return code;
    const message = String(err?.message || "").trim();
    if (message.startsWith("PROJECT_NOT_FOUND")) return "PROJECT_NOT_FOUND";
    return "";
  }

  private throwWithCode(code: string, message: string): never {
    const err: any = new Error(message);
    err.code = code;
    throw err;
  }
}
