import { i18n } from '../services/i18n.js';
import { StreamClient } from '../services/StreamClient.js';
import { logger } from '../services/logger.js';
import { DOM_IDS } from './NebulaDom.js';
import { NebulaConfigController } from './NebulaAppConfig.js';
import { NebulaSessionController } from './NebulaAppRuntime.js';
import { NebulaRenderController } from './NebulaAppRender.js';
import { NebulaDialogController } from './NebulaAppDialog.js';
import { NebulaEventBus } from './NebulaEventBus.js';
import { NebulaStateStore } from './NebulaStateStore.js';

export class NebulaApp {
  constructor() {
    this.domIds = DOM_IDS;
    this.stateStore = new NebulaStateStore({
      session: {
        activeId: '',
        sessions: [],
        messages: []
      },
      runtime: {
        tools: [],
        imOnline: false,
        mcpOnline: false,
        versionInfo: null,
        isStreamConnected: false
      },
      ui: {
        pendingUpdate: null
      }
    });
    this.statusSyncTimer = null;
    this.eventBus = new NebulaEventBus();
    this.cacheElements();
    this.stream = new StreamClient((data) => this.sessionController.handleStreamMessage(data));
    this.renderController = new NebulaRenderController(this);
    this.dialogController = new NebulaDialogController(this);
    this.sessionController = new NebulaSessionController(this);
    this.configController = new NebulaConfigController(this);
    this.identity = { appName: 'BeeSwarm', appIdentifier: 'beeswarm' };
    this.init();
  }

  get state() {
    return this.stateStore.getState();
  }

  getElement(id) {
    return document.getElementById(id);
  }

  requireElement(id) {
    const element = this.getElement(id);
    if (!element) {
      throw new Error(`UI_ELEMENT_MISSING:${id}`);
    }
    return element;
  }

  cacheElements() {
    this.hubList = this.requireElement(DOM_IDS.CONTEXT_LIST);
    this.stageTitle = this.requireElement(DOM_IDS.CURRENT_TITLE);
    this.chatBox = this.requireElement(DOM_IDS.CHAT_MESSAGES);
    this.msgInput = this.requireElement(DOM_IDS.MSG_INPUT);
    this.toolList = this.requireElement(DOM_IDS.TOOLS_LIST);
    this.monitorFeed = this.requireElement(DOM_IDS.MONITOR_FEED);
    this.updateBanner = this.requireElement(DOM_IDS.UPDATE_BANNER);
    this.updateMsg = this.requireElement(DOM_IDS.UPDATE_MSG);
    this.updateBtn = this.requireElement(DOM_IDS.UPDATE_BTN);
    this.stageEmpty = this.requireElement(DOM_IDS.STAGE_EMPTY);
    this.stageChat = this.requireElement(DOM_IDS.STAGE_CHAT);
  }

  emitMonitor(type, message, meta = {}) {
    logger.event({ level: type === 'warn' ? 'warn' : type === 'error' ? 'error' : 'info', type, message, ...meta });
    this.eventBus.emit('monitor:event', { type, message, meta });
  }

  bindOverlayClose(overlayId, onClose) {
    const overlay = this.requireElement(overlayId);
    overlay.onclick = (event) => {
      if (event.target === overlay) {
        onClose();
      }
    };
  }

