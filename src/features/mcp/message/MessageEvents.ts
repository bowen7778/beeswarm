import { EventEmitter } from "node:events";
import { injectable } from "inversify";

export type LogEntry = {
  timestamp: string;
  level: string;
  module: string;
  message: string;
  error?: any;
};

export type AIReplyEvent = {
  reply: string;
  timestamp: string;
  conversationId?: string;
  messageId?: string;
};

export type UserInputEvent = {
  content: string;
  timestamp: string;
  conversationId?: string;
  messageId?: string;
};

@injectable()
export class MessageEvents extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(100);
  }

  emitLog(entry: LogEntry): void {
    this.emit("system:log", entry);
  }

  onLog(handler: (entry: LogEntry) => void): () => void {
    this.on("system:log", handler);
    return () => this.off("system:log", handler);
  }

  emitProjectRegistryChanged(): void {
    this.emit("project:registry_changed");
  }

  emitProjectCreated(projectId: string, projectRoot: string): void {
    this.emit("project:created", { projectId, projectRoot });
    this.emitProjectRegistryChanged();
  }

  onProjectCreated(handler: (payload: { projectId: string; projectRoot: string }) => void): () => void {
    this.on("project:created", handler);
    return () => this.off("project:created", handler);
  }

  emitUIFocusProject(projectId: string): void {
    this.emit("ui:focus_project", { projectId });
  }

  onUIFocusProject(handler: (payload: { projectId: string }) => void): () => void {
    this.on("ui:focus_project", handler);
    return () => this.off("ui:focus_project", handler);
  }

  emitIMStateChanged(providerId: string, status: any): void {
    this.emit("im:state_changed", { providerId, status });
  }

  emitOutboxUpdated(): void {
    this.emit("ops:outbox_updated");
  }

  emitAIReply(reply: string, conversationId?: string, messageId?: string): void {
    const payload: AIReplyEvent = {
      reply: String(reply || ""),
      timestamp: new Date().toISOString(),
      conversationId: String(conversationId || "").trim() || undefined,
      messageId: String(messageId || "").trim() || undefined
    };
    this.emit("message:ai_reply", payload);
  }

  onAIReply(handler: (payload: AIReplyEvent) => void): () => void {
    this.on("message:ai_reply", handler);
    return () => this.off("message:ai_reply", handler);
  }

  emitUserInput(content: string, conversationId?: string, messageId?: string): void {
    const payload: UserInputEvent = {
      content: String(content || ""),
      timestamp: new Date().toISOString(),
      conversationId: String(conversationId || "").trim() || undefined,
      messageId: String(messageId || "").trim() || undefined
    };
    this.emit("message:user_input", payload);
    
    if (payload.conversationId) {
      this.emit(`message:user_input:${payload.conversationId}`, payload);
    }
  }

  onUserInput(handler: (payload: UserInputEvent) => void, conversationId?: string): () => void {
    const eventName = conversationId ? `message:user_input:${conversationId}` : "message:user_input";
    this.on(eventName, handler);
    return () => this.off(eventName, handler);
  }
}

