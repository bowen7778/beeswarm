import { injectable, inject } from "inversify";
import { SYMBOLS } from "../../../common/di/symbols.js";
import { UsecaseBus } from "../../../common/bus/UsecaseBus.js";
import { IMConfigService } from "../services/IMConfigService.js";
import { IMBindingService } from "../services/IMBindingService.js";
import { IMAdminCaptureService } from "../services/IMAdminCaptureService.js";
import { IMRuntimeStore } from "../stores/IMRuntimeStore.js";
import { IMProvider } from "../IMProvider.js";
import { IMPluginRegistry } from "../IMPluginRegistry.js";

/**
 * Facade for all IM (Instant Messaging) operations.
 * Acts as the entry point for the IM domain.
 */
@injectable()
export class IMFacade {
  private readonly inboundMessageFingerprint = new Map<string, number>();

  constructor(
    @inject(IMConfigService) private readonly configService: IMConfigService,
    @inject(IMBindingService) private readonly bindingService: IMBindingService,
    @inject(SYMBOLS.IMPluginRegistry) private readonly pluginRegistry: IMPluginRegistry,
    @inject(SYMBOLS.IMAdminCaptureService) private readonly adminCaptureService: IMAdminCaptureService,
    @inject(IMRuntimeStore) private readonly runtimeStore: IMRuntimeStore,
    @inject(SYMBOLS.UsecaseBus) private readonly bus: UsecaseBus
  ) {}

  /**
   * Get the status of a specific IM provider.
   */
  public async getStatus(providerId: string = "feishu", provider?: IMProvider) {
    const rt = this.runtimeStore.getStatus(providerId);
    const cfg = await this.configService.readConfig();
    const plugin = cfg.plugins[providerId];
    const boundChatId = await this.bindingService.readBoundChatId(providerId);
    const resolvedProvider = provider || this.pluginRegistry.getProvider(providerId);
    const providerState = typeof resolvedProvider?.status === "function" ? resolvedProvider.status() : {};
    const providerHealth = await this.readProviderHealth(resolvedProvider);
    
    return {
      ...rt,
      ...providerState,
      enabled: plugin?.enabled || false,
      configured: !!(plugin?.credentials?.appId && plugin?.credentials?.appSecret),
      boundGroup: !!boundChatId,
      boundChatId: boundChatId,
      providerOk: providerHealth.ok,
      providerMessage: providerHealth.message || "",
      enforceWebhookSecurity: true,
      webhookMaxSkewMs: 5 * 60 * 1000
    };
  }

  /**
   * Read status for all registered IM providers.
   */
  public async readAllStatus(pluginRegistry: IMPluginRegistry) {
    const all: Record<string, any> = {};
    for (const id of pluginRegistry.listProviders()) {
      all[id] = await this.getStatus(id, pluginRegistry.getProvider(id));
    }
    return all;
  }

  /**
   * Read public configuration (sanitized secrets).
   */
  public async readConfigPublic() {
    const cfg = await this.configService.readConfig();
    const sanitized: any = { ...cfg, plugins: {} };
    for (const [id, p] of Object.entries(cfg.plugins)) {
      sanitized.plugins[id] = {
        ...p,
        credentials: {
          ...p.credentials,
          appSecret: p.credentials.appSecret ? "********" : "",
          verificationToken: p.credentials.verificationToken ? "********" : "",
          signEncryptKey: p.credentials.signEncryptKey ? "********" : ""
        }
      };
    }
    return sanitized;
  }

  /**
   * Write IM configuration for a specific provider.
   */
  public async writeConfig(input: any, providerId: string = "feishu") {
    const current = await this.configService.readConfig();
    const pluginInput = input?.plugins?.[providerId] || input;
    const currentPlugin = current.plugins[providerId] || this.configService.defaultPluginConfig();
    
    const nextPlugin = {
      ...currentPlugin,
      ...pluginInput,
      updatedAt: new Date().toISOString()
    };
    
    current.plugins[providerId] = nextPlugin;
    current.updatedAt = new Date().toISOString();
    await this.configService.writeConfig(current);
    return current;
  }

  /**
   * Send a message through a specific IM provider.
   */
  public async sendMessage(providerId: string, provider: IMProvider, text: string, options?: { chatId?: string; kind?: string; projectId?: string }) {
    return this.bus.execute(SYMBOLS.SendMessageUsecase, { providerId, provider, text, options });
  }

  /**
   * Validate an incoming webhook request.
   */
  public async validateWebhookRequest(providerId: string, headers: Record<string, any>, rawBody: string, payload: any) {
    return this.bus.execute(SYMBOLS.ValidateWebhookUsecase, { providerId, headers, rawBody, payload });
  }

  /**
   * Create or bind a group chat for an IM provider.
   */
  public async createOrBindGroup(providerId: string, provider: IMProvider, forceRecreate: boolean = false) {
    return this.bus.execute(SYMBOLS.CreateOrBindGroupUsecase, { providerId, provider, forceRecreate });
  }

