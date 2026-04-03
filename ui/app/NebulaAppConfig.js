import { apiClient } from '../services/api/ApiClient.js';
import { logger } from '../services/logger.js';
import { i18n } from '../services/i18n.js';
import { DOM_IDS } from './NebulaDom.js';
import { Icons } from '../utils/Icons.js';

export class NebulaConfigController {
  constructor(app) {
    this.app = app;
    this.captureTimer = null;
    this.editingBotId = null; // Track which bot is being edited
  }

  get state() {
    return this.app.state;
  }

  getActiveSession() {
    return this.app.sessionController.getActiveSession();
  }

  getElement(id) {
    return this.app.getElement(id);
  }

  requireElement(id) {
    return this.app.requireElement(id);
  }

  async showImConfig() {
    const overlay = this.getElement(DOM_IDS.IM_MODAL_OVERLAY);
    if (!overlay) return;
    await this.switchImView('hub');
    await this.loadImPluginStatus();
    overlay.classList.remove('hidden');
    this.app.emitMonitor('info', 'IM Plugin Hub opened', { domain: 'im', action: 'open-hub' });
  }

  hideImConfig() {
    const overlay = this.getElement(DOM_IDS.IM_MODAL_OVERLAY);
    if (overlay) overlay.classList.add('hidden');
  }

  async switchImView(viewName) {
    const hubView = this.requireElement(DOM_IDS.IM_VIEW_HUB);
    const feishuView = this.requireElement(DOM_IDS.IM_VIEW_FEISHU);
    const titleText = this.requireElement(DOM_IDS.IM_MODAL_TITLE_TEXT);
    if (viewName === 'hub') {
      hubView.classList.remove('hidden');
      feishuView.classList.add('hidden');
      titleText.innerText = i18n.t('modal.im.title');
      await this.loadImPluginStatus();
    } else if (viewName === 'feishu') {
      hubView.classList.add('hidden');
      feishuView.classList.remove('hidden');
      titleText.innerText = i18n.t('modal.im.feishu.name');
      this.editingBotId = null;
      this.getElement(DOM_IDS.IM_FEISHU_BOT_EDIT)?.classList.add('hidden');
      await this.loadFeishuConfig();
    }
  }

  async loadImPluginStatus() {
    try {
      const res = await apiClient.fetchImStatus();
      const status = typeof res.json === 'function' ? await res.json() : res;
      if (status.success && status.data) {
        const feishuStatus = this.getElement(DOM_IDS.PLUGIN_STATUS_FEISHU);
        if (feishuStatus) {
          const online = !!(status.data.enabled && status.data.configured && status.data.providerOk !== false);
          feishuStatus.innerText = online ? i18n.t('status.online') : i18n.t('status.offline');
          feishuStatus.style.color = online ? 'var(--nebula-accent)' : 'var(--nebula-text-dim)';
        }
      }
    } catch (err) {
      logger.error('Failed to load IM status', err);
    }
  }

  async loadFeishuConfig() {
    try {
      const res = await apiClient.fetchImConfig();
      const config = typeof res.json === 'function' ? await res.json() : res;
      if (config.success && config.data?.plugins?.feishu) {
        const p = config.data.plugins.feishu;
        
        // Update master toggle
        const toggle = this.getElement(DOM_IDS.IM_FEISHU_ENABLED_TOGGLE);
        if (toggle) toggle.checked = !!p.enabled;
        
        // Render bot list
        this.renderBotList(p.instances || [], p.masterBotId);
        
        await this.updateFeishuStatusUI(p);
      }
    } catch (err) {
      logger.error('Failed to load Feishu config', err);
    }
  }

