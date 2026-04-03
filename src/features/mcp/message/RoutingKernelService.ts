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
  resolveOutboundRoute(conversationId: string, providerId: string = "feishu", boundChatId: string = "", botId: string = ""): {
    code: "ok" | "missing_conversation" | "route_not_found";
    chatId: string;
    botId: string;
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
      return { code: "missing_conversation", chatId: "", botId: "", conversationId: "" };
    }
    
    // Prioritize reading bound route from memory/database
    const imRouting = this.manager.readConversation(token)?.routingConfig?.im?.[providerId] || {};
    const routedChatId = String(imRouting.chatId || "").trim();
    const routedBotId = String(imRouting.botId || "").trim();
    
    let chatId = routedChatId;
    let finalBotId = routedBotId || botId;

    // Core fix: if not found in DB but boundChatId is provided, establish binding immediately
    if (!chatId && boundChatId) {
      this.bindConversationChatRoute(token, providerId, boundChatId, finalBotId);
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
    return { code, chatId, botId: finalBotId, conversationId: token };
  }

  /**
   * Resolve the outbound chat ID for a conversation.
   */
  resolveOutboundChatId(conversationId: string, providerId: string = "feishu", boundChatId: string = ""): string {
    return this.resolveOutboundRoute(conversationId, providerId, boundChatId).chatId;
  }

  /**
   * Bind a conversation to a specific IM chat ID and Bot ID.
   */
  bindConversationChatRoute(conversationId: string, providerId: string, chatId: string, botId?: string): void {
    const token = this.manager.normalizeConversationId(conversationId);
    const normalizedChatId = String(chatId || "").trim();
    if (!token || !normalizedChatId) return;
    const currentRouting = this.manager.readConversation(token)?.routingConfig || {};
    const nextImRouting = {
      ...(currentRouting.im || {}),
      [providerId]: { chatId: normalizedChatId, botId: botId || "default" }
    };
    this.manager.upsertConversationRouting(token, {
      ...currentRouting,
      im: nextImRouting,
      web: { channel: "web" }
    });
    // Multi-bot channel key format: feishu:bot_id_chat_id
    const channel = botId ? `${providerId}:${botId}_chat_id` : `${providerId}_chat_id`;
    this.manager.upsertRoute(token, channel, normalizedChatId);
  }

  /**
   * Resolve the inbound route for a chat ID.
   */
  resolveInboundRoute(providerId: string, inboundChatId: string, botId?: string): {
    code: "ok" | "missing_chat_id" | "route_not_found";
    conversationId: string;
    autoBound: boolean;
  } {
    const chatId = String(inboundChatId || "").trim();
    if (!chatId) {
      return { code: "missing_chat_id", conversationId: "", autoBound: false };
    }

    // Try multi-bot channel first, then fallback to legacy
    const channels = [];
    if (botId) channels.push(`${providerId}:${botId}_chat_id`);
    channels.push(`${providerId}_chat_id`);
    
    for (const channel of channels) {
      try {
        const mapped = this.manager.findConversationIdByRoute(channel, chatId);
        if (mapped) {
          return { code: "ok", conversationId: mapped, autoBound: false };
        }
      } catch (e: any) {
        if (e.message && e.message.includes("PROJECT_CONTEXT_REQUIRED")) continue;
        this.logger.warn("RoutingKernelService", `Inbound resolve failed for ${channel}: ${e.message}`);
      }
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
