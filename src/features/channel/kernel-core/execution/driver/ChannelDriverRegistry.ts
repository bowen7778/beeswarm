import { injectable, inject } from "inversify";
import { SYMBOLS } from "../../../../../common/di/symbols.js";
import type { ChannelDriver } from "./ChannelDriver.js";
import type { ChannelType } from "../types/ChannelType.js";
import type { ProjectModeType } from "../types/ProjectModeType.js";
import { McpIdeChannelDriver } from "../../../channel-ide/drivers/McpIdeChannelDriver.js";
import { CodexCliChannelDriver } from "../../../channel-cli/drivers/CodexCliChannelDriver.js";
import { CloudCodeCliChannelDriver } from "../../../channel-cli/drivers/CloudCodeCliChannelDriver.js";
import { OrchestratorReservedChannelDriver } from "../../../channel-orchestrator-reserved/drivers/OrchestratorReservedChannelDriver.js";

@injectable()
export class ChannelDriverRegistry {
  private readonly drivers: ChannelDriver[];

  constructor(
    @inject(SYMBOLS.McpIdeChannelDriver) mcpIdeChannelDriver: McpIdeChannelDriver,
    @inject(SYMBOLS.CodexCliChannelDriver) codexCliChannelDriver: CodexCliChannelDriver,
    @inject(SYMBOLS.CloudCodeCliChannelDriver) cloudCodeCliChannelDriver: CloudCodeCliChannelDriver,
    @inject(SYMBOLS.OrchestratorReservedChannelDriver) orchestratorReservedChannelDriver: OrchestratorReservedChannelDriver
  ) {
    this.drivers = [
      mcpIdeChannelDriver,
      codexCliChannelDriver,
      cloudCodeCliChannelDriver,
      orchestratorReservedChannelDriver
    ];
  }

  findDriver(mode: ProjectModeType, channel: ChannelType): ChannelDriver | null {
    return this.drivers.find((x) => x.supports(mode, channel)) || null;
  }
}

