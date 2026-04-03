import { IMCredentials, IMRoutingPolicy } from "../IMProvider.js";

export interface IMBotInstance {
  id: string;
  name: string;
  enabled: boolean;
  credentials: IMCredentials & {
    appId?: string;
    appSecret?: string;
    botName?: string;
    userOpenId?: string;
    verificationToken?: string;
    signEncryptKey?: string;
  };
  routingPolicy: IMRoutingPolicy & {
    autoCreateGroup?: boolean;
    connectionMode?: "webhook" | "long_connection";
    pollFallbackEnabled?: boolean;
    chatId?: string;
  };
  updatedAt?: string;
}

export interface IMPluginConfig {
  enabled: boolean;
  masterBotId?: string; // 全局主机器人 ID
  instances?: IMBotInstance[]; // 机器人实例列表 (多实例模式)
  
  // 保持旧版兼容字段 (Legacy support)
  credentials?: IMCredentials & {
    appId?: string;
    appSecret?: string;
    botName?: string;
    userOpenId?: string;
    verificationToken?: string;
    signEncryptKey?: string;
  };
  routingPolicy?: IMRoutingPolicy & {
    autoCreateGroup?: boolean;
    connectionMode?: "webhook" | "long_connection";
    pollFallbackEnabled?: boolean;
    chatId?: string;
  };
  updatedAt?: string;
}

export interface IMConfig {
  plugins: Record<string, IMPluginConfig>;
  updatedAt?: string;
}

export interface IMRuntimeStatus {
  inboundTotal: number;
  inboundIgnored: number;
  inboundQueued: number;
  attachmentSaved: number;
  attachmentFailed: number;
  lastError: string;
  lastErrorCode: string;
  lastBlockReason: string;
  updatedAt: string;
}

export interface IMAdminCaptureStatus {
  active: boolean;
  startedAt: string;
  expiresAt: string;
  capturedAt: string;
  capturedOpenId: string;
}
