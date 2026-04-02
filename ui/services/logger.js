const LEVELS = Object.freeze({
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
});

class LoggerService {
  getThreshold() {
    const override = typeof localStorage !== 'undefined' ? localStorage.getItem('nebula-log-level') : '';
    const normalized = String(override || '').trim().toLowerCase();
    if (normalized && LEVELS[normalized]) {
      return LEVELS[normalized];
    }
    return LEVELS.info;
  }

  shouldLog(level) {
    return LEVELS[level] >= this.getThreshold();
  }

  write(level, args) {
    if (!this.shouldLog(level) || typeof console === 'undefined') {
      return;
    }
    const method = level === 'debug' ? 'debug' : level === 'info' ? 'info' : level === 'warn' ? 'warn' : 'error';
    console[method]('[Nebula]', ...args);
  }

  debug(...args) {
    this.write('debug', args);
  }

  info(...args) {
    this.write('info', args);
  }

  warn(...args) {
    this.write('warn', args);
  }

  error(...args) {
    this.write('error', args);
  }

  event(payload) {
    const { level = 'info', domain = 'ui', action = 'event', ...meta } = payload || {};
    this.write(level, [{
      domain,
      action,
      ...meta
    }]);
  }
}

export const logger = new LoggerService();
