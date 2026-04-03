import { injectable, inject } from "inversify";
import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { VersionManager } from "./VersionManager.js";
import { SYMBOLS } from "../../common/di/symbols.js";
import { UnifiedEnv } from "../../common/utils/UnifiedEnv.js";

export interface RemoteVersionInfo {
  version: string;
  releaseDate: string;
  url: string;
  sha256: string;
  releaseNotes?: string;
}

export interface UpdateStatus {
  checking: boolean;
  checkedAt: string | null;
  available: boolean;
  currentVersion: string;
  remote: RemoteVersionInfo | null;
  preparedVersion: string | null;
  error: string | null;
}

@injectable()
export class UpdateWorkerService {
  private isChecking = false;
  private readonly defaultUpdateRepo: string;
  private readonly defaultUpdateChannel = "stable";
  private lastCheckedAt: string | null = null;
  private lastRemoteInfo: RemoteVersionInfo | null = null;
  private lastPreparedVersion: string | null = null;
  private lastError: string | null = null;

  constructor(
    @inject(SYMBOLS.PathResolverService) private readonly pathResolver: PathResolverService,
    @inject(SYMBOLS.LoggerService) private readonly logger: LoggerService,
    @inject(SYMBOLS.StreamSnapshotService) private readonly streamService: StreamSnapshotService,
    @inject(SYMBOLS.VersionManager) private readonly versionManager: VersionManager
  ) {
    this.defaultUpdateRepo = `bowen7778/${this.versionManager.appIdentifier}`;
  }

  private get metadataUrl(): string {
    return `https://github.com/${this.defaultUpdateRepo}/releases/download/${this.defaultUpdateChannel}/latest.json`;
  }

  public startUpdateTicking() {
    this.logger.info("Update", "Update worker started.");
    setTimeout(() => this.checkForUpdates(), 5000);
    setInterval(() => this.checkForUpdates(), 3600000);
  }

  public getStatus(): UpdateStatus {
    const currentVersion = this.versionManager.getCurrentVersion();
    const remote = this.lastRemoteInfo;
    const available = !!remote && this.versionManager.compareVersions(remote.version, currentVersion) > 0;

    return {
      checking: this.isChecking,
      checkedAt: this.lastCheckedAt,
      available,
      currentVersion,
      remote,
      preparedVersion: this.resolvePreparedVersion(remote),
      error: this.lastError
    };
  }

  public async checkForUpdates(): Promise<UpdateStatus> {
    if (this.isChecking) return this.getStatus();
    this.isChecking = true;

    try {
      this.logger.info("Update", "Checking for remote updates...");
      const remoteInfo = await this.fetchRemoteMetadata();
      this.lastRemoteInfo = remoteInfo;
      this.lastCheckedAt = new Date().toISOString();
      this.lastError = null;
      const currentVersion = this.versionManager.getCurrentVersion();

      if (this.versionManager.compareVersions(remoteInfo.version, currentVersion) > 0) {
        this.logger.info("Update", `New version found: ${remoteInfo.version} (current: ${currentVersion})`);
        this.notifyUI(remoteInfo);
      } else {
        this.logger.info("Update", `Current version ${currentVersion} is up to date.`);
      }
    } catch (err: any) {
      this.lastCheckedAt = new Date().toISOString();
      const message = String(err?.message || err || "Unknown update error");
      if (this.isRemoteMetadataMissing(message)) {
        this.lastRemoteInfo = null;
        this.lastError = null;
        this.logger.warn("Update", `Remote metadata not published yet: ${message}`);
      } else {
        this.lastError = message;
        this.logger.error("Update", `Update check failed: ${message}`);
      }
    } finally {
      this.isChecking = false;
    }

    return this.getStatus();
  }

  public async downloadAndPrepare(info: RemoteVersionInfo): Promise<string> {
    this.logger.info("Update", `Starting download of v${info.version}...`);

    const updateCacheDir = path.join(this.pathResolver.userDataRoot, "update_cache");
    if (!fs.existsSync(updateCacheDir)) fs.mkdirSync(updateCacheDir, { recursive: true });

    const archivePath = path.join(updateCacheDir, `kernel-v${info.version}.tar.gz`);
    const extractDir = path.join(updateCacheDir, `kernel-v${info.version}`);
    const targetBinDir = this.versionManager.getVersionSlotDir(info.version);

    if (fs.existsSync(targetBinDir)) {
      this.logger.info("Update", `Target version v${info.version} already exists in slots.`);
      this.lastPreparedVersion = info.version;
      return targetBinDir;
    }

    await this.downloadFile(info.url, archivePath);
    this.verifySha256(archivePath, info.sha256);
    this.logger.info("Update", "Download completed. Extracting...");

    fs.rmSync(extractDir, { recursive: true, force: true });
    fs.mkdirSync(extractDir, { recursive: true });
    fs.rmSync(targetBinDir, { recursive: true, force: true });
    fs.mkdirSync(targetBinDir, { recursive: true });

    try {
      this.extractArchive(archivePath, extractDir);
      const payloadRoot = this.resolveExtractedPayloadRoot(extractDir);
      this.copyDirectoryContents(payloadRoot, targetBinDir);
      this.logger.info("Update", `Extraction successful: ${targetBinDir}`);

      fs.unlinkSync(archivePath);
      fs.rmSync(extractDir, { recursive: true, force: true });
      this.lastPreparedVersion = info.version;
      this.lastRemoteInfo = info;
      this.lastError = null;

      return targetBinDir;
    } catch (err: any) {
      fs.rmSync(targetBinDir, { recursive: true, force: true });
      this.logger.error("Update", `Extraction failed: ${err.message}`);
      throw new Error(`Failed to extract update: ${err.message}`);
    }
  }

