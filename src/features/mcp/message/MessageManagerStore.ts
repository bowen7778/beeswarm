import { injectable, inject } from "inversify";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { FileHelper } from "../../runtime/FileHelper.js";
import { ProjectIdentityService } from "../project/ProjectIdentityService.js";
import { ProjectStore } from "../stores/ProjectStore.js";
import { RouteStore } from "../stores/RouteStore.js";
import { SYMBOLS } from "../../../common/di/symbols.js";
import { DatabaseService } from "../../runtime/DatabaseService.js";
import { MigrationService } from "../../runtime/MigrationService.js";
import { LoggerService } from "../../runtime/LoggerService.js";
import { PathResolverService } from "../../runtime/PathResolverService.js";
import { SessionContext } from "../../../common/context/SessionContext.js";
import { MessageEvents } from "./MessageEvents.js";

/**
 * Store for managing project-specific message databases and outbox.
 */
@injectable()
export class MessageManagerStore {
  private initializedProjects = new Set<string>();

  constructor(
    @inject(SYMBOLS.DatabaseService) private readonly dbService: DatabaseService,
    @inject(SYMBOLS.MigrationService) private readonly migration: MigrationService,
    @inject(SYMBOLS.LoggerService) private readonly logger: LoggerService,
    @inject(SYMBOLS.PathResolverService) private readonly pathResolver: PathResolverService,
    @inject(SYMBOLS.ProjectIdentityService) private readonly projectIdentity: ProjectIdentityService,
    @inject(SYMBOLS.ProjectStore) private readonly projectStore: ProjectStore,
    @inject(SYMBOLS.RouteStore) private readonly routeStore: RouteStore,
    @inject(SYMBOLS.MessageEvents) private readonly events: MessageEvents
  ) {}

  /**
   * Get the database connection for the current project context.
   */
  private get db(): DatabaseSync {
    const projectRoot = SessionContext.projectRoot;
    if (!projectRoot) {
      throw new Error("[MessageManagerStore] Access denied: No project context provided.");
    }
    const info = this.projectIdentity.readProjectInfo(projectRoot);
    if (!info.initialized) {
      throw new Error(`[MessageManagerStore] Project at ${projectRoot} is not initialized. Please run 'beemcp:init' first.`);
    }
    try {
      this.ensureProjectDb(projectRoot);
      const dbPath = this.pathResolver.getProjectDbPath(projectRoot);
      return this.dbService.getConnection(dbPath);
    } catch (err: any) {
      if (err.message === "CANNOT_USE_PROGRAM_ROOT_AS_PROJECT_CONTEXT") {
        this.logger.warn(`[MessageManagerStore] Rejected database access to program source directory: ${projectRoot}`);
        throw new Error(`[MessageManagerStore] Security violation: Cannot use program source as project data storage.`);
      }
      throw err;
    }
  }

  /**
   * Ensure the project database exists and is migrated.
   */
  private ensureProjectDb(projectRoot: string) {
    if (this.initializedProjects.has(projectRoot)) return;
    const dbPath = this.pathResolver.getProjectDbPath(projectRoot);
    const dbDir = path.dirname(dbPath);
    
    // Core fix: use synchronous safe directory creation to avoid Windows locking issues
    FileHelper.mkdirSyncSafe(dbDir);
    
    const db = this.dbService.getConnection(dbPath);
    try {
      this.migration.migrate(db, "PROJECT");
      this.initializedProjects.add(projectRoot);
    } catch (err: any) {
      this.logger.error(`[MessageManagerStore] Failed to migrate project database: ${projectRoot}`, err);
      throw err;
    }
  }

  public getProjectId(): string {
    const projectRoot = SessionContext.projectRoot;
    if (!projectRoot) throw new Error("PROJECT_CONTEXT_REQUIRED: Cannot get project ID without project root context.");
    const info = this.projectIdentity.readProjectInfo(projectRoot);
    return info.projectId;
  }
  
  public getProjectRoot(): string { 
    return SessionContext.projectRoot || ""; 
  }
  
  private ensureProjectContext(): string {
    const projectRoot = this.getProjectRoot();
    if (!projectRoot) throw new Error("PROJECT_CONTEXT_REQUIRED: Database access denied.");
    return projectRoot;
  }
  
