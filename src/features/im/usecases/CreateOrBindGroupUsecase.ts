import { injectable, inject } from "inversify";
import path from "node:path";
import { SYMBOLS } from "../../../common/di/symbols.js";
import { LoggerService } from "../../runtime/LoggerService.js";
import { ProjectContextService } from "../../mcp/project/ProjectContextService.js";
import { IMConfigService } from "../services/IMConfigService.js";
import { IMBindingService } from "../services/IMBindingService.js";
import { IMRuntimeStore } from "../stores/IMRuntimeStore.js";
import { IMProvider } from "../IMProvider.js";

@injectable()
export class CreateOrBindGroupUsecase {
  constructor(
    @inject(SYMBOLS.LoggerService) private readonly logger: LoggerService,
    @inject(SYMBOLS.ProjectContextService) private readonly projectContext: ProjectContextService,
    @inject(IMConfigService) private readonly configService: IMConfigService,
    @inject(SYMBOLS.IMBindingService) private readonly bindingService: IMBindingService,
    @inject(IMRuntimeStore) private readonly runtimeStore: IMRuntimeStore
  ) {}

  /**
   * Execute the group binding or creation.
   */
  public async execute(input: { providerId: string; provider: IMProvider; forceRecreate?: boolean; botId?: string }): Promise<{ chatId: string }> {
    const { providerId, provider, forceRecreate = false, botId } = input;
    this.logger.info("IM", `[${providerId}] Binding/Creating group...`);
    try {
      const projectRoot = this.projectContext.getProjectRoot();
      if (!projectRoot) {
        this.logger.warn("IM", "Cannot create group: Project context not established");
        throw new Error("PROJECT_CONTEXT_REQUIRED_FOR_IM_BINDING");
      }

      const bindingInfo = await this.bindingService.readBindingInfo(providerId);
      if (!forceRecreate && bindingInfo.chatId) {
        return { chatId: bindingInfo.chatId };
      }

      const cfg = await this.configService.readConfig();
      const plugin = cfg.plugins[providerId];
      if (!plugin) throw new Error(`Plugin ${providerId} not found`);

      const projectName = path.basename(projectRoot) || "project";
      const projectId = providerId + "-" + projectName.toLowerCase();
      
      const result = await provider.createOrBindGroup({
        projectId,
        projectName,
        credentials: plugin.credentials || {},
        routingPolicy: plugin.routingPolicy || {},
        forceRecreate,
        botId: botId || bindingInfo.botId
      });
      
      await this.bindingService.bindChatId({
        chatId: result.chatId,
        providerId,
        botId: botId || bindingInfo.botId,
        explicitRoot: projectRoot
      });
      return result;
    } catch (err: any) {
      this.runtimeStore.touchStatus(providerId, { lastError: err?.message || "bind_failed" });
      throw err;
    }
  }
}
