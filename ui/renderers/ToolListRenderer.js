export class ToolListRenderer {
  render(input) {
    const { tools, escapeHtml } = input;
    if (!tools.length) {
      return '<div class="card-secondary-info" style="padding: 10px;">No tools available.</div>';
    }

    return tools.map((tool) => `
      <div class="tool-item">
        <div class="tool-name">${escapeHtml(String(tool.name || ''))}</div>
        <div class="tool-desc">${escapeHtml(String(tool.description || 'No description provided.'))}</div>
      </div>
    `).join('');
  }
}
