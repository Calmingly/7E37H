const STORAGE_KEY = 'recoveryTrackerV1';
const HOUR_MS = 3600000;

const ICON_SVG_ATTRS = 'viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"';

const ICONS = {
  capsule: `<svg ${ICON_SVG_ATTRS}><g transform="rotate(-45 12 12)"><rect x="4" y="8" width="16" height="8" rx="4"/><line x1="12" y1="8" x2="12" y2="16"/></g></svg>`,
  tablet: `<svg ${ICON_SVG_ATTRS}><circle cx="12" cy="12" r="8"/><line x1="4" y1="12" x2="20" y2="12"/></svg>`,
  glass: `<svg ${ICON_SVG_ATTRS}><path d="M6 4h12l-1.4 14.8a1 1 0 0 1-1 .9H8.4a1 1 0 0 1-1-.9L6 4Z"/><path d="M7.3 10.5c1 1 2.4 1 3.4 0s2.4-1 3.4 0 2.4 1 3.4 0"/></svg>`,
  bottle: `<svg ${ICON_SVG_ATTRS}><rect x="7" y="9" width="10" height="12" rx="2"/><path d="M9.5 9V6.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V9"/><line x1="9" y1="15" x2="15" y2="15"/></svg>`,
  flame: `<svg ${ICON_SVG_ATTRS}><path d="M12 3.5c.6 2.3-1 3.4-2.1 4.8-1.2 1.5-1.9 3-1.9 4.4a4 4 0 0 0 8 0c0-1-.3-1.8-.8-2.5.1 1.2-.5 1.8-1 1.5-.7-.4-.4-1.5-.4-2.2 0-2-1-4.2-1.8-6Z"/></svg>`,
};

const DEFAULT_ITEMS = [
  { id: 'ibuprofen', label: 'Ibuprofen', icon: ICONS.capsule, color: '#3b82f6', hasDose: true, doseMg: 600, intervalMinH: 6, intervalMaxH: 6, dailyMaxMg: 2400 },
  { id: 'tylenol', label: 'Tylenol (Acetaminophen)', icon: ICONS.tablet, color: '#8b5cf6', hasDose: true, doseMg: 1000, intervalMinH: 3, intervalMaxH: 4, dailyMaxMg: 3000 },
  { id: 'saltwater', label: 'Salt Water Rinse', icon: ICONS.glass, color: '#14b8a6', hasDose: false, intervalMinH: 4, intervalMaxH: 6 },
  { id: 'peridex', label: 'Peridex Rinse', icon: ICONS.bottle, color: '#06b6d4', hasDose: false, intervalMinH: 10, intervalMaxH: 14 },
  { id: 'warmcompress', label: 'Warm Compress', icon: ICONS.flame, color: '#f97316', hasDose: false, intervalMinH: 2, intervalMaxH: 2 },
];

const DEFAULT_SETTINGS = {
  theme: 'system',
  timeFormat: '12',
  leadMinutes: 0,
  hiddenItems: [],
};

