import { injectable, inject } from "inversify";
import type { Request, Response } from "express";
import { SYMBOLS } from "../../common/di/symbols.js";
import { BaseController } from "./BaseController.js";
import { IMFacade } from "../../features/im/facade/IMFacade.js";
import { MessageOutboxService } from "../../features/mcp/message/MessageOutboxService.js";
import { IMPluginRegistry } from "../../features/im/IMPluginRegistry.js";
import { IMWebhookIngressService } from "../../features/im/services/IMWebhookIngressService.js";
import { SessionContext } from "../../common/context/SessionContext.js";
import type { IMRuntimeOrchestrator } from "../../features/runtime/IMRuntimeOrchestrator.js";
import { ProjectContextService } from "../../features/mcp/project/ProjectContextService.js";
import { LoggerService } from "../../features/runtime/LoggerService.js";

@injectable()
export class IMController extends BaseController {
  constructor(
    @inject(SYMBOLS.ProjectContextService) projectContext: ProjectContextService,
    @inject(SYMBOLS.IMFacade) private readonly im: IMFacade,
    @inject(SYMBOLS.IMWebhookIngressService) private readonly webhookIngress: IMWebhookIngressService,
    @inject(SYMBOLS.MessageOutboxService) private readonly outbox: MessageOutboxService,
    @inject(SYMBOLS.IMPluginRegistry) private readonly pluginRegistry: IMPluginRegistry,
    @inject(SYMBOLS.IMRuntimeOrchestrator) private readonly imRuntimeOrchestrator: IMRuntimeOrchestrator,
    @inject(SYMBOLS.LoggerService) logger: LoggerService
  ) {
    super(projectContext, logger);
  }

  /**
   * Get IM configuration (global, not project-specific).
   */
  async getConfig(req: Request, res: Response) {
    try {
      const cfg = await this.im.readConfigPublic();
      this.sendOk(res, cfg);
    } catch (err: any) {
      this.sendOk(res, {
        plugins: {},
        degraded: true,
        degradedReason: String(err?.message || "IM_CONFIG_READ_FAILED")
      });
    }
  }

  /**
   * Save IM configuration.
   */
  async saveConfig(req: Request, res: Response) {
    try {
      const providerId = String(req.query.provider || req.body?.provider || "feishu");
      await this.im.writeConfig(req.body || {}, providerId);
      
      // Trigger runtime reload
      await this.imRuntimeOrchestrator.restartPlugin(providerId);
      
      const saved = await this.im.readConfigPublic();
      this.sendOk(res, saved);
    } catch (err: any) {
      this.sendInternalError(res, err, "IM_CONFIG_SAVE_FAILED");
    }
  }

  /**
   * Add a new bot instance.
   */
  async addBotInstance(req: Request, res: Response) {
    try {
      const providerId = String(req.query.provider || "feishu");
      const instance = req.body;
      if (!instance || !instance.name) {
        this.sendError(res, 400, "MISSING_PARAMS", "Missing instance name");
        return;
      }
      const created = await this.im.addBotInstance(providerId, instance);
      await this.imRuntimeOrchestrator.restartPlugin(providerId);
      this.sendOk(res, created);
    } catch (err: any) {
      this.sendInternalError(res, err, "IM_BOT_ADD_FAILED");
    }
  }

  /**
   * Remove a bot instance.
   */
  async removeBotInstance(req: Request, res: Response) {
    try {
      const providerId = String(req.query.provider || "feishu");
      const botId = String(req.params.botId || req.query.botId || req.body?.botId);
      if (!botId) {
        this.sendError(res, 400, "MISSING_BOT_ID", "Missing botId");
        return;
      }
      const success = await this.im.removeBotInstance(providerId, botId);
      if (success) {
        await this.imRuntimeOrchestrator.restartPlugin(providerId);
        this.sendOk(res, { success: true });
      } else {
        this.sendError(res, 404, "BOT_NOT_FOUND", "Bot instance not found");
      }
    } catch (err: any) {
      this.sendInternalError(res, err, "IM_BOT_REMOVE_FAILED");
    }
  }

