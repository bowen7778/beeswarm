import { injectable, inject } from "inversify";
import { SessionApplicationService } from "../session/SessionApplicationService.js";
import { MessageOutboxService } from "./MessageOutboxService.js";
import { MessageManagerStore } from "./MessageManagerStore.js";
import { RoutingKernelService } from "./RoutingKernelService.js";
import { SYMBOLS } from "../../../common/di/symbols.js";
import { SessionContext } from "../../../common/context/SessionContext.js";
import type { IMProvider } from "../../im/IMProvider.js";
import path from "node:path";
import { StreamSnapshotService } from "../../runtime/sse/StreamSnapshotService.js";
import { LoggerService } from "../../runtime/LoggerService.js";
import { ProjectStore } from "../stores/ProjectStore.js";
import { IMFacade } from "../../im/facade/IMFacade.js";

/**
 * Core service for handling message ingestion from UI and IM.
 */
@injectable()
export class MessageCoreService {
  private setActiveConversationToken?: (token: string) => void;
  private outboxService: MessageOutboxService | null = null;

  constructor(
    @inject(SYMBOLS.SessionApplicationService) private readonly sessionService: SessionApplicationService,
    @inject(SYMBOLS.MessageManagerStore) private readonly manager: MessageManagerStore,
    @inject(SYMBOLS.RoutingKernelService) private readonly routing: RoutingKernelService,
    @inject(SYMBOLS.ProjectStore) private readonly projectStore: ProjectStore,
    @inject(SYMBOLS.StreamSnapshotService) private readonly streamSnapshotService: StreamSnapshotService,
    @inject(SYMBOLS.LoggerService) private readonly logger: LoggerService,
    @inject(SYMBOLS.IMFacade) private readonly imFacade: IMFacade
  ) {}


  public setOutboxService(outbox: MessageOutboxService) {
    this.outboxService = outbox;
  }

  /**
   * Set a callback to notify when an active conversation token changes.
   */
  setTokenCallback(callback: (token: string) => void) {
    this.setActiveConversationToken = callback;
  }

  /**
   * Get current routing status.
   */
  getRoutingStatus() {
    return this.routing.status();
  }

  /**
   * Ingest a message sent from the UI.
   */
  async ingestFromUI(payload: {
    content?: string;
    attachments?: Array<{ name: string; type: string; data: string }>;
    sessionId?: string;
    conversationId?: string;
    clientMessageId?: string;
  }): Promise<{ token: string; queuedCount: number; imForward: { attempted: boolean; forwarded: boolean; reason?: string } }> {
    const projectRoot = SessionContext.projectRoot;
    if (!projectRoot) throw new Error("PROJECT_CONTEXT_REQUIRED");
    
    const token = this.manager.getDefaultConversationId();
    if (token && this.setActiveConversationToken) this.setActiveConversationToken(token);
    
    const queuedCount = await this.sessionService.queueOutgoing({
      token,
      content: payload.content,
      attachments: payload.attachments,
      clientMessageId: payload.clientMessageId
    });

    const imForward: { attempted: boolean; forwarded: boolean; reason?: string } = { attempted: false, forwarded: false };
    
    if (payload.content) {
      imForward.attempted = true;
      const cfg = await this.imFacade.readConfig();
      const providers = Object.entries(cfg.plugins || {});
      let forwardedAtLeastOne = false;
      
      for (const [providerId, plugin] of providers) {
        const gate = await this.imFacade.canForwardMessage(providerId);
        if (gate.allowed) {
          const boundChatId = await this.imFacade.readBoundChatId(providerId);
          if (boundChatId) {
            if (token) this.routing.bindConversationChatRoute(token, providerId, boundChatId);
            forwardedAtLeastOne = true;
          }
        }
      }


      if (forwardedAtLeastOne) {
        imForward.forwarded = true;
        this.outboxService?.enqueueIMText(payload.content, "ui_send", {
          traceId: String(payload.clientMessageId || `${Date.now().toString(36)}-ui_send`),
          conversationId: token || undefined
        });
      } else {
        imForward.reason = "NO_BOUND_CHATS_OR_INACTIVE";
      }
    }
    
    return { token, queuedCount, imForward };
  }