function loadState() {
  const fallback = { overrides: {}, logs: [], notified: {}, notifiedEarly: {}, settings: { ...DEFAULT_SETTINGS } };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return {
      overrides: parsed.overrides || {},
      logs: parsed.logs || [],
      notified: parsed.notified || {},
      notifiedEarly: parsed.notifiedEarly || {},
      settings: { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) },
    };
  } catch {
    return fallback;
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

let state = loadState();

function getConfig(id) {
  const base = DEFAULT_ITEMS.find((i) => i.id === id);
  return { ...base, ...(state.overrides[id] || {}) };
}

function getLogs(id) {
  return state.logs
    .filter((l) => l.itemId === id)
    .sort((a, b) => b.ts - a.ts);
}

function lastLog(id) {
  return getLogs(id)[0] || null;
}

function total24h(id, now) {
  const cutoff = now - 24 * HOUR_MS;
  return state.logs
    .filter((l) => l.itemId === id && l.ts >= cutoff)
    .reduce((sum, l) => sum + (l.doseMg || 0), 0);
}

function computeStatus(id, now) {
  const cfg = getConfig(id);
  const last = lastLog(id);
  if (!last) {
    return { cfg, last: null, ready: true, neverLogged: true };
  }
  const nextEligibleTs = last.ts + cfg.intervalMinH * HOUR_MS;
  const nextUpperTs = last.ts + cfg.intervalMaxH * HOUR_MS;
  const ready = now >= nextEligibleTs;
  const intervalMs = Math.max(cfg.intervalMinH * HOUR_MS, 1);
  const elapsedFraction = Math.min(Math.max((now - last.ts) / intervalMs, 0), 1);
  return {
    cfg,
    last,
    ready,
    neverLogged: false,
    nextEligibleTs,
    nextUpperTs,
    elapsedFraction,
    sinceEligibleMs: ready ? now - nextEligibleTs : 0,
    remainingMs: ready ? 0 : nextEligibleTs - now,
  };
}

function fmtDuration(ms) {
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h <= 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
    hour12: state.settings.timeFormat !== '24',
  });
}

function fmtDateHeading(ts) {
  return new Date(ts).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
}

function applyTheme() {
  const theme = state.settings.theme;
  if (theme === 'system') {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = theme;
  }
}

function greeting(now) {
  const h = new Date(now).getHours();
  if (h < 5) return 'Good night';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  if (h < 21) return 'Good evening';
  return 'Good night';
}

const RING_RADIUS = 34;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function ringHtml(fraction, color, icon, showBadge) {
  const offset = RING_CIRCUMFERENCE * (1 - Math.min(Math.max(fraction, 0), 1));
  return `
    <div class="ring-wrap">
      <svg class="ring" viewBox="0 0 80 80">
        <circle class="ring-bg" cx="40" cy="40" r="${RING_RADIUS}"></circle>
        <circle class="ring-fg" cx="40" cy="40" r="${RING_RADIUS}" stroke="${color}"
          stroke-dasharray="${RING_CIRCUMFERENCE}" stroke-dashoffset="${offset}"></circle>
      </svg>
      <span class="ring-icon" style="color:${color}">${icon}</span>
      ${showBadge ? '<span class="ring-badge">✓</span>' : ''}
    </div>
  `;
}

function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function logDose(id, ts) {
  const cfg = getConfig(id);
  if (cfg.hasDose) {
    const prospective = total24h(id, ts) + cfg.doseMg;
    if (prospective > cfg.dailyMaxMg) {
      const ok = confirm(
        `Logging this would put you at ${prospective}mg of ${cfg.label} in the trailing 24 hours, ` +
        `above your ${cfg.dailyMaxMg}mg limit. Log anyway?`
      );
      if (!ok) return;
    }
  }
  state.logs.push({
    id: `${id}-${ts}-${Math.random().toString(36).slice(2, 8)}`,
    itemId: id,
    ts,
    doseMg: cfg.hasDose ? cfg.doseMg : undefined,
  });
  delete state.notified[id];
  saveState();
  render();
}

function deleteLog(logId) {
  state.logs = state.logs.filter((l) => l.id !== logId);
  saveState();
  render();
}

function saveOverride(id, fields) {
  state.overrides[id] = { ...(state.overrides[id] || {}), ...fields };
  saveState();
  render();
}

