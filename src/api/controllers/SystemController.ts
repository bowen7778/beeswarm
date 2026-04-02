import { injectable, inject } from "inversify";
import { SYMBOLS } from "../../common/di/symbols.js";
import { BaseController } from "./BaseController.js";
import type { UpdateWorkerService } from "../../features/runtime/UpdateWorkerService.js";
import type { VersionManager } from "../../features/runtime/VersionManager.js";
import { ProjectContextService } from "../../features/mcp/project/ProjectContextService.js";
import { LoggerService } from "../../features/runtime/LoggerService.js";

@injectable()
export class SystemController extends BaseController {
  constructor(
    @inject(SYMBOLS.ProjectContextService) projectContext: ProjectContextService,
    @inject(SYMBOLS.UpdateWorkerService) private readonly updateWorker: UpdateWorkerService,
    @inject(SYMBOLS.VersionManager) private readonly versionManager: VersionManager,
    @inject(SYMBOLS.LoggerService) logger: LoggerService
  ) {
    super(projectContext, logger);
  }

  /**
   * Get version information of current and available updates.
   */
  public async getVersion(req: any, res: any): Promise<void> {
    try {
      const current = this.versionManager.getCurrentVersionInfo();
      const available = this.versionManager.getAvailableVersions();
      const latest = available[0] || current;
      const toPublicVersion = (info: typeof current) => ({
        version: info.version,
        releaseDate: info.releaseDate,
        isBuiltin: info.isBuiltin,
        manifest: info.manifest
      });

      this.sendOk(res, {
        current: toPublicVersion(current),
        latest: toPublicVersion(latest),
        available: available.map(toPublicVersion),
        manifest: current.manifest,
        update: this.updateWorker.getStatus()
      });
    } catch (err: any) {
      this.sendInternalError(res, err, "SYSTEM_VERSION_READ_FAILED");
    }
  }

  /**
   * Check for system updates.
   */
  public async checkUpdate(req: any, res: any): Promise<void> {
    try {
      const status = await this.updateWorker.checkForUpdates();
      this.sendOk(res, status);
    } catch (err: any) {
      this.sendInternalError(res, err, "SYSTEM_UPDATE_CHECK_FAILED");
    }
  }

  /**
   * Start the update download and preparation process.
   */
  public async startUpdate(req: any, res: any): Promise<void> {
    const info = req.body;
    if (!info || !info.version || !info.url) {
      return this.sendError(res, 400, "INVALID_UPDATE_INFO", "Version and URL are required");
    }

    try {
      const path = await this.updateWorker.downloadAndPrepare(info);
      this.sendOk(res, { status: "downloaded", path, update: this.updateWorker.getStatus() });
    } catch (err: any) {
      this.sendError(res, 500, "UPDATE_FAILED", err.message);
    }
  }
}

