import { injectable, inject } from "inversify";
import { SYMBOLS } from "../../../../common/di/symbols.js";
import { SessionContext } from "../../../../common/context/SessionContext.js";
import { MessageCoreService } from "../../../mcp/message/MessageCoreService.js";
import { McpFacade } from "../../../mcp/facade/McpFacade.js";
import { ProjectStore } from "../../../mcp/stores/ProjectStore.js";
import type { ChannelDriver, ChannelCommandResult } from "../../kernel-core/execution/driver/ChannelDriver.js";
import type { ProjectModeType } from "../../kernel-core/execution/types/ProjectModeType.js";
import type { ChannelType } from "../../kernel-core/execution/types/ChannelType.js";
import type { CommandEnvelope } from "../../kernel-core/execution/types/CommandEnvelope.js";
import type { ChannelRuntimeStatus } from "../../kernel-core/execution/types/ChannelRuntimeStatus.js";

@injectable()
export class McpIdeChannelDriver implements ChannelDriver {
  readonly channelType: ChannelType = "mcp_ide";

  constructor(
    @inject(SYMBOLS.MessageCoreService) private readonly messageCore: MessageCoreService,
    @inject(SYMBOLS.McpFacade) private readonly mcp: McpFacade,
    @inject(SYMBOLS.ProjectStore) private readonly projectStore: ProjectStore
  ) {}

  supports(mode: ProjectModeType, channel: ChannelType): boolean {
    return mode === "single_agent" && channel === "mcp_ide";
  }

  async handleCommand(command: CommandEnvelope): Promise<ChannelCommandResult> {
    if (command.commandType !== "send") {
      return {
        success: false,
        error: {
          code: "CHANNEL_COMMAND_UNSUPPORTED",
          message: "Unsupported command for mcp_ide",
          details: { commandType: command.commandType }
        }
      };
    }
    const project = this.projectStore.readProjectById(command.projectId);
    const projectRoot = String(command.projectRoot || project?.projectRoot || "").trim();
    if (!projectRoot) {
      return {
        success: false,
        error: {
          code: "PROJECT_CONTEXT_REQUIRED",
          message: "Project root is required for mcp_ide command",
          details: { projectId: command.projectId }
        }
      };
    }
    const payload = command.payload || {};
    const result = await SessionContext.run({ projectRoot }, async () => {
      return this.messageCore.ingestFromUI({
        content: payload.content,
        attachments: payload.attachments,
        clientMessageId: payload.clientMessageId
      });
    });
    return { success: true, data: result };
  }

  async getStatus(projectId: string, mode: ProjectModeType): Promise<ChannelRuntimeStatus> {
    const runtime = this.mcp.getRuntimeStatus();
    return {
      projectId,
      projectMode: mode,
      channelType: this.channelType,
      status: runtime.stdioConnected ? "running" : "idle",
      lastErrorCode: "",
      lastErrorMessage: "",
      lastHeartbeatAt: new Date().toISOString(),
      version: "mcp-driver-1",
      details: {
        stdioConnected: runtime.stdioConnected,
        sseSessionCount: runtime.sseSessionCount
      }
    };
  }
}