function exportBackup() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const dateStr = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `recovery-tracker-backup-${dateStr}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function importBackupFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let parsed;
    try {
      parsed = JSON.parse(reader.result);
    } catch {
      alert('That file is not valid JSON — could not import.');
      return;
    }
    if (!parsed || !Array.isArray(parsed.logs)) {
      alert('That file doesn\'t look like a Recovery Tracker backup.');
      return;
    }
    const ok = confirm('This will replace your current history and settings with the imported backup. Continue?');
    if (!ok) return;
    state = {
      overrides: parsed.overrides || {},
      logs: parsed.logs || [],
      notified: parsed.notified || {},
      notifiedEarly: parsed.notifiedEarly || {},
      settings: { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) },
    };
    saveState();
    applyTheme();
    populateSettingsDialog();
    render();
    alert('Backup imported.');
  };
  reader.readAsText(file);
}

function clearHistory() {
  const ok = confirm('Clear all logged history? Your item settings will be kept. This cannot be undone.');
  if (!ok) return;
  state.logs = [];
  state.notified = {};
  state.notifiedEarly = {};
  saveState();
  render();
}

function resetEverything() {
  const ok = confirm('Reset all history AND settings back to defaults? This cannot be undone.');
  if (!ok) return;
  state = { overrides: {}, logs: [], notified: {}, notifiedEarly: {}, settings: { ...DEFAULT_SETTINGS } };
  saveState();
  applyTheme();
  populateSettingsDialog();
  render();
}

function requestNotifPermission() {
  if (!('Notification' in window)) {
    alert('This browser does not support notifications.');
    return;
  }
  Notification.requestPermission().then(updateNotifButton);
}

function updateNotifButton() {
  const btn = document.getElementById('notif-btn');
  if (!('Notification' in window)) {
    btn.textContent = 'Notifications unsupported';
    btn.disabled = true;
    return;
  }
  if (Notification.permission === 'granted') {
    btn.textContent = 'Notifications on';
    btn.disabled = true;
  } else if (Notification.permission === 'denied') {
    btn.textContent = 'Notifications blocked';
    btn.disabled = true;
  } else {
    btn.textContent = 'Enable notifications';
    btn.disabled = false;
  }
}

function checkNotifications(now) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const leadMs = (state.settings.leadMinutes || 0) * 60000;
  for (const item of DEFAULT_ITEMS) {
    if (state.settings.hiddenItems.includes(item.id)) continue;
    const status = computeStatus(item.id, now);
    if (status.neverLogged) continue;

    if (leadMs > 0 && !status.ready) {
      const leadTs = status.nextEligibleTs - leadMs;
      if (now >= leadTs && state.notifiedEarly[item.id] !== status.last.ts) {
        new Notification(`${status.cfg.label} coming up`, {
          body: `Available at ${fmtTime(status.nextEligibleTs)}.`,
        });
        state.notifiedEarly[item.id] = status.last.ts;
        saveState();
      }
    }

    if (status.ready && state.notified[item.id] !== status.last.ts) {
      new Notification(`${status.cfg.label} is due`, {
        body: status.cfg.hasDose
          ? `Eligible for your next ${status.cfg.doseMg}mg dose.`
          : `Time for your next ${status.cfg.label.toLowerCase()}.`,
      });
      state.notified[item.id] = status.last.ts;
      saveState();
    }
  }
}

function itemCardHtml(item, now) {
  const status = computeStatus(item.id, now);
  const cfg = status.cfg;

  let statusClass = 'status-waiting';
  let bigText;
  let subText;
  let progressFraction = 0;
  if (status.neverLogged) {
    statusClass = 'status-ready';
    bigText = 'Ready';
    subText = 'Log anytime';
    progressFraction = 1;
  } else if (status.ready) {
    statusClass = 'status-ready';
    bigText = 'Ready';
    subText = status.sinceEligibleMs > 0
      ? `Since ${fmtTime(status.nextEligibleTs)} · ${fmtDuration(status.sinceEligibleMs)} ago`
      : 'Just became available';
    progressFraction = 1;
  } else {
    bigText = fmtDuration(status.remainingMs);
    subText = `until next · ${fmtTime(status.nextEligibleTs)}`;
    progressFraction = status.elapsedFraction;
  }

  let doseMeterHtml = '';
  if (cfg.hasDose) {
    const t24 = total24h(item.id, now);
    const pct = t24 / cfg.dailyMaxMg;
    let cls = 'meter-ok';
    if (pct >= 1) cls = 'meter-danger';
    else if (pct >= 0.7) cls = 'meter-warn';
    doseMeterHtml = `
      <div class="dose-meter">
        <div class="dose-meter-row">
          <span>${t24}mg</span>
          <span class="dose-meter-max">/ ${cfg.dailyMaxMg}mg today</span>
        </div>
        <div class="meter-track">
          <div class="meter-fill ${cls}" style="width:${Math.min(pct, 1) * 100}%"></div>
        </div>
      </div>
    `;
  }

  return `
    <div class="card" data-item="${item.id}" style="background: color-mix(in srgb, ${cfg.color} 8%, var(--card-bg))">
      <div class="card-main">
        ${ringHtml(progressFraction, cfg.color, cfg.icon, statusClass === 'status-ready')}
        <div class="card-info">
          <div class="card-label-row">
            <span class="card-label">${cfg.label}</span>
            ${cfg.hasDose ? `<span class="card-dose">${cfg.doseMg}mg</span>` : ''}
          </div>
          <div class="info-big ${statusClass}">${bigText}</div>
          <div class="info-sub">${subText}</div>
        </div>
      </div>

      ${doseMeterHtml}

      <div class="card-actions">
        <button class="btn btn-primary btn-log-now" data-item="${item.id}">Log now</button>
        <button class="btn-icon btn-toggle-custom" data-item="${item.id}" title="Log at another time" aria-label="Log at another time">🕐</button>
        <button class="btn-icon btn-toggle-edit" data-item="${item.id}" title="Edit settings" aria-label="Edit settings">✏️</button>
      </div>
      <div class="custom-time-row" data-item="${item.id}">
        <input type="datetime-local" class="custom-time-input" data-item="${item.id}" value="${localDatetimeValue(now)}">
        <button class="btn btn-small btn-log-custom" data-item="${item.id}">Log this time</button>
      </div>
      <div class="edit-row" data-item="${item.id}">
        ${cfg.hasDose ? `<label>Dose (mg)<input type="number" class="edit-dose" data-item="${item.id}" value="${cfg.doseMg}"></label>` : ''}
        <label>Min hrs<input type="number" step="0.5" class="edit-min" data-item="${item.id}" value="${cfg.intervalMinH}"></label>
        <label>Max hrs<input type="number" step="0.5" class="edit-max" data-item="${item.id}" value="${cfg.intervalMaxH}"></label>
        ${cfg.hasDose ? `<label>Daily max (mg)<input type="number" class="edit-daily-max" data-item="${item.id}" value="${cfg.dailyMaxMg}"></label>` : ''}
        <button class="btn btn-small btn-save-edit" data-item="${item.id}">Save</button>
      </div>
    </div>
  `;
}

function localDatetimeValue(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function renderSummary(now) {
  const container = document.getElementById('summary');
  const visible = DEFAULT_ITEMS.filter((item) => !state.settings.hiddenItems.includes(item.id));
  if (visible.length === 0) {
    container.innerHTML = '';
    return;
  }

  const statuses = visible.map((item) => computeStatus(item.id, now));
  const readyCount = statuses.filter((s) => s.neverLogged || s.ready).length;

  const upcoming = visible
    .map((item, i) => ({ item, status: statuses[i] }))
    .filter(({ status }) => !status.neverLogged && !status.ready)
    .sort((a, b) => a.status.remainingMs - b.status.remainingMs)[0];

  const nextHtml = upcoming
    ? `
      <div class="summary-next-label">Next up</div>
      <div class="summary-next-value">${getConfig(upcoming.item.id).label} · ${fmtDuration(upcoming.status.remainingMs)}</div>
    `
    : `
      <div class="summary-next-label">&nbsp;</div>
      <div class="summary-next-value summary-all-ready">Everything's ready ✓</div>
    `;

  container.innerHTML = `
    <div class="summary-stat">
      <div class="summary-number">${readyCount}<span class="summary-of">/${visible.length}</span></div>
      <div class="summary-label">ready now</div>
    </div>
    <div class="summary-divider"></div>
    <div class="summary-next">${nextHtml}</div>
  `;
}

function renderItems(now) {
  const container = document.getElementById('items');
  const visible = DEFAULT_ITEMS.filter((item) => !state.settings.hiddenItems.includes(item.id));
  container.innerHTML = visible.length
    ? visible.map((item) => itemCardHtml(item, now)).join('')
    : '<p class="empty-note">All items are hidden — enable some in Settings.</p>';
}

function renderHistory() {
  const container = document.getElementById('history');
  if (state.logs.length === 0) {
    container.innerHTML = '<p class="empty-note">Nothing logged yet.</p>';
    return;
  }
  const groups = {};
  for (const log of state.logs) {
    const key = dayKey(log.ts);
    if (!groups[key]) groups[key] = [];
    groups[key].push(log);
  }
  const sortedKeys = Object.keys(groups).sort((a, b) => {
    const ta = Math.max(...groups[a].map((l) => l.ts));
    const tb = Math.max(...groups[b].map((l) => l.ts));
    return tb - ta;
  });

  container.innerHTML = sortedKeys
    .map((key, idx) => {
      const entries = groups[key].sort((a, b) => b.ts - a.ts);
      const rows = entries
        .map((log) => {
          const cfg = getConfig(log.itemId);
          const doseText = log.doseMg ? ` — ${log.doseMg}mg` : '';
          return `
            <div class="log-entry">
              <span>${fmtTime(log.ts)} — ${cfg.label}${doseText}</span>
              <button class="log-entry-remove" data-log-id="${log.id}">remove</button>
            </div>
          `;
        })
        .join('');
      return `
        <details class="day-group" ${idx === 0 ? 'open' : ''}>
          <summary>${fmtDateHeading(entries[0].ts)}</summary>
          ${rows}
        </details>
      `;
    })
    .join('');
}

function buildSummaryText() {
  if (state.logs.length === 0) return 'No entries logged yet.';
  const sorted = [...state.logs].sort((a, b) => a.ts - b.ts);
  const groups = {};
  for (const log of sorted) {
    const key = dayKey(log.ts);
    if (!groups[key]) groups[key] = [];
    groups[key].push(log);
  }
  return Object.values(groups)
    .map((entries) => {
      const heading = fmtDateHeading(entries[0].ts);
      const lines = entries.map((log) => {
        const cfg = getConfig(log.itemId);
        const doseText = log.doseMg ? ` - ${log.doseMg}mg` : '';
        return `  ${fmtTime(log.ts)} - ${cfg.label}${doseText}`;
      });
      return `${heading}\n${lines.join('\n')}`;
    })
    .join('\n\n');
}

function copySummary() {
  const text = buildSummaryText();
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(
      () => alert('Summary copied to clipboard.'),
      () => fallbackCopy(text)
    );
  } else {
    fallbackCopy(text);
  }
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    alert('Summary copied to clipboard.');
  } catch {
    alert('Could not copy automatically. Here is the summary:\n\n' + text);
  }
  document.body.removeChild(ta);
}

function updateHeader(now) {
  document.getElementById('greeting').textContent = greeting(now);
  document.getElementById('date-line').textContent = new Date(now).toLocaleString([], {
    weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    hour12: state.settings.timeFormat !== '24',
  });
}

function populateSettingsDialog() {
  document.getElementById('setting-theme').value = state.settings.theme;
  document.getElementById('setting-time-format').value = state.settings.timeFormat;
  document.getElementById('setting-lead-minutes').value = String(state.settings.leadMinutes);

  const list = document.getElementById('visibility-list');
  list.innerHTML = DEFAULT_ITEMS.map((item) => `
    <label class="visibility-row">
      <input type="checkbox" class="visibility-checkbox" data-item="${item.id}"
        ${state.settings.hiddenItems.includes(item.id) ? '' : 'checked'}>
      <span class="card-dot" style="background:${item.color}"></span>
      ${item.label}
    </label>
  `).join('');
}

function render() {
  const now = Date.now();
  try { updateHeader(now); } catch (e) { console.error('Header render failed:', e); }
  try { renderSummary(now); } catch (e) { console.error('Summary render failed:', e); }
  try { renderItems(now); } catch (e) { console.error('Items render failed:', e); }
  try { renderHistory(); } catch (e) { console.error('History render failed:', e); }
  try { checkNotifications(now); } catch (e) { console.error('Notification check failed:', e); }
}

function setup() {
  applyTheme();
  updateNotifButton();
  document.getElementById('notif-btn').addEventListener('click', requestNotifPermission);
  document.getElementById('copy-summary-btn').addEventListener('click', copySummary);

  const settingsDialog = document.getElementById('settings-dialog');
  document.getElementById('settings-btn').addEventListener('click', () => {
    populateSettingsDialog();
    settingsDialog.showModal();
  });
  document.getElementById('settings-close-btn').addEventListener('click', () => {
    settingsDialog.close();
  });
  settingsDialog.addEventListener('click', (e) => {
    if (e.target === settingsDialog) settingsDialog.close();
  });

  document.getElementById('setting-theme').addEventListener('change', (e) => {
    state.settings.theme = e.target.value;
    saveState();
    applyTheme();
  });
  document.getElementById('setting-time-format').addEventListener('change', (e) => {
    state.settings.timeFormat = e.target.value;
    saveState();
    render();
  });
  document.getElementById('setting-lead-minutes').addEventListener('change', (e) => {
    state.settings.leadMinutes = Number(e.target.value);
    saveState();
  });
  document.getElementById('visibility-list').addEventListener('change', (e) => {
    if (!e.target.classList.contains('visibility-checkbox')) return;
    const id = e.target.dataset.item;
    const hidden = new Set(state.settings.hiddenItems);
    if (e.target.checked) hidden.delete(id);
    else hidden.add(id);
    state.settings.hiddenItems = [...hidden];
    saveState();
    render();
  });

  document.getElementById('export-btn').addEventListener('click', exportBackup);
  document.getElementById('import-btn').addEventListener('click', () => {
    document.getElementById('import-file').click();
  });
  document.getElementById('import-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) importBackupFile(file);
    e.target.value = '';
  });
  document.getElementById('clear-history-btn').addEventListener('click', clearHistory);
  document.getElementById('reset-all-btn').addEventListener('click', resetEverything);

  document.getElementById('items').addEventListener('click', (e) => {
    const target = e.target;
    const id = target.dataset.item;

    if (target.classList.contains('btn-log-now')) {
      logDose(id, Date.now());
    } else if (target.classList.contains('btn-toggle-custom')) {
      document.querySelector(`.custom-time-row[data-item="${id}"]`).classList.toggle('open');
    } else if (target.classList.contains('btn-toggle-edit')) {
      document.querySelector(`.edit-row[data-item="${id}"]`).classList.toggle('open');
    } else if (target.classList.contains('btn-log-custom')) {
      const input = document.querySelector(`.custom-time-input[data-item="${id}"]`);
      const ts = new Date(input.value).getTime();
      if (!isNaN(ts)) logDose(id, ts);
    } else if (target.classList.contains('btn-save-edit')) {
      const row = document.querySelector(`.edit-row[data-item="${id}"]`);
      const fields = {};
      const doseEl = row.querySelector('.edit-dose');
      const minEl = row.querySelector('.edit-min');
      const maxEl = row.querySelector('.edit-max');
      const dailyMaxEl = row.querySelector('.edit-daily-max');
      if (doseEl) fields.doseMg = Number(doseEl.value);
      if (minEl) fields.intervalMinH = Number(minEl.value);
      if (maxEl) fields.intervalMaxH = Number(maxEl.value);
      if (dailyMaxEl) fields.dailyMaxMg = Number(dailyMaxEl.value);
      saveOverride(id, fields);
    }
  });

  document.getElementById('history').addEventListener('click', (e) => {
    if (e.target.classList.contains('log-entry-remove')) {
      deleteLog(e.target.dataset.logId);
    }
  });

  const header = document.querySelector('.app-header');
  window.addEventListener('scroll', () => {
    header.classList.toggle('scrolled', window.scrollY > 4);
  });

  render();
  setInterval(render, 15000);
}

document.addEventListener('DOMContentLoaded', setup);
