import { injectable, inject } from "inversify";
import fsSync from "node:fs";
import path from "node:path";
import { SYMBOLS } from "../../../common/di/symbols.js";
import { ProjectStore } from "../stores/ProjectStore.js";
import { SessionContext } from "../../../common/context/SessionContext.js";
import { UnifiedEnv } from "../../../common/utils/UnifiedEnv.js";

type RequestLike = {
  headers?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
  params?: Record<string, unknown>;
};

/**
 * Service for resolving project context (root path and ID) from requests and environment.
 */
@injectable()
export class ProjectContextService {
  constructor(
    @inject(SYMBOLS.ProjectStore) private readonly projectStore: ProjectStore
  ) {}

  /**
   * Get the current active project root from session context or environment.
   */
  getProjectRoot(): string {
    const activeRoot = SessionContext.projectRoot;
    if (activeRoot) return path.resolve(activeRoot);
    const root = UnifiedEnv.get("PROJECT_ROOT");
    if (root) return path.resolve(root);
    return "";
  }

  /**
   * Resolve project root path from a request's headers, query, or body.
   */
  resolveProjectRoot(input: RequestLike): string {
    const headers = input.headers || {};
    const headerRoot = String(headers["x-project-root"] || "").trim();
    if (headerRoot) {
      try {
        const decoded = decodeURIComponent(headerRoot);
        if (fsSync.existsSync(decoded)) return decoded;
      } catch {
      }
      if (fsSync.existsSync(headerRoot)) return headerRoot;
    }
    const projectId = this.resolveProjectId(input);
    if (projectId) {
      const resolved = String(this.projectStore.readProjectById(projectId)?.projectRoot || "").trim();
      if (resolved && fsSync.existsSync(resolved)) return resolved;
    }
    return "";
  }

  /**
   * Resolve project ID from a request's headers, query, params, or body.
   */
  resolveProjectId(input: RequestLike): string {
    const query = input.query || {};
    const body = input.body || {};
    const params = input.params || {};
    const headers = input.headers || {};
    const id = (
      params["projectId"] ||
      query["projectId"] ||
      query["conversationId"] ||
      body["projectId"] ||
      body["conversationId"] ||
      headers["x-project-id"] ||
      ""
    ) as string;
    return String(id).trim();
  }

  /**
   * Resolve project ID given a project root path.
   */
  resolveProjectIdByRoot(projectRoot: string): string {
    const normalizedRoot = String(projectRoot || "").trim().toLowerCase();
    if (!normalizedRoot) return "";
    const matched = this.projectStore.listProjects().find((x: any) => String(x.projectRoot || "").trim().toLowerCase() === normalizedRoot);
    return String(matched?.projectId || "");
  }
}
