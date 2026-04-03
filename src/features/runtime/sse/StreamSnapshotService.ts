import { injectable, inject } from "inversify";
import { createHash } from "node:crypto";
import type express from "express";
import path from "node:path";
import fsSync from "node:fs";
import os from "node:os";
import { MetricsService } from "../../metrics/MetricsService.js";
import { MessageManagerStore } from "../../mcp/message/MessageManagerStore.js";
import { AppConfig } from "../AppConfig.js";
import { LoggerService } from "../LoggerService.js";
import { SYMBOLS } from "../../../common/di/symbols.js";

import { IMPluginRegistry } from "../../im/IMPluginRegistry.js";
import { IMFacade } from "../../im/facade/IMFacade.js";
import { MessageEvents, LogEntry } from "../../mcp/message/MessageEvents.js";
import { SessionContext } from "../../../common/context/SessionContext.js";
import { ProjectStore } from "../../mcp/stores/ProjectStore.js";
import { VersionManager } from "../VersionManager.js";

interface ProjectSnapshot {
  streamSeq: number;
  cache: any;
  updatedAt: number;
  isDirty: boolean;
  inFlight: Promise<void> | null;
  pendingEvents: any[];
}

@injectable()
export class StreamSnapshotService {
  private snapshots = new Map<string, ProjectSnapshot>();
  private streamClients: number = 0;
  private activePushers = new Set<{ projectRoot: string; push: (force?: boolean) => Promise<void> }>();
  private imRegistry: IMPluginRegistry | null = null;
  private imService: IMFacade | null = null;

  constructor(
    @inject(SYMBOLS.MetricsService) private readonly metricsService: MetricsService,
    @inject(SYMBOLS.MessageManagerStore) private readonly manager: MessageManagerStore,
    @inject(SYMBOLS.LoggerService) private readonly logger: LoggerService,
    @inject(SYMBOLS.MessageEvents) private readonly events: MessageEvents,
    @inject(SYMBOLS.ProjectStore) private readonly projectStore: ProjectStore,
    @inject(SYMBOLS.VersionManager) private readonly versionManager: VersionManager
  ) {
    this.initEventListeners();
  }

  public setIMSnapshotServices(imRegistry: IMPluginRegistry, imService: IMFacade) {
    this.imRegistry = imRegistry;
    this.imService = imService;
  }

  private getOrCreateSnapshot(projectRoot: string = ""): ProjectSnapshot {
    let s = this.snapshots.get(projectRoot);
    if (!s) {
      s = {
        streamSeq: 0,
        cache: { 
          diag: { isActive: false },
          state: { sessions: [], im: {}, outbox: { pending: 0, dead: 0 } }
        },
        updatedAt: 0,
        isDirty: true,
        inFlight: null,
        pendingEvents: []
      };
      this.snapshots.set(projectRoot, s);
    }
    return s;
  }

