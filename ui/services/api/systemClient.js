import { apiFetch } from './request.js';

export const systemClient = {
  async fetchMcpDiscovery() {
    return await apiFetch('/api/mcp/discovery');
  },

  async fetchVersionInfo() {
    return await apiFetch('/api/system/version');
  },

  async checkUpdates() {
    return await apiFetch('/api/system/update/check');
  },

  async startUpdate(payload) {
    return await apiFetch('/api/system/update/start', {
      method: 'POST',
      body: payload
    });
  }
};
