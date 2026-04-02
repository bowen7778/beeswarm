import { i18n } from '../services/i18n.js';
import { Icons } from '../utils/Icons.js';
import { CHAT_ACTIONS, DOM_IDS } from './NebulaDom.js';
import { HubListRenderer } from '../renderers/HubListRenderer.js';
import { MessageListRenderer } from '../renderers/MessageListRenderer.js';
import { SystemVersionRenderer } from '../renderers/SystemVersionRenderer.js';
import { ToolListRenderer } from '../renderers/ToolListRenderer.js';

export class NebulaRenderController {
  constructor(app) {
    this.app = app;
    this.hubListRenderer = new HubListRenderer();
    this.messageListRenderer = new MessageListRenderer();
    this.systemVersionRenderer = new SystemVersionRenderer();
    this.toolListRenderer = new ToolListRenderer();

    this.app.eventBus.on('monitor:event', (payload) => {
      this.addMonitorEvent(payload.type, payload.message);
    });

    this.app.stateStore.subscribe((change) => {
      this.handleStateChange(change);
    });
  }

  get state() {
    return this.app.state;
  }

  getElement(id) {
    return this.app.getElement(id);
  }

  addMonitorEvent(type, message) {
    if (!this.app.monitorFeed) return;
    const event = document.createElement('div');
    event.className = 'monitor-event';
    const time = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const timeNode = document.createElement('span');
    timeNode.className = 'event-time';
    timeNode.textContent = `[${time}]`;
    const typeNode = document.createElement('span');
    typeNode.className = `event-type-${type}`;
    typeNode.textContent = `[${String(type || '').toUpperCase()}]`;
    const messageNode = document.createElement('span');
    messageNode.className = 'event-msg';
    messageNode.textContent = String(message || '');
    event.append(timeNode, typeNode, messageNode);
    this.app.monitorFeed.prepend(event);
    while (this.app.monitorFeed.children.length > 50) {
      this.app.monitorFeed.lastChild.remove();
    }
  }

  handleStateChange(change) {
    if (change.channel.startsWith('session:')) {
      this.renderHub();
      this.renderStage();
      if (change.channel === 'session:messages' || change.channel === 'session:active') {
        this.renderMessages();
      }
      return;
    }

    if (change.channel.startsWith('runtime:')) {
      this.updateConfigUI();
      this.renderTools();
      this.renderSystemVersionModal();
      if (change.channel === 'runtime:stream') {
        this.renderHub();
      }
      return;
    }

    if (change.channel.startsWith('ui:')) {
      this.renderUpdateBanner();
    }
  }

  safeInjectIcon(id, iconHtml) {
    const element = this.getElement(id);
    if (element && iconHtml) {
      element.innerHTML = iconHtml;
    }
  }

  bindLangSwitch() {
    document.querySelectorAll('.lang-btn').forEach((btn) => {
      btn.onclick = () => {
        i18n.setLocale(btn.dataset.lang);
      };
    });
  }

  injectStaticIcons() {
    this.safeInjectIcon(DOM_IDS.NEW_BTN, Icons.ADD);
    this.safeInjectIcon(DOM_IDS.ATTACH_BTN, Icons.ATTACH);
    this.safeInjectIcon(DOM_IDS.SEND_BTN, Icons.SEND);
    this.safeInjectIcon(DOM_IDS.ICON_QUICK_NEW, Icons.ADD);
    this.safeInjectIcon(DOM_IDS.ICON_QUICK_OPEN, Icons.FOLDER);
    this.safeInjectIcon(DOM_IDS.ICON_MCP, Icons.CPU);
    this.safeInjectIcon(DOM_IDS.ICON_IM, Icons.LINK);
    this.safeInjectIcon(DOM_IDS.ICON_SYSTEM, Icons.SETTINGS);
    this.safeInjectIcon(DOM_IDS.HEADER_ICON_CONFIG, Icons.SETTINGS);
    this.safeInjectIcon(DOM_IDS.HEADER_ICON_TOOLS, Icons.BOX);
    this.safeInjectIcon(DOM_IDS.HEADER_ICON_MONITOR, Icons.ACTIVITY);
    this.safeInjectIcon(DOM_IDS.MODAL_HEADER_ICON, Icons.SETTINGS);
    this.safeInjectIcon(DOM_IDS.SYSTEM_MODAL_HEADER_ICON, Icons.SETTINGS);
    this.safeInjectIcon(DOM_IDS.IM_MODAL_HEADER_ICON, Icons.LINK);
    this.safeInjectIcon(DOM_IDS.ICON_PLUGIN_FEISHU, Icons.EARTH);
  }

