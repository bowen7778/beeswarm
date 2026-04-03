import { injectable, inject } from "inversify";
import path from "node:path";
import fs from "node:fs/promises";
import { SYMBOLS } from "../../../common/di/symbols.js";
import { PathResolverService } from "../../runtime/PathResolverService.js";
import { LoggerService } from "../../runtime/LoggerService.js";
import { ProjectContextService } from "../../mcp/project/ProjectContextService.js";
import { ConfigRepository } from "../../../platform/repositories/ConfigRepository.js";
import { VersionManager } from "../../runtime/VersionManager.js";

@injectable()
export class IMBindingService {
  constructor(
    @inject(SYMBOLS.ConfigRepository) private readonly configRepo: ConfigRepository,
    @inject(SYMBOLS.PathResolverService) private readonly pathResolver: PathResolverService,
    @inject(SYMBOLS.ProjectContextService) private readonly projectContext: ProjectContextService,
    @inject(SYMBOLS.LoggerService) private readonly logger: LoggerService,
    @inject(SYMBOLS.VersionManager) private readonly versionManager: VersionManager
  ) {}

  public async readBoundChatId(providerId: string = "feishu", explicitRoot?: string): Promise<string> {
    const binding = await this.readBinding(providerId, explicitRoot);
    return String(binding.chatId || "");
  }

  public async readBindingInfo(providerId: string = "feishu", explicitRoot?: string): Promise<{ chatId?: string; botId?: string }> {
    return await this.readBinding(providerId, explicitRoot);
  }

  public async bindChatId(input: {
    chatId: string;
    botId?: string;
    providerId?: string;
    explicitRoot?: string;
  }): Promise<void> {
    const providerId = input.providerId || "feishu";
    const normalizedChatId = String(input.chatId || "").trim();
    if (!normalizedChatId) return;
    
    const bPath = this.getBindingPath(providerId, input.explicitRoot);
    await fs.mkdir(path.dirname(bPath), { recursive: true });
    await this.configRepo.writeJson(bPath, {
      provider: providerId,
      chatId: normalizedChatId,
      botId: input.botId || undefined,
      updatedAt: new Date().toISOString()
    });
    this.logger.info("IM", `Bound chatId ${normalizedChatId} (Bot: ${input.botId || 'default'}) to project at ${bPath}`);
  }

  public getBindingPath(providerId: string = "feishu", explicitRoot?: string): string {
    const activeRoot = explicitRoot || this.projectContext.getProjectRoot();
    const targetRoot = activeRoot || this.pathResolver.workspaceRoot;
    const projectDataDir = this.pathResolver.getProjectDataDir(targetRoot);
    return path.join(projectDataDir, "im", `${providerId}.binding.json`);
  }

  public async readAllBindings(providerId: string = "feishu"): Promise<Record<string, any>> {
    const roots = await this.collectProjectRoots(this.pathResolver.workspaceRoot, 4);
    const results: Record<string, any> = {};
    for (const root of roots) {
      const binding = await this.readBinding(providerId, root);
      const chatId = String(binding.chatId || "");
      if (!chatId) continue;
      results[root] = {
        plugins: {
          [providerId]: {
            routingPolicy: { 
              boundChatId: chatId,
              botId: binding.botId
            },
            credentials: {}
          }
        }
      };
    }
    return results;
  }

  private async readBinding(providerId: string = "feishu", explicitRoot?: string): Promise<{ chatId?: string; botId?: string }> {
    try {
      const content = await fs.readFile(this.getBindingPath(providerId, explicitRoot), "utf-8");
      return JSON.parse(content);
    } catch {
      return {};
    }
  }

  private async collectProjectRoots(root: string, depth: number): Promise<string[]> {
    const output: string[] = [];
    if (depth < 0) return output;
    let entries: Array<{ name: string; isDirectory: () => boolean }> = [];
    try {
      entries = await fs.readdir(root, { withFileTypes: true }) as any;
    } catch {
      return output;
    }
    const appIdentifier = this.versionManager.appIdentifier;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(root, entry.name);
      // Ignore internal directories
      if (entry.name === `.${appIdentifier}`) {
        output.push(root);
        continue;
      }
      if (entry.name.startsWith(".") && entry.name !== `.${appIdentifier}-runtime`) continue;
      const nested = await this.collectProjectRoots(dir, depth - 1);
      output.push(...nested);
    }
    return output;
  }
}