  renderBotList(instances, masterBotId) {
    const list = this.getElement(DOM_IDS.IM_FEISHU_BOT_LIST);
    if (!list) return;
    
    if (!instances || instances.length === 0) {
      list.innerHTML = `<div class="empty-list-hint">${i18n.t('hub.empty.desc')}</div>`;
      return;
    }
    
    list.innerHTML = instances.map(bot => `
      <div class="im-bot-item ${bot.id === masterBotId ? 'master' : ''}">
        <div class="bot-info">
          <div class="bot-name">${this.app.renderController.escapeHtml(bot.name)} ${bot.id === masterBotId ? `<span class="master-badge">${i18n.t('modal.im.feishu.master_badge') || 'DEFAULT'}</span>` : ''}</div>
          <div class="bot-meta">ID: ${bot.id} · ${bot.enabled ? i18n.t('status.online') : i18n.t('status.offline')}</div>
        </div>
        <div class="bot-actions">
          ${bot.id !== masterBotId ? `<button class="bot-action-btn set-master" data-id="${bot.id}" title="${i18n.t('modal.im.feishu.set_master') || 'Set as Default'}">${Icons.STAR || '★'}</button>` : ''}
          <button class="bot-action-btn edit" data-id="${bot.id}" title="${i18n.t('common.edit') || 'Edit'}">${Icons.EDIT || '✎'}</button>
          <button class="bot-action-btn delete" data-id="${bot.id}" title="${i18n.t('common.delete') || 'Delete'}">${Icons.DELETE || '×'}</button>
        </div>
      </div>
    `).join('');
    
    // Bind actions
    list.querySelectorAll('.bot-action-btn.edit').forEach(btn => {
      btn.onclick = () => this.showBotEdit(btn.dataset.id, instances.find(i => i.id === btn.dataset.id));
    });
    list.querySelectorAll('.bot-action-btn.delete').forEach(btn => {
      btn.onclick = () => this.deleteBot(btn.dataset.id);
    });
    list.querySelectorAll('.bot-action-btn.set-master').forEach(btn => {
      btn.onclick = () => this.setMasterBot(btn.dataset.id);
    });
    
    list.querySelectorAll('.bot-action-btn.edit').forEach(btn => {
      const bot = instances.find(i => i.id === btn.dataset.id);
      btn.onclick = () => this.showBotEdit(btn.dataset.id, bot);
    });
    
    list.querySelectorAll('.bot-action-btn.delete').forEach(btn => {
      btn.onclick = () => this.deleteBot(btn.dataset.id);
    });
  }

  showBotEdit(botId = null, data = null) {
    this.editingBotId = botId;
    const form = this.requireElement(DOM_IDS.IM_FEISHU_BOT_EDIT);
    const title = this.requireElement(DOM_IDS.IM_FEISHU_EDIT_TITLE);
    
    form.classList.remove('hidden');
    title.innerText = botId ? (i18n.t('modal.im.feishu.edit_bot') || '编辑机器人') : i18n.t('modal.im.feishu.add_bot');
    
    this.requireElement(DOM_IDS.IM_FEISHU_BOT_NAME).value = data?.name || '';
    this.requireElement(DOM_IDS.IM_FEISHU_BOT_APPID).value = data?.credentials?.appId || '';
    this.requireElement(DOM_IDS.IM_FEISHU_BOT_SECRET).value = ''; // Always clear secret on edit
    this.requireElement(DOM_IDS.IM_FEISHU_BOT_MODE).value = data?.routingPolicy?.connectionMode || 'long_connection';
    
    form.scrollIntoView({ behavior: 'smooth' });
  }

  hideBotEdit() {
    this.editingBotId = null;
    this.getElement(DOM_IDS.IM_FEISHU_BOT_EDIT)?.classList.add('hidden');
  }

