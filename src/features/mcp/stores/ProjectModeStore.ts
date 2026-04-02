import { injectable, inject } from "inversify";
import { randomUUID } from "node:crypto";
import { SYMBOLS } from "../../../common/di/symbols.js";
import { DatabaseService } from "../../runtime/DatabaseService.js";
import { PathResolverService } from "../../runtime/PathResolverService.js";
import { MessageEvents } from "../message/MessageEvents.js";

@injectable()
export class ProjectModeStore {
  private readonly supportedModes = new Set(["single_agent"]);
  private readonly supportedSingleAgentChannels = new Set(["mcp_ide"]);

  constructor(
    @inject(SYMBOLS.DatabaseService) private readonly dbService: DatabaseService,
    @inject(SYMBOLS.PathResolverService) private readonly pathResolver: PathResolverService,
    @inject(SYMBOLS.MessageEvents) private readonly events: MessageEvents
  ) {}

  private get db() {
    return this.dbService.getConnection(this.pathResolver.hubDbPath);
  }

  public readProjectModeConfig(projectId: string) {
    const row = this.db.prepare(`
      SELECT
        project_id as projectId,
        project_mode as projectMode,
        single_agent_channel as singleAgentChannel,
        mode_updated_at as modeUpdatedAt,
        channel_updated_at as channelUpdatedAt,
        mode_updated_by as modeUpdatedBy,
        channel_updated_by as channelUpdatedBy,
        last_switch_trace_id as lastSwitchTraceId,
        last_switch_remark as lastSwitchRemark
      FROM projects
      WHERE project_id = ?
      LIMIT 1
    `).get(projectId) as any;
    if (!row) return null;
    return {
      projectId: String(row.projectId || ""),
      projectMode: this.normalizeMode(String(row.projectMode || "")),
      singleAgentChannel: this.normalizeSingleAgentChannel(String(row.singleAgentChannel || "")),
      modeUpdatedAt: String(row.modeUpdatedAt || ""),
      channelUpdatedAt: String(row.channelUpdatedAt || ""),
      modeUpdatedBy: String(row.modeUpdatedBy || ""),
      channelUpdatedBy: String(row.channelUpdatedBy || ""),
      lastSwitchTraceId: String(row.lastSwitchTraceId || ""),
      lastSwitchRemark: String(row.lastSwitchRemark || "")
    };
  }

  public updateProjectMode(input: {
    projectId: string;
    mode: string;
    operator: string;
    traceId: string;
    remark?: string;
  }): void {
    const projectId = String(input.projectId || "").trim();
    if (!projectId) return;
    const mode = String(input.mode || "").trim();
    if (!this.supportedModes.has(mode)) return;
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE projects
      SET project_mode = ?, mode_updated_at = ?, mode_updated_by = ?, last_switch_trace_id = ?,
          last_switch_remark = ?, updated_at = ?
      WHERE project_id = ?
    `).run(mode, now, String(input.operator || ""), String(input.traceId || ""), String(input.remark || ""), now, projectId);
    this.events.emitProjectRegistryChanged();
  }

  public updateSingleAgentChannel(input: {
    projectId: string;
    channel: string;
    operator: string;
    traceId: string;
    remark?: string;
  }): void {
    const projectId = String(input.projectId || "").trim();
    if (!projectId) return;
    const channel = String(input.channel || "").trim();
    if (!this.supportedSingleAgentChannels.has(channel)) return;
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE projects
      SET single_agent_channel = ?, channel_updated_at = ?, channel_updated_by = ?, last_switch_trace_id = ?,
          last_switch_remark = ?, updated_at = ?
      WHERE project_id = ?
    `).run(channel, now, String(input.operator || ""), String(input.traceId || ""), String(input.remark || ""), now, projectId);
    this.events.emitProjectRegistryChanged();
  }

  public appendProjectModeAudit(input: {
    projectId: string;
    action: string;
    fromValue: string;
    toValue: string;
    operator: string;
    traceId: string;
    remark?: string;
    result: string;
  }): void {
    const projectId = String(input.projectId || "").trim();
    if (!projectId) return;
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO project_mode_audits(
        id, project_id, action, from_value, to_value, operator, trace_id, remark, result, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      projectId,
      String(input.action || ""),
      String(input.fromValue || ""),
      String(input.toValue || ""),
      String(input.operator || ""),
      String(input.traceId || ""),
      String(input.remark || ""),
      String(input.result || ""),
      now
    );
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