  bindCoreEvents() {
    this.requireElement(DOM_IDS.SEND_BTN).onclick = () => this.sessionController.handleSend();
    this.requireElement(DOM_IDS.NEW_BTN).onclick = () => this.sessionController.handleNewContext();
    this.requireElement(DOM_IDS.QUICK_NEW_PROJECT).onclick = () => this.sessionController.handleNewContext();
    this.requireElement(DOM_IDS.QUICK_OPEN_FOLDER).onclick = () => this.sessionController.handleNewContext();

    this.msgInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        this.sessionController.handleSend();
      }
    });

    this.requireElement(DOM_IDS.CONFIG_MCP).onclick = () => this.configController.showMcpConfig();
    this.requireElement(DOM_IDS.CONFIG_IM).onclick = () => this.configController.showImConfig();
    this.requireElement(DOM_IDS.CONFIG_SYSTEM).onclick = () => this.configController.showSystemConfig();
    this.requireElement(DOM_IDS.MODAL_CLOSE_BTN).onclick = () => this.configController.hideMcpConfig();
    this.requireElement(DOM_IDS.IM_MODAL_CLOSE_BTN).onclick = () => this.configController.hideImConfig();
    this.requireElement(DOM_IDS.SYSTEM_MODAL_CLOSE_BTN).onclick = () => this.configController.hideSystemConfig();

    this.bindOverlayClose(DOM_IDS.MCP_MODAL_OVERLAY, () => this.configController.hideMcpConfig());
    this.bindOverlayClose(DOM_IDS.IM_MODAL_OVERLAY, () => this.configController.hideImConfig());
    this.bindOverlayClose(DOM_IDS.SYSTEM_MODAL_OVERLAY, () => this.configController.hideSystemConfig());

    this.requireElement(DOM_IDS.PLUGIN_CARD_FEISHU).onclick = () => this.configController.switchImView('feishu');
    this.requireElement(DOM_IDS.IM_BACK_TO_HUB).onclick = () => this.configController.switchImView('hub');
    this.requireElement(DOM_IDS.IM_FEISHU_SAVE).onclick = () => this.configController.saveFeishuConfig();
    this.requireElement(DOM_IDS.IM_FEISHU_BIND_ADMIN).onclick = () => this.configController.startAdminCapture();
    
    // Multi-bot events
    this.requireElement(DOM_IDS.IM_FEISHU_ADD_BOT).onclick = () => this.configController.showBotEdit();
    this.requireElement(DOM_IDS.IM_FEISHU_BOT_SAVE).onclick = () => this.configController.saveBot();
    this.requireElement(DOM_IDS.IM_FEISHU_EDIT_CLOSE).onclick = () => this.configController.hideBotEdit();

    this.requireElement(DOM_IDS.IM_FEISHU_ENABLED_TOGGLE).onchange = (event) => {
      this.emitMonitor('info', `Feishu plugin ${event.target.checked ? 'enabling' : 'disabling'}...`, { domain: 'im', action: 'toggle' });
      this.configController.saveFeishuConfig(true);
    };

    this.requireElement(DOM_IDS.COPY_SSE_BTN).onclick = () => this.configController.copyToClipboard(DOM_IDS.CODE_SNIPPET_SSE, DOM_IDS.COPY_SSE_BTN);
    this.requireElement(DOM_IDS.COPY_STDIO_BTN).onclick = () => this.configController.copyToClipboard(DOM_IDS.CODE_SNIPPET_STDIO, DOM_IDS.COPY_STDIO_BTN);
    this.requireElement(DOM_IDS.COPY_SYSTEM_MANIFEST_BTN).onclick = () => this.configController.copyToClipboard(DOM_IDS.SYSTEM_MANIFEST_JSON, DOM_IDS.COPY_SYSTEM_MANIFEST_BTN);
    this.requireElement(DOM_IDS.SYSTEM_UPDATE_CHECK_BTN).onclick = () => this.configController.handleCheckUpdates();
    this.updateBtn.onclick = () => this.configController.handleStartUpdate();
    this.requireElement(DOM_IDS.UPDATE_IGNORE).onclick = () => this.configController.hideUpdateBanner();

    this.chatBox.addEventListener('click', (event) => this.dialogController.handleInteractiveChatClick(event));
    this.hubList.addEventListener('click', (event) => this.sessionController.handleHubClick(event));
  }

  startStatusPolling() {
    if (this.statusSyncTimer) {
      clearInterval(this.statusSyncTimer);
    }
    this.statusSyncTimer = setInterval(() => this.sessionController.syncStatus(), 30000);
  }

  async init() {
    try {
      const res = await fetch('./manifest.json');
      const manifest = await res.json();
      if (manifest.identity) {
        this.identity = manifest.identity;
      }
    } catch (e) {
      logger.error('Failed to fetch identity', e);
    }

    i18n.subscribe(() => this.renderController.updateI18nUI());
    this.renderController.bindLangSwitch();
    this.renderController.updateI18nUI();
    this.renderController.injectStaticIcons();
    this.bindCoreEvents();

    this.renderController.renderHub();
    this.renderController.renderStage();
    await this.sessionController.syncSessions();
    await this.sessionController.syncStatus();
    this.stream.connect();
    this.startStatusPolling();
    this.emitMonitor('info', 'System initialized', { domain: 'app', action: 'init' });
    logger.info('Application initialized');
  }
}
