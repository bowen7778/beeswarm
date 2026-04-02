import { logger } from '../logger.js';

function getTauriInvoke() {
  const hostWindow = typeof window === 'undefined' ? null : window;
  return hostWindow?.__TAURI_INTERNALS__ && typeof hostWindow.__TAURI_INTERNALS__.invoke === 'function'
    ? hostWindow.__TAURI_INTERNALS__.invoke
    : null;
}

export async function invokeDesktopCommand(command, payload = {}) {
  const tauriInvoke = getTauriInvoke();
  if (!tauriInvoke) {
    throw new Error('IPC_OFFLINE');
  }
  return tauriInvoke(command, payload);
}

function createResponse(status, payload) {
  const body = JSON.stringify(payload);
  return {
    status,
    body,
    json: () => payload
  };
}

export async function apiFetch(path, options = {}) {
  const tauriInvoke = getTauriInvoke();
  if (!tauriInvoke) {
    return createResponse(503, { success: false, error: 'IPC_OFFLINE' });
  }

  const method = String(options.method || 'GET').toUpperCase();
  const body = options.body ? (typeof options.body === 'string' ? options.body : JSON.stringify(options.body)) : null;
  const headers = { ...(options.headers || {}) };

  if (options.projectId) {
    headers['x-project-id'] = String(options.projectId);
  }
  if (options.projectRoot) {
    headers['x-project-root'] = String(options.projectRoot);
  }
  if (options.harnessToken) {
    headers['x-harness-token'] = String(options.harnessToken);
  }

  logger.debug('IPC Request', { method, path, projectId: options.projectId || '', projectRoot: options.projectRoot || '' });

  try {
    const ret = await tauriInvoke('ipc_http', { path, method, body, headers });
    return {
      status: ret.status,
      body: ret.body,
      json: () => JSON.parse(ret.body)
    };
  } catch (error) {
    logger.error('IPC Invocation Error', error);
    return createResponse(500, {
      success: false,
      error: 'IPC_INVOKE_FAILED',
      message: String(error)
    });
  }
}
