import { injectable, inject } from "inversify";
import path from "node:path";
import { SYMBOLS } from "../../../common/di/symbols.js";
import { DatabaseService } from "../../runtime/DatabaseService.js";
import { PathResolverService } from "../../runtime/PathResolverService.js";
import { MessageEvents } from "../message/MessageEvents.js";
import { LoggerService } from "../../runtime/LoggerService.js";

/**
 * Store for managing the central projects registry (Hub database).
 */
@injectable()
export class ProjectStore {
  constructor(
    @inject(SYMBOLS.DatabaseService) private readonly dbService: DatabaseService,
    @inject(SYMBOLS.PathResolverService) private readonly pathResolver: PathResolverService,
    @inject(SYMBOLS.MessageEvents) private readonly events: MessageEvents,
    @inject(SYMBOLS.LoggerService) private readonly logger: LoggerService
  ) {}

  /**
   * Get the database connection for the Hub.
   */
  private get db() {
    return this.dbService.getConnection(this.pathResolver.hubDbPath);
  }

  /**
   * List all non-archived projects.
   */
  public listProjects(): any[] {
    const rows = this.db.prepare(`
      SELECT project_id, project_name, project_root, last_active_at, last_message, last_message_at, message_count,
             project_mode, single_agent_channel, mode_updated_at, channel_updated_at
      FROM projects
      WHERE is_archived = 0
      ORDER BY last_active_at DESC
    `).all() as any[];
    return rows.map(r => ({
      projectId: r.project_id,
      projectName: r.project_name,
      projectRoot: r.project_root,
      lastActiveAt: r.last_active_at,
      lastMessage: r.last_message,
      lastMessageAt: r.last_message_at,
      messageCount: r.message_count,
      projectMode: this.normalizeMode(String(r.project_mode || "")),
      singleAgentChannel: this.normalizeSingleAgentChannel(String(r.single_agent_channel || "")),
      modeUpdatedAt: String(r.mode_updated_at || ""),
      channelUpdatedAt: String(r.channel_updated_at || "")
    }));
  }

  /**
   * Read project metadata by ID.
   */
  public readProjectById(projectId: string): any | null {
    const id = String(projectId || "").trim();
    if (!id) return null;
    const row = this.db.prepare(`SELECT * FROM projects WHERE project_id = ? LIMIT 1`).get(id) as any;
    if (!row) return null;
    return {
      projectId: String(row.project_id || ""),
      projectName: String(row.project_name || ""),
      projectRoot: String(row.project_root || ""),
      lastActiveAt: String(row.last_active_at || ""),
      projectMode: this.normalizeMode(String(row.project_mode || "")),
      singleAgentChannel: this.normalizeSingleAgentChannel(String(row.single_agent_channel || "")),
      modeUpdatedAt: String(row.mode_updated_at || ""),
      channelUpdatedAt: String(row.channel_updated_at || ""),
      modeUpdatedBy: String(row.mode_updated_by || ""),
      channelUpdatedBy: String(row.channel_updated_by || ""),
      lastSwitchTraceId: String(row.last_switch_trace_id || ""),
      lastSwitchRemark: String(row.last_switch_remark || "")
    };
  }

