import { apiFetch } from './request.js';

export const sessionClient = {
  async fetchSessions() {
    return await apiFetch('/api/sessions');
  },

  async fetchHistory(projectId, projectRoot = '') {
    return await apiFetch(`/api/history?projectId=${encodeURIComponent(projectId)}`, { projectId, projectRoot });
  },

  async sendMessage(payload) {
    const { projectId, projectRoot, text, content, clientMessageId } = payload;
    return await apiFetch('/api/send', {
      method: 'POST',
      projectId,
      projectRoot,
      body: {
        projectId,
        content: text || content,
        clientMessageId
      }
    });
  },

  async initProject(name, projectRoot = '') {
    return await apiFetch('/api/project/initialize', {
      method: 'POST',
      projectRoot,
      body: { name }
    });
  },

  async deleteSession(projectId) {
    return await apiFetch(`/api/sessions/${encodeURIComponent(projectId)}`, {
      method: 'DELETE'
    });
  }
};
