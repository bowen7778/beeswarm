import { injectable, inject } from "inversify";
import { SYMBOLS } from "../../../common/di/symbols.js";
import { DatabaseService } from "../../runtime/DatabaseService.js";
import { PathResolverService } from "../../runtime/PathResolverService.js";
import { MessageEvents } from "../message/MessageEvents.js";

/**
 * Store for managing bindings between MCP session IDs and project IDs.
 */
@injectable()
export class McpSessionBindingStore {
  constructor(
    @inject(SYMBOLS.DatabaseService) private readonly dbService: DatabaseService,
    @inject(SYMBOLS.PathResolverService) private readonly pathResolver: PathResolverService,
    @inject(SYMBOLS.MessageEvents) private readonly events: MessageEvents
  ) {}

  /**
   * Get the database connection for the Hub.
   */
  private get db() {
    return this.dbService.getConnection(this.pathResolver.hubDbPath);
  }

  /**
   * List all project IDs that have active MCP session bindings.
   */
  public listConnectedProjectIds(): string[] {
    const rows = this.db.prepare(`SELECT DISTINCT project_id FROM mcp_session_bindings`).all() as any[];
    return rows.map(r => String(r.project_id));
  }

  /**
   * Bind an MCP session ID to a project ID.
   */
  public bindMcpSession(sessionId: string, projectId: string): void {
    const sid = String(sessionId || "").trim();
    const pid = String(projectId || "").trim();
    if (!sid || !pid) return;
    const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO mcp_session_bindings(session_id, project_id, updated_at) VALUES (?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET project_id=excluded.project_id, updated_at=excluded.updated_at`).run(sid, pid, now);
    this.events.emitProjectRegistryChanged();
  }

  /**
   * Remove the binding for a specific MCP session ID.
   */
  public unbindMcpSession(sessionId: string): void {
    const sid = String(sessionId || "").trim();
    if (!sid) return;
    this.db.prepare(`DELETE FROM mcp_session_bindings WHERE session_id = ?`).run(sid);
    this.events.emitProjectRegistryChanged();
  }

  /**
   * Resolve the project ID associated with an MCP session ID.
   */
  public resolveProjectIdByMcpSession(sessionId: string): string | null {
    const sid = String(sessionId || "").trim();
    if (!sid) return null;
    const row = this.db.prepare(`SELECT project_id FROM mcp_session_bindings WHERE session_id = ? LIMIT 1`).get(sid) as any;
    return row ? row.project_id : null;
  }
}