  private initEventListeners() {
    const triggerAll = () => {
      for (const s of this.snapshots.values()) {
        s.isDirty = true;
      }
      this.pushToAll();
    };

    // Subscribe to core events
    this.events.onLog((entry) => {
      // Logs don't necessarily need immediate pushToAll unless it's a critical error
      if (entry.level === "ERROR") {
        for (const s of this.snapshots.values()) {
          s.isDirty = true;
        }
        this.pushToAll();
      }
    });

    this.events.on("project:registry_changed", () => {
      this.logger.info("STREAM", "Registry changed detected. Forcing global sync.");
      this.markDirtyAndPush("", true); // Force global list refresh
    });

    this.events.onProjectCreated((payload) => {
      this.logger.info("STREAM", `Project created: ${payload.projectId}. Triggering UI sync.`);
      // 1. Force global project list refresh to ensure new project appears instantly
      this.markDirtyAndPush("", true);
      // 2. Initialize a snapshot and push for the new project (ensures data is immediately available)
      this.markDirtyAndPush(payload.projectRoot, true);
    });
    this.events.on("im:state_changed", triggerAll);
    this.events.on("ops:outbox_updated", triggerAll);

    // Subscribe to UI focus events
    this.events.onUIFocusProject((payload) => {
      this.logger.info("STREAM", `UI Focus requested for project: ${payload.projectId}`);
      // Broadcast focus event to all clients (global broadcast because new projects might not be bound to specific pushers yet)
      this.broadcastEvent("", {
        type: "ui_focus",
        payload: {
          projectId: payload.projectId
        }
      });
      // Force a global push to ensure event is consumed immediately
      this.markDirtyAndPush("", true);
    });

    // Project specific events
    this.events.onAIReply((payload) => {
      const root = this.resolveProjectRoot(payload.conversationId);
      if (root) {
        // Restore incremental event broadcast to ensure UI can pop up messages in real-time
        this.broadcastEvent(root, {
          type: "ai_message",
          payload: {
            role: "ai",
            content: payload.reply,
            timestamp: payload.timestamp,
            id: payload.messageId,
            projectId: payload.conversationId
          }
        });
        this.markDirtyAndPush(root);
      } else {
        // Fallback: if root cannot be resolved, try to trigger all active pushes
        this.pushToAll(true);
      }
    });

    this.events.onUserInput(async (payload) => {
      const appName = this.versionManager.appName;
      const root = this.resolveProjectRoot(payload.conversationId);
      if (root) {
        // Restore incremental event broadcast
        this.broadcastEvent(root, {
          type: "user_message",
          payload: {
            role: "user",
            title: `${appName} Interaction`,
            content: payload.content,
            timestamp: payload.timestamp,
            id: payload.messageId,
            projectId: payload.conversationId
          }
        });
        this.markDirtyAndPush(root);
      } else {
        this.pushToAll(true);
      }
    });
  }

  public broadcastEvent(projectRoot: string, event: { type: string; payload: any }) {
    // 1. Update project snapshot event queue
    const s = this.getOrCreateSnapshot(projectRoot);
    s.pendingEvents.push(event);

    // Core fix: if it's a global event (projectRoot === ""), it needs to be distributed to all existing project snapshots
    // Otherwise only global pushers will receive it, causing users on specific project pages to miss global notifications (e.g. jump commands)
    if (projectRoot === "") {
      for (const [root, snapshot] of this.snapshots.entries()) {
        if (root !== "") {
          snapshot.pendingEvents.push(event);
        }
      }
    }

    // 2. Immediately trigger all SSE pushers belonging to this project
    for (const pusher of this.activePushers) {
      if (!pusher.projectRoot || pusher.projectRoot === projectRoot || projectRoot === "") {
        void pusher.push(true);
      }
    }
  }

  private resolveProjectRoot(id?: string): string {
    if (!id) return "";
    // Priority resolve via Store, which is the authoritative source for project roots
    const root = this.projectStore.resolveProjectRootByProjectId(id);
    if (root) return root;
    
    // If Store hasn't loaded yet (e.g. cold start), try fallback from current session context
    return SessionContext.projectRoot || "";
  }

  public markDirtyAndPush(projectRoot: string = "", force: boolean = false) {
    const s = this.getOrCreateSnapshot(projectRoot);
    s.isDirty = true;
    if (force) s.updatedAt = 0; // Core: if forced refresh, clear last update time to bypass 800ms cache lock
    
    // Core logic fix: if projectRoot is empty, it means a global change, all active pushers must be notified
    // because each pusher's snapshot contains the global sessions list
    const isGlobal = !projectRoot || projectRoot === "";

    for (const item of this.activePushers) {
      if (isGlobal || item.projectRoot === projectRoot) {
        void item.push(true);
      }
    }
  }

  private pushToAll(force: boolean = false) {
    for (const item of this.activePushers) {
      if (force) {
        const s = this.getOrCreateSnapshot(item.projectRoot || "");
        s.isDirty = true;
        s.updatedAt = 0;
      }
      void item.push(force);
    }
  }