  /**
   * Update a bot instance.
   */
  async updateBotInstance(req: Request, res: Response) {
    try {
      const providerId = String(req.query.provider || "feishu");
      const botId = String(req.params.botId || req.query.botId || req.body?.botId);
      if (!botId) {
        this.sendError(res, 400, "MISSING_BOT_ID", "Missing botId");
        return;
      }
      const updated = await this.im.updateBotInstance(providerId, botId, req.body);
      if (updated) {
        await this.imRuntimeOrchestrator.restartPlugin(providerId);
        this.sendOk(res, updated);
      } else {
        this.sendError(res, 404, "BOT_NOT_FOUND", "Bot instance not found");
      }
    } catch (err: any) {
      this.sendInternalError(res, err, "IM_BOT_UPDATE_FAILED");
    }
  }

  /**
   * Set master bot.
   */
  async setMasterBot(req: Request, res: Response) {
    try {
      const providerId = String(req.query.provider || "feishu");
      const botId = String(req.body?.botId);
      if (!botId) {
        this.sendError(res, 400, "MISSING_BOT_ID", "Missing botId");
        return;
      }
      const success = await this.im.setMasterBot(providerId, botId);
      if (success) {
        this.sendOk(res, { success: true });
      } else {
        this.sendError(res, 404, "PROVIDER_NOT_FOUND", "Provider not found");
      }
    } catch (err: any) {
      this.sendInternalError(res, err, "IM_SET_MASTER_FAILED");
    }
  }

  /**
   * Get current IM status and outbox metrics.
   */
  async getStatus(req: Request, res: Response) {
    try {
      const providerId = String(req.query.provider || "feishu");
      const provider = this.pluginRegistry.getProvider(providerId);
      const status = await this.im.readStatus(providerId, provider);
      
      const projectRoot = req.headers["x-project-root"] as string || "";
      const outboxStatus = projectRoot 
        ? await SessionContext.run({ projectRoot }, () => this.outbox.status())
        : { total: 0, dead: 0 };

      const full = {
        ...status,
        allPlugins: await this.im.readAllStatus(this.pluginRegistry),
        outbox: outboxStatus
      };
      this.sendOk(res, full);
    } catch (err: any) {
      this.sendOk(res, {
        enabled: false,
        configured: false,
        boundGroup: false,
        degraded: true,
        degradedReason: String(err?.message || "IM_STATUS_READ_FAILED")
      });
    }
  }

