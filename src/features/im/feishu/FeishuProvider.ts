import { injectable, inject } from "inversify";
import { Client, EventDispatcher, WSClient } from "@larksuiteoapi/node-sdk";
import type { IMProvider, IMCredentials, IMRoutingPolicy } from "../IMProvider.js";
import { LoggerService } from "../../runtime/LoggerService.js";
import { SecretService } from "../../runtime/SecretService.js";
import { SYMBOLS } from "../../../common/di/symbols.js";
import { IMConfigService } from "../services/IMConfigService.js";
import { IMAdminCaptureService } from "../services/IMAdminCaptureService.js";
import { IMRuntimeStore } from "../stores/IMRuntimeStore.js";
import { MessageCoreService } from "../../mcp/message/MessageCoreService.js";
import { MessageEvents } from "../../mcp/message/MessageEvents.js";
import { SessionContext } from "../../../common/context/SessionContext.js";
import { ProjectStore } from "../../mcp/stores/ProjectStore.js";
import { SessionApplicationService } from "../../mcp/session/SessionApplicationService.js";

import { UsecaseBus } from "../../../common/bus/UsecaseBus.js";

@injectable()
export class FeishuProvider implements IMProvider {

  readonly providerId = "feishu";
  readonly supportsLongConnection = true;
  
  private clients = new Map<string, Client>();
  private wsClient: any = null;
  private state: "idle" | "running" | "error" = "idle";
  private lastError = "";
  private healthCache: { ok: boolean; ts: number } | null = null;

  constructor(
    @inject(SYMBOLS.LoggerService) private readonly logger: LoggerService,
    @inject(SYMBOLS.SecretService) private readonly secretService: SecretService,
    @inject(SYMBOLS.MessageEvents) private readonly events: MessageEvents,
    @inject(SYMBOLS.ProjectStore) private readonly projectStore: ProjectStore,
    @inject(IMConfigService) private readonly configService: IMConfigService,
    @inject(SYMBOLS.IMAdminCaptureService) private readonly adminCaptureService: IMAdminCaptureService,
    @inject(IMRuntimeStore) private readonly runtimeStore: IMRuntimeStore,
    @inject(SYMBOLS.UsecaseBus) private readonly bus: UsecaseBus,
    @inject(SYMBOLS.SessionApplicationService) private readonly sessionAppService: SessionApplicationService
  ) {}


