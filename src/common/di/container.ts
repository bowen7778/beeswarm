import { Container } from "inversify";
import { SYMBOLS } from "./symbols.js";

// Infrastructure
import { PathResolverService } from "../../features/runtime/PathResolverService.js";
import { LoggerService } from "../../features/runtime/LoggerService.js";
import { SecretService } from "../../features/runtime/SecretService.js";
import { DatabaseService } from "../../features/runtime/DatabaseService.js";
import { MigrationService } from "../../features/runtime/MigrationService.js";
import { VersionManager } from "../../features/runtime/VersionManager.js";
import { UpdateWorkerService } from "../../features/runtime/UpdateWorkerService.js";
import { AppConfig } from "../../features/runtime/AppConfig.js";
import { LifecycleManager } from "../../features/runtime/LifecycleManager.js";
import { ConfigRepository } from "../../platform/repositories/ConfigRepository.js";

// Stores
import { McpSessionStore } from "../../features/mcp/stores/McpSessionStore.js";
import { IMRuntimeStore } from "../../features/im/stores/IMRuntimeStore.js";
import { ProjectStore } from "../../features/mcp/stores/ProjectStore.js";
import { McpSessionBindingStore } from "../../features/mcp/stores/McpSessionBindingStore.js";
import { ProjectModeStore } from "../../features/mcp/stores/ProjectModeStore.js";
import { MemoryStore } from "../../features/mcp/stores/MemoryStore.js";
import { RouteStore } from "../../features/mcp/stores/RouteStore.js";
import { IMConfigService } from "../../features/im/services/IMConfigService.js";
import { IMBindingService } from "../../features/im/services/IMBindingService.js";
import { IMAdminCaptureService } from "../../features/im/services/IMAdminCaptureService.js";
import { IMWebhookIngressService } from "../../features/im/services/IMWebhookIngressService.js";
import { ProjectModeLockStore } from "../../features/project-mode/stores/ProjectModeLockStore.js";
import { HarnessStore } from "../../features/harness/stores/HarnessStore.js";

// Services
import { SessionService } from "../../features/runtime/SessionService.js";
import { WindowService } from "../../features/runtime/WindowService.js";
import { TrayService } from "../../features/runtime/TrayService.js";
import { UIService } from "../../features/runtime/UIService.js";
import { HttpServerService } from "../../features/runtime/HttpServerService.js";
import { StaticAssetService } from "../../features/runtime/StaticAssetService.js";
import { RouteRegistry } from "../../api/routes/RouteRegistry.js";
import { McpResourceService } from "../../features/mcp/services/McpResourceService.js";
import { ProjectIdentityService } from "../../features/mcp/project/ProjectIdentityService.js";
import { MasterSingletonService } from "../../features/runtime/MasterSingletonService.js";
import { McpDiscoveryService } from "../../features/runtime/McpDiscoveryService.js";
import { PortOwnershipService } from "../../features/runtime/PortOwnershipService.js";
import { IMRuntimeOrchestrator } from "../../features/runtime/IMRuntimeOrchestrator.js";
import { McpSSEBridgeService } from "../../features/runtime/sse/mcp/McpSSEBridgeService.js";
import { IMAttachmentService } from "../../features/im/services/IMAttachmentService.js";
import { MessageCoreService } from "../../features/mcp/message/MessageCoreService.js";
import { MessageOutboxService } from "../../features/mcp/message/MessageOutboxService.js";
import { MessageManagerStore } from "../../features/mcp/message/MessageManagerStore.js";
import { MessageEvents } from "../../features/mcp/message/MessageEvents.js";
import { RoutingKernelService } from "../../features/mcp/message/RoutingKernelService.js";
import { ConversationQueryService } from "../../features/mcp/session/ConversationQueryService.js";
import { SessionApplicationService } from "../../features/mcp/session/SessionApplicationService.js";
import { StreamSnapshotService } from "../../features/runtime/sse/StreamSnapshotService.js";
import { MetricsService } from "../../features/metrics/MetricsService.js";
import { ProjectContextService } from "../../features/mcp/project/ProjectContextService.js";
import { ProjectModeStatusService } from "../../features/project-mode/services/ProjectModeStatusService.js";
import { ToolRegistryService } from "../../features/mcp/services/ToolRegistryService.js";
import { ChannelDriverRegistry } from "../../features/channel/kernel-core/execution/driver/ChannelDriverRegistry.js";
import { McpIdeChannelDriver } from "../../features/channel/channel-ide/drivers/McpIdeChannelDriver.js";
import { CodexCliChannelDriver } from "../../features/channel/channel-cli/drivers/CodexCliChannelDriver.js";
import { CloudCodeCliChannelDriver } from "../../features/channel/channel-cli/drivers/CloudCodeCliChannelDriver.js";
import { OrchestratorReservedChannelDriver } from "../../features/channel/channel-orchestrator-reserved/drivers/OrchestratorReservedChannelDriver.js";
import { HarnessTelemetryService } from "../../features/harness/HarnessTelemetryService.js";
import { HarnessExecutionService } from "../../features/harness/HarnessExecutionService.js";
import { HarnessEvaluationService } from "../../features/harness/HarnessEvaluationService.js";
import { HarnessReplayService } from "../../features/harness/HarnessReplayService.js";
import { HarnessGateService } from "../../features/harness/HarnessGateService.js";
import { HarnessQueryService } from "../../features/harness/HarnessQueryService.js";
import { HarnessFailureClassifierService } from "../../features/harness/HarnessFailureClassifierService.js";
import { MemoryCoreService } from "../../features/memory/MemoryCoreService.js";

