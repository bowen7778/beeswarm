import { injectable, inject } from "inversify";
import { randomUUID } from "node:crypto";
import { IMFacade } from "../../im/facade/IMFacade.js";
import { MessageManagerStore } from "./MessageManagerStore.js";
import { RoutingKernelService } from "./RoutingKernelService.js";
import { SYMBOLS } from "../../../common/di/symbols.js";
import { SessionContext } from "../../../common/context/SessionContext.js";
import { LoggerService } from "../../runtime/LoggerService.js";
import { MessageEvents } from "./MessageEvents.js";
import { IMPluginRegistry } from "../../im/IMPluginRegistry.js";
import { ProjectStore } from "../stores/ProjectStore.js";
import { StreamSnapshotService } from "../../runtime/sse/StreamSnapshotService.js";

/**
 * Service for managing the message outbox and background delivery to IM.
 */
@injectable()
export class MessageOutboxService {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly maxAttempts = 5;
  private lastSentAt = "";
  private lastSentId = "";

  constructor(
    @inject(SYMBOLS.IMFacade) private readonly imService: IMFacade,
    @inject(SYMBOLS.MessageManagerStore) private readonly manager: MessageManagerStore,
    @inject(SYMBOLS.ProjectStore) private readonly projectStore: ProjectStore,
    @inject(SYMBOLS.IMPluginRegistry) private readonly pluginRegistry: IMPluginRegistry,
    @inject(SYMBOLS.LoggerService) private readonly logger: LoggerService,
    @inject(SYMBOLS.MessageEvents) private readonly events: MessageEvents,
    @inject(SYMBOLS.StreamSnapshotService) private readonly streamSnapshotService: StreamSnapshotService
  ) {}

  public initialize(baseDir: string) {}
  
  private backoffMs(attempt: number): number { 
    return Math.min(30000, 1000 * Math.max(1, 2 ** Math.max(0, attempt - 1))); 
  }

  /**
   * Enqueue an interactive message for delivery.
   */
  enqueueIMInteractive(content: string, source: string, meta?: { traceId?: string; conversationId?: string }): string {
    const id = randomUUID();
    this.manager.enqueueOutbox({ 
      id, 
      kind: "interactive", 
      content, 
      source, 
      traceId: meta?.traceId, 
      conversationId: meta?.conversationId 
    });
    this.events.emitOutboxUpdated();
    if (source === "ask_question") {
      setImmediate(() => { void this.tick(); });
    }
    return id;
  }

  /**
   * Enqueue a text message for delivery.
   */
  enqueueIMText(text: string, source: string, meta?: { traceId?: string; conversationId?: string }): string {
    const id = randomUUID();
    this.manager.enqueueOutbox({ 
      id, 
      kind: "im_text", 
      content: text, 
      source, 
      traceId: meta?.traceId, 
      conversationId: meta?.conversationId 
    });
    this.events.emitOutboxUpdated();
    return id;
  }

