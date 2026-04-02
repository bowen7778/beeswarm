import { injectable, inject } from "inversify";
import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";
import os from "node:os";
import { SYMBOLS } from "../../common/di/symbols.js";
import { LoggerService } from "./LoggerService.js";

@injectable()
export class SecretService {
  private readonly algorithm = "aes-256-ctr";
  private readonly machineKey: Buffer;

  constructor(
    @inject(SYMBOLS.LoggerService) private readonly logger: LoggerService
  ) {
    this.machineKey = this.getMachineKey();
  }

  private getMachineKey(): Buffer {
    // Derive a machine-specific Key.
    // In production releases, hardware ID or MAC address can be used.
    // Here we use a combination of hostname + username + homedir for hashing.
    const seed = `${os.hostname()}:${os.userInfo().username}:${os.homedir()}`;
    return createHash("sha256").update(seed).digest();
  }

  encrypt(text: string): string {
    if (!text) return "";
    try {
      const iv = randomBytes(16);
      const cipher = createCipheriv(this.algorithm, this.machineKey, iv);
      const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
      return `${iv.toString("hex")}:${encrypted.toString("hex")}`;
    } catch (err) {
      this.logger.error("[SecretService] Encryption failed", err);
      return text;
    }
  }

  decrypt(encryptedText: string): string {
    if (!encryptedText || !encryptedText.includes(":")) return encryptedText;
    try {
      const [ivHex, dataHex] = encryptedText.split(":");
      const iv = Buffer.from(ivHex, "hex");
      const encryptedData = Buffer.from(dataHex, "hex");
      const decipher = createDecipheriv(this.algorithm, this.machineKey, iv);
      const decrypted = Buffer.concat([decipher.update(encryptedData), decipher.final()]);
      return decrypted.toString("utf8");
    } catch (err) {
      // If decryption fails, it might not be encrypted text (or old plain text), return as is
      return encryptedText;
    }
  }

  /**
   * Masking function for log output
   */
  mask(text: string): string {
    if (!text || text.length < 8) return "****";
    return text.slice(0, 4) + "****" + text.slice(-4);
  }
}

