import { injectable, inject } from "inversify";
import { IMRuntimeStore } from "../stores/IMRuntimeStore.js";

@injectable()
export class IMAdminCaptureService {
  constructor(
    @inject(IMRuntimeStore) private readonly runtimeStore: IMRuntimeStore
  ) {}

  public start(timeoutMs: number = 180000) {
    const now = Date.now();
    const expiresAt = new Date(now + Math.max(30000, timeoutMs)).toISOString();
    this.runtimeStore.touchAdminCapture({
      active: true,
      startedAt: new Date(now).toISOString(),
      expiresAt,
      capturedAt: "",
      capturedOpenId: ""
    });
    return { active: true, expiresAt };
  }

  public getStatus() {
    return this.runtimeStore.getAdminCapture();
  }

  public captureInbound(openId: string, providerId: string): void {
    const normalized = String(openId || "").trim();
    const capture = this.runtimeStore.getAdminCapture();
    const now = Date.now();
    
    process.stderr.write(`[IMAdminCapture] Attempting capture for ${normalized}. Active: ${capture.active}, Expires: ${capture.expiresAt}\n`);

    if (!capture.active) return;
    if (capture.expiresAt && new Date(capture.expiresAt).getTime() < now) {
      this.runtimeStore.touchAdminCapture({ active: false });
      return;
    }
    if (!normalized) return;
    process.stderr.write(`[IMAdminCapture] SUCCESS! Captured OpenID: ${normalized}\n`);
    this.runtimeStore.touchAdminCapture({
      active: false,
      capturedAt: new Date(now).toISOString(),
      capturedOpenId: normalized
    });
    this.runtimeStore.touchStatus(providerId, { updatedAt: new Date(now).toISOString() });
  }
}
