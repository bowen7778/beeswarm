import { injectable, inject } from "inversify";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SYMBOLS } from "../../../common/di/symbols.js";
import { VersionManager } from "../../runtime/VersionManager.js";
import { ProjectStore } from "../stores/ProjectStore.js";
import { McpSessionBindingStore } from "../stores/McpSessionBindingStore.js";

@injectable()
export class McpResourceService {
  constructor(
    @inject(SYMBOLS.ProjectStore) private readonly projectStore: ProjectStore,
    @inject(SYMBOLS.McpSessionBindingStore) private readonly mcpBindingStore: McpSessionBindingStore,
    @inject(SYMBOLS.VersionManager) private readonly versionManager: VersionManager
  ) {}

  public registerStateResources(server: McpServer, sessionId: string): void {
    const prefix = this.versionManager.protocolPrefix;
    server.resource(
      "all-projects",
      `${prefix}://projects/all`,
      async (uri) => {
        const projects = await this.projectStore.listProjects();
        return {
          contents: [{
            uri: uri.href,
            text: JSON.stringify({
              count: projects.length,
              projects: projects.map(p => ({
                id: p.projectId,
                name: p.projectName,
                path: p.projectRoot
              }))
            })
          }]
        };
      }
    );

    server.resource(
      "project-state",
      `${prefix}://projects/{projectId}/state`,
      async (uri, params: any) => {
        const projectId = String(params?.projectId || "");
        const project = this.projectStore.readProjectById(projectId);
        const isBound = !!this.mcpBindingStore.listConnectedProjectIds().includes(projectId);
    
        const response: any = {
          id: projectId,
          name: project?.projectName || "Unknown",
          path: project?.projectRoot || "Unknown",
          active: isBound,
          state: isBound ? "GATEWAY_CONNECTED" : "IDLE"
        };
        
        return {
          contents: [{
            uri: uri.href,
            text: JSON.stringify(response)
          }]
        };
      }
    );

    server.resource(
      "active-session",
      `${prefix}://sessions/active/state`,
      async (uri) => {
        const projectId = this.mcpBindingStore.resolveProjectIdByMcpSession(sessionId);
        let projectInfo = projectId ? this.projectStore.readProjectById(projectId) : null;
        
        const response: any = {
          sessionId,
          activeProjectId: projectInfo?.projectId || null,
          projectName: projectInfo?.projectName || null,
          protocol_version: this.versionManager.getProtocolVersion("gateway")
        };

        if (projectId) {
          response.state = "CONNECTED";
          response.protocol_status = "STABLE";
        } else {
          response.state = "UNINITIALIZED";
          response.protocol_status = "RESTRICTED";
          response.available_actions = [`${prefix}_init`];
           response.instruction = `This session is not yet bound to a project. Please call '${prefix}_init' with 'projectRoot' to establish context.`;
        }

        return {
          contents: [{
            uri: uri.href,
            text: JSON.stringify(response)
          }]
        };
      }
    );
  }
}
