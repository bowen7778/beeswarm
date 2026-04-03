import process from "node:process";

/**
 * Helper to handle environment variables for the application.
 * Dynamically resolves prefix based on identity.
 */
export class UnifiedEnv {
  private static _prefix: string = "APP"; // Default fallback

  /**
   * Initialize the prefix from manifest if possible.
   * Note: In some early boot stages, we might not have VersionManager yet.
   */
  static setPrefix(prefix: string) {
    this._prefix = prefix.toUpperCase();
  }

  /**
   * Get an environment variable value with the app-specific prefix.
   */
  static get(key: string, defaultValue: string = ""): string {
    const appKey = key.startsWith(`${this._prefix}_`) ? key : `${this._prefix}_${key}`;
    const value = process.env[appKey];
    if (value !== undefined) return String(value).trim();

    // Fallback to legacy BEESWARM if prefix is different
    if (this._prefix !== "BEESWARM") {
      const legacyKey = key.startsWith("BEESWARM_") ? key : `BEESWARM_${key}`;
      const legacyValue = process.env[legacyKey];
      if (legacyValue !== undefined) return String(legacyValue).trim();
    }

    return defaultValue;
  }

  /**
   * Get a boolean environment variable value.
   */
  static getBool(key: string, defaultValue: boolean = false): boolean {
    const val = this.get(key, defaultValue ? "1" : "0");
    return val === "1" || val.toLowerCase() === "true";
  }

  /**
   * Get a numeric environment variable value.
   */
  static getNumber(key: string, defaultValue: number): number {
    const val = this.get(key, String(defaultValue));
    const num = Number(val);
    return Number.isFinite(num) ? num : defaultValue;
  }

  /**
   * Check if running in development mode.
   */
  static get isDev(): boolean {
    return this.getBool("IS_DEV") || process.env.NODE_ENV === "development" || process.env.BEESWARM_IS_DEV === '1';
  }

  /**
   * Check if running in attach mode.
   */
  static get isAttachMode(): boolean {
    return this.getBool("ATTACH_MODE") || this.get("INSTANCE_MODE") === "attach" || process.env.BEESWARM_ATTACH_MODE === '1';
  }
}
