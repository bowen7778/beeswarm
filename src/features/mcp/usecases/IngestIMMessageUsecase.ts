import { injectable, inject } from "inversify";
import { SYMBOLS } from "../../../common/di/symbols.js";
import { IUsecase } from "../../../common/bus/UsecaseBus.js";
import { MessageCoreService } from "../message/MessageCoreService.js";
import type { IMProvider } from "../../im/IMProvider.js";

export interface IngestIMMessageInput {
  providerId: string;
  provider: IMProvider;
  payload: any;
}

export interface IngestIMMessageOutput {
  queued: boolean;
  reason?: string;
  count: number;
}

@injectable()
export class IngestIMMessageUsecase implements IUsecase<IngestIMMessageInput, IngestIMMessageOutput> {
  constructor(
    @inject(SYMBOLS.MessageCoreService) private readonly messageCore: MessageCoreService
  ) {}

  async execute(input: IngestIMMessageInput): Promise<IngestIMMessageOutput> {
    return await this.messageCore.ingestDecodedIMMessage(
      input.providerId,
      input.provider,
      input.payload
    );
  }
}
