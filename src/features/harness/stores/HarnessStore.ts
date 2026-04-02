import { injectable, inject } from "inversify";
import { randomUUID } from "node:crypto";
import { SYMBOLS } from "../../../common/di/symbols.js";
import { DatabaseService } from "../../runtime/DatabaseService.js";
import { PathResolverService } from "../../runtime/PathResolverService.js";

@injectable()
export class HarnessStore {
  constructor(
    @inject(SYMBOLS.DatabaseService) private readonly dbService: DatabaseService,
    @inject(SYMBOLS.PathResolverService) private readonly pathResolver: PathResolverService
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
      projectMode: String(row.projectMode || "single_agent"),
      singleAgentChannel: String(row.singleAgentChannel || "mcp_ide"),
      modeUpdatedAt: String(row.modeUpdatedAt || ""),
      channelUpdatedAt: String(row.channelUpdatedAt || ""),
      modeUpdatedBy: String(row.modeUpdatedBy || ""),
      channelUpdatedBy: String(row.channelUpdatedBy || ""),
      lastSwitchTraceId: String(row.lastSwitchTraceId || ""),
      lastSwitchRemark: String(row.lastSwitchRemark || "")
    };
  }

  public createHarnessRun(input: {
    runId: string;
    projectId: string;
    traceId: string;
    mode: string;
    channel: string;
    intent: string;
    payload: any;
    startedAt?: string;
  }) {
    const runId = String(input.runId || "").trim();
    const projectId = String(input.projectId || "").trim();
    if (!runId || !projectId) return;
    const startedAt = String(input.startedAt || new Date().toISOString());
    this.db.prepare(`
      INSERT INTO harness_runs(
        run_id, project_id, trace_id, mode, channel, intent, status, input_payload, started_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      runId,
      projectId,
      String(input.traceId || ""),
      String(input.mode || ""),
      String(input.channel || ""),
      String(input.intent || ""),
      "running",
      JSON.stringify(input.payload || {}),
      startedAt
    );
  }

  public completeHarnessRun(input: {
    runId: string;
    status: "succeeded" | "failed";
    outputPayload?: any;
    errorCode?: string;
    errorMessage?: string;
    endedAt?: string;
  }) {
    const runId = String(input.runId || "").trim();
    if (!runId) return;
    this.db.prepare(`
      UPDATE harness_runs
      SET status = ?, output_payload = ?, error_code = ?, error_message = ?, ended_at = ?
      WHERE run_id = ?
    `).run(
      String(input.status || "failed"),
      JSON.stringify(input.outputPayload || {}),
      String(input.errorCode || ""),
      String(input.errorMessage || ""),
      String(input.endedAt || new Date().toISOString()),
      runId
    );
  }

  public runInTransaction<T>(operation: () => T): T {
    this.db.exec("BEGIN TRANSACTION");
    try {
      const result = operation();
      this.db.exec("COMMIT");
      return result;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  public appendHarnessStep(input: {
    runId: string;
    traceId: string;
    projectId: string;
    layer: string;
    eventType: string;
    confidence: string;
    payload: any;
    createdAt?: string;
  }) {
    const runId = String(input.runId || "").trim();
    if (!runId) return;
    this.db.prepare(`
      INSERT INTO harness_steps(
        step_id, run_id, trace_id, project_id, layer, event_type, confidence, payload, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      runId,
      String(input.traceId || ""),
      String(input.projectId || ""),
      String(input.layer || ""),
      String(input.eventType || ""),
      String(input.confidence || "high"),
      JSON.stringify(input.payload || {}),
      String(input.createdAt || new Date().toISOString())
    );
  }

  public listHarnessStepsByTrace(traceId: string, limit: number = 200, offset: number = 0): any[] {
    const id = String(traceId || "").trim();
    if (!id) return [];
    const rows = this.db.prepare(`
      SELECT run_id, trace_id, project_id, layer, event_type, confidence, payload, created_at
      FROM harness_steps
      WHERE trace_id = ?
      ORDER BY created_at ASC
      LIMIT ?
      OFFSET ?
    `).all(id, Math.max(1, Math.min(1000, limit)), Math.max(0, Math.floor(offset))) as any[];
    return rows.map((x) => ({
      runId: String(x.run_id || ""),
      traceId: String(x.trace_id || ""),
      projectId: String(x.project_id || ""),
      layer: String(x.layer || ""),
      eventType: String(x.event_type || ""),
      confidence: String(x.confidence || ""),
      payload: this.parseJsonObject(x.payload),
      createdAt: String(x.created_at || "")
    }));
  }

  public listHarnessRuns(projectId: string, limit: number = 50, offset: number = 0): any[] {
    const id = String(projectId || "").trim();
    if (!id) return [];
    const rows = this.db.prepare(`
      SELECT run_id, project_id, trace_id, mode, channel, intent, status, input_payload, output_payload, error_code, error_message, started_at, ended_at
      FROM harness_runs
      WHERE project_id = ?
      ORDER BY started_at DESC
      LIMIT ?
      OFFSET ?
    `).all(id, Math.max(1, Math.min(500, limit)), Math.max(0, Math.floor(offset))) as any[];
    return rows.map((x) => ({
      runId: String(x.run_id || ""),
      projectId: String(x.project_id || ""),
      traceId: String(x.trace_id || ""),
      mode: String(x.mode || ""),
      channel: String(x.channel || ""),
      intent: String(x.intent || ""),
      status: String(x.status || ""),
      inputPayload: this.parseJsonObject(x.input_payload),
      outputPayload: this.parseJsonObject(x.output_payload),
      errorCode: String(x.error_code || ""),
      errorMessage: String(x.error_message || ""),
      startedAt: String(x.started_at || ""),
      endedAt: String(x.ended_at || "")
    }));
  }

  public appendHarnessEvalReport(input: {
    evalId: string;
    projectId: string;
    mode: string;
    channel: string;
    traceId: string;
    totalCases: number;
    passedCases: number;
    successRate: number;
    reportPayload: any;
    createdAt?: string;
  }) {
    const evalId = String(input.evalId || "").trim();
    if (!evalId) return;
    this.db.prepare(`
      INSERT INTO harness_eval_reports(
        eval_id, project_id, mode, channel, trace_id, total_cases, passed_cases, success_rate, report_payload, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      evalId,
      String(input.projectId || ""),
      String(input.mode || ""),
      String(input.channel || ""),
      String(input.traceId || ""),
      Number(input.totalCases || 0),
      Number(input.passedCases || 0),
      Number(input.successRate || 0),
      JSON.stringify(input.reportPayload || {}),
      String(input.createdAt || new Date().toISOString())
    );
  }

  public readHarnessEvalReport(evalId: string): any | null {
    const id = String(evalId || "").trim();
    if (!id) return null;
    const row = this.db.prepare(`SELECT * FROM harness_eval_reports WHERE eval_id = ? LIMIT 1`).get(id) as any;
    if (!row) return null;
    return {
      evalId: String(row.eval_id || ""),
      projectId: String(row.project_id || ""),
      mode: String(row.mode || ""),
      channel: String(row.channel || ""),
      traceId: String(row.trace_id || ""),
      totalCases: Number(row.total_cases || 0),
      passedCases: Number(row.passed_cases || 0),
      successRate: Number(row.success_rate || 0),
      reportPayload: this.parseJsonObject(row.report_payload),
      createdAt: String(row.created_at || "")
    };
  }

  public appendHarnessReplayRecord(input: {
    replayId: string;
    projectId: string;
    sourceTraceId: string;
    policyVersion?: string;
    replayPayload: any;
    createdAt?: string;
  }) {
    const replayId = String(input.replayId || "").trim();
    if (!replayId) return;
    this.db.prepare(`
      INSERT INTO harness_replay_records(
        replay_id, project_id, source_trace_id, policy_version, replay_payload, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      replayId,
      String(input.projectId || ""),
      String(input.sourceTraceId || ""),
      String(input.policyVersion || ""),
      JSON.stringify(input.replayPayload || {}),
      String(input.createdAt || new Date().toISOString())
    );
  }

  public readHarnessReplayRecord(replayId: string): any | null {
    const id = String(replayId || "").trim();
    if (!id) return null;
    const row = this.db.prepare(`SELECT * FROM harness_replay_records WHERE replay_id = ? LIMIT 1`).get(id) as any;
    if (!row) return null;
    return {
      replayId: String(row.replay_id || ""),
      projectId: String(row.project_id || ""),
      sourceTraceId: String(row.source_trace_id || ""),
      policyVersion: String(row.policy_version || ""),
      replayPayload: this.parseJsonObject(row.replay_payload),
      createdAt: String(row.created_at || "")
    };
  }

  public appendHarnessGateResult(input: {
    gateId: string;
    evalId: string;
    projectId: string;
    passed: boolean;
    score: number;
    reason?: string;
    resultPayload: any;
    createdAt?: string;
  }) {
    const gateId = String(input.gateId || "").trim();
    if (!gateId) return;
    this.db.prepare(`
      INSERT INTO harness_gate_results(
        gate_id, eval_id, project_id, passed, score, reason, result_payload, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      gateId,
      String(input.evalId || ""),
      String(input.projectId || ""),
      input.passed ? 1 : 0,
      Number(input.score || 0),
      String(input.reason || ""),
      JSON.stringify(input.resultPayload || {}),
      String(input.createdAt || new Date().toISOString())
    );
  }

  public appendHarnessMetric(input: {
    runId: string;
    projectId: string;
    traceId: string;
    metricName: string;
    metricValue: number;
    metricPayload?: any;
    createdAt?: string;
  }) {
    const runId = String(input.runId || "").trim();
    if (!runId) return;
    this.db.prepare(`
      INSERT INTO harness_metrics(
        metric_id, run_id, project_id, trace_id, metric_name, metric_value, metric_payload, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      runId,
      String(input.projectId || ""),
      String(input.traceId || ""),
      String(input.metricName || ""),
      Number(input.metricValue || 0),
      JSON.stringify(input.metricPayload || {}),
      String(input.createdAt || new Date().toISOString())
    );
  }

  public listHarnessMetrics(input: {
    projectId: string;
    traceId?: string;
    limit?: number;
    offset?: number;
  }): any[] {
    const projectId = String(input.projectId || "").trim();
    if (!projectId) return [];
    const traceId = String(input.traceId || "").trim();
    const limit = Math.max(1, Math.min(1000, Number(input.limit || 100)));
    const offset = Math.max(0, Math.floor(Number(input.offset || 0)));
    const byTrace = traceId.length > 0;
    const rows = byTrace
      ? this.db.prepare(`
        SELECT metric_id, run_id, project_id, trace_id, metric_name, metric_value, metric_payload, created_at
        FROM harness_metrics
        WHERE project_id = ? AND trace_id = ?
        ORDER BY created_at DESC
        LIMIT ?
        OFFSET ?
      `).all(projectId, traceId, limit, offset) as any[]
      : this.db.prepare(`
        SELECT metric_id, run_id, project_id, trace_id, metric_name, metric_value, metric_payload, created_at
        FROM harness_metrics
        WHERE project_id = ?
        ORDER BY created_at DESC
        LIMIT ?
        OFFSET ?
      `).all(projectId, limit, offset) as any[];
    return rows.map((x) => ({
      metricId: String(x.metric_id || ""),
      runId: String(x.run_id || ""),
      projectId: String(x.project_id || ""),
      traceId: String(x.trace_id || ""),
      metricName: String(x.metric_name || ""),
      metricValue: Number(x.metric_value || 0),
      metricPayload: this.parseJsonObject(x.metric_payload),
      createdAt: String(x.created_at || "")
    }));
  }

  public appendHarnessFailure(input: {
    runId: string;
    projectId: string;
    traceId: string;
    errorCode: string;
    errorClass: string;
    failureStage: string;
    failurePayload?: any;
    createdAt?: string;
  }) {
    const runId = String(input.runId || "").trim();
    if (!runId) return;
    this.db.prepare(`
      INSERT INTO harness_failures(
        failure_id, run_id, project_id, trace_id, error_code, error_class, failure_stage, failure_payload, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      runId,
      String(input.projectId || ""),
      String(input.traceId || ""),
      String(input.errorCode || ""),
      String(input.errorClass || "E_UNKNOWN"),
      String(input.failureStage || ""),
      JSON.stringify(input.failurePayload || {}),
      String(input.createdAt || new Date().toISOString())
    );
  }

  public listHarnessFailures(input: {
    projectId: string;
    traceId?: string;
    limit?: number;
    offset?: number;
  }): any[] {
    const projectId = String(input.projectId || "").trim();
    if (!projectId) return [];
    const traceId = String(input.traceId || "").trim();
    const limit = Math.max(1, Math.min(1000, Number(input.limit || 100)));
    const offset = Math.max(0, Math.floor(Number(input.offset || 0)));
    const byTrace = traceId.length > 0;
    const rows = byTrace
      ? this.db.prepare(`
        SELECT failure_id, run_id, project_id, trace_id, error_code, error_class, failure_stage, failure_payload, created_at
        FROM harness_failures
        WHERE project_id = ? AND trace_id = ?
        ORDER BY created_at DESC
        LIMIT ?
        OFFSET ?
      `).all(projectId, traceId, limit, offset) as any[]
      : this.db.prepare(`
        SELECT failure_id, run_id, project_id, trace_id, error_code, error_class, failure_stage, failure_payload, created_at
        FROM harness_failures
        WHERE project_id = ?
        ORDER BY created_at DESC
        LIMIT ?
        OFFSET ?
      `).all(projectId, limit, offset) as any[];
    return rows.map((x) => ({
      failureId: String(x.failure_id || ""),
      runId: String(x.run_id || ""),
      projectId: String(x.project_id || ""),
      traceId: String(x.trace_id || ""),
      errorCode: String(x.error_code || ""),
      errorClass: String(x.error_class || ""),
      failureStage: String(x.failure_stage || ""),
      failurePayload: this.parseJsonObject(x.failure_payload),
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
