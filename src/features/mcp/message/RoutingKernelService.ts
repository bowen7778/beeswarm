import { injectable, inject } from "inversify";
import { MessageManagerStore } from "./MessageManagerStore.js";
import { SYMBOLS } from "../../../common/di/symbols.js";
import { LoggerService } from "../../runtime/LoggerService.js";

type RoutingEvent = {
  timestamp: string;
  source: string;
  direction: "inbound" | "outbound";
  code: string;
  conversationId: string;
  chatId: string;
  autoBound: boolean;
};

/**
 * Service for managing message routing between conversations and IM chats.
 */
@injectable()
export class RoutingKernelService {
  private readonly events: RoutingEvent[] = [];
  private readonly source: string;

  constructor(
    @inject(SYMBOLS.MessageManagerStore) private readonly manager: MessageManagerStore,
    @inject(SYMBOLS.LoggerService) private readonly logger: LoggerService
  ) {
    this.source = "routing";
  }

  /**
   * Record a routing event for diagnostics.
   */
  private record(event: RoutingEvent): void {
    this.events.push({
      ...event,
      source: this.source
    });
    if (this.events.length > 200) {
      this.events.splice(0, this.events.length - 200);
    }
  }

  /**
   * Get the current routing status and recent events.
   */
  status(): { size: number; recent: RoutingEvent[] } {
    return {
      size: this.events.length,
      recent: this.events.slice(-20)
    };
  }

  /**
   * Resolve the outbound route for a conversation.
   */
  resolveOutboundRoute(conversationId: string, providerId: string = "feishu", boundChatId: string = ""): {
    code: "ok" | "missing_conversation" | "route_not_found";
    chatId: string;
    conversationId: string;
  } {
    const token = this.manager.normalizeConversationId(conversationId);
    if (!token) {
      this.record({
        timestamp: new Date().toISOString(),
        source: this.source,
        direction: "outbound",
        code: "missing_conversation",
        conversationId: "",
        chatId: "",
        autoBound: false
      });
      return { code: "missing_conversation", chatId: "", conversationId: "" };
    }
    
    // Prioritize reading bound route from memory/database
    const routed = String(this.manager.readConversation(token)?.routingConfig?.im?.[providerId]?.chatId || "").trim();
    
    // Core fix: if not found in DB but boundChatId is provided, establish binding immediately
    let chatId = routed;
    if (!chatId && boundChatId) {
      this.bindConversationChatRoute(token, providerId, boundChatId);
      chatId = boundChatId;
    }

    const code = chatId ? "ok" : "route_not_found";
    this.record({
      timestamp: new Date().toISOString(),
      source: this.source,
      direction: "outbound",
      code,
      conversationId: token,
      chatId,
      autoBound: false
    });
    return { code, chatId, conversationId: token };
  }

  /**
   * Resolve the outbound chat ID for a conversation.
   */
  resolveOutboundChatId(conversationId: string, providerId: string = "feishu", boundChatId: string = ""): string {
    return this.resolveOutboundRoute(conversationId, providerId, boundChatId).chatId;
  }

  /**
   * Bind a conversation to a specific IM chat ID.
   */
  bindConversationChatRoute(conversationId: string, providerId: string, chatId: string): void {
    const token = this.manager.normalizeConversationId(conversationId);
    const normalizedChatId = String(chatId || "").trim();
    if (!token || !normalizedChatId) return;
    const currentRouting = this.manager.readConversation(token)?.routingConfig || {};
    const nextImRouting = {
      ...(currentRouting.im || {}),
      [providerId]: { chatId: normalizedChatId }
    };
    this.manager.upsertConversationRouting(token, {
      ...currentRouting,
      im: nextImRouting,
      web: { channel: "web" }
    });
    this.manager.upsertRoute(token, `${providerId}_chat_id`, normalizedChatId);
  }

  /**
   * Resolve the inbound route for a chat ID.
   */
  resolveInboundRoute(providerId: string, inboundChatId: string, boundChatId: string = ""): {
    code: "ok" | "missing_chat_id" | "route_not_found";
    conversationId: string;
    autoBound: boolean;
  } {
    const chatId = String(inboundChatId || "").trim();
    if (!chatId) {
      return { code: "missing_chat_id", conversationId: "", autoBound: false };
    }

    const channel = `${providerId}_chat_id`;
    
    // We only query persistent routes when a clear context is available.
    // This service doesn't pass projectRoot directly, so we catch potential context errors.
    try {
      const mapped = this.manager.findConversationIdByRoute(channel, chatId);
      if (mapped) {
        return { code: "ok", conversationId: mapped, autoBound: false };
      }
    } catch (e: any) {
      if (e.message && e.message.includes("PROJECT_CONTEXT_REQUIRED")) {
        // No current context means route cannot be found here; let upper layers handle fallback.
        return { code: "route_not_found", conversationId: "", autoBound: false };
      }
      // Log other errors as warnings to avoid blocking the inbound flow.
      this.logger.warn("RoutingKernelService", `Silent fail when resolving inbound route for chatId: ${chatId}. Reason: ${String(e?.message || e)}`);
      return { code: "route_not_found", conversationId: "", autoBound: false };
    }

    return { code: "route_not_found", conversationId: "", autoBound: false };
  }

  /**
   * Resolve the inbound conversation ID for a chat ID.
   */
  resolveInboundConversationId(providerId: string, inboundChatId: string, boundChatId: string = ""): string | null {
    const resolved = this.resolveInboundRoute(providerId, inboundChatId, boundChatId);
    return resolved.code === "ok" ? resolved.conversationId : null;
  }
}