  /**
   * Get the current status of admin OpenID capture.
   */
  public getAdminOpenIdCaptureStatus() {
    return this.adminCaptureService.getStatus();
  }

  /**
   * Run a self-test for a specific IM provider.
   */
  public async selfTest(providerId: string = "feishu", provider?: IMProvider): Promise<any> {
    const resolvedProvider = provider || this.pluginRegistry.getProvider(providerId);
    const cfg = await this.configService.readConfig();
    const plugin = cfg.plugins[providerId];
    const configured = !!(plugin?.credentials?.appId && plugin?.credentials?.appSecret);
    const boundChatId = await this.bindingService.readBoundChatId(providerId);
    const health = await this.readProviderHealth(resolvedProvider);
    const diagnostics = [
      { key: "provider_registered", ok: !!resolvedProvider, message: resolvedProvider ? "" : "provider_not_registered" },
      { key: "config_present", ok: !!plugin, message: plugin ? "" : "provider_config_missing" },
      { key: "credentials_ready", ok: configured, message: configured ? "" : "missing_credentials" },
      { key: "provider_health", ok: health.ok, message: health.message || "" },
      {
        key: "binding_ready",
        ok: !!boundChatId || plugin?.routingPolicy?.autoCreateGroup !== false,
        message: boundChatId ? "" : "binding_missing_but_auto_create_allowed"
      }
    ];
    const ok = diagnostics.every((item) => item.ok);

    return {
      ok,
      provider: providerId,
      checkedAt: new Date().toISOString(),
      configured,
      enabled: !!plugin?.enabled,
      boundChatId: String(boundChatId || ""),
      diagnostics
    };
  }

  /**
   * Start the admin OpenID capture process.
   */
  public startAdminOpenIdCapture(timeoutMs: number = 180000) {
    return this.adminCaptureService.start(timeoutMs);
  }

  public async readStatus(providerId: string, provider?: IMProvider) {
    return this.getStatus(providerId, provider);
  }

  public async readConfig() {
    return this.configService.readConfig();
  }

  /**
   * Read the bound chat ID for a specific provider.
   */
  public async readBoundChatId(providerId: string = "feishu", explicitRoot?: string) {
    return this.bindingService.readBoundChatId(providerId, explicitRoot);
  }

  /**
   * Bind a chat ID to a specific provider.
   */
  public async bindChatId(chatId: string, providerId: string = "feishu", explicitRoot?: string) {
    return this.bindingService.bindChatId(chatId, providerId, explicitRoot);
  }

  /**
   * Determine if a message can be forwarded to an IM provider.
   */
  public async canForwardMessage(providerId: string, provider?: IMProvider): Promise<{ allowed: boolean; reason?: string }> {
    const cfg = await this.configService.readConfig();
    const plugin = cfg.plugins[providerId];
    if (!plugin?.enabled) return { allowed: false, reason: "IM_DISABLED" };
    const boundChatId = await this.bindingService.readBoundChatId(providerId);
    if (boundChatId) return { allowed: true };
    const autoCreateGroup = plugin.routingPolicy?.autoCreateGroup !== false;
    return autoCreateGroup ? { allowed: true } : { allowed: false, reason: "IM_GROUP_NOT_BOUND" };
  }

  /**
   * Read all chat bindings across all projects in the workspace.
   */
  public async readAllBindings(): Promise<Record<string, any>> {
    return this.bindingService.readAllBindings("feishu");
  }

  /**
   * Update the runtime status of an IM provider.
   */
  public touchRuntime(providerId: string, patch: Record<string, any>) {
    this.runtimeStore.touchStatus(providerId, patch);
  }

  /**
   * Check if an inbound message ID is a duplicate within a TTL window.
   */
  public isInboundMessageIdDuplicate(messageId: string, chatId: string): boolean {
    const id = String(messageId || "").trim();
    const chat = String(chatId || "").trim();
    if (!id || !chat) return false;
    const key = `${chat}:${id}`;
    const now = Date.now();
    const ttl = 5 * 60 * 1000;
    const hitAt = this.inboundMessageFingerprint.get(key);
    if (hitAt && now - hitAt < ttl) return true;
    this.inboundMessageFingerprint.set(key, now);
    if (this.inboundMessageFingerprint.size > 5000) {
      for (const [k, ts] of this.inboundMessageFingerprint.entries()) {
        if (now - ts > ttl) this.inboundMessageFingerprint.delete(k);
      }
    }
    return false;
  }

  /**
   * Capture admin OpenID from an inbound message if capture is active.
   */
  public async captureAdminOpenIdFromInbound(openId: string, providerId: string): Promise<void> {
    this.adminCaptureService.captureInbound(openId, providerId);
  }

  private async readProviderHealth(provider?: IMProvider): Promise<{ ok: boolean; message?: string }> {
    if (!provider) {
      return { ok: false, message: "provider_not_registered" };
    }
    try {
      return await provider.health();
    } catch (err: any) {
      return { ok: false, message: String(err?.message || err || "provider_health_failed") };
    }
  }
}
