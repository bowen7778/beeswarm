import { injectable, inject } from "inversify";
import type express from "express";
import { SYMBOLS } from "../../../../common/di/symbols.js";
import { McpFacade } from "../../../mcp/facade/McpFacade.js";

@injectable()
export class McpSSEBridgeService {
  constructor(
    @inject(SYMBOLS.McpFacade) private readonly mcp: McpFacade
  ) {}

  register(app: express.Express, endpoint: string = "/api/mcp/sse") {
    this.mcp.setupSSE(app, endpoint);
  }
}

