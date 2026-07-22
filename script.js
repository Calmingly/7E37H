const STORAGE_KEY = 'recoveryTrackerV1';
const HOUR_MS = 3600000;

const DEFAULT_ITEMS = [
  { id: 'ibuprofen', label: 'Ibuprofen', icon: '💊', color: '#3b82f6', hasDose: true, doseMg: 600, intervalMinH: 6, intervalMaxH: 6, dailyMaxMg: 2400 },
  { id: 'tylenol', label: 'Tylenol (Acetaminophen)', icon: '💊', color: '#8b5cf6', hasDose: true, doseMg: 1000, intervalMinH: 3, intervalMaxH: 4, dailyMaxMg: 3000 },
  { id: 'saltwater', label: 'Salt Water Rinse', icon: '🧂', color: '#14b8a6', hasDose: false, intervalMinH: 4, intervalMaxH: 6 },
  { id: 'peridex', label: 'Peridex Rinse', icon: '🧴', color: '#06b6d4', hasDose: false, intervalMinH: 10, intervalMaxH: 14 },
  { id: 'warmcompress', label: 'Warm Compress', icon: '🔥', color: '#f97316', hasDose: false, intervalMinH: 2, intervalMaxH: 2 },
];

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { overrides: {}, logs: [], notified: {} };
    const parsed = JSON.parse(raw);
    return {
      overrides: parsed.overrides || {},
      logs: parsed.logs || [],
      notified: parsed.notified || {},
    };
  } catch {
    return { overrides: {}, logs: [], notified: {} };
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
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function fmtDateHeading(ts) {
  return new Date(ts).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
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
  for (const item of DEFAULT_ITEMS) {
    const status = computeStatus(item.id, now);
    if (status.neverLogged) continue;
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
  let statusText;
  let progressFraction = 0;
  if (status.neverLogged) {
    statusClass = 'status-ready';
    statusText = 'Available anytime';
    progressFraction = 1;
  } else if (status.ready) {
    statusClass = 'status-ready';
    statusText = status.sinceEligibleMs > 0
      ? `Since ${fmtTime(status.nextEligibleTs)} (${fmtDuration(status.sinceEligibleMs)} ago)`
      : `Just became available`;
    progressFraction = 1;
  } else {
    statusText = `In ${fmtDuration(status.remainingMs)} (at ${fmtTime(status.nextEligibleTs)})`;
    progressFraction = status.elapsedFraction;
  }
  const readyBadge = statusClass === 'status-ready'
    ? `<span class="ready-check" aria-hidden="true">✓</span> Available now`
    : `<span aria-hidden="true">⏳</span> Next dose`;

  let doseMeterHtml = '';
  if (cfg.hasDose) {
    const t24 = total24h(item.id, now);
    const pct = t24 / cfg.dailyMaxMg;
    let cls = 'meter-ok';
    if (pct >= 1) cls = 'meter-danger';
    else if (pct >= 0.7) cls = 'meter-warn';
    doseMeterHtml = `
      <div class="dose-meter">
        <div class="dose-meter-label">${t24}mg / ${cfg.dailyMaxMg}mg in last 24h</div>
        <div class="meter-track">
          <div class="meter-fill ${cls}" style="width:${Math.min(pct, 1) * 100}%"></div>
        </div>
      </div>
    `;
  }

  return `
    <div class="card" data-item="${item.id}" style="--item-color:${cfg.color}">
      <div class="card-title">
        <div class="title-left">
          <span class="icon-badge" style="background:${cfg.color}22; color:${cfg.color}">${cfg.icon}</span>
          <h3>${cfg.label}</h3>
        </div>
        ${cfg.hasDose ? `<span class="card-dose">${cfg.doseMg}mg</span>` : ''}
      </div>

      <div class="status-line ${statusClass}">
        <div class="status-top">${readyBadge}</div>
        <div class="status-detail">${statusText}</div>
        <div class="progress-track">
          <div class="progress-fill ${statusClass}" style="width:${progressFraction * 100}%"></div>
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

function renderItems(now) {
  const container = document.getElementById('items');
  container.innerHTML = DEFAULT_ITEMS.map((item) => itemCardHtml(item, now)).join('');
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

function render() {
  const now = Date.now();
  document.getElementById('clock').textContent = new Date(now).toLocaleString([], {
    weekday: 'short', hour: 'numeric', minute: '2-digit',
  });
  renderItems(now);
  renderHistory();
  checkNotifications(now);
}

function setup() {
  updateNotifButton();
  document.getElementById('notif-btn').addEventListener('click', requestNotifPermission);
  document.getElementById('copy-summary-btn').addEventListener('click', copySummary);

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
