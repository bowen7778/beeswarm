import { logger } from './logger.js';

/**
 * Nebula Stream Client (Standardized & Tauri-Native Edition)
 * 使用后端设计的 ipc_stream_* 系列命令，绕过浏览器 EventSource 限制。
 */

const tauriInvoke = window.__TAURI_INTERNALS__ && typeof window.__TAURI_INTERNALS__.invoke === 'function'
  ? window.__TAURI_INTERNALS__.invoke
  : null;

export class StreamClient {
  constructor(onMessage) {
    this.onMessage = onMessage;
    this.pollTimer = null;
    this.isConnecting = false;
  }

  async connect(projectId = '', projectRoot = '') {
    if (!tauriInvoke) return;
    
    this.stop();
    this.isConnecting = true;
    
    logger.info('Starting Native Stream', projectId);
    try {
      const headers = {};
      if (projectId) headers['x-project-id'] = projectId;
      if (projectRoot) headers['x-project-root'] = projectRoot;

      await tauriInvoke('ipc_stream_start', { projectId, headers });
      
      this.pollTimer = setInterval(() => this.poll(), 500);
    } catch (error) {
      logger.error('Native Stream Start Failed', error);
      this.isConnecting = false;
    }
  }

  async poll() {
    if (!tauriInvoke) return;
    try {
      const res = await tauriInvoke('ipc_stream_poll');
      
      if (res.error) {
        logger.warn('Native Stream Error', res.error);
        this.stop();
        return;
      }

      if (res.events && res.events.length > 0) {
        res.events.forEach(eventStr => {
          try {
            const data = JSON.parse(eventStr);
            if (this.onMessage) this.onMessage(data);
          } catch (error) {
            logger.error('Failed to parse stream event', eventStr, error);
          }
        });
      }
    } catch (error) {
      logger.error('Native Stream Poll Failed', error);
      this.stop();
    }
  }

  async stop() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (tauriInvoke) {
      try {
        await tauriInvoke('ipc_stream_stop');
      } catch (_error) {
      }
    }
    this.isConnecting = false;
  }
}
