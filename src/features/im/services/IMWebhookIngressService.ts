import { injectable, inject } from "inversify";
import { SYMBOLS } from "../../../common/di/symbols.js";
import { IMFacade } from "../facade/IMFacade.js";
import { IMPluginRegistry } from "../IMPluginRegistry.js";
import { UsecaseBus } from "../../../common/bus/UsecaseBus.js";
import { LoggerService } from "../../runtime/LoggerService.js";

@injectable()
export class IMWebhookIngressService {
  constructor(
    @inject(SYMBOLS.IMFacade) private readonly imFacade: IMFacade,
    @inject(SYMBOLS.IMPluginRegistry) private readonly pluginRegistry: IMPluginRegistry,
    @inject(SYMBOLS.UsecaseBus) private readonly bus: UsecaseBus,
    @inject(SYMBOLS.LoggerService) private readonly logger: LoggerService
  ) {}


  public async ingest(providerId: string, payload: {
    headers: Record<string, any>;
    rawBody: string;
    body: any;
    botId?: string; // New field from query params
  }): Promise<{ statusCode: number; body: any }> {
    this.logger.info("IM", `[${providerId}] Incoming webhook request: ${JSON.stringify(payload.body || {})}`);
    const provider = this.pluginRegistry.getProvider(providerId);
    if (!provider) {
      return { statusCode: 404, body: { success: false, error: "PROVIDER_NOT_FOUND" } };
    }

    // [New] Pre-validation Admin Capture:
    // If we are in capture mode, try to extract OpenID before any security checks.
    // This allows binding even if the bot is not yet fully configured (no token/key).
    try {
      const isAdminCapturing = this.imFacade.getAdminCaptureStatus().active;
      if (isAdminCapturing) {
        let rawPayload = payload.body || {};
        
        // Handle encrypted payload for pre-validation capture
        if (rawPayload.encrypt) {
          try {
            const cfg = await this.imFacade.readConfig();
            const plugin = cfg.plugins[providerId];
            let encryptKey = String(plugin?.credentials?.signEncryptKey || "");
            if (payload.botId && plugin?.instances) {
              const inst = plugin.instances.find(i => i.id === payload.botId);
              if (inst?.credentials?.signEncryptKey) encryptKey = inst.credentials.signEncryptKey;
            }
            if (encryptKey) {
              // We need a way to decrypt here too. 
              // Since FeishuProvider has the logic, but it's private, 
              // we'll just re-implement it briefly or make it a utility.
              // For now, let's just use the provider if possible.
              const provider = this.pluginRegistry.getProvider(providerId);
              if (provider && (provider as any).decryptWebhook) {
                rawPayload = (provider as any).decryptWebhook(rawPayload.encrypt, encryptKey);
              }
            }
          } catch (e) {}
        }

        const event = rawPayload.event || rawPayload;
        const openId = event?.sender?.sender_id?.open_id || event?.sender?.open_id;
        if (openId) {
          this.logger.info("IM", `[${providerId}] Pre-validation admin capture triggered for: ${openId}`);
          await this.imFacade.captureAdminOpenIdFromInbound(openId, providerId);
        }
      }
    } catch (e) {
      this.logger.warn("IM", `[${providerId}] Pre-validation admin capture failed: ${e}`);
    }

    const check = await this.imFacade.validateWebhookRequest(providerId, payload.headers, payload.rawBody, payload.body || {}, payload.botId);
    if (!check.ok) {
      return { statusCode: 403, body: { success: false, error: check.reason || "webhook_blocked" } };
    }

    const result = await provider.handleWebhook(payload.body || {});
    
    // Handle URL Verification Challenge (including encrypted ones)
    if (result && result.challenge) {
      return { statusCode: 200, body: { challenge: result.challenge } };
    }

    if (payload.botId) {
      result.botId = payload.botId; // Inject botId from query param into message result
    }
    
    await this.bus.execute(SYMBOLS.IngestIMMessageUsecase, {
      providerId,
      provider,
      payload: result
    });
    return { statusCode: 200, body: { success: true, result } };
  }
}
