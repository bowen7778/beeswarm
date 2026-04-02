import { injectable, inject } from "inversify";
import fs from "node:fs";
import path from "node:path";
import { SYMBOLS } from "../../common/di/symbols.js";
import { PathResolverService } from "./PathResolverService.js";
import { MessageEvents, LogEntry } from "../mcp/message/MessageEvents.js";

/**
 * Log levels for the application.
 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

/**
 * Service for managing application logging, including file persistence and event broadcasting.
 */
@injectable()
export class LoggerService {
  private level: LogLevel = LogLevel.INFO;
  private readonly buffer: LogEntry[] = [];
  private readonly maxBufferSize = 2000;
  private logFile: string | null = null;
  private stderrAvailable = true;

  constructor(
    @inject(SYMBOLS.PathResolverService) private readonly pathResolver: PathResolverService,
    @inject(SYMBOLS.MessageEvents) private readonly events: MessageEvents
  ) {
    this.initLogFile();
  }

  /**
   * Initialize the log file with a local timestamped filename.
   */
  private initLogFile() {
    try {
      const logDir = this.pathResolver.logsDir;
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }
      
      // Use local time instead of UTC for filename to avoid date lag issues
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const dateStr = `${year}-${month}-${day}`;
      
      this.logFile = path.join(logDir, `app-${dateStr}.log`);
      this.writeToFile(`[${new Date().toISOString()}] [INFO] [SYSTEM] Persistent logging initialized at: ${this.logFile}\n`);
    } catch (err) {
      this.logFile = null;
      console.error("[LoggerService] Failed to initialize log file:", err);
    }
  }

  /**
   * Set the current log level.
   */
  setLevel(level: LogLevel) {
    this.level = level;
  }

  /**
   * Append a log entry to the buffer, file, and broadcast it.
   */
  private append(level: string, module: string, message: string, error?: any) {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      module: module.toUpperCase(),
      message
    };
    if (error) entry.error = error;
    
    this.buffer.push(entry);
    if (this.buffer.length > this.maxBufferSize) {
      this.buffer.shift();
    }

    // Trigger event-driven flow
    this.events.emitLog(entry);

    // Physical file persistence
    if (this.logFile) {
      const errStr = error ? (error instanceof Error ? `\n${error.stack}` : `\n${JSON.stringify(error)}`) : "";
      const line = `[${entry.timestamp}] [${level}] [${entry.module}] ${message}${errStr}\n`;
      this.writeToFile(line);
    }
  }

  /**
   * Write a line to the log file.
   */
  private writeToFile(line: string) {
    if (!this.logFile) return;

    try {
      fs.appendFileSync(this.logFile, line, "utf-8");
    } catch (err) {
      this.logFile = null;
      console.error("[LoggerService] File logging disabled after write failure:", err);
    }
  }

  /**
   * Write a line to stderr.
   */
  private writeToStderr(line: string) {
    if (!this.stderrAvailable) return;

    try {
      process.stderr.write(line);
    } catch {
      this.stderrAvailable = false;
    }
  }

  /**
   * Get recent logs from the buffer.
   */
  getRecentLogs(limit: number = 100, module?: string): LogEntry[] {
    let logs = this.buffer;
    if (module) {
      const m = module.toUpperCase();
      logs = logs.filter(l => l.module === m);
    }
    return logs.slice(-limit);
  }

  /**
   * Log a debug message.
   */
  debug(module: any, message?: any, ...args: any[]) {
    if (this.level <= LogLevel.DEBUG) {
      const mod = String(module || "SYSTEM");
      const msg = String(message || "");
      this.append("DEBUG", mod, msg);
      this.writeToStderr(`[DEBUG] [${mod.toUpperCase()}] ${msg} ${args.length ? JSON.stringify(args) : ""}\n`);
    }
  }

  /**
   * Log an info message.
   */
  info(module: any, message?: any, ...args: any[]) {
    if (this.level <= LogLevel.INFO) {
      const mod = String(module || "SYSTEM");
      const msg = String(message || "");
      this.append("INFO", mod, msg);
      this.writeToStderr(`[INFO] [${mod.toUpperCase()}] ${msg} ${args.length ? JSON.stringify(args) : ""}\n`);
    }
  }

  /**
   * Log a warning message.
   */
  warn(module: any, message?: any, ...args: any[]) {
    if (this.level <= LogLevel.WARN) {
      const mod = String(module || "SYSTEM");
      const msg = String(message || "");
      this.append("WARN", mod, msg);
      this.writeToStderr(`[WARN] [${mod.toUpperCase()}] ${msg} ${args.length ? JSON.stringify(args) : ""}\n`);
    }
  }

  /**
   * Log an error message.
   */
  error(module: any, message?: any, error?: any) {
    if (this.level <= LogLevel.ERROR) {
      const mod = String(module || "SYSTEM");
      const msg = String(message || "");
      this.append("ERROR", mod, msg, error);
      const errStr = error ? (error instanceof Error ? `\n${error.stack}` : `\n${JSON.stringify(error)}`) : "";
      this.writeToStderr(`[ERROR] [${mod.toUpperCase()}] ${msg}${errStr}\n`);
    }
  }
}
