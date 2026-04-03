export class SystemVersionRenderer {
  render(input) {
    const { versionInfo, t, escapeHtml } = input;
    if (!versionInfo) {
      const emptySlots = `<div class="system-slot-item"><div class="system-slot-main"><div class="system-slot-value">${escapeHtml(t('modal.system.empty_slots'))}</div></div></div>`;
      return {
        summaryHtml: '',
        updateHtml: '',
        protocolsHtml: '',
        schemasHtml: '',
        slotsHtml: emptySlots,
        manifestJson: '{}'
      };
    }

    const currentVersion = String(versionInfo.current?.version || versionInfo.manifest?.version || '--');
    const latestVersion = String(versionInfo.latest?.version || currentVersion);
    const nodeVersion = String(versionInfo.manifest?.runtime?.node || '--');
    const available = Array.isArray(versionInfo.available) ? versionInfo.available : [];
    const currentReleaseDate = String(versionInfo.current?.releaseDate || versionInfo.manifest?.releaseDate || '--');
    const latestReleaseDate = String(versionInfo.latest?.releaseDate || currentReleaseDate || '--');
    const updateStatus = versionInfo.update || null;

    const summaryHtml = [
      { label: t('modal.system.current'), value: `v${currentVersion}`, meta: currentReleaseDate },
      { label: t('modal.system.latest'), value: `v${latestVersion}`, meta: latestReleaseDate },
      { label: t('modal.system.runtime'), value: nodeVersion, meta: 'Node.js' },
      { label: t('modal.system.slot_count'), value: String(available.length), meta: t('modal.system.slots') }
    ].map((item) => `
      <div class="system-version-card">
        <div class="system-version-label">${escapeHtml(item.label)}</div>
        <div class="system-version-value">${escapeHtml(item.value)}</div>
        <div class="system-version-meta">${escapeHtml(item.meta || '--')}</div>
      </div>
    `).join('');

    const updateStateLabel = updateStatus?.checking
      ? t('modal.system.update_downloading')
      : updateStatus?.error
        ? t('modal.system.update_failed')
        : updateStatus?.available
          ? t('modal.system.update_pending')
          : t('modal.system.update_ok');
    const remoteVersion = updateStatus?.remote?.version ? `v${updateStatus.remote.version}` : t('modal.system.update_none');
    const preparedVersion = updateStatus?.preparedVersion ? `v${updateStatus.preparedVersion}` : '--';
    const checkedAt = updateStatus?.checkedAt || '--';
    const errorText = updateStatus?.error || updateStateLabel;

    const updateHtml = [
      { label: t('modal.system.update_available'), value: remoteVersion },
      { label: t('modal.system.update_prepared'), value: preparedVersion },
      { label: t('modal.system.update_checked_at'), value: checkedAt },
      { label: t('modal.system.update_error'), value: errorText }
    ].map((item) => `
      <div class="system-kv-item">
        <div class="system-kv-label">${escapeHtml(item.label)}</div>
        <div class="system-kv-value">${escapeHtml(String(item.value || '--'))}</div>
      </div>
    `).join('');

    const protocolsHtml = Object.entries(versionInfo.manifest?.protocols || {}).map(([key, value]) => `
      <div class="system-kv-item">
        <div class="system-kv-label">${escapeHtml(key)}</div>
        <div class="system-kv-value">${escapeHtml(String(value))}</div>
      </div>
    `).join('');

    const schemasHtml = Object.entries(versionInfo.manifest?.schemas || {}).map(([key, value]) => `
      <div class="system-kv-item">
        <div class="system-kv-label">${escapeHtml(key)}</div>
        <div class="system-kv-value">${escapeHtml(String(value))}</div>
      </div>
    `).join('');

    const slotsHtml = !available.length
      ? `<div class="system-slot-item"><div class="system-slot-main"><div class="system-slot-value">${escapeHtml(t('modal.system.empty_slots'))}</div></div></div>`
      : available.map((item) => {
          const version = String(item.version || '--');
          const releaseDate = String(item.releaseDate || '--');
          const badgeText = item.isBuiltin ? t('modal.system.builtin') : t('modal.system.shadow');
          const badgeClass = item.isBuiltin ? 'system-slot-badge' : 'system-slot-badge is-shadow';
          return `
            <div class="system-slot-item">
              <div class="system-slot-main">
                <div class="system-slot-label">${escapeHtml(item.manifest?.name || 'app-kernel')}</div>
                <div class="system-slot-value">v${escapeHtml(version)}</div>
                <div class="system-slot-meta">${escapeHtml(releaseDate)}</div>
              </div>
              <div class="${badgeClass}">${escapeHtml(badgeText)}</div>
            </div>
          `;
        }).join('');

    return {
      summaryHtml,
      updateHtml,
      protocolsHtml,
      schemasHtml,
      slotsHtml,
      manifestJson: JSON.stringify(versionInfo.manifest || {}, null, 2)
    };
  }
}
