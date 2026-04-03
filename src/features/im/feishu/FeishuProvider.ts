import { injectable, inject } from "inversify";
import { Client, EventDispatcher, WSClient } from "@larksuiteoapi/node-sdk";
import { createDecipheriv, createHash } from "node:crypto";
import type { IMProvider, IMCredentials, IMRoutingPolicy } from "../IMProvider.js";
import { LoggerService } from "../../runtime/LoggerService.js";
import { SecretService } from "../../runtime/SecretService.js";
import { SYMBOLS } from "../../../common/di/symbols.js";
import { IMConfigService } from "../services/IMConfigService.js";
import { IMBindingService } from "../services/IMBindingService.js";
import { IMAdminCaptureService } from "../services/IMAdminCaptureService.js";
import { IMRuntimeStore } from "../stores/IMRuntimeStore.js";
import { MessageEvents } from "../../mcp/message/MessageEvents.js";
import { SessionContext } from "../../../common/context/SessionContext.js";
import { ProjectStore } from "../../mcp/stores/ProjectStore.js";
import { SessionApplicationService } from "../../mcp/session/SessionApplicationService.js";
import { UsecaseBus } from "../../../common/bus/UsecaseBus.js";
import { IMBotInstance, IMPluginConfig } from "../types/IMTypes.js";
import { VersionManager } from "../../runtime/VersionManager.js";

interface BotRuntime {
  id: string;
  config: IMBotInstance;
  client: Client;
  wsClient?: WSClient;
  state: "idle" | "running" | "error";
  lastError: string;
}

@injectable()
export class FeishuProvider implements IMProvider {

  readonly providerId = "feishu";
  readonly supportsLongConnection = true;
  
  private botInstances = new Map<string, BotRuntime>();
  private masterBotId: string | null = null;
  private healthCache: { ok: boolean; ts: number } | null = null;

  constructor(
    @inject(SYMBOLS.LoggerService) private readonly logger: LoggerService,
    @inject(SYMBOLS.SecretService) private readonly secretService: SecretService,
    @inject(SYMBOLS.MessageEvents) private readonly events: MessageEvents,
    @inject(SYMBOLS.ProjectStore) private readonly projectStore: ProjectStore,
    @inject(IMConfigService) private readonly configService: IMConfigService,
    @inject(SYMBOLS.IMAdminCaptureService) private readonly adminCaptureService: IMAdminCaptureService,
    @inject(SYMBOLS.IMBindingService) private readonly imBindingService: IMBindingService,
    @inject(IMRuntimeStore) private readonly runtimeStore: IMRuntimeStore,
    @inject(SYMBOLS.UsecaseBus) private readonly bus: UsecaseBus,
    @inject(SYMBOLS.SessionApplicationService) private readonly sessionAppService: SessionApplicationService,
    @inject(SYMBOLS.VersionManager) private readonly versionManager: VersionManager
  ) {}


  /**
   * Start the Feishu provider and all its configured bot instances.
   */
  async start(): Promise<void> {
    try {
      this.logger.info("IM", "Starting Feishu Provider Manager...");
      await this.stop();
      
      const cfg = await this.configService.readConfig();
      const plugin = cfg.plugins[this.providerId];
      if (!plugin || !plugin.enabled) return;

      this.masterBotId = plugin.masterBotId || null;
      const instances = plugin.instances || [];

      if (instances.length === 0 && plugin.credentials?.appId) {
        this.logger.warn("IM", "[Feishu] No instances found, but legacy credentials exist. Migration should have handled this.");
      }

      for (const instConfig of instances) {
        if (instConfig.enabled) {
          await this.startBotInstance(instConfig);
        }
      }

      this.logger.info("IM", `Feishu: Provider started with ${this.botInstances.size} active bots.`);
      this.events.emitIMStateChanged(this.providerId, this.status());
    } catch (err: any) {
      this.logger.error("IM", "Feishu: Failed to start provider manager", err);
      this.events.emitIMStateChanged(this.providerId, this.status());
    }
  }

