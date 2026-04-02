import { injectable, inject } from "inversify";
import { SYMBOLS } from "../../common/di/symbols.js";
import type { DatabaseService } from "./DatabaseService.js";
import type { LoggerService } from "./LoggerService.js";
import type { DatabaseSync } from "node:sqlite";

export interface Migration {
  version: number;
  description: string;
  up: string;
}

/**
 * Database Migration Scopes
 */
export type MigrationScope = "HUB" | "PROJECT";

@injectable()
export class MigrationService {
  // Hub Database Migrations (Global)
  private readonly hubMigrations: Migration[] = [
    {
      version: 1,
      description: "Initialize Hub metadata and basic structure",
      up: `
        CREATE TABLE IF NOT EXISTS _schema_metadata (key TEXT PRIMARY KEY, value TEXT);
        INSERT OR IGNORE INTO _schema_metadata (key, value) VALUES ('version', '0');
      `
    },
    {
      version: 2,
      description: "Initialize Hub project mode audit table",
      up: `
        CREATE TABLE IF NOT EXISTS project_mode_audits (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          action TEXT NOT NULL,
          from_value TEXT NOT NULL DEFAULT '',
          to_value TEXT NOT NULL DEFAULT '',
          operator TEXT NOT NULL DEFAULT '',
          trace_id TEXT NOT NULL DEFAULT '',
          remark TEXT NOT NULL DEFAULT '',
          result TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_project_mode_audits_project ON project_mode_audits(project_id, created_at);
      `
    },
    {
      version: 3,
      description: "Initialize Hub harness and memory tables",
      up: `
        CREATE TABLE IF NOT EXISTS harness_runs (
          run_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, trace_id TEXT NOT NULL,
          mode TEXT NOT NULL, channel TEXT NOT NULL, intent TEXT NOT NULL,
          status TEXT NOT NULL, input_payload TEXT NOT NULL DEFAULT '{}',
          output_payload TEXT NOT NULL DEFAULT '{}', error_code TEXT NOT NULL DEFAULT '',
          error_message TEXT NOT NULL DEFAULT '', started_at TEXT NOT NULL, ended_at TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS harness_steps (
          step_id TEXT PRIMARY KEY, run_id TEXT NOT NULL, trace_id TEXT NOT NULL,
          project_id TEXT NOT NULL, layer TEXT NOT NULL, event_type TEXT NOT NULL,
          confidence TEXT NOT NULL DEFAULT 'high', payload TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS harness_eval_reports (
          eval_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, mode TEXT NOT NULL, channel TEXT NOT NULL,
          trace_id TEXT NOT NULL DEFAULT '', total_cases INTEGER NOT NULL DEFAULT 0,
          passed_cases INTEGER NOT NULL DEFAULT 0, success_rate REAL NOT NULL DEFAULT 0,
          report_payload TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS harness_replay_records (
          replay_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, source_trace_id TEXT NOT NULL,
          policy_version TEXT NOT NULL DEFAULT '', replay_payload TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS harness_gate_results (
          gate_id TEXT PRIMARY KEY, eval_id TEXT NOT NULL, project_id TEXT NOT NULL,
          passed INTEGER NOT NULL DEFAULT 0, score REAL NOT NULL DEFAULT 0,
          reason TEXT NOT NULL DEFAULT '', result_payload TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS harness_metrics (
          metric_id TEXT PRIMARY KEY, run_id TEXT NOT NULL, project_id TEXT NOT NULL,
          trace_id TEXT NOT NULL, metric_name TEXT NOT NULL, metric_value REAL NOT NULL DEFAULT 0,
          metric_payload TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS harness_failures (
          failure_id TEXT PRIMARY KEY, run_id TEXT NOT NULL, project_id TEXT NOT NULL,
          trace_id TEXT NOT NULL, error_code TEXT NOT NULL DEFAULT '',
          error_class TEXT NOT NULL DEFAULT 'E_UNKNOWN',
          failure_stage TEXT NOT NULL DEFAULT '',
          failure_payload TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS memory_facts (
          fact_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, fact_key TEXT NOT NULL,
          fact_value TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT '',
          confidence REAL NOT NULL DEFAULT 0.5, trace_id TEXT NOT NULL DEFAULT '',
          updated_at TEXT NOT NULL, created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS memory_events (
          event_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, trace_id TEXT NOT NULL,
          event_type TEXT NOT NULL, event_payload TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_harness_runs_project_created ON harness_runs(project_id, started_at);
        CREATE INDEX IF NOT EXISTS idx_harness_steps_run_created ON harness_steps(run_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_harness_eval_reports_project ON harness_eval_reports(project_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_harness_replay_records_project ON harness_replay_records(project_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_harness_gate_results_eval ON harness_gate_results(eval_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_harness_metrics_run ON harness_metrics(run_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_harness_failures_run ON harness_failures(run_id, created_at);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_facts_project_key ON memory_facts(project_id, fact_key);
        CREATE INDEX IF NOT EXISTS idx_memory_events_project_created ON memory_events(project_id, created_at);
      `
    },
    {
      version: 4,
      description: "Initialize core Hub tables: projects, routes, bindings",
      up: `
        CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS projects (
          project_id TEXT PRIMARY KEY, project_name TEXT NOT NULL, project_root TEXT NOT NULL,
          title TEXT NOT NULL DEFAULT '', last_message TEXT NOT NULL DEFAULT '', last_message_at TEXT NOT NULL DEFAULT '',
          message_count INTEGER NOT NULL DEFAULT 0, is_archived INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_active_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS project_routes (
          project_id TEXT NOT NULL, channel TEXT NOT NULL, route_key TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
          PRIMARY KEY(channel, route_key), FOREIGN KEY(project_id) REFERENCES projects(project_id)
        );
        CREATE TABLE IF NOT EXISTS mcp_session_bindings (
          session_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, updated_at TEXT NOT NULL,
          FOREIGN KEY(project_id) REFERENCES projects(project_id)
        );
        CREATE INDEX IF NOT EXISTS idx_projects_last_active ON projects(last_active_at);
        CREATE INDEX IF NOT EXISTS idx_project_routes_id ON project_routes(project_id);
        CREATE INDEX IF NOT EXISTS idx_mcp_session_project ON mcp_session_bindings(project_id);
      `
    },
    {
      version: 5,
      description: "Add project mode and channel columns to projects table",
      up: `
        ALTER TABLE projects ADD COLUMN project_mode TEXT NOT NULL DEFAULT 'single_agent';
        ALTER TABLE projects ADD COLUMN single_agent_channel TEXT NOT NULL DEFAULT 'mcp_ide';
        ALTER TABLE projects ADD COLUMN mode_updated_at TEXT NOT NULL DEFAULT '';
        ALTER TABLE projects ADD COLUMN channel_updated_at TEXT NOT NULL DEFAULT '';
        ALTER TABLE projects ADD COLUMN mode_updated_by TEXT NOT NULL DEFAULT '';
        ALTER TABLE projects ADD COLUMN channel_updated_by TEXT NOT NULL DEFAULT '';
        ALTER TABLE projects ADD COLUMN last_switch_trace_id TEXT NOT NULL DEFAULT '';
        ALTER TABLE projects ADD COLUMN last_switch_remark TEXT NOT NULL DEFAULT '';
      `
    }
  ];


