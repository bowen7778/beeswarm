import { sessionClient } from './sessionClient.js';
import { imClient } from './imClient.js';
import { systemClient } from './systemClient.js';

export const apiClient = {
  transport: 'http-fetch',
  ...sessionClient,
  ...imClient,
  ...systemClient
};