  private async startBotInstance(config: IMBotInstance): Promise<void> {
    const botId = config.id;
    try {
      this.logger.info("IM", `[Feishu] Starting bot instance: ${config.name} (${botId})...`);
      
      const credentials = config.credentials || {};
      const appId = String(credentials.appId || "");
      let appSecret = String(credentials.appSecret || "");

      if (appSecret && appSecret.includes(":")) {
        try {
          appSecret = this.secretService.decrypt(appSecret);
        } catch (e: any) {
          this.logger.warn("IM", `[Feishu] Failed to decrypt secret for bot ${botId}: ${e.message}`);
        }
      }

      if (!appId || !appSecret) {
        throw new Error("missing_credentials");
      }

      const client = new Client({ appId, appSecret, disableTokenCache: false });
      const runtime: BotRuntime = {
        id: botId,
        config,
        client,
        state: "idle",
        lastError: ""
      };

      const mode = config.routingPolicy?.connectionMode || "webhook";
      if (mode === "long_connection") {
        const dispatcher = new EventDispatcher({}).register({
          "im.message.receive_v1": async (data: any) => {
            (async () => {
              try {
                const wrapped = await this.handleWebhook(data);
                wrapped.botId = botId; // Inject botId into payload
                
                this.logger.info("IM", `[Feishu][${config.name}] Message received: sender=${wrapped.senderOpenId}, chatId=${wrapped.chatId}`);

                if (wrapped.senderOpenId) {
                  this.adminCaptureService.captureInbound(wrapped.senderOpenId, this.providerId);
                }

                await this.bus.execute(SYMBOLS.IngestIMMessageUsecase, {
                  providerId: this.providerId,
                  provider: this,
                  payload: wrapped
                });
              } catch (err: any) {
                this.logger.error("IM", `Feishu[${botId}]: Failed to handle message`, err);
              }
            })();
            return { code: 0, msg: "success" };
          },
          "card.action.trigger": async (data: any) => {
            const action = data?.action || {};
            const value = action?.value || {};
            const operator = data?.operator || {};
            const form_value = action?.form_value || {}; 
            
            this.logger.info("IM", `[Feishu][${config.name}] Card action: ${JSON.stringify(value)} from ${operator.open_id}`);
            
            const rawProjectId = value.projectId || value.project_id;
            if (rawProjectId) {
              (async () => {
                try {
                  const p = this.projectStore.readProjectById(rawProjectId);
                  if (p && p.projectRoot) {
                    const answers: any[] = [];
                    if (value.action_type === "custom_submit") {
                      answers.push({ id: value.question_id, answer: form_value["custom_reply"] || "" });
                    } else if (value.option) {
                      answers.push({ id: value.questionId || value.question_id, answer: value.option });
                    }

                    if (answers.length > 0) {
                      await SessionContext.run({ projectRoot: p.projectRoot }, async () => {
                        await this.sessionAppService.queueInboundText(JSON.stringify({ answers }), p.projectId);
                      });
                    }
                  }
                } catch (err) {
                  this.logger.error("IM", `Feishu[${botId}]: Card action failed`, err);
                }
              })();
            }
            return { toast: { type: "success", content: "Interaction received" } };
          }
        });

        const wsClient = new WSClient({ appId, appSecret });
        await wsClient.start({ eventDispatcher: dispatcher });
        runtime.wsClient = wsClient;
        runtime.state = "running";
      } else {
        runtime.state = "running"; // Webhook mode is always "running" if enabled
      }

      this.botInstances.set(botId, runtime);
      this.runtimeStore.touchStatus(`${this.providerId}:${botId}`, { lastError: "" });
    } catch (err: any) {
      this.logger.error("IM", `Feishu: Failed to start bot ${botId}`, err);
      throw err;
    }
  }

  /**
   * Stop the Feishu provider and all bot instances.
   */
  async stop(): Promise<void> {
    try {
      for (const [botId, runtime] of this.botInstances) {
        this.logger.info("IM", `[Feishu] Stopping bot instance: ${botId}...`);
        if (runtime.wsClient) {
          try {
            if (typeof runtime.wsClient.close === "function") await runtime.wsClient.close({ force: true });
            else if (typeof runtime.wsClient.stop === "function") await runtime.wsClient.stop();
          } catch (e) {
            this.logger.warn("IM", `[Feishu] Error closing WS client for ${botId}: ${e}`);
          }
        }
      }
    } finally {
      this.botInstances.clear();
      this.masterBotId = null;
      this.events.emitIMStateChanged(this.providerId, this.status());
    }
  }

