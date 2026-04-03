import { injectable, inject } from "inversify";
import { randomUUID } from "node:crypto";
import { SYMBOLS } from "../../../common/di/symbols.js";
import { DatabaseService } from "../../runtime/DatabaseService.js";
import { PathResolverService } from "../../runtime/PathResolverService.js";
import { MessageEvents } from "../message/MessageEvents.js";
import { BaseRepository } from "../../runtime/BaseRepository.js";
import { LoggerService } from "../../runtime/LoggerService.js";

@injectable()
export class ProjectModeStore extends BaseRepository {
  private readonly supportedModes = new Set(["single_agent", "multi_agent"]);
  private readonly supportedSingleAgentChannels = new Set(["mcp_ide", "cli_codex", "cli_cc"]);

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

  public readProjectModeConfig(projectId: string) {
    const row = this.queryOne<any>(`
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
    `, [projectId]);
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
    this.run(`
      UPDATE projects
      SET project_mode = ?, mode_updated_at = ?, mode_updated_by = ?, last_switch_trace_id = ?,
          last_switch_remark = ?, updated_at = ?
      WHERE project_id = ?
    `, [mode, now, String(input.operator || ""), String(input.traceId || ""), String(input.remark || ""), now, projectId]);
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
    this.run(`
      UPDATE projects
      SET single_agent_channel = ?, channel_updated_at = ?, channel_updated_by = ?, last_switch_trace_id = ?,
          last_switch_remark = ?, updated_at = ?
      WHERE project_id = ?
    `, [channel, now, String(input.operator || ""), String(input.traceId || ""), String(input.remark || ""), now, projectId]);
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
    this.run(`
      INSERT INTO project_mode_audits(
        id, project_id, action, from_value, to_value, operator, trace_id, remark, result, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
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
    ]);
  }

  private normalizeMode(mode: string): "single_agent" | "multi_agent" {
    if (mode === "multi_agent") return "multi_agent";
    return "single_agent";
  }

  private normalizeSingleAgentChannel(channel: string): "mcp_ide" | "cli_codex" | "cli_cc" {
    if (channel === "cli_codex") return "cli_codex";
    if (channel === "cli_cc") return "cli_cc";
    return "mcp_ide";
  }
}
