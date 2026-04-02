import { apiFetch } from './request.js';

export const imClient = {
  async fetchImStatus(projectId = '', projectRoot = '') {
    return await apiFetch('/api/im/status?provider=feishu', {
      projectId,
      projectRoot
    });
  },

  async fetchImConfig() {
    return await apiFetch('/api/im/config?provider=feishu');
  },

  async fetchAdminCaptureStatus(projectId = '', projectRoot = '') {
    return await apiFetch('/api/im/admin_capture/status?provider=feishu', {
      projectId,
      projectRoot
    });
  },

  async saveImConfig(payload) {
    const { pluginId, config } = payload;
    return await apiFetch(`/api/im/config?provider=${encodeURIComponent(pluginId)}`, {
      method: 'POST',
      body: {
        enabled: !!config.enabled,
        credentials: {
          appId: String(config.appId || ''),
          appSecret: String(config.appSecret || '')
        },
        routingPolicy: {
          connectionMode: String(config.connectionMode || 'webhook')
        }
      }
    });
  },

  async startAdminCapture(payload) {
    const { pluginId, timeout = 180000 } = payload;
    return await apiFetch(`/api/im/admin_capture/start?provider=${encodeURIComponent(pluginId)}&timeout=${encodeURIComponent(timeout)}`, {
      method: 'POST'
    });
  },

  async restartImConnection(payload) {
    const { pluginId } = payload;
    return await apiFetch(`/api/im/long_connection/restart?provider=${encodeURIComponent(pluginId)}`, {
      method: 'POST'
    });
  }
};
