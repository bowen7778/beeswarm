function cloneBranch(value) {
  if (Array.isArray(value)) {
    return value.slice();
  }
  if (value && typeof value === 'object') {
    return { ...value };
  }
  return value;
}

export class NebulaStateStore {
  constructor(initialState) {
    this.state = {
      session: cloneBranch(initialState.session),
      runtime: cloneBranch(initialState.runtime),
      ui: cloneBranch(initialState.ui)
    };
    this.subscribers = new Set();
  }

  getState() {
    return this.state;
  }

  subscribe(listener) {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  notify(channel, payload) {
    const snapshot = this.getState();
    for (const listener of this.subscribers) {
      listener({ channel, payload, state: snapshot });
    }
  }

  setSessionState(patch, reason = 'session:update') {
    this.state.session = {
      ...this.state.session,
      ...patch
    };
    this.notify(reason, this.state.session);
  }

  setRuntimeState(patch, reason = 'runtime:update') {
    this.state.runtime = {
      ...this.state.runtime,
      ...patch
    };
    this.notify(reason, this.state.runtime);
  }

  setUiState(patch, reason = 'ui:update') {
    this.state.ui = {
      ...this.state.ui,
      ...patch
    };
    this.notify(reason, this.state.ui);
  }
}
