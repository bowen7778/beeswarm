export class MessageListRenderer {
  render(input) {
    const { messages, icons, t, escapeHtml, escapeAttribute, chatActions } = input;

    return messages.map((message) => {
      let contentHtml = '';
      if (message.role === 'ai' && message.text && message.text.startsWith('[') && message.text.includes('"type"') && message.text.includes('"label"')) {
        try {
          const questions = JSON.parse(message.text);
          if (Array.isArray(questions)) {
            contentHtml = `
              <div class="interactive-card">
                <div class="card-header">
                  <span class="card-icon">${icons.HELP}</span>
                  <span class="card-title">${t('hub.question_title') || 'Structured Question'}</span>
                </div>
                <div class="card-body">
                  ${questions.map((question) => `
                    <div class="question-item" data-id="${escapeAttribute(question.id)}">
                      <label class="question-label">${escapeHtml(question.label)}</label>
                      ${this.renderQuestionInput({ question, t, escapeHtml, escapeAttribute, chatActions })}
                    </div>
                  `).join('')}
                </div>
                <div class="card-footer">
                  <button class="btn-primary card-submit" data-action="${chatActions.SUBMIT_CARD}" data-message-id="${escapeAttribute(message.id)}">${t('common.submit') || 'Submit'}</button>
                </div>
              </div>
            `;
          }
        } catch {
          contentHtml = `<div class="message-bubble">${escapeHtml(message.text)}</div>`;
        }
      } else if (message.role === 'user' && message.text && message.text.startsWith('{') && message.text.includes('"answers"')) {
        try {
          const payload = JSON.parse(message.text);
          if (payload.answers && Array.isArray(payload.answers)) {
            contentHtml = `
              <div class="message-bubble answer-bubble">
                <div class="answer-header">
                  <span class="answer-icon">${icons.LINK}</span>
                  <span>${t('common.answer_submitted') || 'Answer Submitted'}</span>
                </div>
                <div class="answer-items">
                  ${payload.answers.map((answerItem) => `
                    <div class="answer-item">
                      <span class="answer-label">${escapeHtml(answerItem.id)}:</span>
                      <span class="answer-value">${escapeHtml(answerItem.answer)}</span>
                    </div>
                  `).join('')}
                </div>
              </div>
            `;
          }
        } catch {
          contentHtml = `<div class="message-bubble">${escapeHtml(message.text)}</div>`;
        }
      } else {
        contentHtml = `<div class="message-bubble">${escapeHtml(message.text || '')}</div>`;
      }

      return `
        <div class="message ${message.role}" data-message-id="${escapeAttribute(message.id || '')}">
          ${contentHtml}
        </div>
      `;
    }).join('');
  }

  renderQuestionInput(input) {
    const { question, t, escapeHtml, escapeAttribute, chatActions } = input;
    if (question.type === 'select') {
      return `
        <div class="question-options-grid">
          ${(question.options || []).map((option) => `
            <button class="option-btn" data-action="${chatActions.SELECT_OPTION}" data-value="${escapeAttribute(option)}">${escapeHtml(option)}</button>
          `).join('')}
        </div>
        <div class="question-custom-input-wrapper">
          <span class="custom-label">${t('common.other') || 'Other / Custom'}:</span>
          <input type="text" class="question-input custom-text" placeholder="...">
        </div>
      `;
    }
    if (question.type === 'confirm') {
      return `
        <div class="question-options-grid mini">
          <button class="option-btn" data-action="${chatActions.SELECT_OPTION}" data-value="yes">${t('common.yes') || 'Yes'}</button>
          <button class="option-btn" data-action="${chatActions.SELECT_OPTION}" data-value="no">${t('common.no') || 'No'}</button>
        </div>
      `;
    }
    return '<input type="text" class="question-input main-text" placeholder="...">';
  }
}