  public getDefaultConversationId(): string { 
    try {
      return this.getProjectId(); 
    } catch (e: any) {
      if (e.message.includes("PROJECT_CONTEXT_REQUIRED")) {
        return "";
      }
      throw e;
    }
  }
  
  public isProjectInitialized(): boolean {
    const projectRoot = SessionContext.projectRoot;
    if (!projectRoot) return false;
    return this.projectIdentity.readProjectInfo(projectRoot).initialized;
  }
  
  /**
   * Get outbox metrics for the current project.
   */
  public getOutboxMetrics(): { pending: number; dead: number } {
    try {
      const rows = this.db.prepare(`SELECT SUM(CASE WHEN CAST(attempts AS INTEGER) < 5 AND status = 'pending' THEN 1 ELSE 0 END) as pending, SUM(CASE WHEN CAST(attempts AS INTEGER) >= 5 OR status = 'dead' THEN 1 ELSE 0 END) as dead FROM outbox`).get() as any;
      return { pending: Number(rows?.pending || 0), dead: Number(rows?.dead || 0) };
    } catch {
      return { pending: 0, dead: 0 };
    }
  }
  
  public getProjectIdentityService() { return this.projectIdentity; }
  
  public normalizeConversationId(id: string): string { 
    if (id) return id; 
    const def = this.getDefaultConversationId(); 
    return def || "";
  }

  public closeProjectDb(projectRoot: string) {
    const dbPath = this.pathResolver.getProjectDbPath(projectRoot);
    this.dbService.closeConnection(dbPath);
    this.initializedProjects.delete(projectRoot);
  }

