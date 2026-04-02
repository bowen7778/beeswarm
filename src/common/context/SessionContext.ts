import { AsyncLocalStorage } from "node:async_hooks";

export type SessionContextPayload = {
  sessionId?: string;
  projectRoot?: string;
};

const storage = new AsyncLocalStorage<SessionContextPayload>();

export const SessionContext = {
  run<T>(payload: SessionContextPayload, fn: () => T): T {
    return storage.run(payload, fn);
  },

  current(): SessionContextPayload {
    return storage.getStore() || {};
  },

  get projectRoot(): string {
    return (storage.getStore() || {}).projectRoot || "";
  },

  get sessionId(): string {
    return (storage.getStore() || {}).sessionId || "";
  }
};