  async saveBot() {
    const name = this.requireElement(DOM_IDS.IM_FEISHU_BOT_NAME).value;
    const appId = this.requireElement(DOM_IDS.IM_FEISHU_BOT_APPID).value;
    const appSecret = this.requireElement(DOM_IDS.IM_FEISHU_BOT_SECRET).value;
    const mode = this.requireElement(DOM_IDS.IM_FEISHU_BOT_MODE).value;
    
    if (!name || !appId) {
      this.app.emitMonitor('warn', 'Name and App ID are required', { domain: 'im' });
      return;
    }
    
    const botData = {
      name,
      enabled: true,
      credentials: { appId },
      routingPolicy: { connectionMode: mode, autoCreateGroup: true }
    };

    if (appSecret) {
      botData.credentials.appSecret = appSecret;
    }
    
    try {
      let res;
      if (this.editingBotId) {
        res = await apiClient.updateBotInstance({ pluginId: 'feishu', botId: this.editingBotId, patch: botData });
      } else {
        res = await apiClient.addBotInstance({ pluginId: 'feishu', instance: botData });
      }
      
      const result = typeof res.json === 'function' ? await res.json() : res;
      if (result.success) {
        this.app.emitMonitor('info', 'Bot instance saved successfully', { domain: 'im' });
        this.hideBotEdit();
        await this.loadFeishuConfig();
      }
    } catch (err) {
      logger.error('Failed to save bot', err);
    }
  }

  async deleteBot(botId) {
    if (!confirm('Are you sure you want to delete this bot?')) return;
    try {
      const res = await apiClient.removeBotInstance({ pluginId: 'feishu', botId });
      const result = typeof res.json === 'function' ? await res.json() : res;
      if (result.success) {
        this.app.emitMonitor('info', 'Bot instance removed', { domain: 'im' });
        await this.loadFeishuConfig();
      }
    } catch (err) {
      logger.error('Failed to delete bot', err);
    }
  }

  async setMasterBot(botId) {
    try {
      const res = await apiClient.setMasterBot({ pluginId: 'feishu', botId });
      const result = typeof res.json === 'function' ? await res.json() : res;
      if (result.success) {
        this.app.emitMonitor('info', 'Master bot updated', { domain: 'im' });
        await this.loadFeishuConfig();
      }
    } catch (err) {
      logger.error('Failed to set master bot', err);
    }
  }

  async updateFeishuStatusUI(pluginConfig = null) {
    try {
      const [statusRes, adminStatusRes, configRes] = await Promise.all([
        apiClient.fetchImStatus(this.state.session.activeId, this.getActiveSession()?.workspacePath || ''),
        apiClient.fetchAdminCaptureStatus(this.state.session.activeId, this.getActiveSession()?.workspacePath || ''),
        pluginConfig ? null : apiClient.fetchImConfig()
      ]);
      const status = typeof statusRes.json === 'function' ? await statusRes.json() : statusRes;
      const adminStatus = typeof adminStatusRes.json === 'function' ? await adminStatusRes.json() : adminStatusRes;
      const config = pluginConfig
        ? pluginConfig
        : (() => {
            const resolved = configRes && typeof configRes.json === 'function' ? configRes.json() : configRes;
            return resolved?.data?.plugins?.feishu || {};
          })();

      if (status.success && status.data) {
        const runtime = status.data;
        const adminCapture = adminStatus?.success ? adminStatus.data || {} : {};
        
        // Find master bot name
        const masterBot = runtime.instances?.find(i => i.id === runtime.masterBotId);
        this.requireElement(DOM_IDS.IM_FEISHU_MASTER_BOT_NAME).innerText = masterBot ? masterBot.name : (runtime.masterBotId || '---');
        
        this.requireElement(DOM_IDS.IM_FEISHU_COUNT).innerText = String(runtime.inboundTotal || 0);
        const adminEl = this.requireElement(DOM_IDS.IM_FEISHU_ADMIN);
        const bindBtn = this.requireElement(DOM_IDS.IM_FEISHU_BIND_ADMIN);
        const currentOpenId = adminCapture.capturedOpenId || config?.credentials?.userOpenId || runtime.boundChatId || '';
        if (currentOpenId) {
          adminEl.innerText = currentOpenId;
          adminEl.style.color = 'var(--nebula-accent)';
          adminEl.title = 'Admin OpenID Bound';
        } else {
          adminEl.innerText = i18n.t('status.offline');
          adminEl.style.color = 'var(--nebula-text-dim)';
        }

        if (adminCapture.active) {
          const expiresAt = new Date(adminCapture.expiresAt).getTime();
          const remaining = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
          if (remaining > 0) {
            bindBtn.innerText = `${i18n.t('modal.im.feishu.capturing')} (${remaining}s)`;
            bindBtn.classList.add('capturing');
            bindBtn.disabled = true;
            if (!this.captureTimer) {
              this.captureTimer = setInterval(() => this.updateFeishuStatusUI(), 2000);
            }
          } else {
            this.stopCapturePolling(bindBtn);
          }
        } else if (adminCapture.capturedOpenId && this.captureTimer) {
          bindBtn.innerText = 'Captured';
          bindBtn.style.borderColor = 'var(--nebula-accent)';
          this.app.emitMonitor('info', `Admin OpenID captured: ${adminCapture.capturedOpenId}`, { domain: 'im', action: 'capture-success' });
          setTimeout(() => {
            this.stopCapturePolling(bindBtn);
            this.loadFeishuConfig();
          }, 3000);
        } else {
          this.stopCapturePolling(bindBtn);
        }
      }
    } catch (err) {
      logger.error('Failed to update Feishu status UI', err);
    }
  }

