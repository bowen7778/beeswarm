import { injectable } from "inversify";
import { McpSession } from "../types/McpTypes.js";

/**
 * In-memory store for managing active MCP SSE sessions and their cleanup timers.
 */
@injectable()
export class McpSessionStore {
  private sseSessions = new Map<string, McpSession>();
  private sessionCleanupTimers = new Map<string, NodeJS.Timeout>();

  /**
   * Get an active MCP session by ID.
   */
  public getSession(sessionId: string): McpSession | undefined {
    return this.sseSessions.get(sessionId);
  }

  /**
   * Store an active MCP session.
   */
  public setSession(sessionId: string, session: McpSession): void {
    this.sseSessions.set(sessionId, session);
  }

  /**
   * Delete an MCP session record.
   */
  public deleteSession(sessionId: string): void {
    this.sseSessions.delete(sessionId);
  }

  /**
   * List all currently active MCP sessions.
   */
  public listSessions(): [string, McpSession][] {
    return Array.from(this.sseSessions.entries());
  }

  /**
   * Get the total count of active MCP sessions.
   */
  public getSessionCount(): number {
    return this.sseSessions.size;
  }

  /**
   * Get the cleanup timer for a specific session.
   */
  public getCleanupTimer(sessionId: string): NodeJS.Timeout | undefined {
    return this.sessionCleanupTimers.get(sessionId);
  }

  /**
   * Set a cleanup timer for a session.
   */
  public setCleanupTimer(sessionId: string, timer: NodeJS.Timeout): void {
    this.sessionCleanupTimers.set(sessionId, timer);
  }

  /**
   * Clear and delete the cleanup timer for a session.
   */
  public deleteCleanupTimer(sessionId: string): void {
    const timer = this.sessionCleanupTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.sessionCleanupTimers.delete(sessionId);
    }
  }

  /**
   * Clear all sessions and their cleanup timers.
   */
  public clearAll(): void {
    for (const timer of this.sessionCleanupTimers.values()) {
      clearTimeout(timer);
    }
    this.sessionCleanupTimers.clear();
    this.sseSessions.clear();
  }
}
