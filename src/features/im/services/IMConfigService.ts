import { injectable, inject } from "inversify";
import path from "node:path";
import fs from "node:fs/promises";
import { SYMBOLS } from "../../../common/di/symbols.js";
import { ConfigRepository } from "../../../platform/repositories/ConfigRepository.js";
import { PathResolverService } from "../../runtime/PathResolverService.js";
import { SecretService } from "../../runtime/SecretService.js";
import { VersionManager } from "../../runtime/VersionManager.js";
import { IMConfig, IMPluginConfig } from "../types/IMTypes.js";

@injectable()
export class IMConfigService {
  private configCache: IMConfig | null = null;
  private configCacheTs = 0;
  private readonly CONFIG_CACHE_TTL = 30000;
  private configMigrationTried = false;

  constructor(
    @inject(SYMBOLS.ConfigRepository) private readonly configRepo: ConfigRepository,
    @inject(SYMBOLS.PathResolverService) private readonly pathResolver: PathResolverService,
    @inject(SYMBOLS.SecretService) private readonly secret: SecretService,
    @inject(SYMBOLS.VersionManager) private readonly versionManager: VersionManager
  ) {}

  public async readConfig(): Promise<IMConfig> {
    const now = Date.now();
    if (this.configCache && (now - this.configCacheTs < this.CONFIG_CACHE_TTL)) {
      return this.configCache;
    }

    await this.tryMigrateLegacyConfig();
    const raw = await this.configRepo.readJson(this.getConfigPath(), { plugins: {} });
    const normalized = this.toRuntimeConfig(raw);

    if (Object.keys(normalized.plugins).length === 0) {
      normalized.plugins["feishu"] = this.defaultPluginConfig();
    }

    this.configCache = normalized;
    this.configCacheTs = now;
    return normalized;
  }

  public async writeConfig(config: IMConfig): Promise<void> {
    const persisted = this.toPersistedConfig(config);
    await fs.mkdir(path.dirname(this.getConfigPath()), { recursive: true });
    await this.configRepo.writeJson(this.getConfigPath(), persisted);
    await this.configRepo.writeJson(this.getBackupConfigPath(), persisted);
    
    this.configCache = null;
    this.configCacheTs = 0;
  }

  public defaultPluginConfig(): IMPluginConfig {
    return {
      enabled: false,
      masterBotId: "default",
      instances: [
        {
          id: "default",
          name: "Default Bot",
          enabled: false,
          credentials: {
            appId: "",
            appSecret: "",
            botName: this.versionManager.appName,
            userOpenId: "",
            verificationToken: "",
            signEncryptKey: ""
          },
          routingPolicy: {
            autoCreateGroup: true,
            connectionMode: "long_connection",
            pollFallbackEnabled: false
          }
        }
      ]
    };
  }

  public async tryMigrateLegacyConfig(): Promise<void> {
    if (this.configMigrationTried) return;
    this.configMigrationTried = true;
    const configPath = this.getConfigPath();
    const backupPath = this.getBackupConfigPath();
    const current = await this.configRepo.readJson<any>(configPath, {});
    if (current?.plugins && typeof current.plugins === "object") return;
    const backup = await this.configRepo.readJson<any>(backupPath, {});
    const legacy = this.pickLegacyConfig(current) || this.pickLegacyConfig(backup);
    if (!legacy) return;
    const migrated = this.migrateLegacyConfig(legacy);
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await this.configRepo.writeJson(configPath, migrated);
    await this.configRepo.writeJson(backupPath, migrated);
  }

  private getConfigPath(): string {
    return path.join(this.pathResolver.configDir, `${this.versionManager.appIdentifier}.im.config.json`);
  }

  private getBackupConfigPath(): string {
    return path.join(this.pathResolver.configDir, `${this.versionManager.appIdentifier}.im.config.backup.json`);
  }

  private pickLegacyConfig(raw: any): any | null {
    if (!raw || typeof raw !== "object") return null;
    if (raw.plugins && typeof raw.plugins === "object") return null;
    const hasLegacyTopFields = [
      "enabled",
      "credentials",
      "routingPolicy",
      "appId",
      "appSecret",
      "verificationToken",
      "signEncryptKey",
      "connectionMode",
      "provider",
      "pluginId"
    ].some((k) => raw[k] != null);
    return hasLegacyTopFields ? raw : null;
  }

