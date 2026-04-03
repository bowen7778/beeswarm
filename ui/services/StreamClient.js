import { logger } from './logger.js';

/**
 * Nebula Stream Client (Browser-Native SSE Edition)
 * Uses standard EventSource to connect to the backend stream.
 */
export class StreamClient {
  constructor(onMessage) {
    this.onMessage = onMessage;
    this.eventSource = null;
    this.isConnecting = false;
  }

  async connect(projectId = '', projectRoot = '') {
    this.stop();
    this.isConnecting = true;
    
    logger.info('Starting SSE Stream', { projectId, projectRoot });
    
    // Construct stream URL with params
    const params = new URLSearchParams();
    if (projectId) params.append('projectId', projectId);
    if (projectRoot) params.append('projectRoot', projectRoot);
    
    const streamUrl = `/api/stream?${params.toString()}`;

    try {
      this.eventSource = new EventSource(streamUrl);

      this.eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (this.onMessage) this.onMessage(data);
        } catch (error) {
          logger.error('Failed to parse SSE event data', event.data, error);
        }
      };

      this.eventSource.onerror = (error) => {
        logger.error('SSE Stream Connection Error', error);
        // EventSource automatically retries, but we might want to log it
      };

      this.eventSource.onopen = () => {
        logger.info('SSE Stream Connection Established');
        this.isConnecting = false;
      };

    } catch (error) {
      logger.error('Failed to initialize SSE', error);
      this.isConnecting = false;
    }
  }

  async stop() {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this.isConnecting = false;
  }
}
