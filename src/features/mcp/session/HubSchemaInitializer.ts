import { injectable, inject } from "inversify";
import { BaseRepository } from "../../runtime/BaseRepository.js";
import { DatabaseService } from "../../runtime/DatabaseService.js";
import { LoggerService } from "../../runtime/LoggerService.js";
import { PathResolverService } from "../../runtime/PathResolverService.js";
import { SYMBOLS } from "../../../common/di/symbols.js";
import type { VersionManager } from "../../runtime/VersionManager.js";

/**
 * Service for initializing and migrating the central Hub database schema.
 */
@injectable()
export class HubSchemaInitializer extends BaseRepository {
  private readonly schemaVersion: number;

  constructor(
    @inject(SYMBOLS.DatabaseService) dbService: DatabaseService,
    @inject(SYMBOLS.LoggerService) logger: LoggerService,
    @inject(SYMBOLS.PathResolverService) pathResolver: PathResolverService,
    @inject(SYMBOLS.VersionManager) versionManager: VersionManager
  ) {
    super(dbService, logger, pathResolver.hubDbPath);
    this.schemaVersion = versionManager.getSchemaVersion("conversationHub");
    // Removed init logic from constructor to avoid circular dependency via DatabaseService -> LoggerService -> MessageEvents -> StreamSnapshotService -> IMPluginRegistry -> FeishuProvider -> IMFacade -> UsecaseBus -> SendMessageUsecase -> MessageCoreService -> HubSchemaInitializer
  }

  /**
   * 现在由 MigrationService 统一负责 Schema 维护。
   * 此处仅保留非 DDL 的运行时初始化逻辑（如有）。
   */
  public async initialize(): Promise<void> {
    this.logger.info("HubSchemaInitializer: Schema migration is now handled by MigrationService. Skipping redundant initialization.");
  }

  /**
   * Read the current schema version from metadata.
   */
  protected readSchemaVersion(): number {
    const row = this.db.prepare(`SELECT value FROM metadata WHERE key = 'schema_version' LIMIT 1`).get() as any;
    const version = Number(row?.value || 0);
    return Number.isFinite(version) ? Math.max(0, Math.floor(version)) : 0;
  }

  /**
   * Write the schema version to metadata.
   */
  protected writeSchemaVersion(version: number): void {
    this.db.prepare(`INSERT INTO metadata(key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(String(version));
  }

  /**
   * Run schema migrations if version mismatch is detected.
   */
  private runMigrations(): void {
    const version = this.readSchemaVersion();
    if (version < this.schemaVersion) {
      this.logger.info(`[HubSchemaInitializer] Schema version upgrade (${version} -> ${this.schemaVersion}). Performing incremental updates.`);
      this.initTables();
      this.writeSchemaVersion(this.schemaVersion);
      return;
    }
    this.ensureProjectColumns();
  }
}