  stopCapturePolling(btn = null) {
    if (this.captureTimer) {
      clearInterval(this.captureTimer);
      this.captureTimer = null;
    }
    const targetButton = btn || this.getElement(DOM_IDS.IM_FEISHU_BIND_ADMIN);
    if (targetButton) {
      targetButton.innerText = i18n.t('modal.im.feishu.bind_admin');
      targetButton.classList.remove('capturing');
      targetButton.style.borderColor = '';
      targetButton.disabled = false;
    }
  }

  async startAdminCapture() {
    const bindBtn = this.getElement(DOM_IDS.IM_FEISHU_BIND_ADMIN);
    if (!bindBtn) {
      console.error('[Nebula] Admin bind button not found');
      return;
    }
    if (bindBtn.disabled) {
      console.warn('[Nebula] Admin bind button is already disabled');
      return;
    }
    
    const originalText = bindBtn.innerText;
    bindBtn.innerText = i18n.t('hub.initializing') || 'Starting...';
    bindBtn.disabled = true;
    
    try {
      console.log('[Nebula] Requesting admin capture start...');
      const res = await apiClient.startAdminCapture({ pluginId: 'feishu' });
      const result = typeof res.json === 'function' ? await res.json() : res;
      
      console.log('[Nebula] Admin capture start response:', result);
      
      if (result.success) {
        this.app.emitMonitor('info', 'Admin capture mode started. Please message the bot in Feishu.', { domain: 'im', action: 'capture-start' });
        await this.updateFeishuStatusUI();
      } else {
        const errorMsg = result.error?.message || 'Unknown error';
        this.app.emitMonitor('warn', `Start capture failed: ${errorMsg}`, { domain: 'im', action: 'capture-failed' });
        console.error('[Nebula] Start capture failed:', result.error);
        bindBtn.innerText = originalText;
        bindBtn.disabled = false;
      }
    } catch (err) {
      console.error('[Nebula] Start capture exception:', err);
      this.app.emitMonitor('warn', `Failed to start admin capture: ${err.message}`, { domain: 'im', action: 'capture-error' });
      bindBtn.innerText = originalText;
      bindBtn.disabled = false;
    }
  }

  async saveFeishuConfig(isSilent = false) {
    const enabled = this.requireElement(DOM_IDS.IM_FEISHU_ENABLED_TOGGLE).checked;
    const payload = { pluginId: 'feishu', config: { enabled } };
    try {
      const res = await apiClient.saveImConfig(payload);
      const result = typeof res.json === 'function' ? await res.json() : res;
      if (result.success) {
        if (!isSilent) this.app.emitMonitor('info', 'Feishu configuration updated', { domain: 'im', action: 'save-config' });
        await this.restartFeishuConnection(true);
      }
    } catch (err) {
      logger.error('Save failed', err);
      if (!isSilent) this.app.emitMonitor('warn', 'Failed to save Feishu configuration', { domain: 'im', action: 'save-config-failed' });
    }
  }