  /**
   * Start the Feishu provider and its long connection.
   */
  async start(): Promise<void> {
    try {
      this.logger.info("IM", "Starting Feishu Provider...");
      await this.stop();
      
      const cfg = await this.configService.readConfig();
      const plugin = cfg.plugins[this.providerId];
      if (!plugin || !plugin.enabled) return;

      const mode = plugin.routingPolicy?.connectionMode || "webhook";
      if (mode !== "long_connection") {
        this.state = "idle";
        return;
      }

      const credentials = plugin.credentials || {};
      const appId = String(credentials.appId || "");
      let appSecret = String(credentials.appSecret || "");

      if (appSecret && appSecret.includes(":")) {
        try {
          appSecret = this.secretService.decrypt(appSecret);
        } catch (e: any) {
          this.logger.warn("IM", `[Feishu] Failed to decrypt secret for long connection: ${e.message}`);
        }
      }

      if (!appId || !appSecret) {
        this.state = "error";
        this.lastError = "missing_credentials";
        return;
      }

      const dispatcher = new EventDispatcher({}).register({
        "im.message.receive_v1": async (data: any) => {
          // Core optimization: return immediately to avoid blocking Feishu retry flow
          (async () => {
            const t1 = Date.now();
            try {
              // 1. Rapid parsing of core data (single pass)
              const wrapped = await this.handleWebhook(data);
              const { senderOpenId, messageId, chatId } = wrapped;
              
              this.logger.info("IM", `[Feishu] Inbound: sender=${senderOpenId}, msgId=${messageId}, chatId=${chatId}`);

              if (senderOpenId) {
                this.adminCaptureService.captureInbound(senderOpenId, this.providerId);
              }

              await this.bus.execute(SYMBOLS.IngestIMMessageUsecase, {
                providerId: this.providerId,
                provider: this,
                payload: wrapped
              });

              
              const tCost = Date.now() - t1;
              if (tCost > 500) {
                this.logger.warn("IM", `[Feishu] Inbound processing slow: ${tCost}ms`);
              }
            } catch (err: any) {
              this.logger.error("IM", "Feishu: Failed to handle receive_v1 event", err);
            }
          })();
          return { code: 0, msg: "success" };
        },
        "card.action.trigger": async (data: any) => {
          // Key point: data is flat in long connection mode, extract directly from data
          const action = data?.action || {};
          const value = action?.value || {};
          const operator = data?.operator || {};
          const form_value = action?.form_value || {}; 
          
          this.logger.info("IM", `[Feishu] Card action (V2): ${JSON.stringify(value)} from ${operator.open_id}`);
          
          const rawProjectId = value.projectId || value.project_id;
          
          if (rawProjectId) {
            // Asynchronous business logic processing to ensure immediate response to Feishu
            (async () => {
              try {
                // Core stabilization: query standard projectId via Store to prevent event broadcast failure due to drift
                let resolvedProjectId = "";
                let resolvedProjectRoot = "";

                // Attempt to find matching project in Store (ignoring case and spaces)
                const allProjects = this.projectStore.listProjects();
                const matched = allProjects.find(p => 
                  p.projectId.toLowerCase() === String(rawProjectId).toLowerCase()
                );

                if (matched) {
                  resolvedProjectId = matched.projectId;
                  resolvedProjectRoot = matched.projectRoot;
                } else {
                  // Fallback: use original ID but try one more time to find by ID in Store
                  const p = this.projectStore.readProjectById(rawProjectId);
                  if (p) {
                    resolvedProjectId = p.projectId;
                    resolvedProjectRoot = p.projectRoot;
                  }
                }

                if (!resolvedProjectId || !resolvedProjectRoot) {
                  this.logger.warn("IM", `[Feishu] Card callback ignored: Could not resolve project context for ID: ${rawProjectId}`);
                  return;
                }

                const answers: any[] = [];
                if (value.action_type === "custom_submit") {
                  const customReply = form_value["custom_reply"] || "";
                  answers.push({ id: value.question_id, answer: customReply || "User entered no content" });
                } else if (value.option) {
                  // Compatibility for both field names
                  const qId = value.questionId || value.question_id;
                  answers.push({ id: qId, answer: value.option });
                }

                if (answers.length > 0) {
                  await SessionContext.run({ projectRoot: resolvedProjectRoot }, async () => {
                    // Key: must use resolvedProjectId to ensure ToolRegistry listeners receive the signal
                    await this.sessionAppService.queueInboundText(JSON.stringify({ answers }), resolvedProjectId);
                    this.logger.info("IM", `[Feishu] Card response delivered to project: ${resolvedProjectId}`);
                  });
                }
              } catch (err) {
                this.logger.error("IM", "[Feishu] Async card action processing failed", err);
              }
            })();
          }
          
          // Return standard Card V2 response body to trigger Feishu client Toast
          return {
            toast: {
              type: "success",
              content: "Interaction receipt received"
            }
          };
        }
      });

      this.wsClient = new WSClient({ appId, appSecret });
      await this.wsClient.start({ eventDispatcher: dispatcher });
      this.state = "running";
      this.runtimeStore.touchStatus(this.providerId, { lastError: "" });
      this.logger.info("IM", "Feishu: Long Connection started successfully");
      this.events.emitIMStateChanged(this.providerId, this.status());
    } catch (err: any) {
      this.state = "error";
      this.lastError = err?.message || "start_failed";
      this.logger.error("IM", "Feishu: Failed to start long connection", err);
      this.events.emitIMStateChanged(this.providerId, this.status());
    }
  }

  /**
   * Stop the Feishu provider.
   */
  async stop(): Promise<void> {
    try {
      if (this.wsClient) {
        if (typeof this.wsClient.close === "function") await this.wsClient.close({ force: true });
        else if (typeof this.wsClient.stop === "function") await this.wsClient.stop();
      }
    } finally {
      this.wsClient = null;
      this.state = "idle";
      this.events.emitIMStateChanged(this.providerId, this.status());
    }
  }

  /**
   * Get the current status of the provider.
   */
  status() {
    return {
      state: this.state,
      lastError: this.lastError
    };
  }

