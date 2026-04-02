import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { SessionContextPayload } from "../../../common/context/SessionContext.js";

export interface McpSession {
  server: McpServer;
  transport: SSEServerTransport;
  lastActive: number;
  context: SessionContextPayload;
}

export interface McpRuntimeStatus {
  stdioConnected: boolean;
  sseSessionCount: number;
}