  async restartFeishuConnection(isSilent = false) {
    try {
      const res = await apiClient.restartImConnection({ pluginId: 'feishu' });
      const result = typeof res.json === 'function' ? await res.json() : res;
      if (result.success) {
        if (!isSilent) this.app.emitMonitor('info', 'Feishu connection restart triggered', { domain: 'im', action: 'restart' });
        await this.updateFeishuStatusUI();
      }
    } catch (err) {
      logger.error('Restart failed', err);
    }
  }

  async showMcpConfig() {
    const overlay = this.getElement(DOM_IDS.MCP_MODAL_OVERLAY);
    if (!overlay) return;
    try {
      const res = await apiClient.fetchMcpDiscovery();
      const discovery = typeof res.json === 'function' ? await res.json() : res;
      if (discovery.success && discovery.data?.transports) {
        const data = discovery.data;
        const appIdentifier = discovery.data?.appIdentifier || 'beeswarm';
        const sseSnippet = { mcpServers: { [appIdentifier]: { url: data.transports.sse.url } } };
        const ssePre = this.getElement(DOM_IDS.CODE_SNIPPET_SSE);
        if (ssePre) ssePre.innerText = JSON.stringify(sseSnippet, null, 2);
        const stdioSnippet = {
          mcpServers: {
            [appIdentifier]: {
              command: data.transports.stdio.command,
              args: data.transports.stdio.args,
              env: data.transports.stdio.env
            }
          }
        };
        const stdioPre = this.getElement(DOM_IDS.CODE_SNIPPET_STDIO);
        if (stdioPre) stdioPre.innerText = JSON.stringify(stdioSnippet, null, 2);
      } else {

        this.app.emitMonitor('warn', 'MCP Discovery data incomplete', { domain: 'mcp', action: 'show-config' });
      }
    } catch (err) {
      logger.error('Failed to fetch discovery for modal', err);
      this.app.emitMonitor('warn', 'Failed to fetch real-time MCP config', { domain: 'mcp', action: 'show-config-error' });
    }
    overlay.classList.remove('hidden');
    this.app.emitMonitor('info', 'MCP Config Center opened', { domain: 'mcp', action: 'show-config' });
  }

  hideMcpConfig() {
    const overlay = this.getElement(DOM_IDS.MCP_MODAL_OVERLAY);
    if (overlay) overlay.classList.add('hidden');
  }

  async showSystemConfig() {
    const overlay = this.getElement(DOM_IDS.SYSTEM_MODAL_OVERLAY);
    if (!overlay) return;
    await this.app.sessionController.syncStatus();
    this.app.renderController.renderSystemVersionModal();
    overlay.classList.remove('hidden');
    this.app.emitMonitor('info', `Kernel version: v${this.state.runtime.versionInfo?.current?.version || '--'}`, { domain: 'system', action: 'show-version' });
  }

  hideSystemConfig() {
    const overlay = this.getElement(DOM_IDS.SYSTEM_MODAL_OVERLAY);
    if (overlay) overlay.classList.add('hidden');
  }

  async copyToClipboard(codeId, btnId) {
    const code = this.requireElement(codeId).innerText;
    const btn = this.getElement(btnId);
    try {
      await navigator.clipboard.writeText(code);
      const originalText = btn.innerText;
      btn.innerText = i18n.t('modal.mcp.copied') || 'Copied!';
      btn.classList.add('copied');
      setTimeout(() => {
        btn.innerText = originalText;
        btn.classList.remove('copied');
      }, 2000);
      this.app.emitMonitor('info', `Config snippet copied: ${codeId}`, { domain: 'config', action: 'copy' });
    } catch (err) {
      logger.error('Copy failed', err);
    }
  }