  private async fetchRemoteMetadata(): Promise<RemoteVersionInfo> {
    return new Promise((resolve, reject) => {
      https.get(this.metadataUrl, (res) => {
        if (!res.statusCode || res.statusCode >= 400) {
          reject(new Error(`Remote metadata unavailable: HTTP ${res.statusCode || "unknown"}`));
          return;
        }
        let data = "";
        res.on("data", (chunk) => data += chunk);
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error("Failed to parse remote metadata"));
          }
        });
      }).on("error", reject);
    });
  }

  private isRemoteMetadataMissing(message: string): boolean {
    return /Remote metadata unavailable:\s*HTTP\s*404/i.test(String(message || ""));
  }

  private verifySha256(filePath: string, expectedSha256: string): void {
    const expected = String(expectedSha256 || "").trim().toLowerCase();
    if (!expected) {
      if (this.isDevMode()) {
        this.logger.warn("Update", "Skipping SHA256 verification in development mode because metadata hash is empty.");
        return;
      }
      throw new Error("SHA256 missing in remote metadata");
    }
    const content = fs.readFileSync(filePath);
    const actual = createHash("sha256").update(content).digest("hex").toLowerCase();
    if (actual !== expected) {
      throw new Error(`SHA256 mismatch: expected=${expected}, actual=${actual}`);
    }
  }

  private downloadFile(url: string, dest: string, redirects: number = 0): Promise<void> {
    return new Promise((resolve, reject) => {
      const normalizedUrl = String(url || "").trim();
      if (!/^https:\/\//i.test(normalizedUrl)) {
        reject(new Error("Only HTTPS update URLs are allowed"));
        return;
      }
      if (redirects > 5) {
        reject(new Error("Too many redirects while downloading update package"));
        return;
      }
      const file = fs.createWriteStream(dest);
      https.get(normalizedUrl, (res) => {
        if (res.statusCode === 302 || res.statusCode === 301) {
          const next = String(res.headers.location || "").trim();
          file.close();
          fs.unlink(dest, () => {});
          this.downloadFile(next, dest, redirects + 1).then(resolve).catch(reject);
          return;
        }
        if (!res.statusCode || res.statusCode >= 400) {
          file.close();
          fs.unlink(dest, () => {});
          reject(new Error(`Update package download failed: HTTP ${res.statusCode || "unknown"}`));
          return;
        }
        res.pipe(file);
        file.on("finish", () => {
          file.close();
          resolve();
        });
      }).on("error", (err) => {
        fs.unlink(dest, () => reject(err));
      });
    });
  }

  private isDevMode(): boolean {
    return UnifiedEnv.isDev;
  }

  private getMetadataUrl(): string {
    const custom = UnifiedEnv.get("UPDATE_METADATA_URL");
    if (custom) return custom;
    const repo = UnifiedEnv.get("UPDATE_REPO", this.defaultUpdateRepo);
    const channel = UnifiedEnv.get("UPDATE_CHANNEL", this.defaultUpdateChannel);
    return `https://github.com/${repo}/releases/download/${channel}/latest.json`;
  }

  private notifyUI(info: RemoteVersionInfo) {
    this.streamService.broadcastEvent("", {
      type: "update_available",
      payload: info
    });
  }

  private resolvePreparedVersion(remote: RemoteVersionInfo | null): string | null {
    if (this.lastPreparedVersion) {
      return this.lastPreparedVersion;
    }

    if (!remote?.version) {
      return null;
    }

    const preparedPath = this.versionManager.getVersionSlotDir(remote.version);
    return fs.existsSync(preparedPath) ? remote.version : null;
  }

  private resolveExtractedPayloadRoot(extractDir: string): string {
    const candidates = [extractDir, path.join(extractDir, "kernel")];
    for (const candidate of candidates) {
      const manifestPath = path.join(candidate, "manifest.json");
      const distPath = path.join(candidate, "dist", "cli.cjs");
      if (fs.existsSync(manifestPath) && fs.existsSync(distPath)) {
        return candidate;
      }
    }
    throw new Error("Update payload layout invalid");
  }

  private copyDirectoryContents(sourceDir: string, targetDir: string): void {
    const entries = fs.readdirSync(sourceDir);
    for (const entry of entries) {
      const sourcePath = path.join(sourceDir, entry);
      const targetPath = path.join(targetDir, entry);
      fs.cpSync(sourcePath, targetPath, { recursive: true });
    }
  }

  private extractArchive(archivePath: string, extractDir: string): void {
    const result = spawnSync("tar", ["-xzf", archivePath, "-C", extractDir], {
      stdio: "inherit",
      windowsHide: true,
      shell: false
    });
    if (result.error) {
      throw new Error(`Failed to execute tar: ${result.error.message}`);
    }
    if (result.status !== 0) {
      throw new Error(`tar exited with code ${result.status}`);
    }
  }
}