// Providers & Registry
import { FeishuProvider } from "../../features/im/feishu/FeishuProvider.js";
import { IMPluginRegistry } from "../../features/im/IMPluginRegistry.js";
import type { IMProvider } from "../../features/im/IMProvider.js";

// Usecases
import { StartMcpServerUsecase } from "../../features/mcp/usecases/StartMcpServerUsecase.js";
import { SetupSSESessionUsecase } from "../../features/mcp/usecases/SetupSSESessionUsecase.js";
import { EnsureProjectModeAllowsMessageUsecase } from "../../features/mcp/usecases/EnsureProjectModeAllowsMessageUsecase.js";
import { SendMessageUsecase } from "../../features/im/usecases/SendMessageUsecase.js";
import { ValidateWebhookUsecase } from "../../features/im/usecases/ValidateWebhookUsecase.js";
import { CreateOrBindGroupUsecase } from "../../features/im/usecases/CreateOrBindGroupUsecase.js";
import { SwitchProjectModeUsecase } from "../../features/project-mode/usecases/SwitchProjectModeUsecase.js";
import { SwitchProjectChannelUsecase } from "../../features/project-mode/usecases/SwitchProjectChannelUsecase.js";
import { IngestIMMessageUsecase } from "../../features/mcp/usecases/IngestIMMessageUsecase.js";

// Facades
import { McpFacade } from "../../features/mcp/facade/McpFacade.js";
import { IMFacade } from "../../features/im/facade/IMFacade.js";
import { ProjectModeFacade } from "../../features/project-mode/facade/ProjectModeFacade.js";
import { ChannelFacade } from "../../features/channel/facade/ChannelFacade.js";

// Bus
import { UsecaseBus } from "../bus/UsecaseBus.js";

// Controllers
import { IMController } from "../../api/controllers/IMController.js";
import { SystemController } from "../../api/controllers/SystemController.js";
import { SessionController } from "../../api/controllers/SessionController.js";
import { MonitorController } from "../../api/controllers/MonitorController.js";
import { ProjectModeController } from "../../api/controllers/ProjectModeController.js";
import { ChannelController } from "../../api/controllers/ChannelController.js";
import { HarnessController } from "../../api/controllers/HarnessController.js";

let appContainer: Container | null = null;

