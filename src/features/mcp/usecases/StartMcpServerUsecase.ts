import { injectable, inject } from "inversify";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SYMBOLS } from "../../../common/di/symbols.js";
import { LoggerService } from "../../runtime/LoggerService.js";
import { VersionManager } from "../../runtime/VersionManager.js";
import { ToolRegistryService } from "../services/ToolRegistryService.js";
import { McpResourceService } from "../services/McpResourceService.js";
import { SessionContextPayload } from "../../../common/context/SessionContext.js";
import { AppConfig } from "../../runtime/AppConfig.js";

/**
 * Usecase for starting an MCP server with Stdio transport.
 */
@injectable()
export class StartMcpServerUsecase {
  constructor(
    @inject(SYMBOLS.LoggerService) private readonly logger: LoggerService,
    @inject(SYMBOLS.VersionManager) private readonly versionManager: VersionManager,
    @inject(SYMBOLS.ToolRegistryService) private readonly toolRegistry: ToolRegistryService,
    @inject(McpResourceService) private readonly resourceService: McpResourceService
  ) {}

  /**
   * Execute the MCP server startup logic.
   */
  public execute(input: { server: McpServer }): { transport: StdioServerTransport; context: SessionContextPayload } {
    const { server } = input;
    const stdioContext: SessionContextPayload = { 
      sessionId: "stdio-session", 
      projectRoot: AppConfig.projectRoot() || ""
    };
    
    this.toolRegistry.apply(server, stdioContext);
    this.resourceService.registerStateResources(server, stdioContext.sessionId || "stdio");
    
    const transport = new StdioServerTransport();
    return { transport, context: stdioContext };
  }
}