  async handleCheckUpdates() {
    const btn = this.getElement(DOM_IDS.SYSTEM_UPDATE_CHECK_BTN);
    const originalText = btn?.innerText || '';
    if (btn) {
      btn.disabled = true;
      btn.innerText = i18n.t('modal.system.update_downloading');
    }
    try {
      const res = await apiClient.checkUpdates();
      const result = typeof res.json === 'function' ? await res.json() : res;
      if (result.success) {
        if (this.state.runtime.versionInfo) {
          this.app.stateStore.setRuntimeState({
            versionInfo: {
              ...this.state.runtime.versionInfo,
              update: result.data
            }
          }, 'runtime:status');
        }
        if (result.data?.available && result.data?.remote) {
          this.showUpdateBanner(result.data.remote);
          this.app.emitMonitor('info', `Update available: v${result.data.remote.version}`, { domain: 'system', action: 'update-available' });
        } else {
          this.app.emitMonitor('info', i18n.t('modal.system.update_ok'), { domain: 'system', action: 'update-check' });
        }
      } else {
        throw new Error(result.error?.message || i18n.t('modal.system.update_failed'));
      }
    } catch (err) {
      logger.error('Update check failed', err);
      this.app.emitMonitor('warn', `${i18n.t('modal.system.update_failed')}: ${err.message}`, { domain: 'system', action: 'update-check-failed' });
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerText = originalText || i18n.t('modal.system.check_update');
      }
    }
  }

  showUpdateBanner(info) {
    this.app.stateStore.setUiState({
      pendingUpdate: info
    }, 'ui:update-banner');
    if (this.state.runtime.versionInfo) {
      this.app.stateStore.setRuntimeState({
        versionInfo: {
          ...this.state.runtime.versionInfo,
          update: {
            ...(this.state.runtime.versionInfo.update || {}),
            remote: info,
            available: true
          }
        }
      }, 'runtime:status');
    }
    this.app.emitMonitor('info', `Update available: v${info.version}`, { domain: 'system', action: 'update-banner' });
  }

  hideUpdateBanner() {
    this.app.stateStore.setUiState({
      pendingUpdate: null
    }, 'ui:update-banner');
  }

  async handleStartUpdate() {
    if (!this.state.ui.pendingUpdate) return;
    const info = this.state.ui.pendingUpdate;
    this.app.updateBtn.innerText = 'Downloading...';
    this.app.updateBtn.disabled = true;
    try {
      this.app.emitMonitor('info', `Starting update to v${info.version}...`, { domain: 'system', action: 'update-start' });
      const res = await apiClient.startUpdate(info);
      const result = typeof res.json === 'function' ? await res.json() : res;
      if (result.success) {
        if (this.state.runtime.versionInfo && result.data?.update) {
          this.app.stateStore.setRuntimeState({
            versionInfo: {
              ...this.state.runtime.versionInfo,
              update: result.data.update
            }
          }, 'runtime:status');
        }
        this.app.updateMsg.innerText = `v${info.version} 已下载完成，请手动重启 ${this.app.identity.appName} 以生效。`;
        this.app.updateBtn.innerText = '刷新页面';
        this.app.updateBtn.disabled = false;
        this.app.updateBtn.onclick = () => {
          window.location.reload();
        };
        this.app.emitMonitor('info', `Update v${info.version} downloaded. Waiting for manual app restart.`, { domain: 'system', action: 'update-ready' });
      } else {
        throw new Error(result.error?.message || 'Download failed');
      }
    } catch (err) {
      logger.error('Update failed', err);
      this.app.updateMsg.innerText = `Update failed: ${err.message}`;
      this.app.updateBtn.innerText = 'Retry';
      this.app.updateBtn.disabled = false;
      this.app.emitMonitor('warn', `Update failed: ${err.message}`, { domain: 'system', action: 'update-failed' });
    }
  }
}
