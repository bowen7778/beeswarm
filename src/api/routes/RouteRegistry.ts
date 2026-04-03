import { injectable, inject } from "inversify";
import express from "express";
import path from "node:path";
import fsSync from "node:fs";
import { timingSafeEqual } from "node:crypto";
import { SYMBOLS } from "../../common/di/symbols.js";
import { IMController } from "../controllers/IMController.js";
import { SessionController } from "../controllers/SessionController.js";
import { SystemController } from "../controllers/SystemController.js";
import { MonitorController } from "../controllers/MonitorController.js";
import { ProjectModeController } from "../controllers/ProjectModeController.js";
import { ChannelController } from "../controllers/ChannelController.js";
import { HarnessController } from "../controllers/HarnessController.js";
import { StaticAssetService } from "../../features/runtime/StaticAssetService.js";
import { LoggerService } from "../../features/runtime/LoggerService.js";
import { AppConfig } from "../../features/runtime/AppConfig.js";
import { VersionManager } from "../../features/runtime/VersionManager.js";
import { McpSSEBridgeService } from "../../features/runtime/sse/mcp/McpSSEBridgeService.js";

@injectable()
export class RouteRegistry {
  private readonly headerMaskKeys = new Set([
    "authorization",
    "cookie",
    "x-api-key",
    "x-project-root",
    "x-harness-token",
    "x-auth-token",
    "proxy-authorization"
  ]);

  constructor(
    @inject(SYMBOLS.IMController) private readonly imController: IMController,
    @inject(SYMBOLS.SessionController) private readonly sessionController: SessionController,
    @inject(SYMBOLS.SystemController) private readonly systemController: SystemController,
    @inject(SYMBOLS.MonitorController) private readonly monitorController: MonitorController,
    @inject(SYMBOLS.ProjectModeController) private readonly projectModeController: ProjectModeController,
    @inject(SYMBOLS.ChannelController) private readonly channelController: ChannelController,
    @inject(SYMBOLS.HarnessController) private readonly harnessController: HarnessController,
    @inject(SYMBOLS.McpSSEBridgeService) private readonly mcpSSEBridge: McpSSEBridgeService,
    @inject(SYMBOLS.StaticAssetService) private readonly staticAssets: StaticAssetService,
    @inject(SYMBOLS.LoggerService) private readonly logger: LoggerService,
    @inject(SYMBOLS.AppConfig) private readonly config: AppConfig,
    @inject(SYMBOLS.PathResolverService) private readonly pathResolver: PathResolverService,
    @inject(SYMBOLS.VersionManager) private readonly versionManager: VersionManager
  ) {}

