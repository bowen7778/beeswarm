import { injectable, inject } from "inversify";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import type { Express, Request, Response } from "express";
import { SYMBOLS } from "../../../common/di/symbols.js";
import { UsecaseBus } from "../../../common/bus/UsecaseBus.js";
import { LoggerService } from "../../runtime/LoggerService.js";
import { VersionManager } from "../../runtime/VersionManager.js";
import { McpSessionStore } from "../stores/McpSessionStore.js";
import { McpSessionBindingStore } from "../stores/McpSessionBindingStore.js";
import { McpRuntimeStatus } from "../types/McpTypes.js";

/**
 * Facade for all MCP (Model Context Protocol) operations.
 */
@injectable()
export class McpFacade {
  public readonly server: McpServer;
  private stdioTransport: StdioServerTransport | null = null;
  private connected = false;
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(
    @inject(SYMBOLS.LoggerService) private readonly logger: LoggerService,
    @inject(SYMBOLS.VersionManager) private readonly versionManager: VersionManager,
    @inject(SYMBOLS.McpSessionBindingStore) private readonly mcpBindingStore: McpSessionBindingStore,
    @inject(SYMBOLS.UsecaseBus) private readonly bus: UsecaseBus,
    @inject(McpSessionStore) private readonly sessionStore: McpSessionStore
  ) {
    this.server = new McpServer({
      name: "BeeMCP",
      version: this.versionManager.getProtocolVersion("mcpServer")
    }, {
      capabilities: { logging: {} },
      instructions: this.getInstructions()
    });
    
    this.startCleanupTask();
  }

  /**
   * Get custom instructions for the MCP server.
   */
  private getInstructions(): string {
    return `BeeMCP Protocol ${this.versionManager.getProtocolVersion("beemcp")}
You are working in a BeeMCP environment.
Prioritize using beemcp_orchestrate and beemcp_ask for interactions.
Please maintain a clear output structure and follow the current session context.`;
  }

  /**
   * Start the cleanup task for expired sessions.
   */
  private startCleanupTask() {
    this.cleanupTimer = setInterval(async () => {
      const now = Date.now();
      for (const [sessionId, session] of this.sessionStore.listSessions()) {
        if (now - session.lastActive > 30 * 60 * 1000) {
          this.logger.info("MCP", `Session ${sessionId} expired.`);
          await session.server.close();
          this.sessionStore.deleteSession(sessionId);
          this.mcpBindingStore.unbindMcpSession(sessionId);
        }
      }
    }, 60 * 1000);
  }

  /**
   * Start the MCP server with Stdio transport.
   */
  async start() {
    if (this.connected) return;
    
    const { transport } = await this.bus.execute(SYMBOLS.StartMcpServerUsecase, this.server);
    this.stdioTransport = transport;
    try {
      if (!this.stdioTransport) {
        throw new Error("TRANSPORT_INITIALIZATION_FAILED");
      }
      await this.server.connect(this.stdioTransport);
      this.connected = true;
      this.logger.info("MCP", "Stdio connected (Waiting for handshake).");
    } catch (err: any) {
      this.logger.error("MCP", "Stdio failed", err);
      this.stdioTransport = null;
      throw err;
    }
  }

  /**
   * Setup SSE transport for the MCP server.
   */
  setupSSE(app: Express, endpoint: string = "/api/mcp/sse") {
    app.get(endpoint, async (req: Request, res: Response) => {
      const protocol = req.headers["x-forwarded-proto"] || req.protocol || "http";
      const host = req.get("host") || "localhost:3000";
      const fullMessagesUrl = `${protocol}://${host}${endpoint}/messages`;
      const projectRoot = String(req.query.projectRoot || "").trim();

      try {
        req.setTimeout(0);
        res.setTimeout(0);
        const transport = new SSEServerTransport(fullMessagesUrl, res);
        const sessionId = transport.sessionId;
        
        await this.bus.execute(SYMBOLS.SetupSSESessionUsecase, { sessionId, transport, projectRoot });

        this.logger.info("MCP", `SSE Session established: ${sessionId} (Project: ${projectRoot || "Anonymous"})`);

        const heartbeatTimer = setInterval(() => {
          if (!res.writableEnded) {
            res.write(": keep-alive\n\n");
            if ((res as any).flush) (res as any).flush();
          }
        }, 30000);

        res.on("close", () => {
          clearInterval(heartbeatTimer);
          this.logger.info("MCP", `SSE Connection ${sessionId} closed. Starting 60s grace period...`);
          const timer = setTimeout(async () => {
            const currentSession = this.sessionStore.getSession(sessionId);
            if (currentSession && currentSession.transport === transport) {
              this.logger.info("MCP", `Grace period expired for ${sessionId}. Cleaning up.`);
              this.mcpBindingStore.unbindMcpSession(sessionId);
              this.sessionStore.deleteSession(sessionId);
              await currentSession.server.close().catch(() => {});
            }
          }, 60 * 1000);
          this.sessionStore.setCleanupTimer(sessionId, timer);
        });
      } catch (err: any) {
        this.logger.error("MCP", `SSE Setup Error: ${err.message}`);
        if (!res.headersSent) res.status(500).send(err.message);
      }
    });

    app.post(`${endpoint}/messages`, async (req: Request, res: Response) => {
      const sessionId = String(req.query.sessionId || "");
      const session = this.sessionStore.getSession(sessionId);
      if (session) {
        session.lastActive = Date.now();
        try {
          await session.transport.handlePostMessage(req, res);
        } catch (err: any) {
          this.logger.error("MCP", `Session ${sessionId} POST error: ${err.message}`);
          if (!res.headersSent) res.status(500).send(err.message);
        }
      } else {
        this.logger.warn("MCP", `POST message received for unknown session: ${sessionId}`);
        res.status(404).send("Session not found");
      }
    });
  }

  /**
   * Update the project root context for a specific session.
   */
  updateSessionContext(sessionId: string, projectRoot: string) {
    if (sessionId === "stdio-session") return;
    const session = this.sessionStore.getSession(sessionId);
    if (session) {
      this.logger.info("MCP", `Binding Session ${sessionId} to ${projectRoot}`);
      session.context.projectRoot = projectRoot;
    }
  }

  /**
   * Get the runtime status of the MCP server.
   */
  getRuntimeStatus(): McpRuntimeStatus {
    return {
      stdioConnected: this.connected,
      sseSessionCount: this.sessionStore.getSessionCount()
    };
  }

  /**
   * Stop the MCP server and cleanup all sessions.
   */
  async stop() {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    try {
      await this.server.close();
      for (const [sessionId, session] of this.sessionStore.listSessions()) {
        this.mcpBindingStore.unbindMcpSession(sessionId);
        await session.server.close();
      }
      this.sessionStore.clearAll();
      this.connected = false;
      this.logger.info("MCP", "Stopped.");
    } catch (err: any) {
      this.logger.error("MCP", "Stop failed", err);
    }
  }
}
