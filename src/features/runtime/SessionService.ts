import { injectable, inject } from "inversify";
import fs from "node:fs/promises";
import path from "node:path";
import { FileHelper } from "./FileHelper.js";
import { SYMBOLS } from "../../common/di/symbols.js";
import { LoggerService } from "./LoggerService.js";

@injectable()
export class SessionService {
  public readonly sessionId: string;
  private dataDir: string = "";

  constructor(
    @inject(SYMBOLS.LoggerService) private readonly logger: LoggerService
  ) {
    this.sessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  async initialize(baseDir: string) {
    this.dataDir = path.join(baseDir, "system", "logs");
    await FileHelper.ensureDir(this.dataDir);
    this.logger.info("SYSTEM", `Session Initialized: ${this.sessionId}`);
  }

  async trace(source: string, message: any) {
    this.logger.info(source, typeof message === "string" ? message : JSON.stringify(message));
  }

  async log(level: string, message: string) {
    const lvl = level.toUpperCase();
    if (lvl === "ERROR") this.logger.error("SESSION", message);
    else if (lvl === "WARN") this.logger.warn("SESSION", message);
    else this.logger.info("SESSION", message);
  }

  async touch() {
    // Simplified: no longer need to physically touch separate session files, handled by LoggerService
  }

  finalizeSync() {
    // Simplified: no longer need to sync meta
  }
}