function buildContainer(): Container {
  const container = new Container();

  container.bind<PathResolverService>(SYMBOLS.PathResolverService).to(PathResolverService).inSingletonScope();
  container.bind<LoggerService>(SYMBOLS.LoggerService).to(LoggerService).inSingletonScope();
  container.bind<SecretService>(SYMBOLS.SecretService).to(SecretService).inSingletonScope();
  container.bind<DatabaseService>(SYMBOLS.DatabaseService).to(DatabaseService).inSingletonScope();
  container.bind<ConfigRepository>(SYMBOLS.ConfigRepository).to(ConfigRepository).inSingletonScope();
  container.bind<MigrationService>(SYMBOLS.MigrationService).to(MigrationService).inSingletonScope();
  container.bind<VersionManager>(SYMBOLS.VersionManager).to(VersionManager).inSingletonScope();
  container.bind<UpdateWorkerService>(SYMBOLS.UpdateWorkerService).to(UpdateWorkerService).inSingletonScope();
  container.bind<AppConfig>(SYMBOLS.AppConfig).to(AppConfig).inSingletonScope();
  container.bind<LifecycleManager>(SYMBOLS.LifecycleManager).to(LifecycleManager).inSingletonScope();

  container.bind<McpSessionStore>(McpSessionStore).toSelf().inSingletonScope();
  container.bind<IMRuntimeStore>(IMRuntimeStore).toSelf().inSingletonScope();
  container.bind<ProjectStore>(SYMBOLS.ProjectStore).to(ProjectStore).inSingletonScope();
  container.bind<McpSessionBindingStore>(SYMBOLS.McpSessionBindingStore).to(McpSessionBindingStore).inSingletonScope();
  container.bind<ProjectModeStore>(SYMBOLS.ProjectModeStore).to(ProjectModeStore).inSingletonScope();
  container.bind<MemoryStore>(SYMBOLS.MemoryStore).to(MemoryStore).inSingletonScope();
  container.bind<RouteStore>(SYMBOLS.RouteStore).to(RouteStore).inSingletonScope();
  container.bind<IMConfigService>(IMConfigService).toSelf().inSingletonScope();
  container.bind<IMBindingService>(SYMBOLS.IMBindingService).to(IMBindingService).inSingletonScope();
  container.bind<IMAdminCaptureService>(SYMBOLS.IMAdminCaptureService).to(IMAdminCaptureService).inSingletonScope();
  container.bind<ProjectModeLockStore>(ProjectModeLockStore).toSelf().inSingletonScope();
  container.bind<HarnessStore>(SYMBOLS.HarnessStore).to(HarnessStore).inSingletonScope();

  container.bind<SessionService>(SYMBOLS.SessionService).to(SessionService).inSingletonScope();
  container.bind<TrayService>(SYMBOLS.TrayService).to(TrayService).inSingletonScope();
  container.bind<UIService>(SYMBOLS.UIService).to(UIService).inSingletonScope();
  container.bind<HttpServerService>(SYMBOLS.HttpServerService).to(HttpServerService).inSingletonScope();
  container.bind<StaticAssetService>(SYMBOLS.StaticAssetService).to(StaticAssetService).inSingletonScope();
  container.bind<RouteRegistry>(SYMBOLS.RouteRegistry).to(RouteRegistry).inSingletonScope();
  container.bind<McpResourceService>(McpResourceService).toSelf().inSingletonScope();
  container.bind<ProjectIdentityService>(SYMBOLS.ProjectIdentityService).to(ProjectIdentityService).inSingletonScope();
  container.bind<MasterSingletonService>(SYMBOLS.MasterSingletonService).to(MasterSingletonService).inSingletonScope();
  container.bind<McpDiscoveryService>(SYMBOLS.McpDiscoveryService).to(McpDiscoveryService).inSingletonScope();
  container.bind<PortOwnershipService>(SYMBOLS.PortOwnershipService).to(PortOwnershipService).inSingletonScope();
  container.bind<IMRuntimeOrchestrator>(SYMBOLS.IMRuntimeOrchestrator).to(IMRuntimeOrchestrator).inSingletonScope();
  container.bind<McpSSEBridgeService>(SYMBOLS.McpSSEBridgeService).to(McpSSEBridgeService).inSingletonScope();
  container.bind<IMAttachmentService>(IMAttachmentService).toSelf().inSingletonScope();
  container.bind<MessageCoreService>(SYMBOLS.MessageCoreService).to(MessageCoreService).inSingletonScope();
  container.bind<MessageOutboxService>(SYMBOLS.MessageOutboxService).to(MessageOutboxService).inSingletonScope();
  container.bind<MessageManagerStore>(SYMBOLS.MessageManagerStore).to(MessageManagerStore).inSingletonScope();
  container.bind<MessageEvents>(SYMBOLS.MessageEvents).to(MessageEvents).inSingletonScope();
  container.bind<RoutingKernelService>(SYMBOLS.RoutingKernelService).to(RoutingKernelService).inSingletonScope();
  container.bind<ConversationQueryService>(SYMBOLS.ConversationQueryService).to(ConversationQueryService).inSingletonScope();
  container.bind<SessionApplicationService>(SYMBOLS.SessionApplicationService).to(SessionApplicationService).inSingletonScope();
  container.bind<StreamSnapshotService>(SYMBOLS.StreamSnapshotService).to(StreamSnapshotService).inSingletonScope();
  container.bind<MetricsService>(SYMBOLS.MetricsService).to(MetricsService).inSingletonScope();
  container.bind<ProjectContextService>(SYMBOLS.ProjectContextService).to(ProjectContextService).inSingletonScope();
  container.bind<ProjectModeStatusService>(SYMBOLS.ProjectModeStatusService).to(ProjectModeStatusService).inSingletonScope();
  container.bind<ToolRegistryService>(SYMBOLS.ToolRegistryService).to(ToolRegistryService).inSingletonScope();
  container.bind<ChannelDriverRegistry>(SYMBOLS.ChannelDriverRegistry).to(ChannelDriverRegistry).inSingletonScope();
  container.bind<McpIdeChannelDriver>(SYMBOLS.McpIdeChannelDriver).to(McpIdeChannelDriver).inSingletonScope();
  container.bind<CodexCliChannelDriver>(SYMBOLS.CodexCliChannelDriver).to(CodexCliChannelDriver).inSingletonScope();
  container.bind<CloudCodeCliChannelDriver>(SYMBOLS.CloudCodeCliChannelDriver).to(CloudCodeCliChannelDriver).inSingletonScope();
  container.bind<OrchestratorReservedChannelDriver>(SYMBOLS.OrchestratorReservedChannelDriver).to(OrchestratorReservedChannelDriver).inSingletonScope();
  container.bind<HarnessTelemetryService>(SYMBOLS.HarnessTelemetryService).to(HarnessTelemetryService).inSingletonScope();
  container.bind<HarnessExecutionService>(SYMBOLS.HarnessExecutionService).to(HarnessExecutionService).inSingletonScope();
  container.bind<HarnessEvaluationService>(SYMBOLS.HarnessEvaluationService).to(HarnessEvaluationService).inSingletonScope();
  container.bind<HarnessReplayService>(SYMBOLS.HarnessReplayService).to(HarnessReplayService).inSingletonScope();
  container.bind<HarnessGateService>(SYMBOLS.HarnessGateService).to(HarnessGateService).inSingletonScope();
  container.bind<HarnessQueryService>(SYMBOLS.HarnessQueryService).to(HarnessQueryService).inSingletonScope();
  container.bind<HarnessFailureClassifierService>(SYMBOLS.HarnessFailureClassifierService).to(HarnessFailureClassifierService).inSingletonScope();
  container.bind<MemoryCoreService>(SYMBOLS.MemoryCoreService).to(MemoryCoreService).inSingletonScope();
  container.bind<IMWebhookIngressService>(SYMBOLS.IMWebhookIngressService).to(IMWebhookIngressService).inSingletonScope();

  container.bind<IMProvider>(SYMBOLS.IMProvider).to(FeishuProvider).inSingletonScope();
  container.bind<IMPluginRegistry>(SYMBOLS.IMPluginRegistry).to(IMPluginRegistry).inSingletonScope();

  container.bind<StartMcpServerUsecase>(SYMBOLS.StartMcpServerUsecase).to(StartMcpServerUsecase).inSingletonScope();
  container.bind<SetupSSESessionUsecase>(SYMBOLS.SetupSSESessionUsecase).to(SetupSSESessionUsecase).inSingletonScope();
  container.bind<EnsureProjectModeAllowsMessageUsecase>(SYMBOLS.EnsureProjectModeAllowsMessageUsecase).to(EnsureProjectModeAllowsMessageUsecase).inSingletonScope();
  container.bind<SendMessageUsecase>(SYMBOLS.SendMessageUsecase).to(SendMessageUsecase).inSingletonScope();
  container.bind<ValidateWebhookUsecase>(SYMBOLS.ValidateWebhookUsecase).to(ValidateWebhookUsecase).inSingletonScope();
  container.bind<CreateOrBindGroupUsecase>(SYMBOLS.CreateOrBindGroupUsecase).to(CreateOrBindGroupUsecase).inSingletonScope();
  container.bind<SwitchProjectModeUsecase>(SYMBOLS.SwitchProjectModeUsecase).to(SwitchProjectModeUsecase).inSingletonScope();
  container.bind<SwitchProjectChannelUsecase>(SYMBOLS.SwitchProjectChannelUsecase).to(SwitchProjectChannelUsecase).inSingletonScope();
  container.bind<IngestIMMessageUsecase>(SYMBOLS.IngestIMMessageUsecase).to(IngestIMMessageUsecase).inSingletonScope();

  container.bind<McpFacade>(SYMBOLS.McpFacade).to(McpFacade).inSingletonScope();
  container.bind<IMFacade>(SYMBOLS.IMFacade).to(IMFacade).inSingletonScope();
  container.bind<ProjectModeFacade>(SYMBOLS.ProjectModeFacade).to(ProjectModeFacade).inSingletonScope();
  container.bind<ChannelFacade>(SYMBOLS.ChannelFacade).to(ChannelFacade).inSingletonScope();

  const usecaseBus = new UsecaseBus();
  container.bind<UsecaseBus>(SYMBOLS.UsecaseBus).toConstantValue(usecaseBus);
  usecaseBus.setContainer(container);

  container.bind<IMController>(SYMBOLS.IMController).to(IMController).inSingletonScope();
  container.bind<SystemController>(SYMBOLS.SystemController).to(SystemController).inSingletonScope();
  container.bind<SessionController>(SYMBOLS.SessionController).to(SessionController).inSingletonScope();
  container.bind<MonitorController>(SYMBOLS.MonitorController).to(MonitorController).inSingletonScope();
  container.bind<ProjectModeController>(SYMBOLS.ProjectModeController).to(ProjectModeController).inSingletonScope();
  container.bind<ChannelController>(SYMBOLS.ChannelController).to(ChannelController).inSingletonScope();
  container.bind<HarnessController>(SYMBOLS.HarnessController).to(HarnessController).inSingletonScope();

  return container;
}

