import { injectable, inject } from "inversify";
import { VersionManager } from "../../runtime/VersionManager.js";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { ConversationQueryService } from "./ConversationQueryService.js";
import { MessageManagerStore } from "../message/MessageManagerStore.js";
import { ProjectStore } from "../stores/ProjectStore.js";
import { SYMBOLS } from "../../../common/di/symbols.js";
import { PathResolverService } from "../../runtime/PathResolverService.js";
import { LoggerService } from "../../runtime/LoggerService.js";
import { MessageOutboxService } from "../message/MessageOutboxService.js";
import { MessageEvents } from "../message/MessageEvents.js";
import { McpSessionBindingStore } from "../stores/McpSessionBindingStore.js";

@injectable()
export class SessionApplicationService {
  private readonly maxContentLength = 20000;
  private readonly maxAttachments = 8;
  private readonly maxAttachmentBytes = 10 * 1024 * 1024;
  private readonly sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  private outboxService: MessageOutboxService | null = null;

  constructor(
    @inject(SYMBOLS.ConversationQueryService) private readonly conversation: ConversationQueryService,
    @inject(SYMBOLS.MessageManagerStore) private readonly manager: MessageManagerStore,
    @inject(SYMBOLS.ProjectStore) private readonly projectStore: ProjectStore,
    @inject(SYMBOLS.McpSessionBindingStore) private readonly mcpBindingStore: McpSessionBindingStore,
    @inject(SYMBOLS.LoggerService) private readonly logger: LoggerService,
    @inject(SYMBOLS.PathResolverService) private readonly pathResolver: PathResolverService,
    @inject(SYMBOLS.MessageEvents) private readonly events: MessageEvents,
    @inject(SYMBOLS.VersionManager) private readonly versionManager: VersionManager
  ) {}

  public setOutboxService(outbox: MessageOutboxService) {
    this.outboxService = outbox;
  }

  public getInitialWelcomeMessage(projectName: string): string {
    const appName = this.versionManager.appName;
    const prefix = this.versionManager.protocolPrefix;
    return `欢迎使用 ${appName} 智能编排！
项目 [${projectName}] 已成功连接。

你可以直接输入指令，或者让 AI 调用 '${prefix}_orchestrate' 开始工作。`;
  }

  /**
   * List available sessions/projects.
   */
  async listSessions(options?: { limit?: number; activeWithinHours?: number }) {
    const limit = Number.isFinite(Number(options?.limit)) ? Number(options?.limit) : 20;
    const rows = this.projectStore.listProjects().slice(0, Math.max(1, Math.min(100, limit)));
    const connectedIds = new Set(this.mcpBindingStore.listConnectedProjectIds());
    return rows.map((x: any) => ({
      id: String(x.projectId || ""),
      projectId: String(x.projectId || ""),
      title: String(x.projectName || x.projectId || ""),
      workspacePath: String(x.projectRoot || ""),
      activeSessionId: String(x.projectId || ""),
      sessionCount: 1,
      lastMessage: String(x.lastMessage || "Click to start conversation"),
      lastMessageAt: String(x.lastMessageAt || ""),
      mtime: new Date(String(x.lastActiveAt || 0)).getTime() || Date.now(),
      connected: connectedIds.has(String(x.projectId)),
      mcp_connected: connectedIds.has(String(x.projectId))
    }));
  }

  /**
   * Delete a project and its associated data.
   */
  async deleteProject(projectId: string): Promise<{ success: boolean; message?: string }> {
    const id = String(projectId || "").trim();
    if (!id) throw new Error("PROJECT_ID_REQUIRED");
    const project = this.projectStore.readProjectById(id);
    if (!project) return { success: false, message: "Project not found" };
    
    const projectRoot = project.projectRoot;
    
    // 1. Close current process database connection to release file handles
    if (projectRoot) {
      this.manager.closeProjectDb(projectRoot);
    }

    // 2. Delete registration record from Hub database
    // Priority cleanup of Hub record to cut off any potential async MCP heartbeat handles
    try {
      this.projectStore.deleteProject(id);
    } catch (err: any) {
      return { success: false, message: `Failed to remove registration record: ${err?.message || "Internal error"}` };
    }

    // 3. Attempt full cleanup of project data directory (e.g. .beeswarm)
    if (projectRoot) {
      const dataDir = this.pathResolver.getProjectDataDir(projectRoot);
      if (fs.existsSync(dataDir)) {
        try {
          // Use recursive deletion with retry logic to handle potential IDE scan locks
          const maxRetries = 5;
          for (let i = 0; i < maxRetries; i++) {
            try {
              fs.rmSync(dataDir, { recursive: true, force: true });
              break;
            } catch (err: any) {
              if (i === maxRetries - 1) throw err;
              if (err.code === 'EBUSY' || err.code === 'EPERM') {
                const delay = Math.pow(2, i) * 100;
                await this.sleep(delay);
                continue;
              }
              throw err;
            }
          }
        } catch (err: any) {
          // If files are locked, at least Hub is cleared so user can refresh and recreate without deadlocks
          this.logger.warn(`[SessionService] File cleanup failed for ${dataDir} after Hub deletion: ${err.message}`);
        }
      }
    }

    // Core fix: explicitly trigger global registry changed event
    if (typeof this.events.emitProjectRegistryChanged === "function") {
      this.events.emitProjectRegistryChanged();
    }

    return { success: true };
  }

