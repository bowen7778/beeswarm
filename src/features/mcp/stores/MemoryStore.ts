import { injectable, inject } from "inversify";
import { randomUUID } from "node:crypto";
import { SYMBOLS } from "../../../common/di/symbols.js";
import { DatabaseService } from "../../runtime/DatabaseService.js";
import { PathResolverService } from "../../runtime/PathResolverService.js";

@injectable()
export class MemoryStore {
  constructor(
    @inject(SYMBOLS.DatabaseService) private readonly dbService: DatabaseService,
    @inject(SYMBOLS.PathResolverService) private readonly pathResolver: PathResolverService
  ) {}

  private get db() {
    return this.dbService.getConnection(this.pathResolver.hubDbPath);
  }

  public upsertMemoryFact(input: {
    projectId: string;
    factKey: string;
    factValue: string;
    source?: string;
    confidence?: number;
    traceId?: string;
    updatedAt?: string;
  }): void {
    const projectId = String(input.projectId || "").trim();
    const factKey = String(input.factKey || "").trim();
    if (!projectId || !factKey) return;
    const now = String(input.updatedAt || new Date().toISOString());
    this.db.prepare(`
      INSERT INTO memory_facts(
        fact_id, project_id, fact_key, fact_value, source, confidence, trace_id, updated_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id, fact_key) DO UPDATE SET
        fact_value = excluded.fact_value,
        source = excluded.source,
        confidence = excluded.confidence,
        trace_id = excluded.trace_id,
        updated_at = excluded.updated_at
    `).run(
      randomUUID(),
      projectId,
      factKey,
      String(input.factValue || ""),
      String(input.source || ""),
      Number(input.confidence ?? 0.5),
      String(input.traceId || ""),
      now,
      now
    );
  }

  public listMemoryFacts(projectId: string, limit: number = 50): any[] {
    const id = String(projectId || "").trim();
    if (!id) return [];
    return this.db.prepare(`
      SELECT fact_key, fact_value, source, confidence, trace_id, updated_at, created_at
      FROM memory_facts
      WHERE project_id = ?
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(id, Math.max(1, Math.min(500, limit))) as any[];
  }

  public appendMemoryEvent(input: {
    projectId: string;
    traceId: string;
    eventType: string;
    eventPayload?: any;
    createdAt?: string;
  }): void {
    const projectId = String(input.projectId || "").trim();
    if (!projectId) return;
    this.db.prepare(`
      INSERT INTO memory_events(
        event_id, project_id, trace_id, event_type, event_payload, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      projectId,
      String(input.traceId || ""),
      String(input.eventType || ""),
      JSON.stringify(input.eventPayload || {}),
      String(input.createdAt || new Date().toISOString())
    );
  }

  public listMemoryEvents(projectId: string, limit: number = 50): any[] {
    const id = String(projectId || "").trim();
    if (!id) return [];
    const rows = this.db.prepare(`
      SELECT trace_id, event_type, event_payload, created_at
      FROM memory_events
      WHERE project_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(id, Math.max(1, Math.min(500, limit))) as any[];
    return rows.map((x) => ({
      traceId: String(x.trace_id || ""),
      eventType: String(x.event_type || ""),
      eventPayload: this.parseJsonObject(x.event_payload),
      createdAt: String(x.created_at || "")
    }));
  }

  private parseJsonObject(raw: any): any {
    const value = String(raw || "").trim();
    if (!value) return {};
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
}
