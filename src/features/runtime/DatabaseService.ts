import { injectable, inject } from "inversify";
import { DatabaseSync, StatementSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { PathResolverService } from "./PathResolverService.js";
import { LoggerService } from "./LoggerService.js";
import { SYMBOLS } from "../../common/di/symbols.js";

@injectable()
export class DatabaseService {
  private connections = new Map<string, DatabaseSync>();

  constructor(
    @inject(SYMBOLS.PathResolverService) private readonly pathResolver: PathResolverService,
    @inject(SYMBOLS.LoggerService) private readonly logger: LoggerService
  ) {}

  getConnection(dbPath: string): DatabaseSync {
    const absolutePath = path.resolve(dbPath);
    
    if (this.connections.has(absolutePath)) {
      return this.connections.get(absolutePath)!;
    }

    const dir = path.dirname(absolutePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const db = new DatabaseSync(absolutePath);
    this.connections.set(absolutePath, db);
    this.logger.info(`[DatabaseService] Connected to ${absolutePath}`);
    return db;
  }

  async execute(sql: string, params: any[] = []): Promise<void> {
    // Assume we use the primary connection for generic migrations, or callers call getConnection first.
    // For simplicity, we use the default primary connection here.
    const db = this.getPrimaryConnection();
    const stmt = db.prepare(sql);
    stmt.run(...params);
  }

  async query<T>(sql: string, params: any[] = []): Promise<T[]> {
    const db = this.getPrimaryConnection();
    const stmt = db.prepare(sql);
    return stmt.all(...params) as T[];
  }

  private getPrimaryConnection(): DatabaseSync {
    // This logic should be consistent with MessageManagerStore, using the main hub database
    const dbPath = this.pathResolver.getDatabasePath();
    return this.getConnection(dbPath);
  }

  closeConnection(dbPath: string): void {
    const absolutePath = path.resolve(dbPath);
    const db = this.connections.get(absolutePath);
    if (db) {
      try {
        db.close();
        this.connections.delete(absolutePath);
        this.logger.info(`[DatabaseService] Closed connection to ${absolutePath}`);
      } catch (err) {
        this.logger.error(`[DatabaseService] Failed to close connection to ${absolutePath}`, err);
      }
    }
  }

  closeAll() {
    for (const [path, db] of this.connections) {
      try {
        db.close();
        this.logger.info(`[DatabaseService] Closed connection to ${path}`);
      } catch (err) {
        this.logger.error(`[DatabaseService] Failed to close connection to ${path}`, err);
      }
    }
    this.connections.clear();
  }
}

