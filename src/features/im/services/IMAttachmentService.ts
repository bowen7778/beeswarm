import { injectable, inject } from "inversify";
import path from "node:path";
import fs from "node:fs/promises";
import { SYMBOLS } from "../../../common/di/symbols.js";
import { PathResolverService } from "../../runtime/PathResolverService.js";
import { ProjectContextService } from "../../mcp/project/ProjectContextService.js";

@injectable()
export class IMAttachmentService {
  constructor(
    @inject(SYMBOLS.PathResolverService) private readonly pathResolver: PathResolverService,
    @inject(SYMBOLS.ProjectContextService) private readonly projectContext: ProjectContextService
  ) {}

  public async saveAttachment(fileName: string, content: Buffer): Promise<string> {
    const dir = this.getInboundDir();
    await fs.mkdir(dir, { recursive: true });
    
    const safeName = this.getSafeFileName(fileName);
    const fullPath = path.join(dir, `${Date.now()}_${safeName}`);
    await fs.writeFile(fullPath, content);
    return fullPath;
  }

  private getInboundDir(): string {
    const activeRoot = this.projectContext.getProjectRoot();
    const targetRoot = activeRoot || this.pathResolver.workspaceRoot;
    const projectDataDir = this.pathResolver.getProjectDataDir(targetRoot);
    return path.join(projectDataDir, "im", "inbound");
  }

  private getSafeFileName(name: string): string {
    return String(name || "attachment")
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
      .slice(0, 120);
  }
}