  // Project Database Migrations (Per-project private DB)
  private readonly projectMigrations: Migration[] = [
    {
      version: 1,
      description: "Initialize Project database and core tables",
      up: `
        CREATE TABLE IF NOT EXISTS _schema_metadata (key TEXT PRIMARY KEY, value TEXT);
        INSERT OR IGNORE INTO _schema_metadata (key, value) VALUES ('version', '0');
        
        CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY, project_id TEXT NOT NULL DEFAULT '', conversation_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL,
          message_id TEXT NOT NULL DEFAULT '', origin TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, delivered_chat_id TEXT NOT NULL DEFAULT '',
          delivered_message_id TEXT NOT NULL DEFAULT '', FOREIGN KEY(conversation_id) REFERENCES conversations(id)
        );
        CREATE TABLE IF NOT EXISTS ai_replies (
          conversation_id TEXT PRIMARY KEY, content TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY(conversation_id) REFERENCES conversations(id)
        );
        CREATE TABLE IF NOT EXISTS outbox (
          id TEXT PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'im_text', content TEXT NOT NULL, source TEXT NOT NULL, trace_id TEXT, conversation_id TEXT,
          attempts TEXT NOT NULL DEFAULT '0', next_run_at TEXT NOT NULL, last_error TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending',
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS inbound_fingerprints (
          message_key TEXT PRIMARY KEY,
          processed_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_messages_conv_created ON messages(conversation_id, created_at);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_unique_msgid ON messages(message_id) WHERE message_id != '';
        CREATE INDEX IF NOT EXISTS idx_outbox_status_runat ON outbox(status, next_run_at);
      `
    }
  ];

  constructor(
    @inject(SYMBOLS.LoggerService) private readonly logger: LoggerService
  ) {}

  /**
   * Execute database migrations (supports any instance and scope)
   */
  public migrate(db: DatabaseSync, scope: MigrationScope): void {
    const scopeLabel = scope === "HUB" ? "HubDB" : "ProjectDB";
    const migrations = scope === "HUB" ? this.hubMigrations : this.projectMigrations;

    this.logger.info("Database", `[${scopeLabel}] Checking for migrations...`);

    // 1. Ensure _schema_metadata exists
    db.exec(migrations[0].up);

    // 2. Get current version
    const row = db.prepare("SELECT value FROM _schema_metadata WHERE key = 'version'").get() as { value: string };
    let currentVersion = parseInt(row?.value || "0", 10);

    // 3. Execute missing migrations in order
    const pending = migrations.filter(m => m.version > currentVersion);
    if (pending.length === 0) {
      this.logger.info("Database", `[${scopeLabel}] Database is already up to date (v${currentVersion}).`);
      return;
    }

    for (const m of pending) {
      this.logger.info("Database", `[${scopeLabel}] Migrating to v${m.version}: ${m.description}`);
      try {
        db.exec("BEGIN TRANSACTION");
        
        // 分条执行 DDL，以便捕获特定错误（如列已存在）
        const statements = m.up.split(";").map(s => s.trim()).filter(s => s.length > 0);
        for (const sql of statements) {
          try {
            db.exec(sql);
          } catch (stmtErr: any) {
            // 如果是“列已存在”错误，在迁移过程中通常可以安全忽略（说明之前初始化过）
            if (stmtErr.message?.includes("duplicate column name")) {
              this.logger.warn("Database", `[${scopeLabel}] Column already exists, skipping: ${sql.substring(0, 50)}...`);
              continue;
            }
            throw stmtErr;
          }
        }

        db.prepare("UPDATE _schema_metadata SET value = ? WHERE key = 'version'").run(m.version.toString());
        db.exec("COMMIT");
        currentVersion = m.version;
      } catch (err: any) {

        db.exec("ROLLBACK");
        this.logger.error("Database", `[${scopeLabel}] Failed to migrate to v${m.version}`, err);
        throw new Error(`[${scopeLabel}] Migration failed at v${m.version}: ${err.message}`);
      }
    }

    this.logger.info("Database", `[${scopeLabel}] Successfully migrated to v${currentVersion}.`);
  }
}

