import { injectable, inject } from "inversify";
import { createHash } from "node:crypto";
import { SYMBOLS } from "../../../common/di/symbols.js";
import { IMConfigService } from "../services/IMConfigService.js";
import { IMRuntimeStore } from "../stores/IMRuntimeStore.js";
import { LoggerService } from "../../runtime/LoggerService.js";

@injectable()
export class ValidateWebhookUsecase {
  private readonly webhookMaxSkewMs = 5 * 60 * 1000;

  constructor(
    @inject(IMConfigService) private readonly configService: IMConfigService,
    @inject(IMRuntimeStore) private readonly runtimeStore: IMRuntimeStore,
    @inject(SYMBOLS.LoggerService) private readonly logger: LoggerService
  ) {}

  /**
   * Execute webhook validation.
   */
  public async execute(input: {
    providerId: string;
    headers: Record<string, any>;
    rawBody: string;
    payload: any;
    botId?: string;
  }): Promise<{ ok: boolean; reason?: string }> {
    const { providerId, headers, rawBody, payload, botId } = input;
    this.logger.info("IM", `[${providerId}] Validating webhook (Bot: ${botId || 'default'})...`);
    this.logger.debug("IM", `[${providerId}] Raw Headers: ${JSON.stringify(headers)}`);
    
    const cfg = await this.configService.readConfig();
    const plugin = cfg.plugins[providerId];
    const isAdminCapturing = this.runtimeStore.getAdminCapture().active;

    if (!plugin || (!plugin.enabled && !isAdminCapturing)) {
      this.runtimeStore.touchStatus(providerId, { lastError: "webhook_blocked_im_disabled", lastErrorCode: "IM_DISABLED", lastBlockReason: "im_disabled" });
      return { ok: false, reason: "im_disabled" };
    }

    // Determine credentials: specific instance or legacy global
    let verificationToken = "";
    let signEncryptKey = "";

    if (botId && plugin.instances) {
      const instance = plugin.instances.find(i => i.id === botId);
      if (instance && instance.credentials) {
        verificationToken = String(instance.credentials.verificationToken || "");
        signEncryptKey = String(instance.credentials.signEncryptKey || "");
      }
    }

    if (!verificationToken && !signEncryptKey) {
      verificationToken = String(plugin.credentials?.verificationToken || "");
      signEncryptKey = String(plugin.credentials?.signEncryptKey || "");
    }
    
    if (!verificationToken && !signEncryptKey && !isAdminCapturing) {
      this.runtimeStore.touchStatus(providerId, { lastError: "webhook_blocked_security_not_enabled", lastErrorCode: "IM_SECURITY_NOT_ENABLED", lastBlockReason: "security_not_enabled" });
      return { ok: false, reason: "security_not_enabled" };
    }

    let ok = true;
    if (verificationToken) {
      ok = ok && String(payload?.token || "") === verificationToken;
    }
    
    if (signEncryptKey) {
      ok = ok && this.verifySignature(headers, rawBody, payload, signEncryptKey, providerId);
    }

    if (!ok) {
      this.runtimeStore.touchStatus(providerId, { lastError: "webhook_signature_invalid", lastErrorCode: "IM_INVALID_SIGNATURE", lastBlockReason: "invalid_signature" });
      return { ok: false, reason: "invalid_signature" };
    }

    this.runtimeStore.touchStatus(providerId, { lastBlockReason: "", lastErrorCode: "" });
    return { ok: true };
  }

  private verifySignature(headers: Record<string, any>, rawBody: string, payload: any, signEncryptKey: string, providerId: string): boolean {
    const timestamp = String(headers["x-lark-request-timestamp"] || headers["X-Lark-Request-Timestamp"] || "");
    const nonce = String(headers["x-lark-request-nonce"] || headers["X-Lark-Request-Nonce"] || "");
    const signature = String(headers["x-lark-signature"] || headers["X-Lark-Signature"] || "").toLowerCase();

    if (!timestamp || !nonce || !signature) return false;

    const tsNumber = Number(timestamp);
    if (!Number.isFinite(tsNumber)) return false;
    
    const tsMs = tsNumber > 1e12 ? tsNumber : tsNumber * 1000;
    if (Math.abs(Date.now() - tsMs) > this.webhookMaxSkewMs) return false;

    const base = `${timestamp}${nonce}${signEncryptKey}${rawBody || JSON.stringify(payload || {})}`;
    const expected = createHash("sha256").update(base).digest("hex").toLowerCase();
    return expected === signature;
  }
}
