import { sessionClient } from './sessionClient.js';
import { imClient } from './imClient.js';
import { systemClient } from './systemClient.js';

const tauriBridgeAvailable = !!(typeof window !== 'undefined'
  && window.__TAURI_INTERNALS__
  && typeof window.__TAURI_INTERNALS__.invoke === 'function');

export const apiClient = {
  transport: tauriBridgeAvailable ? 'tauri-ipc' : 'offline',
  ...sessionClient,
  ...imClient,
  ...systemClient
};
