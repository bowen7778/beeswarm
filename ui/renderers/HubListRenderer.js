export class HubListRenderer {
  render(input) {
    const { isStreamConnected, sessions, activeId, icons, t, escapeHtml, actions } = input;

    if (!isStreamConnected) {
      return `
        <div class="hub-initializing">
          <div class="spinner"></div>
          <span>${t('hub.initializing')}</span>
        </div>
      `;
    }

    if (!sessions || sessions.length === 0) {
      return `
        <div class="hub-empty-state">
          <div class="empty-icon">${icons.FOLDER}</div>
          <div class="empty-title">${t('hub.empty.title')}</div>
          <div class="empty-desc">${t('hub.empty.desc')}</div>
        </div>
      `;
    }

    return sessions.map((session) => `
      <div class="context-item ${session.projectId === activeId ? 'active' : ''}" data-action="${actions.SELECT_SESSION}" data-session-id="${escapeHtml(session.projectId)}">
        <div class="context-item-icon">${icons.BOX}</div>
        <div class="context-item-info">
          <div class="context-item-title">${escapeHtml(session.title || session.name || String(session.projectId || '').slice(0, 8))}</div>
          <div class="context-item-meta">${session.connected ? '<span class="status-online">●</span> ' : ''}${escapeHtml(session.lastMessage || '')}</div>
        </div>
        <div class="context-item-actions">
          <button class="btn-delete" title="Delete" data-action="${actions.DELETE_SESSION}" data-session-id="${escapeHtml(session.projectId)}">${icons.TRASH}</button>
        </div>
      </div>
    `).join('');
  }
}
