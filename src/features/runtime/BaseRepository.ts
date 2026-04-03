import { injectable, inject } from "inversify";
import { DatabaseSync } from "node:sqlite";
import { DatabaseService } from "./DatabaseService.js";
import { LoggerService } from "./LoggerService.js";
import { SYMBOLS } from "../../common/di/symbols.js";

@injectable()
export abstract class BaseRepository {
  constructor(
    @inject(SYMBOLS.DatabaseService) protected readonly dbService: DatabaseService,
    @inject(SYMBOLS.LoggerService) protected readonly logger: LoggerService
  ) {}

  /**
   * Abstract method to be implemented by child stores to provide their DB path.
   * This avoids constructor injection race conditions with @inject properties.
   */
  protected abstract getDbPath(): string;

  private get db(): DatabaseSync {
    return this.dbService.getConnection(this.getDbPath());
  }

  protected exec(sql: string) {
    try {
      this.db.exec(sql);
    } catch (err) {
      this.logger.error(`[BaseRepository] Exec failed: ${sql}`, err);
      throw err;
    }
  }

  protected queryOne<T>(sql: string, params: any[] = []): T | null {
    try {
      const stmt = this.db.prepare(sql);
      return (stmt.get(...params) as T) || null;
    } catch (err) {
      this.logger.error(`[BaseRepository] QueryOne failed: ${sql}`, err);
      return null;
    }
  }

  protected queryAll<T>(sql: string, params: any[] = []): T[] {
    try {
      const stmt = this.db.prepare(sql);
      return (stmt.all(...params) as T[]) || [];
    } catch (err) {
      this.logger.error(`[BaseRepository] QueryAll failed: ${sql}`, err);
      return [];
    }
  }

  protected run(sql: string, params: any[] = []) {
    try {
      const stmt = this.db.prepare(sql);
      return stmt.run(...params);
    } catch (err) {
      this.logger.error(`[BaseRepository] Run failed: ${sql}`, err);
      throw err;
    }
  }

  protected readSchemaVersion(): number {
    const val = this.getMetadata("sys.version");
    return val ? parseInt(val, 10) : 0;
  }

  protected writeSchemaVersion(version: number) {
    this.setMetadata("sys.version", String(version));
  }

  /**
   * Standardized access to metadata table (unified facts/versioning).
   */
  protected getMetadata(key: string): string | null {
    try {
      const row = this.queryOne<{ value: string }>(
        `SELECT value FROM metadata WHERE key = ? LIMIT 1`,
        [key]
      );
      return row ? String(row.value) : null;
    } catch {
      return null;
    }
  }

  /**
   * Standardized storage to metadata table.
   */
  protected setMetadata(key: string, value: string): void {
    this.run(
      `
      INSERT INTO metadata(key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `,
      [key, String(value)]
    );
  }
}