  async start(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => { void this.tick(); }, 5000);
  }
  
  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Periodic task to process pending outbox entries for all projects.
   */
  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const projects = this.projectStore.listProjects();
      for (const project of projects) {
        if (!project.projectRoot) continue;
        await SessionContext.run({ projectRoot: project.projectRoot }, async () => {
          try {
            if (!this.manager.isProjectInitialized()) return;
            const pending = this.manager.getPendingOutbox(5);
            for (const entry of pending) {
              await this.processEntry(entry);
            }
          } catch (e: any) {
            if (e.message?.includes("no such table: outbox") || e.message?.includes("Security violation")) return;
            this.logger.error("OUTBOX", `Tick failed for ${project.projectRoot}`, e);
          }
        });
      }
    } finally {
      this.running = false;
    }
  }

  /**
   * Process a single outbox entry and deliver it to active IM providers.
   */
  private async processEntry(entry: any): Promise<void> {
    try {
      const routing = new RoutingKernelService(this.manager, this.logger);
      const activeProviders = this.pluginRegistry.listAll();
      const config = await this.imService.readConfig();
      let sentCount = 0;
      let lastError = "";
      for (const provider of activeProviders) {
        const pluginConfig = config.plugins[provider.providerId];
        if (!pluginConfig || !pluginConfig.enabled) continue;
        
        // Core fix: lazy routing and auto group creation
        let chatId = routing.resolveOutboundChatId(entry.conversation_id || "", provider.providerId);
        
        // If no chatId is resolved and provider supports auto group creation
        if (!chatId && typeof provider.createOrBindGroup === "function") {
          const project = this.projectStore.readProjectById(entry.conversation_id || "");
          if (project) {
            try {
              this.logger.info("OUTBOX", `[${provider.providerId}] Attempting lazy group creation for project: ${project.projectName}`);
              const res = await provider.createOrBindGroup({
                projectId: project.projectId,
                projectName: project.projectName,
                credentials: pluginConfig.credentials,
                routingPolicy: pluginConfig.routingPolicy || {}
              });
              if (res.chatId) {
                chatId = res.chatId;
                // Bind route to ensure next time doesn't trigger creation
                routing.bindConversationChatRoute(project.projectId, provider.providerId, chatId);
                // Core fix: explicitly persist binding to the project's .beemcp directory
                await this.imService.bindChatId(chatId, provider.providerId, project.projectRoot);
              }
            } catch (createErr: any) {
              this.logger.warn("OUTBOX", `Lazy group creation failed for ${provider.providerId}: ${createErr.message}`);
            }
          }
        }

        if (!chatId) continue;
        
        // Core fix: for interactive cards, strictly forbid any string concatenation, 
        // as it breaks the JSON structure and causes Feishu parsing failure.
        let finalContent = entry.content;
        if (entry.kind !== "interactive") {
          if (entry.source === "mcp_reply") {
            finalContent += "\n\n---\n🤖 *Source: AI Assistant*";
          } else if (entry.source === "ui_send") {
            finalContent += "\n\n---\n💬 *Source: Desktop App Reply*";
          }
        }

        try {
          const sendResult = await this.imService.sendMessage(provider.providerId, provider, finalContent, { 
            chatId,
            kind: entry.kind, // Pass message kind (text/interactive)
            projectId: entry.conversation_id 
          } as any);
          sentCount++;
          
          // If group self-healing occurred during send (new group created), sync route and binding
          if (sendResult && sendResult.chatId && sendResult.chatId !== chatId) {
            const project = this.projectStore.readProjectById(entry.conversation_id || "");
            if (project) {
              this.logger.info("OUTBOX", `[${provider.providerId}] Group healed during send. Updating route to new chatId: ${sendResult.chatId}`);
              routing.bindConversationChatRoute(project.projectId, provider.providerId, sendResult.chatId);
              await this.imService.bindChatId(sendResult.chatId, provider.providerId, project.projectRoot);
            }
          }
        } catch (err: any) {
          lastError = `[${provider.providerId}] ${err.message}`;
        }
      }
      if (sentCount > 0) {
        this.manager.updateOutboxStatus(entry.id, "sent", entry.attempts + 1, 0, lastError);
        this.lastSentAt = new Date().toISOString();
        this.lastSentId = entry.id;
        this.events.emitOutboxUpdated();
      } else {
        throw new Error(lastError || "NO_ACTIVE_PLUGINS_OR_ROUTES");
      }
    } catch (err: any) {
      const attempts = entry.attempts + 1;
      const status = attempts >= this.maxAttempts ? "dead" : "pending";
      const nextRunAt = status === "pending" ? Date.now() + this.backoffMs(attempts) : 0;
      this.manager.updateOutboxStatus(entry.id, status, attempts, nextRunAt, err?.message || "unknown_error");
      this.events.emitOutboxUpdated();

      // Core fix: when message becomes dead, notify the frontend via SSE, 
      // otherwise UI might stay in a loading state.
      if (status === "dead" && entry.conversation_id) {
        try {
          const project = this.projectStore.readProjectById(entry.conversation_id);
          const root = project?.projectRoot || project?.project_root;
          if (root) {
            this.streamSnapshotService.markDirtyAndPush(root);
          }
        } catch (e) {
          this.logger.error("OUTBOX", "Failed to notify frontend for dead message", e);
        }
      }
    }
  }

  /**
   * List dead letter messages across all projects.
   */
  listDead(limit: number = 20, source?: string): any[] {
    const projectRoot = SessionContext.projectRoot;
    if (projectRoot) return this.manager.listOutboxDead(limit, source);
    const allItems: any[] = [];
    const projects = this.projectStore.listProjects();
    for (const project of projects) {
      const root = project.project_root || project.projectRoot;
      if (!root) continue;
      try {
        const items = SessionContext.run({ projectRoot: root }, () => {
          if (!this.manager.isProjectInitialized()) return [];
          return this.manager.listOutboxDead(limit, source);
        });
        allItems.push(...items.map(it => ({ ...it, projectName: project.project_name || project.projectName, projectId: project.project_id || project.projectId })));
      } catch {}
    }
    return allItems.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()).slice(0, limit);
  }

  /**
   * Replay a single dead letter message.
   */
  replayDead(id: string): boolean {
    const projectRoot = SessionContext.projectRoot;
    if (projectRoot) return this.manager.replayOutboxDead(id);
    const projects = this.projectStore.listProjects();
    for (const project of projects) {
      const root = project.project_root || project.projectRoot;
      if (!root) continue;
      try {
        const ok = SessionContext.run({ projectRoot: root }, () => {
          if (!this.manager.isProjectInitialized()) return false;
          return this.manager.replayOutboxDead(id);
        });
        if (ok) return true;
      } catch {}
    }
    return false;
  }

  /**
   * Count replayable dead letter messages.
   */
  countReplayableDead(limit: number = 20, source?: string): number {
    const projectRoot = SessionContext.projectRoot;
    if (projectRoot) return this.manager.countReplayableDead(limit, source);
    let total = 0;
    const projects = this.projectStore.listProjects();
    for (const project of projects) {
      const root = project.project_root || project.projectRoot;
      if (!root) continue;
      try {
        total += SessionContext.run({ projectRoot: root }, () => {
          if (!this.manager.isProjectInitialized()) return 0;
          return this.manager.countReplayableDead(limit, source);
        });
      } catch {}
    }
    return total;
  }

  /**
   * Replay a batch of dead letter messages.
   */
  replayDeadBatch(limit: number = 20, source?: string): number {
    const projectRoot = SessionContext.projectRoot;
    if (projectRoot) return this.manager.replayOutboxDeadBatch(limit, source);
    let total = 0;
    const projects = this.projectStore.listProjects();
    for (const project of projects) {
      const root = project.project_root || project.projectRoot;
      if (!root) continue;
      try {
        total += SessionContext.run({ projectRoot: root }, () => {
          if (!this.manager.isProjectInitialized()) return 0;
          return this.manager.replayOutboxDeadBatch(limit, source);
        });
      } catch {}
    }
    return total;
  }

  /**
   * Preview messages to be replayed.
   */
  previewReplay(limit: number = 20, source?: string): { items: any[]; count: number } {
    const projectRoot = SessionContext.projectRoot;
    if (projectRoot) return this.manager.previewOutboxReplay(limit, source);
    const allItems: any[] = [];
    let totalCount = 0;
    const projects = this.projectStore.listProjects();
    for (const project of projects) {
      const root = project.project_root || project.projectRoot;
      if (!root) continue;
      try {
        const res = SessionContext.run({ projectRoot: root }, () => {
          if (!this.manager.isProjectInitialized()) return { items: [], count: 0 };
          return this.manager.previewOutboxReplay(limit, source);
        });
        allItems.push(...res.items.map(it => ({ ...it, projectName: project.project_name || project.projectName, projectId: project.project_id || project.projectId })));
        totalCount += res.count;
      } catch {}
    }
    return { items: allItems.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()).slice(0, limit), count: totalCount };
  }

  /**
   * List outbox audit logs across all projects.
   */
  async listAudit(limit: number = 50, source?: string, action?: string): Promise<any[]> {
    const projectRoot = SessionContext.projectRoot;
    if (projectRoot) return this.manager.listOutboxAudit(limit, source, action);
    const allItems: any[] = [];
    const projects = this.projectStore.listProjects();
    for (const project of projects) {
      const root = project.project_root || project.projectRoot;
      if (!root) continue;
      try {
        const items = SessionContext.run({ projectRoot: root }, () => {
          if (!this.manager.isProjectInitialized()) return [];
          return this.manager.listOutboxAudit(limit, source, action);
        });
        allItems.push(...items.map(it => ({ ...it, projectName: project.project_name || project.projectName, projectId: project.project_id || project.projectId })));
      } catch {}
    }
    return allItems.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()).slice(0, limit);
  }

  /**
   * Get overall outbox status and alert level.
   */
  status() {
    const projectRoot = SessionContext.projectRoot;
    let pending = 0;
    let dead = 0;
    let alertLevel = "normal";
    if (projectRoot) {
      try {
        const rows = this.manager.getOutboxMetrics();
        pending = rows.pending || 0;
        dead = rows.dead || 0;
      } catch {}
    } else {
      const projects = this.projectStore.listProjects();
      for (const project of projects) {
        const root = project.project_root || project.projectRoot;
        if (!root) continue;
        try {
          const rows = SessionContext.run({ projectRoot: root }, () => {
            if (!this.manager.isProjectInitialized()) return { pending: 0, dead: 0 };
            return this.manager.getOutboxMetrics();
          });
          pending += (rows.pending || 0);
          dead += (rows.dead || 0);
        } catch {}
      }
    }
    if (dead > 0) alertLevel = "critical";
    else if (pending > 50) alertLevel = "warning";
    return { alertLevel, pending, dead, lastSentAt: this.lastSentAt, lastSentId: this.lastSentId };
  }
}
