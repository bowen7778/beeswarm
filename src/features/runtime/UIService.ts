import { injectable, inject } from "inversify";
import express from "express";
import { SessionService } from "./SessionService.js";
import { MessageCoreService } from "../mcp/message/MessageCoreService.js";
import { MessageOutboxService } from "../mcp/message/MessageOutboxService.js";
import { MessageEvents } from "../mcp/message/MessageEvents.js";
import { AppConfig } from "./AppConfig.js";
import { HttpServerService } from "./HttpServerService.js";
import { RouteRegistry } from "../../api/routes/RouteRegistry.js";
import { ConversationQueryService } from "../mcp/session/ConversationQueryService.js";
import { SessionApplicationService } from "../mcp/session/SessionApplicationService.js";
import { SYMBOLS } from "../../common/di/symbols.js";
import { LoggerService } from "./LoggerService.js";
import { PathResolverService } from "./PathResolverService.js";

@injectable()
export class UIService {
  private activeConversationToken: string = "";
  private unsubscribeUserInputRelay: (() => void) | null = null;
  private hostStatusProvider: () => any = () => null;
  private hostRestartHandler?: () => Promise<void>;

  constructor(
    @inject(SYMBOLS.HttpServerService) public readonly httpServer: HttpServerService,
    @inject(SYMBOLS.RouteRegistry) private readonly routeRegistry: RouteRegistry,
    @inject(SYMBOLS.SessionService) public readonly session: SessionService,
    @inject(SYMBOLS.MessageCoreService) public readonly messageCore: MessageCoreService,
    @inject(SYMBOLS.MessageOutboxService) public readonly outbox: MessageOutboxService,
    @inject(SYMBOLS.ConversationQueryService) private readonly queryService: ConversationQueryService,
    @inject(SYMBOLS.SessionApplicationService) private readonly applicationService: SessionApplicationService,
    @inject(SYMBOLS.AppConfig) private readonly appConfig: AppConfig,
    @inject(SYMBOLS.PathResolverService) private readonly pathResolver: PathResolverService,
    @inject(SYMBOLS.LoggerService) private readonly logger: LoggerService,
    @inject(SYMBOLS.MessageEvents) private readonly messageEvents: MessageEvents
  ) {}

  get sessionAppService(): SessionApplicationService {
    return this.applicationService;
  }

  get conversationQueryService(): ConversationQueryService {
    return this.queryService;
  }

  public async initialize(baseDir: string) {
    const sessionsDir = this.pathResolver.sessionsDir;
    
    // Initialize sub-services
    await this.session.initialize(baseDir);
    this.outbox.initialize(baseDir);
    this.queryService.initialize(sessionsDir);
    
    this.messageCore.setTokenCallback((token: string) => {
      this.activeConversationToken = token;
    });

    this.routeRegistry.register(this.httpServer.app, () => this.hostStatusProvider());

    this.unsubscribeUserInputRelay = this.messageEvents.onUserInput((payload) => {
      const content = String(payload?.content || "").trim();
      if (!content) return;
      const conversationId = String(payload?.conversationId || "").trim();
      if (conversationId) {
        this.activeConversationToken = conversationId;
      }
    });
  }

  public setHostStatusProvider(provider: () => any) {
    this.hostStatusProvider = provider;
    // Potentially update route registry if it holds a reference
  }

  public setHostRestartHandler(handler: () => Promise<void>) {
    this.hostRestartHandler = handler;
  }

  public async start(port: number): Promise<void> {
    await this.httpServer.start(port, this.appConfig.uiHost);
    // Start Outbox polling task to process pending messages
    await this.outbox.start();
  }

  public async stop(): Promise<void> {
    await this.outbox.stop();
    await this.httpServer.stop();
    if (this.unsubscribeUserInputRelay) {
      this.unsubscribeUserInputRelay();
      this.unsubscribeUserInputRelay = null;
    }
  }

  public isUIActive(): boolean {
    // Basic implementation
    return this.httpServer.isListening();
  }

  public extendRoutes(handler: (app: express.Express) => void) {
    handler(this.httpServer.app);
  }
}