  private migrateLegacyConfig(raw: any): IMConfig {
    const providerId = String(raw?.provider || raw?.pluginId || "feishu").trim() || "feishu";
    const defaults = this.defaultPluginConfig();
    const rawCredentials = raw?.credentials || {};
    const rawRouting = raw?.routingPolicy || {};
    
    // Convert single bot to first instance
    const legacyBot = {
      id: "default",
      name: "Default Bot",
      enabled: raw?.enabled != null ? !!raw.enabled : defaults.enabled,
      credentials: {
        appId: String(rawCredentials?.appId || raw?.appId || ""),
        appSecret: String(rawCredentials?.appSecret || raw?.appSecret || ""),
        botName: String(rawCredentials?.botName || raw?.botName || this.versionManager.appName),
        userOpenId: String(rawCredentials?.userOpenId || raw?.userOpenId || ""),
        verificationToken: String(rawCredentials?.verificationToken || raw?.verificationToken || ""),
        signEncryptKey: String(rawCredentials?.signEncryptKey || raw?.signEncryptKey || "")
      },
      routingPolicy: {
        autoCreateGroup: rawRouting?.autoCreateGroup != null ? !!rawRouting.autoCreateGroup : true,
        connectionMode: String(rawRouting?.connectionMode || raw?.connectionMode || "long_connection"),
        pollFallbackEnabled: !!rawRouting?.pollFallbackEnabled
      }
    };

    const migratedPlugin: IMPluginConfig = this.normalizePluginConfig({
      enabled: legacyBot.enabled,
      masterBotId: legacyBot.id,
      instances: [legacyBot]
    });

    return {
      plugins: {
        [providerId]: migratedPlugin
      },
      updatedAt: String(raw?.updatedAt || new Date().toISOString())
    };
  }

  private toRuntimeConfig(raw: any): IMConfig {
    const config: IMConfig = {
      plugins: {},
      updatedAt: raw?.updatedAt || new Date().toISOString()
    };
    if (raw?.plugins) {
      for (const [id, p] of Object.entries(raw.plugins)) {
        config.plugins[id] = this.toRuntimePluginConfig(p);
      }
    }
    return config;
  }

  private toRuntimePluginConfig(raw: any): IMPluginConfig {
    const normalized = this.normalizePluginConfig(raw);
    
    // Decrypt secrets for all instances
    if (normalized.instances) {
      for (const instance of normalized.instances) {
        if (instance.credentials) {
          instance.credentials.appSecret = this.secret.decrypt(instance.credentials.appSecret || "");
          instance.credentials.verificationToken = this.secret.decrypt(instance.credentials.verificationToken || "");
          instance.credentials.signEncryptKey = this.secret.decrypt(instance.credentials.signEncryptKey || "");
        }
      }
    }

    // Decrypt legacy credentials if they exist
    if (normalized.credentials) {
      normalized.credentials.appSecret = this.secret.decrypt(normalized.credentials.appSecret || "");
      normalized.credentials.verificationToken = this.secret.decrypt(normalized.credentials.verificationToken || "");
      normalized.credentials.signEncryptKey = this.secret.decrypt(normalized.credentials.signEncryptKey || "");
    }
    return normalized;
  }

  private toPersistedConfig(config: IMConfig): IMConfig {
    const persisted: IMConfig = {
      plugins: {},
      updatedAt: config.updatedAt || new Date().toISOString()
    };
    for (const [id, p] of Object.entries(config.plugins)) {
      const instances = (p.instances || []).map(instance => {
        const credentials = instance.credentials || {};
        return {
          ...instance,
          credentials: {
            ...credentials,
            appSecret: this.secret.encrypt(credentials.appSecret || ""),
            verificationToken: this.secret.encrypt(credentials.verificationToken || ""),
            signEncryptKey: this.secret.encrypt(credentials.signEncryptKey || "")
          }
        };
      });

      const legacyCredentials = p.credentials || {};
      persisted.plugins[id] = {
        ...p,
        instances,
        credentials: p.credentials ? {
          ...legacyCredentials,
          appSecret: this.secret.encrypt(legacyCredentials.appSecret || ""),
          verificationToken: this.secret.encrypt(legacyCredentials.verificationToken || ""),
          signEncryptKey: this.secret.encrypt(legacyCredentials.signEncryptKey || "")
        } : undefined
      };
    }
    return persisted;
  }

  private normalizePluginConfig(raw: any): IMPluginConfig {
    const defaults = this.defaultPluginConfig();
    const instances = Array.isArray(raw?.instances) ? raw.instances : undefined;
    
    const normalized: IMPluginConfig = {
      ...defaults,
      ...raw
    };

    if (instances) {
      normalized.instances = instances.map((inst: any) => ({
        ...inst,
        credentials: { ...inst?.credentials },
        routingPolicy: { ...inst?.routingPolicy }
      }));
    } else {
      normalized.instances = defaults.instances;
    }

    return normalized;
  }
}
