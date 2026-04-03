import { injectable, inject } from "inversify";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { SYMBOLS } from "../../../common/di/symbols.js";
import { LoggerService } from "../../runtime/LoggerService.js";
import { VersionManager } from "../../runtime/VersionManager.js";
import { ToolRegistryService } from "../services/ToolRegistryService.js";
import { McpResourceService } from "../services/McpResourceService.js";
import { McpSessionStore } from "../stores/McpSessionStore.js";
import { McpSessionBindingStore } from "../stores/McpSessionBindingStore.js";
import { ProjectIdentityService } from "../project/ProjectIdentityService.js";
import { SessionContextPayload } from "../../../common/context/SessionContext.js";

/**
 * Usecase for setting up and connecting an MCP SSE session.
 */
@injectable()
export class SetupSSESessionUsecase {
  constructor(
    @inject(SYMBOLS.LoggerService) private readonly logger: LoggerService,
    @inject(SYMBOLS.VersionManager) private readonly versionManager: VersionManager,
    @inject(SYMBOLS.ProjectIdentityService) private readonly projectIdentity: ProjectIdentityService,
    @inject(SYMBOLS.McpSessionBindingStore) private readonly mcpBindingStore: McpSessionBindingStore,
    @inject(SYMBOLS.ToolRegistryService) private readonly toolRegistry: ToolRegistryService,
    @inject(McpResourceService) private readonly resourceService: McpResourceService,
    @inject(McpSessionStore) private readonly sessionStore: McpSessionStore
  ) {}

  /**
   * Execute the SSE session setup.
   */
  public async execute(input: { sessionId: string; transport: SSEServerTransport; projectRoot?: string }): Promise<McpServer> {
    const { sessionId, transport, projectRoot } = input;
    if (projectRoot) {
      await this.bindProject(sessionId, projectRoot);
    }

    let session = this.sessionStore.getSession(sessionId);
    if (!session) {
      const { server, context } = this.createMcpServer(sessionId, projectRoot || "");
      session = { server, transport, lastActive: Date.now(), context };
      this.sessionStore.setSession(sessionId, session);
    } else {
      this.sessionStore.deleteCleanupTimer(sessionId);
      session.transport = transport;
      session.lastActive = Date.now();
      session.context.projectRoot = projectRoot || "";
    }

    await session.server.connect(transport);
    return session.server;
  }

  /**
   * Bind an MCP session to a specific project.
   */
  private async bindProject(sessionId: string, projectRoot: string) {
    const info = this.projectIdentity.readProjectInfo(projectRoot);
    let projectId = info.projectId;
    
    if (!info.initialized) {
      this.logger.info("MCP", `Project auto-init at handshake: ${projectRoot}`);
      const identity = await this.projectIdentity.initializeProject(projectRoot);
      projectId = identity.projectId;
    }
    
    this.mcpBindingStore.bindMcpSession(sessionId, projectId);
  }

  /**
   * Create a new McpServer instance with registered tools and resources.
   */
  private createMcpServer(sessionId: string, projectRoot: string): { server: McpServer; context: SessionContextPayload } {
    const context: SessionContextPayload = { sessionId, projectRoot };
    const appName = this.versionManager.appName;
    const server = new McpServer({
      name: `${appName}-${sessionId.slice(0, 8)}`,
      version: this.versionManager.getProtocolVersion("mcpServer")
    }, {
      capabilities: { logging: {} },
      instructions: this.getInstructions()
    });
    
    this.toolRegistry.apply(server, context);
    this.resourceService.registerStateResources(server, sessionId);
    return { server, context };
  }

  /**
   * Get custom instructions for the MCP server.
   */
  private getInstructions(): string {
    const prefix = this.versionManager.protocolPrefix;
    const appName = this.versionManager.appName;
    return `${appName} Protocol ${this.versionManager.getProtocolVersion(prefix)}
You are working in a ${appName} environment.
Prioritize using ${prefix}_orchestrate and ${prefix}_ask for interactions.
Please maintain a clear output structure and follow the current session context.`;
  }
}