  /**
   * Get or create a Lark client for given credentials.
   */
  private getClient(appId: string, appSecret: string): Client {
    const key = `${appId}:${appSecret}`;
    if (this.clients.has(key)) {
      return this.clients.get(key)!;
    }
    const client = new Client({
      appId,
      appSecret,
      disableTokenCache: false,
    });
    this.clients.set(key, client);
    return client;
  }

  async health(): Promise<{ ok: boolean; message?: string }> {
    const now = Date.now();
    if (this.healthCache && (now - this.healthCache.ts < 60000)) {
      return { ok: this.healthCache.ok, message: "cached" };
    }

    // Basic connectivity check
    try {
      const res = await fetch("https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal", {
        method: "HEAD"
      });
      const ok = res.status < 500;
      this.healthCache = { ok, ts: now };
      return { ok };
    } catch (err: any) {
      return { ok: false, message: err?.message || "network error" };
    }
  }

  async sendMessage(input: { chatId: string; text: string; credentials: IMCredentials; kind?: string; projectId?: string }): Promise<{ messageId?: string }> {
    const { appId, appSecret } = input.credentials;
    if (!appId || !appSecret) {
      throw new Error("Missing appId/appSecret in credentials");
    }

    let decryptedSecret = appSecret;
    if (appSecret && appSecret.includes(":")) {
      try {
        decryptedSecret = this.secretService.decrypt(appSecret);
      } catch (e: any) {
        this.logger.warn("IM", `[Feishu] Failed to decrypt secret, using raw value. Error: ${e.message}`);
      }
    }

    const client = this.getClient(String(appId), String(decryptedSecret));
    
    try {
      this.logger.info("IM", `[Feishu] Sending outbound message (kind: ${input.kind || "text"}) to chatId: ${input.chatId}`);
      
      let msgType = "text";
      let msgContent: any = { text: input.text };

      const trimmedText = input.text.trim();
      // Enhanced JSON extraction logic: identify JSON possibly wrapped in Markdown code blocks
      let jsonStr = trimmedText;
      if (trimmedText.includes("```json")) {
        jsonStr = trimmedText.split("```json")[1].split("```")[0].trim();
      } else if (trimmedText.includes("```")) {
        jsonStr = trimmedText.split("```")[1].split("```")[0].trim();
      }

      // Enhanced identification logic: even if kind is not interactive, if content is clearly interaction JSON, try rendering as card
      const isJsonLike = jsonStr.startsWith("[") || jsonStr.startsWith("{");
      const shouldTryInteractive = input.kind === "interactive" || (isJsonLike && jsonStr.includes('"options":'));

      if (shouldTryInteractive && isJsonLike) {
        try {
          const parsed = JSON.parse(jsonStr);
          const questions = Array.isArray(parsed) ? parsed : [parsed];
          msgType = "interactive";
          
          const questionLabel = "🤖 BeeMCP Interaction Decision";
          // Standard treatment via JSON.stringify instead of manual escape
          const questionDesc = String(questions.map((q: any) => q.label).join("\n"));
            
          const projectId = String(input.projectId || "");
          
          // Feishu card button limit: max 5 per action block. If exceeded, split into multiple blocks.
          const actionBlocks: any[] = [];
          let currentActionList: any[] = [];

          questions.forEach((q: any) => {
            const opts = q.options || ["Confirm", "Cancel"];
            opts.forEach((opt: string) => {
              if (currentActionList.length >= 5) {
                actionBlocks.push({ tag: "action", actions: currentActionList });
                currentActionList = [];
              }
              currentActionList.push({
                tag: "button",
                text: {
                  content: String(opt),
                  tag: "plain_text"
                },
                type: "primary",
                value: {
                  option: String(opt),
                  projectId: projectId,
                  question_id: String(q.id || "")
                }
              });
            });
          });

          if (currentActionList.length > 0) {
            actionBlocks.push({ tag: "action", actions: currentActionList });
          }

          // Native Card V2 JSON structure
          msgContent = {
            config: {
              wide_screen_mode: true
            },
            header: {
              title: {
                content: questionLabel,
                tag: "plain_text"
              },
              template: "blue"
            },
            elements: [
              {
                tag: "div",
                text: {
                  content: questionDesc,
                  tag: "lark_md"
                }
              },
              ...actionBlocks
            ]
          };
          this.logger.debug("IM", `[Feishu] Card constructed successfully: ${JSON.stringify(msgContent)}`);
        } catch (e: any) {
          this.logger.warn("IM", `[Feishu] Failed to parse interactive card JSON, falling back to text mode. Error: ${e.message}`);
        }
      }

    const receiveId = String(input.chatId).trim();
    const receiveIdType = receiveId.startsWith("ou_") ? "open_id" : "chat_id";
    this.logger.info("IM", `[Feishu] Calling Lark API: msg_type=${msgType}, receive_id=${receiveId} (${receiveIdType})`);

    const res = await client.im.message.create({
      params: {
        receive_id_type: receiveIdType as any,
      },
      data: {
        receive_id: receiveId,
        msg_type: msgType as any,
        content: JSON.stringify(msgContent),
      },
    });

      if (res.code !== 0) {
        const requestId = (res as any)?.error?.request_id || (res as any)?.request_id || "";
        // Audit log: record all error codes returned by Feishu for easy debugging of permission issues (e.g., 99991663 or 99991668)
        this.logger.error("IM", `[Feishu] Lark API Error: ${res.msg} (code: ${res.code}, requestId: ${requestId})`);
        throw new Error(`Feishu API Error: ${res.msg} (code: ${res.code})`);
      }

      this.logger.info("IM", `[Feishu] Message sent successfully. ID: ${res.data?.message_id}`);
      return { messageId: res.data?.message_id };
    } catch (err: any) {
      // Capture more detailed axios/Feishu response body errors to assist debugging
      let errorMsg = err.message;
      if (err.response && err.response.data) {
        errorMsg += ` - Detail: ${JSON.stringify(err.response.data)}`;
      }
      this.logger.error("IM", `[FeishuProvider] Failed to send message: ${errorMsg}`);
      
      // Throw error with specific marker to help upper layers identify invalid groups
      if (errorMsg.includes("400") || errorMsg.includes("230")) {
         throw new Error(`[GroupInvalid] ${errorMsg}`);
      }
      throw err;
    }
  }