  private async refreshSnapshot(projectRoot: string = "", force: boolean = false): Promise<void> {
    const s = this.getOrCreateSnapshot(projectRoot);
    
    if (!force && !s.isDirty && Date.now() - s.updatedAt < 800) return;
    
    // Core fix: if forced refresh, even if there's an inFlight request, refresh again after it finishes to ensure latest data
    if (s.inFlight) {
      await s.inFlight;
      if (force) {
        // Re-check and refresh to prevent DB changes during inFlight
        s.isDirty = true;
      } else {
        return;
      }
    }

    s.inFlight = (async () => {
      try {
        let snapshot: any = { 
          diag: { 
            isActive: true, 
            pid: process.pid, 
            serverTime: new Date().toISOString(),
            streamClients: this.streamClients
          },
          state: { sessions: [], im: {}, outbox: { pending: 0, dead: 0 } } 
        };
        
        // Load global state
        try {
          const sessions = this.projectStore.listProjects().slice(0, 100).map((x: any) => ({
            id: String(x.projectId || ""),
            projectId: String(x.projectId || ""),
            title: String(x.projectName || x.projectId || ""),
            workspacePath: String(x.projectRoot || ""),
            activeSessionId: String(x.projectId || ""),
            sessionCount: 1,
            lastMessage: String(x.lastMessage || "Click to start conversation"),
            lastMessageAt: String(x.lastMessageAt || ""),
            mtime: new Date(String(x.lastActiveAt || 0)).getTime() || Date.now(),
            connected: false,
            mcp_connected: false
          }));
          const imStatus = this.imRegistry && this.imService
            ? await this.imService.readAllStatus(this.imRegistry)
            : {};
          const outboxMetrics = this.manager.getOutboxMetrics();

          snapshot.state = {
            sessions: sessions || [],
            im: imStatus,
            outbox: outboxMetrics,
            metrics: this.metricsService.buildRuntimeMetrics({
              streamClients: this.streamClients,
              streamSeq: s.streamSeq,
              lastUIHeartbeat: Date.now(),
              uiLockAgeMs: null
            })
          };
        } catch (e: any) {
          this.logger.warn("STREAM", `Global state build failed: ${e.message}`);
        }

        s.cache = snapshot;
        s.updatedAt = Date.now();
        s.isDirty = false;
      } catch (err: any) {
        this.logger.warn("STREAM", `refreshSnapshot error: ${err.message}`);
      }
    })();

    try {
      await s.inFlight;
    } finally {
      s.inFlight = null;
    }
  }

  public markDirty() {
    for (const s of this.snapshots.values()) {
      s.isDirty = true;
    }
  }

