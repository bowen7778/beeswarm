import { apiClient } from '../services/api/ApiClient.js';
import { logger } from '../services/logger.js';
import { CHAT_ACTIONS } from './NebulaDom.js';
import { i18n } from '../services/i18n.js';

export class NebulaSessionController {
  constructor(app) {
    this.app = app;
  }

  get state() {
    return this.app.state;
  }

  getActiveSession() {
    return this.state.session.sessions.find((session) => session.projectId === this.state.session.activeId) || null;
  }

  clearActiveSession() {
    this.app.stateStore.setSessionState({
      activeId: '',
      messages: []
    }, 'session:active');
  }

  async syncSessions() {
    try {
      const res = await apiClient.fetchSessions();
      const json = typeof res.json === 'function' ? await res.json() : res;
      if (!json.success) {
        return;
      }
      const sessions = Array.isArray(json.data) ? json.data : [];
      const stillExists = this.state.session.activeId
        ? sessions.some((session) => session.projectId === this.state.session.activeId)
        : false;
      this.app.stateStore.setSessionState({
        sessions,
        activeId: stillExists ? this.state.session.activeId : '',
        messages: stillExists ? this.state.session.messages : []
      }, 'session:sessions');
    } catch (error) {
      logger.error('Sync Sessions Error', error);
    }
  }

  async syncStatus() {
    try {
      const activeSession = this.getActiveSession();
      const [imRes, mcpRes, versionRes] = await Promise.all([
        apiClient.fetchImStatus(this.state.session.activeId, activeSession?.workspacePath || ''),
        apiClient.fetchMcpDiscovery(),
        apiClient.fetchVersionInfo()
      ]);
      const imJson = typeof imRes.json === 'function' ? await imRes.json() : imRes;
      const mcpJson = typeof mcpRes.json === 'function' ? await mcpRes.json() : mcpRes;
      const versionJson = typeof versionRes.json === 'function' ? await versionRes.json() : versionRes;
      this.app.stateStore.setRuntimeState({
        imOnline: !!(imJson.success && imJson.data?.enabled && imJson.data?.configured && imJson.data?.providerOk !== false),
        mcpOnline: !!(mcpJson.success && mcpJson.data?.host?.alive),
        versionInfo: versionJson.success ? versionJson.data : this.state.runtime.versionInfo,
        tools: mcpJson.success ? (mcpJson.data.tools || []) : this.state.runtime.tools
      }, 'runtime:status');
    } catch (error) {
      logger.warn('Sync Status Error', error);
    }
  }

  handleStreamMessage(data) {
    logger.debug('Stream Data Received', data);
    if (data._meta?.status === 'ready' || !this.state.runtime.isStreamConnected) {
      this.app.stateStore.setRuntimeState({
        isStreamConnected: true
      }, 'runtime:stream');
    }

    if (data.state?.sessions) {
      const sessions = data.state.sessions;
      const stillExists = this.state.session.activeId
        ? sessions.some((session) => session.projectId === this.state.session.activeId)
        : false;
      this.app.stateStore.setSessionState({
        sessions,
        activeId: stillExists ? this.state.session.activeId : '',
        messages: stillExists ? this.state.session.messages : []
      }, 'session:sessions');
      this.app.stateStore.setRuntimeState({
        imOnline: !!(data.state.im?.feishu?.configured && data.state.im?.feishu?.enabled)
      }, 'runtime:status');
    }

    if (!Array.isArray(data.events)) {
      return;
    }

    for (const event of data.events) {
      if ((event.type === 'ai_message' || event.type === 'user_message') && event.payload.projectId === this.state.session.activeId) {
        const exists = this.state.session.messages.some((message) => message.id === event.payload.id);
        if (!exists) {
          this.app.stateStore.setSessionState({
            messages: [
              ...this.state.session.messages,
              {
                id: event.payload.id,
                role: event.payload.role,
                text: event.payload.content,
                timestamp: event.payload.timestamp
              }
            ]
          }, 'session:messages');
        }
        continue;
      }

      if (event.type === 'update_available') {
        this.app.stateStore.setUiState({
          pendingUpdate: event.payload
        }, 'ui:update-banner');
        this.app.emitMonitor('info', `Update available: v${event.payload.version}`, { domain: 'system', action: 'update-available' });
        continue;
      }

      if (event.type === 'ui_focus') {
        this.app.emitMonitor('info', `Remote Focus: ${event.payload.projectId}`, { domain: 'session', action: 'focus' });
        this.selectSession(event.payload.projectId);
      }
    }
  }