  async createOrBindGroup(input: {
    projectId: string;
    projectName: string;
    credentials: IMCredentials;
    routingPolicy: IMRoutingPolicy;
    forceRecreate?: boolean;
  }): Promise<{ chatId: string }> {
    const { appId, appSecret, userOpenId } = input.credentials;
    
    let decryptedSecret = appSecret;
    if (appSecret && appSecret.includes(":")) {
      try {
        decryptedSecret = this.secretService.decrypt(appSecret);
      } catch (e: any) {
        this.logger.warn("IM", `[Feishu] Failed to decrypt secret for createOrBindGroup. Error: ${e.message}`);
      }
    }

    const client = this.getClient(String(appId), String(decryptedSecret));
    
    // 1. Try to read chatId from local persistent configuration
    let currentChatId = await this.imService.readBoundChatId(this.providerId);
    if (!currentChatId) {
      currentChatId = String(
        input?.routingPolicy?.chatId ||
        input?.routingPolicy?.boundChatId ||
        input?.credentials?.chatId ||
        ""
      ).trim();
    }

    // 2. Self-healing logic: if chatId exists and not forced to recreate, validate its existence and validity on Feishu side
    if (currentChatId && !input.forceRecreate) {
      try {
        this.logger.info("IM", `[Feishu] Validating existing chatId: ${currentChatId}`);
        const chatInfo = await client.im.chat.get({
          path: { chat_id: currentChatId }
        });
        
        // Feishu API success and group not disbanded
        if (chatInfo.code === 0 && chatInfo.data) {
          this.logger.info("IM", `[Feishu] ChatId ${currentChatId} is valid. Reusing it.`);
          return { chatId: currentChatId };
        } else {
          this.logger.warn("IM", `[Feishu] ChatId ${currentChatId} is invalid or non-existent (code: ${chatInfo.code}). Triggering re-creation.`);
        }
      } catch (err: any) {
        // If exception thrown (e.g. HTTP 400, Feishu returns group not found), catch and trigger re-creation
        this.logger.warn("IM", `[Feishu] Failed to validate chatId ${currentChatId}: ${err.message}. Triggering re-creation.`);
      }
    }

    // 3. Fallback logic: if no chatId or validation failed, execute re-creation and override configuration
    if (input.routingPolicy.autoCreateGroup !== false) {
      this.logger.info("IM", `[Feishu] Creating/Re-creating auto-group for project: ${input.projectName}`);
      try {
        const data: any = {
          name: `BeeMCP: ${input.projectName}`,
          description: `Auto-generated group for BeeMCP project: ${input.projectId}. Created at: ${new Date().toLocaleString()}`
        };
        if (userOpenId) {
          // Correction: only add user to list, do not set owner_id
          // Feishu rule: if owner_id not provided, the robot calling the API becomes the group owner automatically
          data.user_id_list = [userOpenId];
        }

        const res = await client.im.chat.create({
          params: {
            user_id_type: "open_id"
          },
          data
        });

        if (res.code === 0 && res.data?.chat_id) {
          const newChatId = res.data.chat_id;
          this.logger.info("IM", `[Feishu] New group created and self-healed: ${newChatId}`);
          
          // 4. Force persistent override to ensure next hit directly
          await this.imService.bindChatId(newChatId, this.providerId);
          
          return { chatId: newChatId };
        } else {
          throw new Error(`Feishu API Error (CreateChat): ${res.msg} (code: ${res.code})`);
        }
      } catch (err: any) {
        this.logger.error("IM", `[Feishu] Failed to re-create group: ${err.message}`);
        throw err;
      }
    }

    throw new Error("FEISHU_CHAT_ID_REPAIR_FAILED");
  }