  async resolveSessionDirByToken(token?: string | null): Promise<string | null> { return this.conversation.resolveSessionDirByToken(token); }
  async resolveSessionDirsByToken(token?: string | null): Promise<string[]> { return this.conversation.resolveSessionDirsByToken(token); }
  async readChatHistory(token?: string | null): Promise<any[]> { return this.conversation.readChatHistory(token || null); }
  
  // Deprecated queue logic methods no longer exposed
  async publishQuestion(questions: any[]): Promise<any[]> { return this.conversation.publishQuestion(questions); }

  /**
   * Sync AI reply to UI and IM (Feishu).
   */
  async ensureConnectedAndSyncReply(reply: string, projectRoot: string): Promise<void> {
    const conversationId = this.manager.getDefaultConversationId();
    const content = String(reply || "").trim();
    if (!content) return;

    // 1. Generate AI message fingerprint to avoid duplicates
    const contentHash = crypto.createHash("md5").update(content).digest("hex").slice(0, 12);
    const messageId = `ai_${conversationId.slice(0, 5)}_${contentHash}`;

    // 2. Persist AI message to database (triggers SSE push to UI)
    this.manager.appendMessage({
      conversationId,
      role: "ai",
      content,
      origin: "mcp_reply",
      message_id: messageId,
      createdAt: new Date().toISOString()
    });
    
    // 3. Update last AI reply snapshot for UI recovery
    this.manager.updateAIReply(conversationId, content);

    // 4. Sync to IM (Feishu)
    try {
      if (this.outboxService && typeof this.outboxService.enqueueIMText === "function") {
        this.outboxService.enqueueIMText(content, "ai_reply", {
          traceId: messageId,
          conversationId
        });
      }
    } catch (e) {
    }
  }

  /**
   * Queue outgoing user message from UI.
   */
  async queueOutgoing(payload: { token: string; content?: string; attachments?: Array<{ name: string; type: string; data: string }>; clientMessageId?: string; origin?: string; }): Promise<number> {
    const token = payload.token || this.manager.getDefaultConversationId();
    const normalizedContent = typeof payload.content === "string" ? payload.content.trim() : "";
    const origin = payload.origin || "web_input";
    if (normalizedContent.length > this.maxContentLength) throw new Error("Payload too large: content exceeds 20000 chars");
    return await this.manager.runTransaction(async () => {
      if (normalizedContent) {
        const messageId = String(payload.clientMessageId || `${Date.now().toString(36)}-ui`);
        // No longer write to pending queue, only record in official chat history
        if (origin !== "im_inbound") {
          this.manager.appendMessage({ conversationId: token, role: "user", content: normalizedContent, message_id: String(payload.clientMessageId || ""), origin, createdAt: new Date().toISOString() });
        }
      }
      if (payload.attachments && Array.isArray(payload.attachments)) {
        if (payload.attachments.length > this.maxAttachments) throw new Error(`Payload too large: attachments exceeds ${this.maxAttachments}`);
        for (const att of payload.attachments) {
          const ext = path.extname(att.name) || (att.type.includes("image") ? ".png" : ".txt");
          const tempFileName = `upload_${Date.now()}_${Math.random().toString(36).slice(2, 5)}${ext}`;
          const base64Data = (att.data || "").split(",")[1] || "";
          const approxBytes = Math.floor((base64Data.length * 3) / 4);
          if (approxBytes > this.maxAttachmentBytes) throw new Error(`Payload too large: attachment exceeds ${this.maxAttachmentBytes} bytes`);
          await this.conversation.writeAttachment(token, tempFileName, Buffer.from(base64Data, "base64"));
          // Attachments are no longer pushed via queue, must be read via context
          }
      }
      return 0;
    });
  }

  /**
   * Queue inbound text message from IM.
   */
  async queueInboundText(text: string, token: string = ""): Promise<number> {
    const conversationId = this.manager.normalizeConversationId(token || this.manager.getDefaultConversationId());
    const normalized = String(text || "").trim();
    if (!normalized) return 0;
    return await this.manager.runTransaction(async () => {
      this.manager.appendMessage({ conversationId, role: "user", content: normalized, origin: "im_inbound", createdAt: new Date().toISOString() });
      return 0;
    });
  }

  /**
   * Queue multiple inbound items from IM.
   */
  async queueInboundItems(items: any[], token: string = ""): Promise<number> {
    if (!Array.isArray(items) || items.length === 0) return 0;
    const conversationId = this.manager.normalizeConversationId(token || this.manager.getDefaultConversationId());
    return await this.manager.runTransaction(async () => {
      for (const item of items) {
        if (String(item?.type || "") !== "text") continue;
        const content = String(item?.content || "").trim();
        if (!content) continue;
        this.manager.appendMessage({
          conversationId,
          role: "user",
          content,
          message_id: String(item?.messageId || item?.id || ""),
          origin: String(item?.origin || item?.source || "im_inbound"),
          createdAt: String(item?.timestamp || new Date().toISOString())
        });
      }
      return 0;
    });
  }
}
