import { logger } from '../logger.js';

/**
 * Standard API request handler for BeeSwarm.
 * Now uses direct fetch for browser-based UI.
 */
export async function apiFetch(path, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const headers = { 
    'Content-Type': 'application/json',
    ...(options.headers || {}) 
  };

  if (options.projectId) {
    headers['x-project-id'] = String(options.projectId);
  }
  if (options.projectRoot) {
    headers['x-project-root'] = String(options.projectRoot);
  }
  if (options.harnessToken) {
    headers['x-harness-token'] = String(options.harnessToken);
  }

  const fetchOptions = {
    method,
    headers
  };

  if (options.body && method !== 'GET' && method !== 'HEAD') {
    fetchOptions.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
  }

  // Determine base URL: in dev it might be localhost:3000, in prod it's the current origin
  const baseUrl = ''; // Relative path works fine since we host UI on the same port
  const fullUrl = `${baseUrl}${path.startsWith('/') ? path : '/' + path}`;

  logger.debug('API Request', { method, url: fullUrl, projectId: options.projectId || '', projectRoot: options.projectRoot || '' });

  try {
    const response = await fetch(fullUrl, fetchOptions);
    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch (e) {
      data = { raw: text };
    }

    return {
      status: response.status,
      ok: response.ok,
      body: text,
      json: () => data
    };
  } catch (error) {
    logger.error('API Fetch Error', error);
    return {
      status: 500,
      ok: false,
      body: JSON.stringify({ success: false, error: 'FETCH_FAILED', message: String(error) }),
      json: () => ({ success: false, error: 'FETCH_FAILED', message: String(error) })
    };
  }
}
