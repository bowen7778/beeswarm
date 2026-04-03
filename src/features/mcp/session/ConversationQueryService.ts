import { injectable, inject } from "inversify";
import path from "node:path";
import fs from "node:fs/promises";
import { MessageManagerStore } from "../message/MessageManagerStore.js";
import { MessageOutboxService } from "../message/MessageOutboxService.js";
import { SYMBOLS } from "../../../common/di/symbols.js";
import { PathResolverService } from "../../runtime/PathResolverService.js";

/**
 * Service for querying and managing conversation history and attachments.
 */
@injectable()
export class ConversationQueryService {
  private outboxService: MessageOutboxService | null = null;

  constructor(
    @inject(SYMBOLS.PathResolverService) private readonly pathResolver: PathResolverService,
    @inject(SYMBOLS.MessageManagerStore) private readonly manager: MessageManagerStore
  ) {}

  public setOutboxService(outbox: MessageOutboxService) {
    this.outboxService = outbox;
  }

  public initialize(_sessionsDir: string) {}

  /**
   * Resolve the data directory for a specific session token.
   */
  async resolveSessionDirByToken(token?: string | null): Promise<string | null> {
    if (!token) return null;
    const projectRoot = this.manager.getProjectRoot();
    if (!projectRoot) return null;
    return this.pathResolver.getProjectDataDir(projectRoot);
  }

  /**
   * Resolve all data directories for a session token.
   */
  async resolveSessionDirsByToken(token?: string | null): Promise<string[]> {
    const dir = await this.resolveSessionDirByToken(token);
    return dir ? [dir] : [];
  }

  /**
   * Read the chat history for the current project.
   */
  async readChatHistory(_token?: string | null): Promise<any[]> {
    const root = this.manager.getProjectRoot();
    if (!root) return [];

    const activeId = this.manager.getDefaultConversationId();
    if (!activeId) return [];

    const rows = this.manager.getMessages(activeId, 400);
    return rows.map((r: any) => ({
      id: r.message_id || r.id,
      role: r.role === 'ai' ? 'ai' : 'user',
      content: r.content,
      timestamp: r.created_at,
      origin: r.origin,
      delivery: { chatId: r.delivered_chat_id || "", messageId: r.delivered_message_id || "" }
    }));
  }

  /**
   * Get the last AI reply for the current project.
   */
  async getAIReply(_token?: string | null): Promise<string> { 
    return this.manager.getAIReply(this.manager.getDefaultConversationId()); 
  }

  /**
   * Write an AI reply to the current project.
   */
  async writeAIReply(_token: string | null, content: string): Promise<void> { 
    this.manager.updateAIReply(this.manager.getDefaultConversationId(), content); 
  }

  /**
   * Publish an interactive question to the UI and IM.
   */
  async publishQuestion(questions: any[]): Promise<any[]> {
    const conversationId = this.manager.getDefaultConversationId();
    const questionItems = questions.map((q, i) => ({ id: q.id || "q" + i, ...q }));
    const now = new Date().toISOString();
    const content = JSON.stringify(questionItems);
    
    // Persist to chat history (triggers SSE real-time signal for UI components)
    this.manager.appendMessage({
      conversationId,
      role: "ai",
      content: content,
      origin: "system",
      message_id: `q_${Date.now()}`,
      createdAt: now
    });

    // Enqueue for IM delivery as an interactive card
    try {
      this.outboxService?.enqueueIMInteractive(content, "ask_question", { conversationId });
    } catch (e) {
    }

    return questionItems;
  }

  /**
   * Write an attachment file to the project's data directory.
   */
  async writeAttachment(conversationId: string, fileName: string, data: Buffer): Promise<string> {
    const root = this.manager.getProjectRoot();
    if (!root) throw new Error("No active project");
    const dir = await this.pathResolver.getProjectDataDir(root);
    const attachmentsDir = path.join(dir, "attachments", conversationId);
    await fs.mkdir(attachmentsDir, { recursive: true });
    const fullPath = path.join(attachmentsDir, fileName);
    await fs.writeFile(fullPath, data);
    return fullPath;
  }
}
