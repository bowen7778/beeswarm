import zhCN from '../i18n/zh-CN.js';
import enUS from '../i18n/en-US.js';

const resources = {
  'zh-CN': zhCN,
  'en-US': enUS
};

function getStorage() {
  return typeof localStorage === 'undefined' ? null : localStorage;
}

class I18nService {
  constructor() {
    this.locale = getStorage()?.getItem('nebula-locale') || 'zh-CN';
    this.subscribers = new Set();
  }

  setLocale(locale) {
    if (!resources[locale]) return;
    this.locale = locale;
    getStorage()?.setItem('nebula-locale', locale);
    this.notify();
  }

  getLocale() {
    return this.locale;
  }

  t(key) {
    return resources[this.locale][key] || key;
  }

  subscribe(callback) {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  notify() {
    this.subscribers.forEach(cb => cb(this.locale));
  }
}

export const i18n = new I18nService();