  /**
   * List messages in the dead letter outbox.
   */
  async listOutboxDead(req: Request, res: Response) {
    try {
      const rawLimit = Number(req.query.limit || 20);
      const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(100, rawLimit)) : 20;
      const source = String(req.query.source || "");
      const projectRoot = this.resolveProjectRoot(req);
      
      const result = await SessionContext.run({ projectRoot }, () => this.outbox.listDead(limit, source || undefined));

      this.sendOk(res, { items: result });
    } catch (err: any) {
      this.sendInternalError(res, err, "IM_OUTBOX_DEAD_LIST_FAILED");
    }
  }

  /**
   * Replay a single message from the dead letter outbox.
   */
  async replayOutboxDead(req: Request, res: Response) {
    try {
      const id = String(req.body?.id || "");
      if (!id) {
        this.sendError(res, 400, "MISSING_ID", "Missing message ID");
        return;
      }
      const projectRoot = this.resolveProjectRoot(req);
      const replayed = await SessionContext.run({ projectRoot }, () => this.outbox.replayDead(id));

      if (!replayed) {
        this.sendError(res, 404, "NOT_FOUND", "Message not found in dead outbox");
        return;
      }
      this.sendOk(res, { id });
    } catch (err: any) {
      this.sendInternalError(res, err, "IM_OUTBOX_REPLAY_FAILED");
    }
  }

  /**
   * Replay messages from the dead letter outbox in batch.
   */
  async replayOutboxDeadBatch(req: Request, res: Response) {
    try {
      const rawLimit = Number(req.body?.limit || 20);
      const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(100, rawLimit)) : 20;
      const source = String(req.body?.source || "");
      const dryRun = !!req.body?.dryRun;
      const projectRoot = this.resolveProjectRoot(req);

      if (dryRun) {
        const wouldReplay = await SessionContext.run({ projectRoot }, () => this.outbox.countReplayableDead(limit, source || undefined));
        this.sendOk(res, { dryRun: true, wouldReplay, source: source || undefined });
        return;
      }

      const replayed = await SessionContext.run({ projectRoot }, () => this.outbox.replayDeadBatch(limit, source || undefined));

      this.sendOk(res, { replayed, source: source || undefined });
    } catch (err: any) {
      this.sendInternalError(res, err, "IM_OUTBOX_REPLAY_BATCH_FAILED");
    }
  }

  /**
   * Preview messages to be replayed from the dead letter outbox.
   */
  async previewOutboxReplay(req: Request, res: Response) {
    try {
      const rawLimit = Number(req.query.limit || 20);
      const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(100, rawLimit)) : 20;
      const source = String(req.query.source || "");
      const projectRoot = this.resolveProjectRoot(req);

      const preview = await SessionContext.run({ projectRoot }, () => this.outbox.previewReplay(limit, source || undefined));

      this.sendOk(res, preview);
    } catch (err: any) {
      this.sendInternalError(res, err, "IM_OUTBOX_PREVIEW_FAILED");
    }
  }

  /**
   * List outbox audit logs.
   */
  async listOutboxAudit(req: Request, res: Response) {
    try {
      const rawLimit = Number(req.query.limit || 50);
      const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(200, rawLimit)) : 50;
      const source = String(req.query.source || "");
      const action = String(req.query.action || "");
      const projectRoot = this.resolveProjectRoot(req);

      const items = await SessionContext.run({ projectRoot }, () => this.outbox.listAudit(limit, source || undefined, action || undefined));

      this.sendOk(res, { items });
    } catch (err: any) {
      this.sendInternalError(res, err, "IM_OUTBOX_AUDIT_FAILED");
    }
  }

  /**
   * Run a self-test for the IM provider.
   */
  async selfTest(req: Request, res: Response) {
    try {
      const providerId = String(req.query.provider || req.body?.provider || "feishu");
      const provider = this.pluginRegistry.getProvider(providerId);
      const projectRoot = this.resolveProjectRoot(req);
      const report = await SessionContext.run({ projectRoot }, () => this.im.selfTest(providerId, provider));
      if (!report.ok) {
        this.sendError(res, 500, "IM_SELF_TEST_FAILED", "Self test failed", report);
        return;
      }
      this.sendOk(res, report);
    } catch (err: any) {
      this.sendError(res, 500, "IM_SELF_TEST_FAILED", String(err?.message || "unknown_error"));
    }
  }

  /**
   * Start capturing admin OpenID.
   */
  async startAdminCapture(req: Request, res: Response) {
    try {
      const timeout = Number(req.query.timeout || req.body?.timeoutMs || 180000);
      const result = this.im.startAdminOpenIdCapture(timeout);
      this.sendOk(res, result);
    } catch (err: any) {
      this.sendInternalError(res, err, "IM_ADMIN_CAPTURE_START_FAILED");
    }
  }

  /**
   * Get the status of admin OpenID capture.
   */
  public async getAdminCaptureStatus(req: Request, res: Response) {
    try {
      const projectRoot = this.resolveProjectRoot(req);
      const status = await SessionContext.run({ projectRoot }, () => this.im.getAdminCaptureStatus());
      this.sendOk(res, status);
    } catch (err: any) {
      this.sendInternalError(res, err, "IM_ADMIN_CAPTURE_STATUS_FAILED");
    }
  }

  /**
   * Restart the IM provider's long connection.
   */
  async restartLongConnection(req: Request, res: Response) {
    try {
      const providerId = String(req.query.provider || "feishu");
      await this.imRuntimeOrchestrator.restartPlugin(providerId);
      this.sendOk(res, { success: true });
    } catch (err: any) {
      this.sendInternalError(res, err, "IM_LONG_CONNECTION_RESTART_FAILED");
    }
  }

  /**
   * Handle incoming IM webhooks.
   */
  async handleWebhook(req: Request, res: Response) {
    try {
      const providerId = String(req.params.providerId || req.query.provider || "feishu");
      const botId = String(req.query.botId || ""); // Extract botId from query params
      const ret = await this.webhookIngress.ingest(providerId, {
        headers: req.headers as any,
        rawBody: (req as any).rawBody || "",
        body: req.body || {},
        botId: botId || undefined
      });
      if (ret.statusCode >= 400) {
        this.sendError(
          res,
          ret.statusCode,
          String(ret.body?.code || ret.body?.error || "IM_WEBHOOK_REJECTED"),
          String(ret.body?.message || ret.body?.error || ret.statusCode)
        );
        return;
      }
      this.sendOk(res, ret.body);
    } catch (err: any) {
      this.sendInternalError(res, err, "IM_WEBHOOK_INGEST_FAILED");
    }
  }

}