  async stream(req: express.Request, res: express.Response, token: string): Promise<void> {
    let projectRoot = SessionContext.projectRoot || "";
    const projectIdFromToken = String(req.query.projectId || req.query.conversationId || "");

    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no"
    });
    res.flushHeaders();

    this.streamClients += 1;
    let isClosed = false;

    // Get current projectRoot
    const initialProjectRoot = SessionContext.projectRoot ||
                              (projectIdFromToken ? this.projectStore.resolveProjectRootByProjectId(projectIdFromToken) : "") || "";

    const pusherItem = { 
      projectRoot: initialProjectRoot, 
      push: async (_force?: boolean) => {} 
    };
    this.activePushers.add(pusherItem);

    const pushTaskInner = async (force: boolean = false) => {
      if (isClosed) return;
      
      // If project root still cannot be resolved, try fallback
      if (!pusherItem.projectRoot && projectIdFromToken) {
        pusherItem.projectRoot = this.projectStore.resolveProjectRootByProjectId(projectIdFromToken) || "";
      }

      const currentRoot = pusherItem.projectRoot || "";
      const s = this.getOrCreateSnapshot(currentRoot);
      
      const run = async () => {
        const shouldRefresh = force || s.isDirty || Date.now() - s.updatedAt > 5000;
        const hasEvents = Array.isArray(s.pendingEvents) && s.pendingEvents.length > 0;

        if (!shouldRefresh && !hasEvents) {
          return;
        }

        if (shouldRefresh) {
          await this.refreshSnapshot(currentRoot, force);
        }

        const latest = this.getOrCreateSnapshot(currentRoot);
        const latestHasEvents = Array.isArray(latest.pendingEvents) && latest.pendingEvents.length > 0;
        const payload = {
          ...latest.cache,
          diag: {
            ...latest.cache.diag,
            isActive: true,
            streamClients: this.streamClients
          },
          _meta: {
            seq: latest.streamSeq,
            serverTime: new Date().toISOString(),
            isDirty: latest.isDirty,
            projectRoot: currentRoot,
            status: latest.streamSeq === 0 ? "ready" : "active"
          }
        };

        if (latestHasEvents) {
          (payload as any).events = [...latest.pendingEvents];
          latest.pendingEvents = [];
        }
        
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
        if ((res as any).flush) (res as any).flush();

        latest.streamSeq += 1;
        this.metricsService.recordStreamPush(Date.now());
      };

      await run().catch(err => {
        this.logger.error("STREAM", `Push task failed: ${err.message}`);
      });
    };

    pusherItem.push = pushTaskInner;

    // Core fix: SSE handshake-then-push mechanism
    // After establishing connection, no longer wait for markDirty, execute a mandatory push immediately to ensure UI gets data instantly without manual refresh
    this.logger.info("STREAM", `SSE handshaked for project: ${pusherItem.projectRoot || "unknown"}. Immediate push triggered.`);
    void pushTaskInner(true);

    const keepAliveTimer = setInterval(() => pushTaskInner(false), 1000);

    req.on("close", () => {
      isClosed = true;
      this.streamClients = Math.max(0, this.streamClients - 1);
      this.activePushers.delete(pusherItem);
      clearInterval(keepAliveTimer);
    });
  }

  recordSendLatency(durationMs: number): void {
    this.metricsService.recordSendLatency(durationMs);
  }

  markHeartbeat(setLastUIHeartbeat: (time: number) => void): void {
    const now = Date.now();
    setLastUIHeartbeat(now);
    const appIdentifier = this.versionManager.appIdentifier;
    const lockFile = path.join(os.tmpdir(), `${appIdentifier}_ui_active.lock`);
    try {
      fsSync.writeFileSync(lockFile, now.toString());
    } catch (err: any) {
      this.logger.warn(`[StreamSnapshotService] markHeartbeat failed: ${String(err?.message || err)}`);
    }
  }

  health() {
    return { status: "ok", uptime: process.uptime() };
  }

  private uiLockAgeMs(): number | null {
    const appIdentifier = this.versionManager.appIdentifier;
    const activeLock = path.join(os.tmpdir(), `${appIdentifier}_ui_active.lock`);
    try {
      if (fsSync.existsSync(activeLock)) {
        return Date.now() - fsSync.statSync(activeLock).mtimeMs;
      }
    } catch (err: any) {
      this.logger.warn(`[StreamSnapshotService] uiLockAgeMs failed: ${String(err?.message || err)}`);
    }
    return null;
  }

  getRuntimeMetrics(lastUIHeartbeat: number, uiLockAgeMs: number | null) {
    return this.metricsService.buildRuntimeMetrics({
      streamClients: this.streamClients,
      streamSeq: 0,
      lastUIHeartbeat,
      uiLockAgeMs
    });
  }

  getRuntimeMetricsByLock(lastUIHeartbeat: number) {
    return this.getRuntimeMetrics(lastUIHeartbeat, this.uiLockAgeMs());
  }

  async startSnapshotTicker(): Promise<NodeJS.Timeout> {
    this.logger.info("STREAM", "Starting snapshot ticker...");
    try {
      // First refresh with 5s timeout to prevent startup hang
      await Promise.race([
        this.refreshSnapshot(""),
        new Promise((_, reject) => setTimeout(() => reject(new Error("INITIAL_SNAPSHOT_TIMEOUT")), 5000))
      ]);
    } catch (err: any) {
      this.logger.warn("STREAM", `Initial snapshot failed or timed out: ${err.message}`);
    }
    
    // Use a larger interval (e.g. 10s) as a fallback instead of a frequent 1.5s ticker
    // Actual updates should be event-driven
    return setInterval(() => {
      if (this.streamClients > 0) {
        // Core fix: ticker refresh should target all active snapshots
        for (const projectRoot of this.snapshots.keys()) {
          void this.refreshSnapshot(projectRoot);
        }
      }
    }, 10000);
  }
}
