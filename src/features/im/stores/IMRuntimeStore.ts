import { injectable } from "inversify";
import { IMRuntimeStatus, IMAdminCaptureStatus } from "../types/IMTypes.js";

@injectable()
export class IMRuntimeStore {
  private readonly runtime = new Map<string, IMRuntimeStatus>();
  private readonly adminCapture: IMAdminCaptureStatus = {
    active: false,
    startedAt: "",
    expiresAt: "",
    capturedAt: "",
    capturedOpenId: ""
  };

  public getStatus(providerId: string): IMRuntimeStatus {
    return this.runtime.get(providerId) || this.defaultRuntime();
  }

  public setStatus(providerId: string, status: IMRuntimeStatus): void {
    this.runtime.set(providerId, status);
  }

  public touchStatus(providerId: string, patch: Partial<IMRuntimeStatus>): void {
    const current = this.getStatus(providerId);
    this.setStatus(providerId, { ...current, ...patch, updatedAt: new Date().toISOString() });
  }

  public getAdminCapture(): IMAdminCaptureStatus {
    return { ...this.adminCapture };
  }

  public touchAdminCapture(patch: Partial<IMAdminCaptureStatus>): void {
    Object.assign(this.adminCapture, patch);
  }

  private defaultRuntime(): IMRuntimeStatus {
    return {
      inboundTotal: 0,
      inboundIgnored: 0,
      inboundQueued: 0,
      attachmentSaved: 0,
      attachmentFailed: 0,
      lastError: "",
      lastErrorCode: "",
      lastBlockReason: "",
      updatedAt: ""
    };
  }
}