  /**
   * Insert or update a project record. Handles path conflicts.
   */
  public upsertProject(input: { projectId: string; projectName: string; projectRoot: string }): void {
    const projectId = String(input.projectId || "").trim();
    if (!projectId) return;
    const projectRoot = String(input.projectRoot || "").trim();
    if (!projectRoot) return;
    const normalizedRoot = path.resolve(projectRoot).toLowerCase();
    
    // Prevent system root registration
    if (normalizedRoot === "/" || normalizedRoot === "c:\\") {
      this.logger.warn("HUB", `Rejected registration of system root as project: ${projectRoot}`);
      return;
    }
    
    const now = new Date().toISOString();
    this.db.exec("BEGIN TRANSACTION");
    try {
      // Purge conflicting projects with the same root path
      const conflicts = this.db.prepare(`SELECT project_id FROM projects WHERE LOWER(project_root) = ?`).all(normalizedRoot) as any[];
      for (const conflict of conflicts) {
        if (conflict.project_id !== projectId) {
          process.stdout.write(`[HubStore] Purging conflicting project ${conflict.project_id} for path ${normalizedRoot}\n`);
          this.db.prepare(`DELETE FROM mcp_session_bindings WHERE project_id = ?`).run(conflict.project_id);
          this.db.prepare(`DELETE FROM project_routes WHERE project_id = ?`).run(conflict.project_id);
          this.db.prepare(`DELETE FROM projects WHERE project_id = ?`).run(conflict.project_id);
        }
      }
      
      this.db.prepare(`
        INSERT INTO projects(
          project_id, project_name, project_root, project_mode, single_agent_channel,
          mode_updated_at, channel_updated_at, created_at, updated_at, last_active_at
        ) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) 
        ON CONFLICT(project_id) DO UPDATE SET 
          project_name=excluded.project_name, 
          project_root=excluded.project_root, 
          project_mode=COALESCE(NULLIF(projects.project_mode, ''), excluded.project_mode),
          single_agent_channel=COALESCE(NULLIF(projects.single_agent_channel, ''), excluded.single_agent_channel),
          mode_updated_at=COALESCE(NULLIF(projects.mode_updated_at, ''), excluded.mode_updated_at),
          channel_updated_at=COALESCE(NULLIF(projects.channel_updated_at, ''), excluded.channel_updated_at),
          updated_at=excluded.updated_at, 
          last_active_at=excluded.last_active_at
      `).run(
        projectId,
        String(input.projectName || projectId),
        String(input.projectRoot || ""),
        "single_agent",
        "mcp_ide",
        now,
        now,
        now,
        now,
        now
      );
      this.db.exec("COMMIT");
      this.events.emitProjectRegistryChanged();
    } catch (err) {
      this.db.exec("ROLLBACK");
      this.logger.error("HUB", `Failed to upsert project ${projectId}`, err);
      throw err;
    }
  }

  /**
   * Delete a project and all its metadata from the Hub.
   */
  public deleteProject(projectId: string): void {
    const id = String(projectId || "").trim();
    if (!id) return;
    this.db.exec("BEGIN TRANSACTION");
    try {
      this.db.prepare("DELETE FROM mcp_session_bindings WHERE project_id = ?").run(id);
      this.db.prepare("DELETE FROM project_routes WHERE project_id = ?").run(id);
      this.db.prepare("DELETE FROM projects WHERE project_id = ?").run(id);
      this.db.exec("COMMIT");
      this.logger.info("HUB", `Project ${id} removed from hub.`);
      this.events.emitProjectRegistryChanged();
    } catch (err) {
      this.db.exec("ROLLBACK");
      this.logger.error("HUB", `Failed to delete project ${id}`, err);
      throw err;
    }
  }

  /**
   * Resolve project root path by project ID.
   */
  public resolveProjectRootByProjectId(projectId: string): string | null {
    return String(this.readProjectById(projectId)?.projectRoot || "").trim() || null;
  }

  /**
   * Update last message and active time for a project.
   */
  public touchMessage(input: {
    conversationId: string;
    projectId: string;
    message: string;
    createdAt?: string;
  }): void {
    const projectId = String(input.projectId || input.conversationId || "").trim();
    if (!projectId) return;
    const now = input.createdAt || new Date().toISOString();
    this.db.prepare(`UPDATE projects SET last_message = ?, last_message_at = ?, message_count = message_count + 1, last_active_at = ?, updated_at = ? WHERE project_id = ?`).run(String(input.message || "").slice(0, 200), now, now, now, projectId);
    this.events.emitProjectRegistryChanged();
  }

  private normalizeMode(mode: string): "single_agent" | "multi_agent" {
    void mode;
    return "single_agent";
  }

  private normalizeSingleAgentChannel(channel: string): "mcp_ide" | "cli_codex" | "cli_cc" {
    void channel;
    return "mcp_ide";
  }
}