  async handleSend() {
    const text = this.app.msgInput.value.trim();
    if (!text || !this.state.session.activeId) return;
    const activeSession = this.getActiveSession();
    this.app.msgInput.value = '';
    const tempId = `temp-${Date.now()}`;
    this.app.stateStore.setSessionState({
      messages: [
        ...this.state.session.messages,
        {
          id: tempId,
          role: 'user',
          text,
          timestamp: new Date().toISOString()
        }
      ]
    }, 'session:messages');
    try {
      await apiClient.sendMessage({
        projectId: this.state.session.activeId,
        projectRoot: activeSession?.workspacePath,
        text,
        clientMessageId: tempId
      });
    } catch (error) {
      logger.error('Send failed', error);
    }
  }

  async handleNewContext() {
    const name = await this.app.dialogController.showPrompt(i18n.t('hub.new'), i18n.t('prompt.project_name'));
    if (!name) return;
    const root = await this.app.dialogController.showPrompt(i18n.t('hub.new'), i18n.t('prompt.project_root'), '');
    this.app.emitMonitor('info', `Creating new project: ${name}...`, { domain: 'session', action: 'create' });
    try {
      const res = await apiClient.initProject(name, root);
      const json = typeof res.json === 'function' ? await res.json() : res;
      if (json.success) {
        this.app.emitMonitor('info', `Project ${name} created.`, { domain: 'session', action: 'created' });
        await this.syncSessions();
      } else {
        await this.app.dialogController.showAlert('Service Error', `${i18n.t('error.init_failed')}: ${json.error?.message || 'Unknown'}`);
      }
    } catch (error) {
      logger.error('Create Project Error', error);
    }
  }

  handleHubClick(event) {
    const target = event.target.closest('[data-action]');
    if (!target || !this.app.hubList.contains(target)) {
      return;
    }
    const sessionId = target.dataset.sessionId || '';
    if (target.dataset.action === CHAT_ACTIONS.DELETE_SESSION) {
      event.preventDefault();
      event.stopPropagation();
      this.handleDeleteSession(sessionId);
      return;
    }
    if (target.dataset.action === CHAT_ACTIONS.SELECT_SESSION) {
      event.preventDefault();
      this.selectSession(sessionId);
    }
  }

  async selectSession(id, retryCount = 0) {
    if (!id) return;
    if (this.state.session.activeId === id && this.state.session.messages.length > 0) return;
    const session = this.state.session.sessions.find((item) => item.projectId === id || item.id === id);
    if (!session && retryCount < 10) {
      setTimeout(() => this.selectSession(id, retryCount + 1), 500);
      return;
    }
    if (!session) return;

    this.app.stateStore.setSessionState({
      activeId: id,
      messages: []
    }, 'session:active');
    this.app.stageTitle.innerText = session.title || session.name || id;
    this.app.stageTitle.removeAttribute('data-i18n');
    setTimeout(() => {
      this.syncHistory(id, session.workspacePath);
      this.app.stream.connect(id, session.workspacePath);
    }, 0);
  }

  async syncHistory(id, projectRoot = '') {
    try {
      const res = await apiClient.fetchHistory(id, projectRoot);
      const json = typeof res.json === 'function' ? await res.json() : res;
      if (json.success) {
        this.app.stateStore.setSessionState({
          messages: json.data.map((message) => ({
            role: message.role,
            text: message.content,
            id: message.id,
            timestamp: message.timestamp
          }))
        }, 'session:messages');
      }
    } catch (error) {
      logger.error('Sync History Error', id, error);
    }
  }

  async handleDeleteSession(id) {
    const confirmed = await this.app.dialogController.showConfirm(
      i18n.t('dialog.delete_project.title'),
      i18n.t('dialog.delete_project.msg'),
      true
    );
    if (!confirmed) return;
    try {
      const res = await apiClient.deleteSession(id);
      const json = typeof res.json === 'function' ? await res.json() : res;
      if (json.success) {
        this.app.emitMonitor('info', `Session ${id} deleted.`, { domain: 'session', action: 'deleted' });
        await this.syncSessions();
      }
    } catch (error) {
      logger.error('Delete Session Error', error);
    }
  }
}