  /**
   * Run a function within a database transaction.
   */
  public async runTransaction<T>(fn: () => Promise<T> | T): Promise<T> {
    const db = this.db;
    db.exec("BEGIN TRANSACTION");
    try {
      const result = await fn();
      db.exec("COMMIT");
      return result;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }

  public ensureConversation(id: string, profile?: any) {
    const token = this.normalizeConversationId(id);
    const now = new Date().toISOString();
    this.run("INSERT OR IGNORE INTO conversations(id, created_at, updated_at) VALUES (?, ?, ?)", [token, now, now]);
  }

  /**
   * Append a message to the database and trigger events.
   */
  public appendMessage(msg: { conversationId?: string; role: string; content: string; origin?: string; message_id?: string; createdAt?: string }) {
    this.ensureProjectContext();
    const projectId = this.getProjectId();
    const conversationId = projectId;
    const id = randomUUID();
    const now = msg.createdAt || new Date().toISOString();
    const messageId = String(msg.message_id || "").trim();
    
    // Physical idempotent write: use INSERT OR IGNORE with UNIQUE index
    const result = this.run(`INSERT OR IGNORE INTO messages(id, project_id, conversation_id, role, content, message_id, origin, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [id, projectId, conversationId, msg.role, msg.content, messageId, msg.origin || "", now]);
    
    // If changes is 0, it means message_id already exists
    if (result.changes === 0) {
      this.logger.info("MessageManagerStore", `Ignored duplicate message_id: ${messageId}`);
      return;
    }

    this.projectStore.touchMessage({ conversationId, projectId, message: msg.content, createdAt: now });

    process.stdout.write(`[MessageStore] Appending ${msg.role} message for project: ${projectId}\n`);

    // All rendering events are unified here to ensure SSE real-time awareness.
    // Only messages successfully persisted to the DB trigger UI rendering to solve duplication issues.
    if (msg.role === "ai") {
      this.events.emitAIReply(msg.content, conversationId, messageId || id);
    } else {
      // UserInput event now supports precise broadcasting based on projectId
      this.events.emitUserInput(msg.content, conversationId, messageId || id);
    }
  }

  public updateAIReply(conversationId: string, content: string) {
    this.ensureProjectContext();
    const projectId = this.getProjectId();
    const token = projectId;
    const now = new Date().toISOString();
    this.run(`INSERT INTO ai_replies(conversation_id, content, updated_at) VALUES (?, ?, ?) ON CONFLICT(conversation_id) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`, [token, content, now]);
    this.projectStore.touchMessage({ conversationId: token, projectId, message: content, createdAt: now });
  }

  public getMessages(conversationId: string, limit: number = 50): any[] {
    const token = this.normalizeConversationId(conversationId);
    // Fetch latest N messages in descending order of time
    const rows = this.queryAll(`SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?`, [token, limit]);
    // Reverse before returning to maintain chronological order for the Service layer
    return rows.reverse();
  }
  
  public enqueueOutbox(data: { id: string; content: string; source: string; traceId?: string; conversationId?: string; kind?: string }) {
    const now = new Date().toISOString();
    const conversationId = data.conversationId || this.getProjectId();
    this.run(`INSERT INTO outbox(id, kind, content, source, trace_id, conversation_id, next_run_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [data.id, data.kind || "im_text", data.content, data.source, data.traceId || "", conversationId, now, now, now]);
  }
  
  public getPendingOutbox(limit: number = 5): any[] {
    const now = new Date().toISOString();
    return this.queryAll(`SELECT * FROM outbox WHERE status = 'pending' AND next_run_at <= ? LIMIT ?`, [now, limit]);
  }
  
  public updateOutboxStatus(id: string, status: string, attempts: number, nextRunAt: number, lastError: string) {
    const now = new Date().toISOString();
    const nextRunStr = nextRunAt > 0 ? new Date(nextRunAt).toISOString() : now;
    this.run(`UPDATE outbox SET status = ?, attempts = ?, next_run_at = ?, last_error = ?, updated_at = ? WHERE id = ?`, [status, String(attempts), nextRunStr, lastError, now, id]);
  }
  
  public getAIReply(conversationId: string): string {
    const token = this.normalizeConversationId(conversationId);
    const row = this.queryOne<{ content: string }>(`SELECT content FROM ai_replies WHERE conversation_id = ?`, [token]);
    return row ? row.content : "";
  }
  
  public latestConversationId(): string | null { return this.getProjectId(); }
  
  public readConversation(conversationId: string): any | null {
    const token = this.normalizeConversationId(conversationId);
    const row = this.queryOne<any>(`SELECT id, created_at, updated_at FROM conversations WHERE id = ? LIMIT 1`, [token]);
    if (!row) return null;
    const chatId = this.routeStore.findRouteKeyByProject("feishu_chat_id", token);
    return { id: token, createdAt: String(row.created_at || ""), updatedAt: String(row.updated_at || ""), routingConfig: { im: { chatId: String(chatId || "").trim() } } };
  }
  
  public upsertConversationRouting(conversationId: string, routing: any): void {
    const token = this.normalizeConversationId(conversationId);
    const chatId = String(routing?.im?.chatId || "").trim();
    if (chatId) this.routeStore.upsertRoute(token, "feishu_chat_id", chatId);
  }
  
  public upsertRoute(conversationId: string, channel: string, routeKey: string): void {
    const token = this.normalizeConversationId(conversationId);
    this.routeStore.upsertRoute(token, channel, routeKey);
  }
  
  public findConversationIdByRoute(channel: string, routeKey: string): string | null { 
    try {
      return this.routeStore.findProjectIdByRoute(channel, routeKey);
    } catch (e: any) {
      if (e.message && e.message.includes("PROJECT_CONTEXT_REQUIRED")) {
        return null;
      }
      throw e;
    }
  }
  
  public listOutboxDead(limit: number = 20, source?: string): any[] {
    const normalizedLimit = Math.max(1, Math.min(500, limit));
    const normalizedSource = String(source || "").trim();
    if (normalizedSource) {
      return this.queryAll(
        `SELECT * FROM outbox WHERE status = 'dead' AND source = ? ORDER BY updated_at DESC LIMIT ?`,
        [normalizedSource, normalizedLimit]
      );
    }
    return this.queryAll(
      `SELECT * FROM outbox WHERE status = 'dead' ORDER BY updated_at DESC LIMIT ?`,
      [normalizedLimit]
    );
  }
  
  public replayOutboxDead(id: string): boolean {
    try {
      this.run(`UPDATE outbox SET status = 'pending', attempts = '0', next_run_at = ?, last_error = '', updated_at = ? WHERE id = ? AND status = 'dead'`, [new Date().toISOString(), new Date().toISOString(), String(id || "")]);
      return true;
    } catch {
      return false;
    }
  }
  
  public countReplayableDead(limit: number, source?: string): number {
    const hasSource = !!String(source || "").trim();
    const row = hasSource
      ? this.queryOne<{ c: number }>(`SELECT COUNT(1) AS c FROM (SELECT id FROM outbox WHERE status = 'dead' AND source = ? ORDER BY updated_at DESC LIMIT ?)`, [String(source || "").trim(), Math.max(1, Math.min(500, limit))])
      : this.queryOne<{ c: number }>(`SELECT COUNT(1) AS c FROM (SELECT id FROM outbox WHERE status = 'dead' ORDER BY updated_at DESC LIMIT ?)`, [Math.max(1, Math.min(500, limit))]);
    return Number(row?.c || 0);
  }
  
  public replayOutboxDeadBatch(limit: number, source?: string): number {
    const rows = String(source || "").trim()
      ? this.queryAll<{ id: string }>(`SELECT id FROM outbox WHERE status = 'dead' AND source = ? ORDER BY updated_at DESC LIMIT ?`, [String(source || "").trim(), Math.max(1, Math.min(500, limit))])
      : this.queryAll<{ id: string }>(`SELECT id FROM outbox WHERE status = 'dead' ORDER BY updated_at DESC LIMIT ?`, [Math.max(1, Math.min(500, limit))]);
    let changed = 0;
    for (const row of rows) {
      if (this.replayOutboxDead(String(row.id || ""))) changed += 1;
    }
    return changed;
  }
  
  public previewOutboxReplay(limit: number, source?: string): { items: any[]; count: number } {
    const items = String(source || "").trim()
      ? this.queryAll(`SELECT id, source, attempts, last_error, updated_at FROM outbox WHERE status = 'dead' AND source = ? ORDER BY updated_at DESC LIMIT ?`, [String(source || "").trim(), Math.max(1, Math.min(500, limit))])
      : this.queryAll(`SELECT id, source, attempts, last_error, updated_at FROM outbox WHERE status = 'dead' ORDER BY updated_at DESC LIMIT ?`, [Math.max(1, Math.min(500, limit))]);
    return { items, count: items.length };
  }
  
  public listOutboxAudit(limit: number, source?: string, action?: string): any[] {
    const rows = String(source || "").trim()
      ? this.queryAll(`SELECT id, source, status, attempts, last_error, updated_at FROM outbox WHERE source = ? ORDER BY updated_at DESC LIMIT ?`, [String(source || "").trim(), Math.max(1, Math.min(1000, limit))])
      : this.queryAll(`SELECT id, source, status, attempts, last_error, updated_at FROM outbox ORDER BY updated_at DESC LIMIT ?`, [Math.max(1, Math.min(1000, limit))]);
    if (!String(action || "").trim()) return rows;
    const normalizedAction = String(action || "").trim().toLowerCase();
    return rows.filter((x: any) => String(x?.status || "").toLowerCase() === normalizedAction);
  }

  private queryOne<T>(sql: string, params: any[] = []): T | null {
    try {
      const stmt = this.db.prepare(sql);
      return (stmt.get(...params) as T) || null;
    } catch (err) {
      this.logger.error(`[MessageManagerStore] QueryOne failed: ${sql}`, err);
      return null;
    }
  }
  
  private queryAll<T>(sql: string, params: any[] = []): T[] {
    try {
      const stmt = this.db.prepare(sql);
      return (stmt.all(...params) as T[]) || [];
    } catch (err) {
      this.logger.error(`[MessageManagerStore] QueryAll failed: ${sql}`, err);
      return [];
    }
  }
  
  private run(sql: string, params: any[] = []) {
    try {
      const stmt = this.db.prepare(sql);
      return stmt.run(...params);
    } catch (err) {
      this.logger.error(`[MessageManagerStore] Run failed: ${sql}`, err);
      throw err;
    }
  }

  public isFingerprintSeen(chatId: string, messageId: string): boolean {
    const key = `${String(chatId || "").trim()}|${String(messageId || "").trim()}`;
    const row = this.queryOne<any>(`SELECT 1 FROM inbound_fingerprints WHERE message_key = ?`, [key]);
    return !!row;
  }

  public markFingerprintSeen(chatId: string, messageId: string): void {
    const key = `${String(chatId || "").trim()}|${String(messageId || "").trim()}`;
    const now = Date.now();
    this.run(`INSERT OR IGNORE INTO inbound_fingerprints (message_key, processed_at) VALUES (?, ?)`, [key, now]);
    
    // Periodically clean up fingerprints older than 24 hours to keep the database clean
    const dayAgo = now - 24 * 60 * 60 * 1000;
    this.run(`DELETE FROM inbound_fingerprints WHERE processed_at < ?`, [dayAgo]);
  }
}
