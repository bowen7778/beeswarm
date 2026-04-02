import { injectable, inject } from "inversify";
import { SYMBOLS } from "../../../common/di/symbols.js";
import { IMConfigService } from "../services/IMConfigService.js";
import { IMBindingService } from "../services/IMBindingService.js";
import { CreateOrBindGroupUsecase } from "./CreateOrBindGroupUsecase.js";
import { IMRuntimeStore } from "../stores/IMRuntimeStore.js";
import { IMProvider } from "../IMProvider.js";

@injectable()
export class SendMessageUsecase {
  constructor(
    @inject(IMConfigService) private readonly configService: IMConfigService,
    @inject(IMBindingService) private readonly bindingService: IMBindingService,
    @inject(CreateOrBindGroupUsecase) private readonly createOrBindGroupUsecase: CreateOrBindGroupUsecase,
    @inject(IMRuntimeStore) private readonly runtimeStore: IMRuntimeStore
  ) {}

  public async execute(providerId: string, provider: IMProvider, text: string, options?: { chatId?: string; kind?: string; projectId?: string }): Promise<{ chatId: string; messageId?: string }> {
    const cfg = await this.configService.readConfig();
    const plugin = cfg.plugins[providerId];
    if (!plugin || !plugin.enabled) {
      throw new Error(`IM plugin ${providerId} is disabled or not found`);
    }

    const credentials = plugin.credentials || {};
    const boundChatId = await this.bindingService.readBoundChatId(providerId);
    const policy = plugin.routingPolicy || {};
    const targetChatId = String(options?.chatId || boundChatId || "").trim();

    if (!targetChatId) {
      if (policy.autoCreateGroup !== false) {
        const created = await this.createOrBindGroupUsecase.execute(providerId, provider);
        const sent = await provider.sendMessage({ 
          chatId: created.chatId, 
          text, 
          credentials,
          kind: options?.kind,
          projectId: options?.projectId
        });
        return { chatId: created.chatId, messageId: sent?.messageId };
      }
      throw new Error("IM group not bound");
    }

    // Validation and sending logic... (omitted for brevity but can be fully implemented)
    try {
      const sent = await provider.sendMessage({ 
        chatId: targetChatId, 
        text, 
        credentials,
        kind: options?.kind,
        projectId: options?.projectId
      });
      return { chatId: targetChatId, messageId: sent?.messageId };
    } catch (err: any) {
      this.runtimeStore.touchStatus(providerId, { lastError: err?.message || "send_failed" });
      throw err;
    }
  }
}
