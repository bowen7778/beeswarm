import { injectable, inject } from "inversify";
import { MessageOutboxService } from "../mcp/message/MessageOutboxService.js";
import { StreamSnapshotService } from "./sse/StreamSnapshotService.js";
import { SYMBOLS } from "../../common/di/symbols.js";
import { IMPluginRegistry } from "../im/IMPluginRegistry.js";

@injectable()
export class IMRuntimeOrchestrator {
  private snapshotTicker: NodeJS.Timeout | null = null;

  constructor(
    @inject(SYMBOLS.StreamSnapshotService) private readonly streamService: StreamSnapshotService,
    @inject(SYMBOLS.MessageOutboxService) private readonly outbox: MessageOutboxService,
    @inject(SYMBOLS.IMPluginRegistry) private readonly pluginRegistry: IMPluginRegistry
  ) {}

  async start(): Promise<void> {
    if (this.snapshotTicker) {
      clearInterval(this.snapshotTicker);
    }
    // Note: snapshotTicker here only handles snapshots for global state (system logs, etc.)
    this.snapshotTicker = await this.streamService.startSnapshotTicker();
    
    // Start global Outbox scanner (it will automatically traverse all projects in Hub)
    void this.outbox.start();
    
    // Start all enabled IM plugins (lifecycle of long connections etc. managed by plugins themselves)
    void this.pluginRegistry.startAll();
  }

  async stop(): Promise<void> {
    if (this.snapshotTicker) {
      clearInterval(this.snapshotTicker);
      this.snapshotTicker = null;
    }
    try {
      await this.outbox.stop();
      await this.pluginRegistry.stopAll();
    } catch (err) {
      // Ignore errors during stop
    }
  }

  async restartPlugin(providerId: string): Promise<void> {
    const provider = this.pluginRegistry.getProvider(providerId);
    if (!provider) {
      throw new Error(`IM_PROVIDER_NOT_FOUND:${providerId}`);
    }
    if (typeof provider.stop === "function") {
      await provider.stop();
    }
    if (typeof provider.start === "function") {
      await provider.start();
    }
  }
}

