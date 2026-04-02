import { injectable, inject } from "inversify";
import path from "node:path";
import fs from "node:fs/promises";
import { SYMBOLS } from "../../../common/di/symbols.js";
import { PathResolverService } from "../../runtime/PathResolverService.js";
import { LoggerService } from "../../runtime/LoggerService.js";
import { ProjectContextService } from "../../mcp/project/ProjectContextService.js";
import { ConfigRepository } from "../../../platform/repositories/ConfigRepository.js";

@injectable()
export class IMBindingService {
  constructor(
    @inject(SYMBOLS.ConfigRepository) private readonly configRepo: ConfigRepository,
    @inject(SYMBOLS.PathResolverService) private readonly pathResolver: PathResolverService,
    @inject(SYMBOLS.ProjectContextService) private readonly projectContext: ProjectContextService,
    @inject(SYMBOLS.LoggerService) private readonly logger: LoggerService
  ) {}

  public async readBoundChatId(providerId: string = "feishu", explicitRoot?: string): Promise<string> {
    const binding = await this.readBinding(providerId, explicitRoot);
    return String(binding.chatId || "");
  }

  public async bindChatId(chatId: string, providerId: string = "feishu", explicitRoot?: string): Promise<void> {
    const normalized = String(chatId || "").trim();
    if (!normalized) return;
    const bPath = this.getBindingPath(providerId, explicitRoot);
    await fs.mkdir(path.dirname(bPath), { recursive: true });
    await this.configRepo.writeJson(bPath, {
      provider: providerId,
      chatId: normalized,
      updatedAt: new Date().toISOString()
    });
    this.logger.info("IM", `Bound chatId ${normalized} to project at ${bPath}`);
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
            routingPolicy: { boundChatId: chatId },
            credentials: {}
          }
        }
      };
    }
    return results;
  }

  private async readBinding(providerId: string = "feishu", explicitRoot?: string): Promise<{ chatId?: string }> {
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
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(root, entry.name);
      if (entry.name === ".beemcp") {
        output.push(path.dirname(dir));
        continue;
      }
      if (entry.name.startsWith(".") && entry.name !== ".beemcp-runtime") continue;
      const nested = await this.collectProjectRoots(dir, depth - 1);
      output.push(...nested);
    }
    return output;
  }
}
