import { IMCredentials, IMRoutingPolicy } from "../IMProvider.js";

export interface IMPluginConfig {
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