function initializeContainer(container: Container): Container {
  const outbox = container.get<MessageOutboxService>(SYMBOLS.MessageOutboxService);
  const messageCore = container.get<MessageCoreService>(SYMBOLS.MessageCoreService);
  const conversationQuery = container.get<ConversationQueryService>(SYMBOLS.ConversationQueryService);
  const sessionApplication = container.get<SessionApplicationService>(SYMBOLS.SessionApplicationService);
  const streamSnapshot = container.get<StreamSnapshotService>(SYMBOLS.StreamSnapshotService);
  const imRegistry = container.get<IMPluginRegistry>(SYMBOLS.IMPluginRegistry);
  const imFacade = container.get<IMFacade>(SYMBOLS.IMFacade);
  messageCore.setOutboxService(outbox);
  conversationQuery.setOutboxService(outbox);
  sessionApplication.setOutboxService(outbox);
  streamSnapshot.setIMSnapshotServices(imRegistry, imFacade);

  // 移除容器初始化阶段对 HubSchemaInitializer 的直接调用
  // 统一由 LifecycleManager 在数据库就绪后调用 MigrationService 维护 Schema
  return container;
}

function getContainer(): Container {
  if (!appContainer) {
    appContainer = initializeContainer(buildContainer());
  }
  return appContainer;
}

export const container = {
  get<T>(identifier: symbol | string | Function): T {
    return getContainer().get<T>(identifier as any);
  }
};