  /**
   * Process a decoded message received from an IM provider.
   */
  async ingestDecodedIMMessage(providerId: string, provider: IMProvider, result: any): Promise<{ queued: boolean; reason?: string; count: number }> {
    if (!result || result.type !== "message" || !result.text) return { queued: false, reason: "not_message", count: 0 };
    
    // 1. Get sender metadata
    const senderType = String(result.senderType || "").toLowerCase();
    const senderOpenId = String(result.senderOpenId || "").trim();
    const senderAppId = String(result.senderAppId || "").trim();

    // 2. Identity identification and filtering logic
    const inboundChatId = String(result.chatId || "");
    if (!inboundChatId) return { queued: false, reason: "missing_chat_id", count: 0 };
    
    // 3. Route resolution and context restoration
    // Step 1: Scan all project configuration files (.beemcp) to find the matching chatId
    let resolvedProjectRoot: string | null = null;
    let conversationId: string | null = null;

    try {
      const boundChatId = await this.imFacade.readBoundChatId(providerId);
      if (boundChatId === inboundChatId) {
        // 如果是 Hub 级别的全局绑定，需要根据会话路由进一步解析
        conversationId = this.routing.resolveInboundConversationId(providerId, inboundChatId);
        if (conversationId) {
          const project = this.projectStore.readProjectById(conversationId);
          resolvedProjectRoot = project?.projectRoot || null;
        }
      }
    } catch (err) {
      this.logger.error("IM", `Failed to resolve binding via IMFacade: ${err}`);
    }

    
    // Step 2: Fallback to Hub memory if not found in physical config files
    if (!resolvedProjectRoot) {
      conversationId = this.routing.resolveInboundConversationId(providerId, inboundChatId);
      if (conversationId) {
        const project = this.projectStore.readProjectById(conversationId);
        resolvedProjectRoot = project?.projectRoot || null;
      }
    }
    
    this.logger.info("IM", `[${providerId}] Inbound message routing: chatId=${inboundChatId}, resolvedProjectRoot=${resolvedProjectRoot}`);
    
    // Core fix: Do NOT use current session context (SessionContext.projectRoot) as fallback.
    // In a daemon process architecture, IM webhooks are sent to the master process.
    // If no matching project is found, it should be dropped or sent to dead letter, 
    // rather than leaking into whatever project happens to be active in the current thread.
    if (!resolvedProjectRoot) {
      this.logger.warn("IM", `[MessageCoreService] Dropped inbound message because no projectRoot could be resolved for chatId: ${inboundChatId}`);
      return { queued: false, reason: "project_not_found", count: 0 };
    }

    // If projectRoot is found but conversationId is not yet bound (e.g. new group)
    if (!conversationId) {
      // Force get default ID within the project context
      await SessionContext.run({ projectRoot: resolvedProjectRoot }, async () => {
        conversationId = this.manager.getDefaultConversationId();
      });
      if (!conversationId) {
         conversationId = `${path.basename(resolvedProjectRoot)}-default-conv`;
      }
      this.routing.bindConversationChatRoute(conversationId, providerId, inboundChatId);
    }

    return SessionContext.run({ projectRoot: resolvedProjectRoot }, async () => {
      const cfg = await this.imFacade.readConfig();
      const myAppId = String(cfg.plugins[providerId]?.credentials?.appId || "").trim();

      // Precision interception: ignore messages sent by the bot itself (via appId comparison)
      // This is the first and most accurate line of defense against feedback loops.
      const isSelfBot = senderAppId === myAppId;
      
      if (isSelfBot) {
        this.logger.info("IM", `[${providerId}] Ignored self-message from bot to prevent loop. AppId: ${senderAppId}`);
        return { queued: false, reason: "self_bot_sender", count: 0 };
      } else if (senderType === "app") {
        this.logger.info("IM", `[${providerId}] Received message from third-party bot. AppId: ${senderAppId}`);
      }

      // Content-Hash Deduplication (Safety fallback)
      const recentMessages = this.manager.getMessages(conversationId!, 15);
      const isEcho = recentMessages.some(m => {
        if (!result.text || !m.content) return false;
        // Check content similarity and 60s time window
        const timeDiff = Math.abs(new Date(result.createdAt || Date.now()).getTime() - new Date(m.created_at).getTime());
        // If we are sure this is not our own bot (isSelfBot is false and senderAppId exists),
        // we should not block third-party bot messages just because content is similar.
        if (senderAppId && senderAppId !== myAppId) return false;
        
        return m.content.trim() === result.text.trim() && timeDiff < 60000;
      });

      if (isEcho) {
        this.logger.info("IM", `[${providerId}] Echo loop blocked by content hash. Text: ${result.text.substring(0, 30)}...`);
        return { queued: false, reason: "echo_loop_blocked", count: 0 };
      }

      // Duplication check via message_id
      const inboundMessageId = String(result.messageId || "");
      if (this.imFacade.isInboundMessageIdDuplicate(inboundMessageId, inboundChatId)) {
        return { queued: false, reason: "duplicate_message_id", count: 0 };
      }

      await this.imFacade.captureAdminOpenIdFromInbound(String(senderOpenId || ""), providerId);
      
      const normalizedToken = this.manager.normalizeConversationId(conversationId || "");
      if (this.setActiveConversationToken && normalizedToken) this.setActiveConversationToken(normalizedToken);
      
      const targetConversationId = normalizedToken || String(conversationId || "");
      this.manager.appendMessage({
        conversationId: targetConversationId,
        role: "user",
        content: result.text,
        origin: "im",
        message_id: inboundMessageId,
        createdAt: result.createdAt
      });

      // Loop prevention and TTL gate
      // 1. Role/Origin check
      if (result.role === "ai" || result.origin === "system") {
        this.logger.info("IM", `[${providerId}] Message loop prevented: role=${result.role}, origin=${result.origin}. Not enqueuing to AI.`);
        return { queued: false, reason: "loop_prevented", count: 0 };
      }

      // 2. TTL Gate: ignore "ghost" messages older than 5 minutes (historical replays)
      const createTs = new Date(result.createdAt || Date.now()).getTime();
      const nowTs = Date.now();
      const ageMinutes = (nowTs - createTs) / 1000 / 60;
      
      if (ageMinutes > 5) {
        this.logger.warn("IM", `[${providerId}] Ghost message detected (age: ${ageMinutes.toFixed(1)} min). Saved to DB, but skipped AI processing.`);
        return { queued: false, reason: "ghost_replay_detected", count: 0 };
      }

      // Push message to sessionService's real-time queue
      const queuedCount = await this.sessionService.queueOutgoing({
        token: normalizedToken || "",
        content: result.text,
        clientMessageId: inboundMessageId,
        origin: "im_inbound"
      });

      this.logger.info("IM", `[${providerId}] Successfully enqueued inbound message. Queued count: ${queuedCount}`);

      // Force a project-level SSE push to ensure UI reflects the new message immediately
      this.streamSnapshotService.markDirtyAndPush(resolvedProjectRoot);
      
      this.imFacade.touchRuntime(providerId, { inboundQueued: 1, inboundTotal: 1 });
      return { queued: true, count: 1 };
    });
  }

  private async canForwardMessage(providerId: string, provider?: IMProvider): Promise<{ allowed: boolean; reason?: string }> {
    return this.imFacade.canForwardMessage(providerId, provider);
  }

}
