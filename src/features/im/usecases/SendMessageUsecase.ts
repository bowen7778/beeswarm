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
    @inject(SYMBOLS.IMBindingService) private readonly bindingService: IMBindingService,
    @inject(CreateOrBindGroupUsecase) private readonly createOrBindGroupUsecase: CreateOrBindGroupUsecase,
    @inject(IMRuntimeStore) private readonly runtimeStore: IMRuntimeStore
  ) {}

  /**
   * Execute message sending.
   */
  public async execute(input: {
    providerId: string;
    provider: IMProvider;
    text: string;
    options?: { chatId?: string; kind?: string; projectId?: string; botId?: string };
  }): Promise<{ chatId: string; messageId?: string }> {
    const { providerId, provider, text, options } = input;
    const { chatId, kind, projectId, botId } = options || {};
    const cfg = await this.configService.readConfig();
    const plugin = cfg.plugins[providerId];
    if (!plugin || !plugin.enabled) {
      throw new Error(`IM plugin ${providerId} is disabled or not found`);
    }

    const bindingInfo = await this.bindingService.readBindingInfo(providerId);
    const credentials = plugin.credentials || {};
    const policy = plugin.routingPolicy || {};
    const targetChatId = String(chatId || bindingInfo.chatId || "").trim();
    const targetBotId = botId || bindingInfo.botId || plugin.masterBotId;

    if (!targetChatId) {
      if (policy.autoCreateGroup !== false) {
        const created = await this.createOrBindGroupUsecase.execute({ providerId, provider, botId: targetBotId });
        const sent = await provider.sendMessage({ 
          chatId: created.chatId, 
          text, 
          credentials,
          kind,
          projectId,
          botId: targetBotId
        });
        return { chatId: created.chatId, messageId: sent?.messageId };
      }
      throw new Error("IM group not bound");
    }

    try {
      const sent = await provider.sendMessage({ 
        chatId: targetChatId, 
        text, 
        credentials,
        kind,
        projectId,
        botId: targetBotId
      });
      return { chatId: targetChatId, messageId: sent?.messageId };
    } catch (err: any) {
      this.runtimeStore.touchStatus(providerId, { lastError: err?.message || "send_failed" });
      throw err;
    }
  }
}
