import { injectable, inject } from "inversify";
import { SYMBOLS } from "../../../common/di/symbols.js";
import { DatabaseService } from "../../runtime/DatabaseService.js";
import { PathResolverService } from "../../runtime/PathResolverService.js";
import { MessageEvents } from "../message/MessageEvents.js";
import { BaseRepository } from "../../runtime/BaseRepository.js";
import { LoggerService } from "../../runtime/LoggerService.js";

/**
 * Store for managing project-specific communication routes (e.g. Feishu chat IDs).
 */
@injectable()
export class RouteStore extends BaseRepository {
  constructor(
    @inject(SYMBOLS.DatabaseService) dbService: DatabaseService,
    @inject(SYMBOLS.PathResolverService) private readonly pathResolver: PathResolverService,
    @inject(SYMBOLS.MessageEvents) private readonly events: MessageEvents,
    @inject(SYMBOLS.LoggerService) logger: LoggerService
  ) {
    super(dbService, logger);
  }

  protected getDbPath(): string {
    return this.pathResolver.hubDbPath;
  }

  /**
   * Insert or update a communication route for a project.
   */
  public upsertRoute(projectId: string, channel: string, routeKey: string): void {
    const id = String(projectId || "").trim();
    if (!id || !channel || !routeKey) return;
    const now = new Date().toISOString();
    this.run(`INSERT INTO project_routes(project_id, channel, route_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(channel, route_key) DO UPDATE SET project_id=excluded.project_id, updated_at=excluded.updated_at`, [id, channel, routeKey, now, now]);
    this.events.emitProjectRegistryChanged();
  }

  /**
   * Find a project ID by a given communication channel and route key.
   */
  public findProjectIdByRoute(channel: string, routeKey: string): string | null {
    const row = this.queryOne<any>(`SELECT project_id FROM project_routes WHERE channel = ? AND route_key = ? LIMIT 1`, [channel, routeKey]);
    return row ? row.project_id : null;
  }

  /**
   * Find a route key for a specific project and communication channel.
   */
  public findRouteKeyByProject(channel: string, projectId: string): string | null {
    const row = this.queryOne<any>(`SELECT route_key FROM project_routes WHERE channel = ? AND project_id = ? LIMIT 1`, [channel, projectId]);
    return row ? row.route_key : null;
  }
}