  updateI18nUI() {
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      el.innerText = i18n.t(el.dataset.i18n);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      el.placeholder = i18n.t(el.dataset.i18nPlaceholder);
    });
    document.querySelectorAll('[data-i18n-title]').forEach((el) => {
      el.title = i18n.t(el.dataset.i18nTitle);
    });
    document.querySelectorAll('.lang-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.lang === i18n.getLocale());
    });
    this.renderHub();
    this.renderStage();
    this.renderMessages();
    this.updateConfigUI();
    this.renderTools();
    this.renderSystemVersionModal();
    this.renderUpdateBanner();
  }

  updateConfigUI() {
    const mcpBadge = this.getElement(DOM_IDS.BADGE_MCP);
    const mcpInfo = this.getElement(DOM_IDS.INFO_MCP);
    if (mcpBadge) {
      if (this.state.runtime.mcpOnline) {
        mcpBadge.innerText = i18n.t('status.running');
        mcpBadge.classList.add('status-ok');
        if (mcpInfo) mcpInfo.innerText = `${this.state.runtime.tools.length} Tools`;
      } else {
        mcpBadge.innerText = i18n.t('status.stopped');
        mcpBadge.classList.remove('status-ok');
        if (mcpInfo) mcpInfo.innerText = '';
      }
    }

    const imBadge = this.getElement(DOM_IDS.BADGE_IM);
    const imInfo = this.getElement(DOM_IDS.INFO_IM);
    if (imBadge) {
      if (this.state.runtime.imOnline) {
        imBadge.innerText = i18n.t('status.connected');
        imBadge.classList.add('status-ok');
        if (imInfo) imInfo.innerText = i18n.t('status.online');
      } else {
        imBadge.innerText = i18n.t('status.disconnected');
        imBadge.classList.remove('status-ok');
        if (imInfo) imInfo.innerText = i18n.t('status.offline');
      }
    }

    const systemBadge = this.getElement(DOM_IDS.BADGE_SYSTEM);
    const systemInfo = this.getElement(DOM_IDS.INFO_SYSTEM);
    const hubVersion = this.getElement(DOM_IDS.HUB_VERSION);
    const currentVersion = this.state.runtime.versionInfo?.current?.version || this.state.runtime.versionInfo?.manifest?.version || '--';
    const nodeVersion = this.state.runtime.versionInfo?.manifest?.runtime?.node || '';
    const latestVersion = this.state.runtime.versionInfo?.latest?.version || currentVersion;

    if (systemBadge) {
      systemBadge.innerText = 'OK';
      systemBadge.classList.add('status-ok');
    }
    if (systemInfo) {
      const latestSuffix = latestVersion && latestVersion !== currentVersion ? ` → v${latestVersion}` : '';
      const nodeSuffix = nodeVersion ? ` · Node ${nodeVersion}` : '';
      systemInfo.innerText = `Kernel v${currentVersion}${latestSuffix}${nodeSuffix}`;
    }
    if (hubVersion) {
      hubVersion.innerText = `v${currentVersion}`;
    }

    const toolCount = this.getElement(DOM_IDS.TOOL_COUNT);
    if (toolCount) {
      toolCount.innerText = String(this.state.runtime.tools.length);
    }
  }

  renderSystemVersionModal() {
    const summary = this.getElement(DOM_IDS.SYSTEM_VERSION_SUMMARY);
    const update = this.getElement(DOM_IDS.SYSTEM_VERSION_UPDATE);
    const protocols = this.getElement(DOM_IDS.SYSTEM_VERSION_PROTOCOLS);
    const schemas = this.getElement(DOM_IDS.SYSTEM_VERSION_SCHEMAS);
    const slots = this.getElement(DOM_IDS.SYSTEM_VERSION_SLOTS);
    const manifestCode = this.getElement(DOM_IDS.SYSTEM_MANIFEST_JSON);
    if (!summary || !update || !protocols || !schemas || !slots || !manifestCode) {
      return;
    }

    const rendered = this.systemVersionRenderer.render({
      versionInfo: this.state.runtime.versionInfo,
      t: (key) => i18n.t(key),
      escapeHtml: (value) => this.escapeHtml(value)
    });

    summary.innerHTML = rendered.summaryHtml;
    update.innerHTML = rendered.updateHtml;
    protocols.innerHTML = rendered.protocolsHtml;
    schemas.innerHTML = rendered.schemasHtml;
    slots.innerHTML = rendered.slotsHtml;
    manifestCode.innerText = rendered.manifestJson;
  }

  renderStage() {
    if (this.state.session.activeId) {
      this.app.stageEmpty.classList.add('hidden');
      this.app.stageChat.classList.remove('hidden');
      return;
    }
    this.app.stageEmpty.classList.remove('hidden');
    this.app.stageChat.classList.add('hidden');
  }

  renderHub() {
    this.app.hubList.innerHTML = this.hubListRenderer.render({
      isStreamConnected: this.state.runtime.isStreamConnected,
      sessions: this.state.session.sessions,
      activeId: this.state.session.activeId,
      icons: Icons,
      t: (key) => i18n.t(key),
      escapeHtml: (value) => this.escapeHtml(value),
      actions: CHAT_ACTIONS
    });
  }

  renderMessages() {
    this.app.chatBox.innerHTML = this.messageListRenderer.render({
      messages: this.state.session.messages,
      icons: Icons,
      t: (key) => i18n.t(key),
      escapeHtml: (value) => this.escapeHtml(value),
      escapeAttribute: (value) => this.escapeAttribute(value),
      chatActions: CHAT_ACTIONS
    });
    this.app.chatBox.scrollTop = this.app.chatBox.scrollHeight;
  }

  activateOption(button) {
    const parent = button.closest('.question-item');
    if (!parent) {
      return;
    }
    parent.querySelectorAll('.option-btn').forEach((candidate) => candidate.classList.remove('active'));
    button.classList.add('active');
  }

  renderTools() {
    if (!this.app.toolList) return;
    this.app.toolList.innerHTML = this.toolListRenderer.render({
      tools: this.state.runtime.tools,
      escapeHtml: (value) => this.escapeHtml(value)
    });
    const toolCount = this.getElement(DOM_IDS.TOOL_COUNT);
    if (toolCount) {
      toolCount.innerText = String(this.state.runtime.tools.length);
    }
  }

  renderUpdateBanner() {
    if (!this.app.updateBanner || !this.app.updateMsg) {
      return;
    }
    if (!this.state.ui.pendingUpdate) {
      this.app.updateBanner.classList.add('hidden');
      return;
    }
    this.app.updateMsg.innerText = `New version available: v${this.state.ui.pendingUpdate.version}`;
    this.app.updateBanner.classList.remove('hidden');
  }

  escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = value;
    return div.innerHTML;
  }

  escapeAttribute(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}
