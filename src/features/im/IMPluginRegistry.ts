import { injectable, multiInject, inject } from "inversify";
import { SYMBOLS } from "../../common/di/symbols.js";
import type { IMProvider } from "./IMProvider.js";
import { LoggerService } from "../runtime/LoggerService.js";

@injectable()
export class IMPluginRegistry {
  constructor(
    @multiInject(SYMBOLS.IMProvider) private readonly providers: IMProvider[],
    @inject(SYMBOLS.LoggerService) private readonly logger: LoggerService
  ) {}

  public getProvider(id: string): IMProvider | undefined {
    return this.providers.find(p => p.providerId === id);
  }

  public listAll(): IMProvider[] {
    return this.providers;
  }

  public listProviders(): string[] {
    return this.providers.map((p) => p.providerId);
  }

  public async startAll(): Promise<void> {
    this.logger.info("IM", "Starting all enabled IM plugins...");
    for (const p of this.providers) {
      if (typeof p.start === "function") {
        try {
          await p.start();
        } catch (err) {
          this.logger.error("IM", `Failed to start IM plugin: ${p.providerId}`, err);
        }
      }
    }
  }

  public async stopAll(): Promise<void> {
    this.logger.info("IM", "Stopping all IM plugins...");
    for (const p of this.providers) {
      if (typeof p.stop === "function") {
        try {
          await p.stop();
        } catch (err) {
          this.logger.error("IM", `Failed to stop IM plugin: ${p.providerId}`, err);
        }
      }
    }
  }

  public getAllStatus(): Record<string, any> {
    const status: Record<string, any> = {};
    for (const p of this.providers) {
      if (typeof p.status === "function") {
        status[p.providerId] = p.status();
      }
    }
    return status;
  }
}