  register(app: express.Express, statusProvider?: () => any) {
    if (statusProvider) {
      this.monitorController.setHostStatusProvider(statusProvider);
    }

    // [ABSOLUTE TOP] Debugging all incoming traffic
    app.use((req, res, next) => {
      process.stderr.write(`[TRAFFIC] ${req.method} ${req.url}\n`);
      next();
    });

    const mcpMessagesPath = "/api/mcp/sse/messages";
    const webhookPath = "/api/im/webhook";
    
    // Global logging middleware
    app.use((req, res, next) => {
      this.logger.info("HTTP", `${req.method} ${req.url} (Origin: ${req.headers.origin || 'none'})`);
      next();
    });

    // Minimal CORS: must be at the top to ensure all requests have CORS headers
    app.use((req, res, next) => {
      const allowedOrigin = this.resolveAllowedOrigin(req.headers.origin as string | undefined);
      if (allowedOrigin) {
        res.header("Access-Control-Allow-Origin", allowedOrigin);
      }
      res.header("Vary", "Origin");
      res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
      res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, x-project-id, x-project-root, x-harness-token");
      res.header("Access-Control-Expose-Headers", "Content-Type");
      
      this.logger.debug("HTTP_TRACE", `${req.method} ${req.url} (Headers: ${JSON.stringify(this.sanitizeHeaders(req.headers as any))})`);

      // SSE Special Handling: only set special headers for stream requests
      if (req.url.startsWith("/api/stream") || req.url.startsWith("/api/mcp/sse")) {
        res.header("Cache-Control", "no-cache, no-transform");
        res.header("Connection", "keep-alive");
        res.header("X-Accel-Buffering", "no");
      }

      if (req.method === "OPTIONS") {
        res.sendStatus(200);
      } else {
        next();
      }
    });

    // --- MCP Standard Routes (Must be registered before Body Parser to ensure streams are not corrupted) ---
    this.mcpSSEBridge.register(app, "/api/mcp/sse");

    // Minimal response headers (only keep basic security, remove strict CSP)
    app.use((req, res, next) => {
      res.header("X-Content-Type-Options", "nosniff");
      res.header("X-Frame-Options", "SAMEORIGIN");
      next();
    });

    // Security Cleanup: thoroughly remove auth middleware

    // Body Parser with Raw Body capture
    app.use((req, res, next) => {
      // Must skip stream paths, otherwise SDK cannot read stream (HTTP 400 root cause)
      if (req.url.startsWith(mcpMessagesPath) || req.url.startsWith("/api/stream") || req.url.startsWith("/api/mcp/sse")) {
        return next();
      }
      
      express.json({ 
        limit: "50mb",
        verify: (req: any, res, buf) => {
          if (req.url.startsWith(webhookPath)) {
            req.rawBody = buf.toString();
          }
        }
      })(req, res, next);
    });
    
    app.use((req, res, next) => {
      if (req.url.startsWith(mcpMessagesPath) || req.url.startsWith("/api/stream") || req.url.startsWith("/api/mcp/sse")) {
        return next();
      }
      express.urlencoded({ extended: true, limit: "50mb" })(req, res, next);
    });

    // --- IM Routes ---
    app.get("/api/im/config", (req, res) => this.imController.getConfig(req, res));
    app.post("/api/im/config", (req, res) => this.imController.saveConfig(req, res));
    app.post("/api/im/bot/add", (req, res) => this.imController.addBotInstance(req, res));
    app.post("/api/im/bot/remove", (req, res) => this.imController.removeBotInstance(req, res));
    app.post("/api/im/bot/update", (req, res) => this.imController.updateBotInstance(req, res));
    app.post("/api/im/bot/set_master", (req, res) => this.imController.setMasterBot(req, res));
    app.get("/api/im/status", (req, res) => this.imController.getStatus(req, res));
    app.get("/api/im/outbox/dead", (req, res) => this.imController.listOutboxDead(req, res));
    app.post("/api/im/outbox/replay_dead", (req, res) => this.imController.replayOutboxDead(req, res));
    app.post("/api/im/outbox/replay_dead_batch", (req, res) => this.imController.replayOutboxDeadBatch(req, res));
    app.get("/api/im/outbox/preview_replay", (req, res) => this.imController.previewOutboxReplay(req, res));
    app.get("/api/im/outbox/audit", (req, res) => this.imController.listOutboxAudit(req, res));
    app.post("/api/im/self_test", (req, res) => this.imController.selfTest(req, res));
    app.post("/api/im/admin_capture/start", (req, res) => this.imController.startAdminCapture(req, res));
    app.get("/api/im/admin_capture/status", (req, res) => this.imController.getAdminCaptureStatus(req, res));
    app.post("/api/im/long_connection/restart", (req, res) => this.imController.restartLongConnection(req, res));
    app.post("/api/im/webhook", (req, res) => this.imController.handleWebhook(req, res));
    app.post("/api/im/webhook/:providerId", (req, res) => this.imController.handleWebhook(req, res));

    // --- Session Routes ---
    app.get("/api/sessions", (req, res) => this.sessionController.listSessions(req, res));
    app.delete("/api/sessions/:projectId", (req, res) => this.sessionController.deleteProject(req, res));
    app.get("/api/history", (req, res) => this.sessionController.getChatHistory(req, res));
    app.post("/api/send", (req, res) => this.sessionController.sendMessage(req, res));

    // --- System Monitor Routes ---
    app.post("/api/heartbeat", (req, res) => this.monitorController.heartbeat(req, res));
    app.get("/api/health", (req, res) => this.monitorController.getHealth(req, res));
    app.get("/api/host/status", (req, res) => this.monitorController.getHostStatus(req, res));
    app.post("/api/project/initialize", (req, res) => this.monitorController.initializeProject(req, res));
    app.get("/api/project/mode/get", (req, res) => this.projectModeController.getMode(req, res));
    app.post("/api/project/mode/set", (req, res) => this.projectModeController.setMode(req, res));
    app.post("/api/project/channel/set", (req, res) => this.projectModeController.setSingleAgentChannel(req, res));
    app.get("/api/project/channel/status", (req, res) => this.projectModeController.getChannelStatus(req, res));
    app.post("/api/channel/command", (req, res) => this.channelController.command(req, res));
    app.get("/api/channel/status", (req, res) => this.channelController.status(req, res));
    app.use("/api/harness", (req, res, next) => this.authorizeHarnessRequest(req, res, next));
    app.post("/api/harness/execute", (req, res) => this.harnessController.execute(req, res));
    app.get("/api/harness/traces/:traceId", (req, res) => this.harnessController.readTrace(req, res));
    app.get("/api/harness/runs", (req, res) => this.harnessController.listRuns(req, res));
    app.get("/api/harness/metrics", (req, res) => this.harnessController.listMetrics(req, res));
    app.get("/api/harness/failures", (req, res) => this.harnessController.listFailures(req, res));
    app.post("/api/harness/eval/run", (req, res) => this.harnessController.runEvaluation(req, res));
    app.get("/api/harness/eval/:evalId/report", (req, res) => this.harnessController.readEvaluationReport(req, res));
    app.post("/api/harness/replay/run", (req, res) => this.harnessController.runReplay(req, res));
    app.get("/api/harness/replay/:replayId", (req, res) => this.harnessController.readReplay(req, res));
    app.get("/api/harness/gate/check", (req, res) => this.harnessController.gateCheck(req, res));
    app.post("/api/logs", (req, res) => this.monitorController.postLog(req, res));
    
    // --- System Update Routes ---
    app.get("/api/system/version", (req, res) => this.systemController.getVersion(req, res));
    app.get("/api/system/update/check", (req, res) => this.systemController.checkUpdate(req, res));
    app.post("/api/system/update/start", (req, res) => this.systemController.startUpdate(req, res));
    
    // --- MCP Standard Routes ---
    app.get("/api/mcp/discovery", (req, res) => this.monitorController.getMcpDiscovery(req, res));

    app.get("/api/stream", (req, res) => this.monitorController.handleStream(req, res));

    // --- Identity & Manifest ---
     app.get("/manifest.json", (req, res) => {
       const manifestPath = path.join(this.pathResolver.programRoot, "manifest.json");
       if (fsSync.existsSync(manifestPath)) {
         try {
           const content = fsSync.readFileSync(manifestPath, "utf-8");
           res.setHeader("Content-Type", "application/json");
           res.send(content);
         } catch (err) {
           res.status(500).json({ error: "FAILED_TO_READ_MANIFEST" });
         }
       } else {
         res.status(404).json({ error: "MANIFEST_NOT_FOUND" });
       }
     });

    // Static Assets
    const staticDir = this.staticAssets.staticDir;
    const isDev = process.env.NODE_ENV === 'development' || process.env[`${this.versionManager.appIdentifier.toUpperCase()}_IS_DEV`] === '1';
    
    if (isDev) {
      // Disable caching for static assets in development to ensure HMR/Refreshes work
      app.use((req, res, next) => {
        if (req.url.startsWith('/api')) return next();
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.setHeader('Surrogate-Control', 'no-store');
        next();
      });
    }

    app.use(express.static(staticDir, isDev ? { etag: false } : undefined));
    
    // SPA Fallback: handle all non-api routes
    app.get(/^\/(?!api).*$/, (req, res) => {
      const indexPath = path.join(staticDir, "index.html");
      if (fsSync.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(404).send("UI not found. If this is a dev server, use port 5173.");
      }
    });
  }

