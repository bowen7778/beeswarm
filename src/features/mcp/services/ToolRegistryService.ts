import { injectable, inject } from "inversify";
import { z } from "zod";
import path from "node:path";
import process from "node:process";
import { SYMBOLS } from "../../../common/di/symbols.js";
import { MessageEvents } from "../message/MessageEvents.js";
import { MessageManagerStore } from "../message/MessageManagerStore.js";
import { WindowService } from "../../runtime/WindowService.js";
import { ProjectIdentityService } from "../project/ProjectIdentityService.js";
import { SessionContext, SessionContextPayload } from "../../../common/context/SessionContext.js";
import { ProjectStore } from "../stores/ProjectStore.js";
import { McpSessionBindingStore } from "../stores/McpSessionBindingStore.js";
import { ConversationQueryService } from "../session/ConversationQueryService.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * Active Kernel Registry: manages the lifecycle of blocking tasks for different projects.
 * Ensures only one active orchestration kernel is listening for a project at a time.
 */
class ActiveKernelRegistry {
  private static activeKernels = new Map<string, () => void>();

  static register(projectId: string, abort: () => void) {
    const existing = this.activeKernels.get(projectId);
    if (existing) {
      process.stdout.write(`[KernelRegistry] Terminating stale kernel for project: ${projectId}\n`);
      existing();
    }
    this.activeKernels.set(projectId, abort);
  }

  static unregister(projectId: string) {
    this.activeKernels.delete(projectId);
  }
}

@injectable()
export class ToolRegistryService {
  constructor(
    @inject(SYMBOLS.McpSessionBindingStore) private readonly mcpBindingStore: McpSessionBindingStore,
    @inject(SYMBOLS.ProjectStore) private readonly projectStore: ProjectStore,
    @inject(SYMBOLS.MessageEvents) private readonly events: MessageEvents,
    @inject(SYMBOLS.ConversationQueryService) private readonly queryService: ConversationQueryService,
    @inject(SYMBOLS.WindowService) private readonly window: WindowService,
    @inject(SYMBOLS.MessageManagerStore) private readonly manager: MessageManagerStore,
    @inject(SYMBOLS.MessageOutboxService) private readonly outbox: any,
    @inject(SYMBOLS.ProjectIdentityService) private readonly projectIdentity: ProjectIdentityService
  ) {}

