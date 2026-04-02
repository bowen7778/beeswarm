import { injectable, inject } from "inversify";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { FileHelper } from "../../runtime/FileHelper.js";
import { PathResolverService } from "../../runtime/PathResolverService.js";
import { SYMBOLS } from "../../../common/di/symbols.js";
import { MessageEvents } from "../message/MessageEvents.js";
import type { VersionManager } from "../../runtime/VersionManager.js";
import { ProjectStore } from "../stores/ProjectStore.js";

export type ProjectIdentity = {
  schemaVersion: number;
  projectId: string;
  projectName: string;
  projectRoot: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * Service for managing project identity and initialization.
 */
@injectable()
export class ProjectIdentityService {
  private static readonly FILE_NAME = "project.json";

  constructor(
    @inject(SYMBOLS.PathResolverService) private readonly pathResolver: PathResolverService,
    @inject(SYMBOLS.ProjectStore) private readonly projectStore: ProjectStore,
    @inject(SYMBOLS.MessageEvents) private readonly events: MessageEvents,
    @inject(SYMBOLS.VersionManager) private readonly versionManager: VersionManager
  ) {}

  private normalize(p: string): string {
    return path.resolve(p || process.cwd());
  }

  private markerPath(projectRoot: string): string {
    return path.join(this.pathResolver.getProjectDataDir(projectRoot), ProjectIdentityService.FILE_NAME);
  }

  /**
   * Find the nearest root directory that contains a project marker file.
   */
  private findNearestExistingMarkerRoot(startRoot: string): string | null {
    const normalized = this.normalize(startRoot);
    try {
      if (fsSync.existsSync(this.markerPath(normalized))) {
        return normalized;
      }
    } catch {
      // Ignore permission errors during search
    }
    return null;
  }

  private projectName(projectRoot: string): string {
    return path.basename(projectRoot) || "project";
  }

  private fallbackProjectId(projectRoot: string): string {
    return createHash("sha1").update(projectRoot.toLowerCase()).digest("hex").slice(0, 16);
  }

  /**
   * Resolve the workspace root directory based on hints or environment.
   */
  resolveWorkspaceRoot(workspaceHint?: string): string {
    const candidates = [
      workspaceHint || "",
      process.env.BEEMCP_PROJECT_ROOT || ""
    ].map((x) => String(x || "").trim()).filter(Boolean);
    for (const c of candidates) {
      const normalized = this.normalize(c);
      const markerRoot = this.findNearestExistingMarkerRoot(normalized);
      if (markerRoot) return markerRoot;
    }
    return candidates.length > 0 ? this.normalize(candidates[0]) : this.normalize(process.cwd());
  }

  /**
   * Read physical project identity and metadata from disk.
   */
  readProjectInfo(projectRoot: string): { 
    projectId: string; 
    projectName: string; 
    initialized: boolean; 
    projectRoot: string;
  } {
    const root = String(projectRoot || "").trim();
    if (!root) {
      return { projectId: "", projectName: "", initialized: false, projectRoot: "" };
    }
    try {
      const file = this.markerPath(root);
      if (!fsSync.existsSync(file)) {
        return {
          projectId: "",
          projectName: path.basename(root),
          initialized: false,
          projectRoot: root
        };
      }
      
      const rawContent = fsSync.readFileSync(file, "utf-8");
      if (!rawContent.trim()) throw new Error("Empty file");
      
      const raw = JSON.parse(rawContent);
      return {
        projectId: String(raw?.projectId || "").trim(),
        projectName: String(raw?.projectName || "").trim() || path.basename(root),
        initialized: true,
        projectRoot: root
      };
    } catch (err) {
      return {
        projectId: "",
        projectName: path.basename(root),
        initialized: false,
        projectRoot: root
      };
    }
  }

  /**
   * Initialize a project directory by creating marker files and registering with the Hub.
   */
  async initializeProject(projectRoot: string, name?: string): Promise<ProjectIdentity> {
    const normalized = this.normalize(projectRoot);

    try {
      const dataDir = this.pathResolver.getProjectDataDir(normalized);
      const existingInfo = this.readProjectInfo(normalized);
      
      let projectId: string;
      let isRecovery = false;

      // 1. Detect existing identity (read-only)
      if (existingInfo.initialized && existingInfo.projectId) {
        projectId = existingInfo.projectId;
        isRecovery = true;
        process.stdout.write(`[ProjectIdentity] Recovery mode: Reusing existing ID ${projectId} for ${normalized}\n`);
      } else {
        projectId = randomUUID().replace(/-/g, "").slice(0, 16);
        process.stdout.write(`[ProjectIdentity] Fresh init: Generated new ID ${projectId} for ${normalized}\n`);
      }

      // 2. Execute mkdir only when necessary
      if (!isRecovery) {
        await FileHelper.mkdirSafe(dataDir);
        await FileHelper.mkdirSafe(path.join(dataDir, "history"));
        await FileHelper.mkdirSafe(path.join(dataDir, "sessions"));
      }
        
      const projectName = name || existingInfo.projectName || path.basename(normalized);
      const now = new Date().toISOString();
      
      const payload: ProjectIdentity = {
        schemaVersion: this.versionManager.getSchemaVersion("projectIdentity"),
        projectId,
        projectName,
        projectRoot: normalized,
        createdAt: isRecovery ? (existingInfo as any).createdAt || now : now,
        updatedAt: now
      };
      
      // 3. Persist physical identity file
      await FileHelper.writeJsonAtomic(this.markerPath(normalized), payload);
      
      // 4. Sync to central Hub database
      this.projectStore.upsertProject({
        projectId,
        projectName,
        projectRoot: normalized
      });

      this.events.emitProjectCreated(projectId, normalized);
      
      // Notify UI to focus on the newly created project
      setTimeout(() => {
        this.events.emitUIFocusProject(projectId);
      }, 300);

      return payload;
    } catch (err: any) {
      process.stderr.write(`[ProjectIdentity] Init failed: ${err.message}\n`);
      throw err;
    }
  }
}