  /**
   * Handle incoming webhooks from Feishu.
   */
  async handleWebhook(payload: any): Promise<any> {
    if (payload?.challenge) {
      return { challenge: payload.challenge };
    }
    // According to official Feishu Node SDK documentation structure:
    // payload passed in might be { message: {...}, sender: {...} }
    // or native { event: { message: {...}, sender: {...} } }
    let message = payload?.message;
    let sender = payload?.sender;
    
    if (!message && payload?.event) {
      message = payload.event.message;
      sender = payload.event.sender;
    }
    
    message = message || {};
    sender = sender || {};
    
    let text = "";
    try {
      const contentStr = String(message?.content || "{}");
      const parsed = JSON.parse(contentStr);
      text = String(parsed?.text || "").trim();
    } catch {
      text = "";
    }
    
    // Core refactoring: precise interception based on official identity markers
    // User message: ID is in sender.sender_id.open_id
    // Bot message: ID is in sender.id (and id_type must be 'app_id')
    const senderOpenId = String(sender?.sender_id?.open_id || sender?.open_id || "");
    let senderAppId = "";
    
    // Official Feishu determination:
    // If sender_type is 'app', it usually means the message is sent by a bot
    // In group chats, if other third-party bots send messages, their sender_type is also 'app'.
    // We must pass senderAppId out and strictly compare with our own appId in MessageCoreService.
    // This way we can both intercept ourselves and receive messages from third-party bots.
    if (sender?.id_type === "app_id" || sender?.sender_type === "app") {
      // Compatibility for V1/V2 structures: some in sender.id, some in sender.sender_id.app_id
      senderAppId = String(sender?.id || sender?.sender_id?.app_id || ""); 
    }

    // Key correction: log the actual app_id in received messages for debugging
    this.logger.debug("IM", `[Feishu] Webhook parsed sender: type=${sender?.sender_type}, appId=${senderAppId}, openId=${senderOpenId}`);

    const chatId = String(message?.chat_id || "");
    const messageId = String(message?.message_id || "");

    return {
      type: "message",
      text,
      chatId,
      chatType: String(message?.chat_type || "group"),
      senderType: String(sender?.sender_type || ""),
      senderId: senderAppId || senderOpenId || "",
      senderOpenId,
      senderAppId, // Pass appId for precise comparison and interception in MessageCoreService
      messageId,
      // Convert Feishu native create time (milliseconds) to standard ISO string
      createdAt: message?.create_time ? new Date(Number(message.create_time)).toISOString() : new Date().toISOString(),
      messageCreateTime: Number(message?.create_time || 0),
      messageType: String(message?.message_type || "")
    };
  }

  /**
   * Fetch an attachment from a Feishu message.
   */
  async fetchAttachment(input: {
    message: any;
    credentials: IMCredentials;
  }): Promise<{
    kind: "image" | "file";
    fileName: string;
    mimeType: string;
    content: Buffer;
  } | null> {
    // Feishu attachment download logic not yet implemented, maintaining original behavior
    return null;
  }
}