  public apply(server: McpServer, context: SessionContextPayload) {
    if ((server as any)._beemcp_tools_applied) return;
    (server as any)._beemcp_tools_applied = true;

    // beemcp_init
    server.registerTool(
      "beemcp_init",
      {
        description: "Initialize a new BeeMCP territory. MUST be called first when project state is UNINITIALIZED.",
        inputSchema: {
          projectRoot: z.string().describe("Absolute physical path of the project root.")
        }
      },
      async ({ projectRoot }: { projectRoot: string }) => {
        const root = path.resolve(projectRoot);
        const identity = await this.projectIdentity.initializeProject(root);
        if (context.sessionId) {
          this.mcpBindingStore.bindMcpSession(context.sessionId, identity.projectId);
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              status: "INITIALIZED",
              projectId: identity.projectId,
              instruction: "Connection established. You MUST now call 'beemcp_orchestrate' immediately to start the communication loop."
            })
          }]
        };
      }
    );

    // beemcp_orchestrate
    server.registerTool(
      "beemcp_orchestrate",
      {
        description: "Synchronize AI state and listen for user input. This is the UNIFIED tool for communication. It sends your reply and blocks until user input is received.",
        inputSchema: z.object({
          reply: z.string().optional().describe("Your response message to the user.")
        })
      },
      async ({ reply }: { reply?: string }) => {
        return await this.runUnifiedOrchestrationKernel(reply, context);
      }
    );

    // beemcp_ask
    server.registerTool(
      "beemcp_ask",
      {
        description: "Send structured questions (select, input, confirm) to the user via BeeMCP desktop window. Blocks until answered.",
        inputSchema: z.object({
          questions: z.array(z.object({
            id: z.string().describe("Unique ID for the question"),
            type: z.enum(["select", "input", "confirm"]).describe("Type of question"),
            label: z.string().describe("Question title or prompt"),
            options: z.array(z.string()).optional().describe("Available options")
          }))
        })
      },
      async ({ questions }: { questions: any[] }) => {
        return await this.runUnifiedOrchestrationKernel(undefined, context, questions);
      }
    );

    server.registerPrompt(
      "start_bridge",
      {
        title: "Activate MCP Bridge Interaction",
        description: "Activate BeeMCP managed mode, please check beemcp://sessions/active/state first."
      },
      () => ({
        messages: [{
          role: "user",
          content: {
            type: "text",
            text: "Please check beemcp://sessions/active/state and follow its instructions to sync reply."
          }
        }]
      })
    );
  }

  private async runUnifiedOrchestrationKernel(
    reply: string | undefined, 
    context: SessionContextPayload,
    questions?: any[]
  ): Promise<any> {
    let projectId = context.sessionId ? this.mcpBindingStore.resolveProjectIdByMcpSession(context.sessionId) : null;
    let projectRoot = projectId ? this.projectStore.resolveProjectRootByProjectId(projectId) : null;

    if (!projectId || !projectRoot) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            status: "HANDSHAKE_REQUIRED",
            instruction: "Connection not bound. Please call 'beemcp_init' first."
          })
        }]
      };
    }

    return await SessionContext.run({ ...context, projectRoot }, async () => {
      try {
        if (reply) {
          process.stdout.write(`[Gateway:Sync] Syncing AI reply for project: ${projectId}\n`);
          await this.appendAIReplyToManager(projectRoot!, projectId!, reply);
        }

        if (questions && questions.length > 0) {
          await this.queryService.publishQuestion(questions);
        }

        this.events.emitUIFocusProject(projectId!);
        this.window.openDesktopWindow(true);

        const results = await new Promise<any[]>((resolve) => {
          let isResolved = false;

          ActiveKernelRegistry.register(projectId!, () => {
            if (isResolved) return;
            isResolved = true;
            cleanup();
            resolve([{
              type: "text",
              text: JSON.stringify({ status: "TERMINATED", message: "Kernel superseded by newer request." })
            }]);
          });

          const onReply = (payload: any) => {
            if (payload.conversationId === projectId) {
              isResolved = true;
              cleanup();
              resolve([{ type: "text", text: payload.content }]);
            }
          };

          const cleanup = () => {
            this.events.off("message:user_input", onReply);
            ActiveKernelRegistry.unregister(projectId!);
          };

          this.events.onUserInput(onReply);
        });

        return { content: results };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: JSON.stringify({ status: "error", message: err.message }) }],
          isError: true
        };
      }
    });
  }

  private async appendAIReplyToManager(projectRoot: string, conversationId: string, reply: string): Promise<void> {
    const content = String(reply || "").trim();
    if (!content) return;
    try {
      const token = this.manager.normalizeConversationId(conversationId || this.manager.getDefaultConversationId());
      const crypto = await import("node:crypto");
      const contentHash = crypto.createHash("md5").update(content).digest("hex").slice(0, 12);
      const messageId = `ai_${token.slice(0, 5)}_${contentHash}`;

      this.manager.appendMessage({
        conversationId: token,
        role: "ai",
        content,
        origin: "mcp_reply",
        message_id: messageId,
        createdAt: new Date().toISOString()
      });
      this.manager.updateAIReply(token, content);

      if (this.outbox && typeof this.outbox.enqueueIMText === "function") {
        this.outbox.enqueueIMText(content, "ai_reply", {
          traceId: messageId,
          conversationId: token
        });
      }
    } catch (err: any) {
      process.stderr.write(`[ToolRegistry] appendAIReplyToManager failed: ${String(err?.message || err)}\n`);
    }
  }
}