  /**
   * Get the current status of the provider.
   */
  status() {
    const activeBots = Array.from(this.botInstances.values()).map(b => ({
      id: b.id,
      name: b.config.name,
      state: b.state,
      isMaster: b.id === this.masterBotId
    }));

    return {
      state: this.botInstances.size > 0 ? "running" : "idle",
      activeBots,
      masterBotId: this.masterBotId
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

  async sendMessage(input: { 
    chatId: string; 
    text: string; 
    credentials: IMCredentials; 
    kind?: string; 
    projectId?: string;
    botId?: string; // New field
  }): Promise<{ messageId?: string }> {
    
    // 1. Determine which bot instance to use
    let targetBotId = input.botId;
    if (!targetBotId && input.projectId) {
      const binding = await this.imBindingService.readBindingInfo(this.providerId, this.projectStore.readProjectById(input.projectId)?.projectRoot);
      targetBotId = binding.botId;
    }
    
    // Fallback to master bot
    if (!targetBotId) targetBotId = this.masterBotId || "default";

    const runtime = this.botInstances.get(targetBotId);
    if (!runtime) {
      throw new Error(`Bot instance not found or not running: ${targetBotId}`);
    }

    const client = runtime.client;
    
    try {
      this.logger.info("IM", `[Feishu][${runtime.config.name}] Sending message to ${input.chatId}`);
      
      let msgType = "text";
      let msgContent: any = { text: input.text };

      const trimmedText = input.text.trim();
      let jsonStr = trimmedText;
      if (trimmedText.includes("```json")) {
        jsonStr = trimmedText.split("```json")[1].split("```")[0].trim();
      } else if (trimmedText.includes("```")) {
        jsonStr = trimmedText.split("```")[1].split("```")[0].trim();
      }

      const isJsonLike = jsonStr.startsWith("[") || jsonStr.startsWith("{");
      const shouldTryInteractive = input.kind === "interactive" || (isJsonLike && jsonStr.includes('"options":'));

      if (shouldTryInteractive && isJsonLike) {
        try {
          const parsed = JSON.parse(jsonStr);
          const questions = Array.isArray(parsed) ? parsed : [parsed];
          msgType = "interactive";
          
          const questionLabel = `🤖 ${this.versionManager.appName} Interaction Decision`;
          const questionDesc = String(questions.map((q: any) => q.label).join("\n"));
          const projectId = String(input.projectId || "");
          
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
                text: { content: String(opt), tag: "plain_text" },
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

          msgContent = {
            config: { wide_screen_mode: true },
            header: {
              title: { content: questionLabel, tag: "plain_text" },
              template: "blue"
            },
            elements: [
              { tag: "div", text: { content: questionDesc, tag: "lark_md" } },
              ...actionBlocks
            ],
            footer: {
              content: { tag: "plain_text", content: `Sent from ${this.versionManager.appName}` }
            }
          };
        } catch (e: any) {
          this.logger.warn("IM", `[Feishu] Failed to parse card JSON: ${e.message}`);
        }
      }

      const receiveId = String(input.chatId).trim();
      const receiveIdType = receiveId.startsWith("ou_") ? "open_id" : "chat_id";

      const res = await client.im.message.create({
        params: { receive_id_type: receiveIdType as any },
        data: {
          receive_id: receiveId,
          msg_type: msgType as any,
          content: JSON.stringify(msgContent),
        },
      });

      if (res.code !== 0) {
        throw new Error(`Feishu API Error: ${res.msg} (code: ${res.code})`);
      }

      return { messageId: res.data?.message_id };
    } catch (err: any) {
      this.logger.error("IM", `[Feishu] Failed to send message: ${err.message}`);
      throw err;
    }
  }

  async createOrBindGroup(input: {
    projectId: string;
    projectName: string;
    credentials: IMCredentials;
    routingPolicy: IMRoutingPolicy;
    forceRecreate?: boolean;
    botId?: string; // New field
  }): Promise<{ chatId: string }> {
    
    // 1. Determine which bot instance to use
    const project = this.projectStore.readProjectById(input.projectId);
    const bindingInfo = await this.imBindingService.readBindingInfo(this.providerId, project?.projectRoot);
    
    let targetBotId = input.botId || bindingInfo.botId;
    if (!targetBotId) targetBotId = this.masterBotId || "default";

    const runtime = this.botInstances.get(targetBotId);
    if (!runtime) {
      throw new Error(`Bot instance not found or not running: ${targetBotId}`);
    }

    const client = runtime.client;
    let currentChatId = bindingInfo.chatId;

    if (currentChatId && !input.forceRecreate) {
      try {
        const chatInfo = await client.im.chat.get({ path: { chat_id: currentChatId } });
        if (chatInfo.code === 0 && chatInfo.data) {
          return { chatId: currentChatId };
        }
      } catch (err: any) {
        this.logger.warn("IM", `[Feishu] Chat validation failed: ${err.message}`);
      }
    }

    if (input.routingPolicy.autoCreateGroup !== false) {
      try {
        const projectName = input.projectName || "Project";
        const botName = runtime.config.name || this.versionManager.appName;
        const res = await client.im.chat.create({
          params: { user_id_type: "open_id" },
          data: {
            name: `${botName}: ${projectName}`,
            description: `Project: ${input.projectId}`,
            user_id_list: input.credentials.userOpenId ? [input.credentials.userOpenId] : []
          }
        });

        if (res.code === 0 && res.data?.chat_id) {
          const newChatId = res.data.chat_id;
          await this.imBindingService.bindChatId({
            chatId: newChatId,
            botId: targetBotId,
            explicitRoot: project?.projectRoot
          });
          
          // Trigger a message to confirm binding
          await this.sendBindingSuccessMessage(client, newChatId, project?.projectRoot || "");

          return { chatId: newChatId };
        }
        throw new Error(`Feishu API Error: ${res.msg} (code: ${res.code})`);
      } catch (err: any) {
        this.logger.error("IM", `[Feishu] Group creation failed: ${err.message}`);
        throw err;
      }
    }

    throw new Error("FEISHU_CHAT_ID_REPAIR_FAILED");
  }

  /**
   * Handle incoming webhooks from Feishu.
   */
  async handleWebhook(payload: any): Promise<any> {
    this.logger.debug("IM", `[Feishu] handleWebhook raw payload: ${JSON.stringify(payload)}`);
    if (payload?.challenge) {
      return { challenge: payload.challenge };
    }

    // [New] Handle Encrypted Webhook
    let decryptedPayload = payload;
    if (payload?.encrypt) {
      this.logger.info("IM", "[Feishu] Encrypted webhook detected, attempting decryption...");
      try {
        // We need the Encrypt Key from the bot instance.
        // Since we don't have botId here, we'll have to look up all instances or use a fallback.
        // However, usually the user only has one active bot per webhook endpoint.
        const cfg = await this.configService.readConfig();
        const plugin = cfg.plugins[this.providerId];
        let encryptKey = String(plugin?.credentials?.signEncryptKey || "");
        
        // If we have a botId injected earlier (from controller), use that instance's key
        const botId = payload.botId;
        if (botId && plugin?.instances) {
          const inst = plugin.instances.find(i => i.id === botId);
          if (inst?.credentials?.signEncryptKey) {
            encryptKey = inst.credentials.signEncryptKey;
          }
        }

        if (encryptKey) {
          decryptedPayload = this.decryptWebhook(payload.encrypt, encryptKey);
          this.logger.debug("IM", `[Feishu] Decrypted payload: ${JSON.stringify(decryptedPayload)}`);
          if (decryptedPayload?.challenge) return { challenge: decryptedPayload.challenge };
        } else {
          this.logger.warn("IM", "[Feishu] Encrypted webhook received but no Encrypt Key found in config.");
        }
      } catch (e: any) {
        this.logger.error("IM", `[Feishu] Webhook decryption failed: ${e.message}`);
        // Return original payload as fallback
      }
    }

    const finalPayload = decryptedPayload || {};
    // According to official Feishu Node SDK documentation structure:
    // payload passed in might be { message: {...}, sender: {...} }
    // or native { event: { message: {...}, sender: {...} } }
    let message = finalPayload?.message;
    let sender = finalPayload?.sender;
    
    if (!message && finalPayload?.event) {
      message = finalPayload.event.message;
      sender = finalPayload.event.sender;
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

  public decryptWebhook(encrypt: string, encryptKey: string): any {
    const key = createHash("sha256").update(encryptKey).digest();
    const iv = key.slice(0, 16);
    const decipher = createDecipheriv("aes-256-cbc", key, iv);
    let decrypted = decipher.update(encrypt, "base64", "utf8");
    decrypted += decipher.final("utf8");
    return JSON.parse(decrypted);
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

  private async sendConnectionMessage(client: any, receiveId: string) {
    const appName = this.versionManager.appName;
    const prefix = this.versionManager.protocolPrefix;
    await client.im.message.create({
      params: { receive_id_type: "chat_id" },
      data: {
        receive_id: receiveId,
        msg_type: "post",
        content: JSON.stringify({
          zh_cn: {
            title: `🚀 ${appName} 连接成功`,
            content: [
              [{ tag: "text", text: `欢迎使用 ${appName}！你的项目已成功连接到飞书。` }],
              [{ tag: "text", text: `你可以直接在此群组中与 AI 助手对话，或者在 IDE 中调用 '${prefix}_orchestrate' 指令。` }]
            ]
          }
        })
      }
    });
  }

  private async sendBindingSuccessMessage(client: any, receiveId: string, projectRoot: string) {
    const appName = this.versionManager.appName;
    const prefix = this.versionManager.protocolPrefix;
    await client.im.message.create({
      params: { receive_id_type: "chat_id" },
      data: {
        receive_id: receiveId,
        msg_type: "post",
        content: JSON.stringify({
          zh_cn: {
            title: `✅ ${appName} 绑定成功`,
            content: [
              [{ tag: "text", text: `群组已成功绑定到项目路径：\n${projectRoot}` }],
              [{ tag: "text", text: `现在你可以通过飞书直接控制该项目的编排流程。` }],
              [{ tag: "text", text: `提示：如果这是新项目，请确保 AI 已执行过 '${prefix}_init'。` }]
            ]
          }
        })
      }
    });
  }
}