  private resolveAllowedOrigin(origin?: string): string {
    const value = String(origin || "").trim();
    if (!value) return "*";
    
    // In development, allow all local origins to prevent CORS errors during HMR
      const appIdentifier = this.versionManager.appIdentifier;
      const isDev = process.env.NODE_ENV === 'development' || process.env[`${appIdentifier.toUpperCase()}_IS_DEV`] === '1';
      if (isDev) {
      if (/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(value)) {
        return value;
      }
    }

    if (value === "http://localhost:5173" || value === "http://127.0.0.1:5173") return value;
    if (/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(value)) return value;
    return `http://${this.config.uiHost}:${this.config.uiPort}`;
  }

  private sanitizeHeaders(headers: Record<string, any>): Record<string, any> {
    const masked: Record<string, any> = {};
    for (const [k, v] of Object.entries(headers || {})) {
      masked[k] = this.headerMaskKeys.has(k.toLowerCase()) ? "***" : v;
    }
    return masked;
  }

  private authorizeHarnessRequest(req: express.Request, res: express.Response, next: express.NextFunction) {
    if (!this.config.harnessAuthEnabled) {
      next();
      return;
    }
    const expected = this.config.harnessApiToken;
    const provided = String(req.headers["x-harness-token"] || "").trim();
    const expectedBuffer = Buffer.from(expected);
    const providedBuffer = Buffer.from(provided);
    const valid = expectedBuffer.length > 0
      && expectedBuffer.length === providedBuffer.length
      && timingSafeEqual(expectedBuffer, providedBuffer);
    if (!valid) {
      res.status(401).json({
        success: false,
        error: {
          code: "HARNESS_AUTH_REQUIRED",
          message: "Harness token is required"
        }
      });
      return;
    }
    next();
  }
}
