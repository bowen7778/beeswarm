import { injectable, inject } from "inversify";
import { SYMBOLS } from "../../../common/di/symbols.js";
import { IMFacade } from "../facade/IMFacade.js";
import { IMPluginRegistry } from "../IMPluginRegistry.js";
import { UsecaseBus } from "../../../common/bus/UsecaseBus.js";

@injectable()
export class IMWebhookIngressService {
  constructor(
    @inject(SYMBOLS.IMFacade) private readonly imFacade: IMFacade,
    @inject(SYMBOLS.IMPluginRegistry) private readonly pluginRegistry: IMPluginRegistry,
    @inject(SYMBOLS.UsecaseBus) private readonly bus: UsecaseBus
  ) {}


  public async ingest(providerId: string, payload: {
    headers: Record<string, any>;
    rawBody: string;
    body: any;
  }): Promise<{ statusCode: number; body: any }> {
    const provider = this.pluginRegistry.getProvider(providerId);
    if (!provider) {
      return { statusCode: 404, body: { success: false, error: "PROVIDER_NOT_FOUND" } };
    }

    const check = await this.imFacade.validateWebhookRequest(providerId, payload.headers, payload.rawBody, payload.body || {});
    if (!check.ok) {
      return { statusCode: 403, body: { success: false, error: check.reason || "webhook_blocked" } };
    }

    if (providerId === "feishu" && payload.body?.type === "url_verification") {
      return { statusCode: 200, body: { challenge: payload.body.challenge } };
    }

    const result = await provider.handleWebhook(payload.body || {});
    await this.bus.execute(SYMBOLS.IngestIMMessageUsecase, {
      providerId,
      provider,
      payload: result
    });
    return { statusCode: 200, body: { success: true, result } };

  }
}
