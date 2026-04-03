export type IMCredentials = Record<string, string>;
export type IMRoutingPolicy = Record<string, any>;

export interface IMProvider {
  readonly providerId: string;
  readonly supportsLongConnection: boolean;
  
  health(): Promise<{ ok: boolean; message?: string }>;
  
  // Lifecycle management
  start?(): Promise<void>;
  stop?(): Promise<void>;
  status?(): any;

  sendMessage(input: { chatId: string; text: string; credentials: IMCredentials; kind?: string; projectId?: string; botId?: string }): Promise<{ messageId?: string }>;
  validateChat?(input: {
    chatId: string;
    credentials: IMCredentials;
  }): Promise<{ exists: boolean; isGroup: boolean; chatType?: string }>;
  createOrBindGroup(input: {
    projectId: string;
    projectName: string;
    credentials: IMCredentials;
    routingPolicy: IMRoutingPolicy;
    forceRecreate?: boolean;
    botId?: string;
  }): Promise<{ chatId: string }>;
  handleWebhook(payload: any): Promise<any>;
  fetchAttachment(input: {
    message: any;
    credentials: IMCredentials;
  }): Promise<{
    kind: "image" | "file";
    fileName: string;
    mimeType: string;
    content: Buffer;
  } | null>;
}

