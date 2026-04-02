import { apiClient } from '../services/api/ApiClient.js';
import { i18n } from '../services/i18n.js';
import { logger } from '../services/logger.js';
import { Icons } from '../utils/Icons.js';
import { CHAT_ACTIONS, DOM_IDS } from './NebulaDom.js';

export class NebulaDialogController {
  constructor(app) {
    this.app = app;
  }

  requireElement(id) {
    return this.app.requireElement(id);
  }

  async showDialog(options = {}) {
    const {
      title = 'Notification',
      message = '',
      type = 'alert',
      defaultValue = '',
      confirmText = i18n.t('common.confirm'),
      cancelText = i18n.t('common.cancel'),
      isDanger = false
    } = options;

    const overlay = this.requireElement(DOM_IDS.DIALOG_OVERLAY);
    const titleEl = this.requireElement(DOM_IDS.DIALOG_TITLE);
    const msgEl = this.requireElement(DOM_IDS.DIALOG_MSG);
    const inputEl = this.requireElement(DOM_IDS.DIALOG_INPUT);
    const cancelBtn = this.requireElement(DOM_IDS.DIALOG_CANCEL_BTN);
    const confirmBtn = this.requireElement(DOM_IDS.DIALOG_CONFIRM_BTN);

    return new Promise((resolve) => {
      titleEl.innerText = title;
      msgEl.innerText = message;
      confirmBtn.innerText = confirmText;
      cancelBtn.innerText = cancelText;
      confirmBtn.className = 'nebula-dialog-btn confirm';
      if (isDanger) confirmBtn.classList.add('danger');
      inputEl.classList.toggle('hidden', type !== 'prompt');
      cancelBtn.classList.toggle('hidden', type === 'alert');

      if (type === 'prompt') {
        inputEl.value = defaultValue;
        this.app.renderController.safeInjectIcon(DOM_IDS.DIALOG_HEADER_ICON, Icons.BOX);
      } else if (isDanger) {
        this.app.renderController.safeInjectIcon(DOM_IDS.DIALOG_HEADER_ICON, Icons.TRASH);
      } else {
        this.app.renderController.safeInjectIcon(DOM_IDS.DIALOG_HEADER_ICON, Icons.ACTIVITY);
      }

      overlay.classList.remove('hidden');
      if (type === 'prompt') inputEl.focus();

      const cleanup = (result) => {
        overlay.classList.add('hidden');
        confirmBtn.onclick = null;
        cancelBtn.onclick = null;
        overlay.onclick = null;
        inputEl.onkeydown = null;
        resolve(result);
      };

      confirmBtn.onclick = () => cleanup(type === 'prompt' ? inputEl.value : true);
      cancelBtn.onclick = () => cleanup(type === 'prompt' ? null : false);
      overlay.onclick = (e) => {
        if (e.target === overlay && type !== 'prompt') cleanup(type === 'alert' ? true : false);
      };
      inputEl.onkeydown = (e) => {
        if (e.key === 'Enter') confirmBtn.click();
        if (e.key === 'Escape') cancelBtn.click();
      };
    });
  }

  async showAlert(title, message) {
    return this.showDialog({ title, message, type: 'alert' });
  }

  async showConfirm(title, message, isDanger = false) {
    return this.showDialog({ title, message, type: 'confirm', isDanger });
  }

  async showPrompt(title, message, defaultValue = '') {
    return this.showDialog({ title, message, type: 'prompt', defaultValue });
  }

  handleInteractiveChatClick(event) {
    const actionTarget = event.target.closest('[data-action]');
    if (!actionTarget || !this.app.chatBox.contains(actionTarget)) {
      return;
    }

    const action = actionTarget.dataset.action;
    if (action === CHAT_ACTIONS.SELECT_OPTION) {
      event.preventDefault();
      this.app.renderController.activateOption(actionTarget);
      return;
    }

    if (action === CHAT_ACTIONS.SUBMIT_CARD) {
      event.preventDefault();
      this.handleCardSubmit(actionTarget.dataset.messageId || '');
    }
  }

  async handleCardSubmit(messageId) {
    const escapedId = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
      ? CSS.escape(String(messageId || ''))
      : String(messageId || '');
    const targetMessage = this.app.chatBox.querySelector(`[data-message-id="${escapedId}"]`);
    let targetCard = targetMessage?.querySelector('.interactive-card') || null;
    if (!targetCard) targetCard = this.app.chatBox.querySelector('.interactive-card');
    if (!targetCard) return;

    const answers = [];
    targetCard.querySelectorAll('.question-item').forEach((item) => {
      const id = item.dataset.id;
      let answer = '';
      const activeBtn = item.querySelector('.option-btn.active');
      const customInput = item.querySelector('.custom-text');
      const mainInput = item.querySelector('.main-text');
      if (customInput && customInput.value.trim()) {
        answer = customInput.value.trim();
      } else if (activeBtn) {
        answer = activeBtn.dataset.value;
      } else if (mainInput) {
        answer = mainInput.value.trim();
      }
      answers.push({ id, answer });
    });

    try {
      this.app.emitMonitor('info', 'Submitting card response...', { domain: 'chat', action: 'card-submit' });
      const activeSession = this.app.sessionController.getActiveSession();
      await apiClient.sendMessage({
        projectId: this.app.state.session.activeId,
        projectRoot: activeSession?.workspacePath,
        text: JSON.stringify({ answers })
      });
      const btn = targetCard.querySelector('.card-submit');
      if (btn) {
        btn.disabled = true;
        btn.innerText = 'Submitted';
      }
      targetCard.querySelectorAll('input, button:not(.card-submit)').forEach((el) => {
        el.disabled = true;
      });
    } catch (err) {
      logger.error('Card Submit Error', err);
    }
  }
}
