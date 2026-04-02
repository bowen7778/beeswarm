import { injectable, inject } from "inversify";
import { DatabaseSync } from "node:sqlite";
import { DatabaseService } from "./DatabaseService.js";
import { LoggerService } from "./LoggerService.js";
import { SYMBOLS } from "../../common/di/symbols.js";

@injectable()
export abstract class BaseRepository {
  private _db: DatabaseSync | null = null;

  constructor(
    @inject(SYMBOLS.DatabaseService) protected readonly dbService: DatabaseService,
    @inject(SYMBOLS.LoggerService) protected readonly logger: LoggerService,
    dbPath?: string
  ) {
    if (dbPath) {
      this._db = this.dbService.getConnection(dbPath);
    }
  }

  protected get db(): DatabaseSync {
    if (!this._db) {
      throw new Error(`[BaseRepository] Database not connected. Call connect(dbPath) first.`);
    }
    return this._db;
  }

  protected connect(dbPath: string) {
    if (this._db) return;
    this._db = this.dbService.getConnection(dbPath);
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
    const row = this.queryOne<{ value: string }>(`
      SELECT value FROM metadata WHERE key = 'schema_version'
    `);
    return row ? parseInt(row.value, 10) : 0;
  }

  protected writeSchemaVersion(version: number) {
    this.run(`
      INSERT INTO metadata(key, value) VALUES ('schema_version', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `, [String(version)]);
  }
}

