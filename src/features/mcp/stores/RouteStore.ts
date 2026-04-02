import { injectable, inject } from "inversify";
import { SYMBOLS } from "../../../common/di/symbols.js";
import { DatabaseService } from "../../runtime/DatabaseService.js";
import { PathResolverService } from "../../runtime/PathResolverService.js";
import { MessageEvents } from "../message/MessageEvents.js";

/**
 * Store for managing project-specific communication routes (e.g. Feishu chat IDs).
 */
@injectable()
export class RouteStore {
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
   * Insert or update a communication route for a project.
   */
  public upsertRoute(projectId: string, channel: string, routeKey: string): void {
    const id = String(projectId || "").trim();
    if (!id || !channel || !routeKey) return;
    const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO project_routes(project_id, channel, route_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(channel, route_key) DO UPDATE SET project_id=excluded.project_id, updated_at=excluded.updated_at`).run(id, channel, routeKey, now, now);
    this.events.emitProjectRegistryChanged();
  }

  /**
   * Find a project ID by a given communication channel and route key.
   */
  public findProjectIdByRoute(channel: string, routeKey: string): string | null {
    const row = this.db.prepare(`SELECT project_id FROM project_routes WHERE channel = ? AND route_key = ? LIMIT 1`).get(channel, routeKey) as any;
    return row ? row.project_id : null;
  }

  /**
   * Find a route key for a specific project and communication channel.
   */
  public findRouteKeyByProject(channel: string, projectId: string): string | null {
    const row = this.db.prepare(`SELECT route_key FROM project_routes WHERE channel = ? AND project_id = ? LIMIT 1`).get(channel, projectId) as any;
    return row ? row.route_key : null;
  }
}
