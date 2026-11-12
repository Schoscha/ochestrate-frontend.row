// Codex Web UI - Frontend (OpenCode-Look, Wave-Arbeitsflaeche, kein Build)

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const state = {
  info: null,
  providers: [],
  provider: localStorage.getItem('cx.provider') || 'free',
  model: localStorage.getItem('cx.model') || null,
  models: [],
  sessions: [],
  session: null,
  agent: localStorage.getItem('cx.agent') === '1',
  pendingApproval: null,
  busy: false,
  layout: { widgets: [], types: [], presets: [] }
};

/* ---------------- Hilfsfunktionen ---------------- */
function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function fmtDate(seconds) {
  if (!seconds) return '';
  const d = new Date(seconds * 1000);
  const today = new Date();
  return d.toDateString() === today.toDateString()
    ? d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
}

function fmtGroup(seconds) {
  const d = new Date(seconds * 1000);
  const days = Math.floor((new Date() - d) / 86400000);
  if (days === 0) return 'Heute';
  if (days === 1) return 'Gestern';
  if (days < 7) return 'Diese Woche';
  if (days < 30) return 'Dieser Monat';
  return d.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
}

async function api(path, opts) {
  const res = await fetch(path, opts);
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { error: text.slice(0, 200) }; }
}

function post(path, body) {
  return api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
}

/* ---------------- Chat ---------------- */
function addMessage(role, text) {
  const wrap = el('div', 'msg ' + role);
  wrap.appendChild(el('div', 'msg-role', role === 'user' ? 'Du' : role === 'error' ? 'Fehler' : 'Agent'));
  wrap.appendChild(el('div', 'msg-body', text || ''));
  $('#timeline').appendChild(wrap);
  $('#timeline').scrollTop = $('#timeline').scrollHeight;
  return wrap;
}

async function send() {
  const prompt = $('#prompt').value.trim();
  if (!prompt || state.busy) return;
  state.busy = true;
  $('#send-btn').disabled = true;
  $('#prompt').value = '';
  autoGrow();

  addMessage('user', prompt);
  const answerBox = addMessage('agent', '');
  let answer = '';
  const tools = new Map();

  try {
    const res = await fetch('/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: state.provider, model: state.model, prompt, agent: state.agent, stream: true })
    });
    if (!res.ok || !res.body) throw new Error('HTTP ' + res.status);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';
      for (const part of parts) {
        const line = part.split('\n').find(l => l.startsWith('data: '));
        if (!line) continue;
        let evt;
        try { evt = JSON.parse(line.substring(6)); } catch { continue; }
        if (evt.type === 'delta') {
          answer += evt.text;
          answerBox.querySelector('.msg-body').textContent = answer;
          $('#timeline').scrollTop = $('#timeline').scrollHeight;
        } else if (evt.type === 'toolStart') {
          tools.set(evt.tool, addToolChip(evt.tool, undefined));
        } else if (evt.type === 'toolEnd') {
          const chip = tools.get(evt.tool);
          if (chip) {
            chip.classList.remove('ok', 'err');
            chip.classList.add(evt.ok ? 'ok' : 'err');
            chip.querySelector('.spin')?.remove();
          }
        } else if (evt.type === 'done') {
          answerBox.querySelector('.msg-body').textContent = evt.answer || answer;
          $('#st-provider').textContent = evt.provider || state.provider;
          $('#st-model').textContent = evt.model || state.model || '';
          answer = evt.answer || answer;
        } else if (evt.type === 'error') {
          addMessage('error', evt.error);
        }
      }
    }
  } catch (err) {
    addMessage('error', 'Verbindung fehlgeschlagen: ' + err.message);
  }

  state.busy = false;
  $('#send-btn').disabled = false;
  await persistSession(prompt, answer);
  await loadSessions();
}

function addToolChip(tool, ok) {
  const chip = el('div', 'tool-chip ' + (ok === true ? 'ok' : ok === false ? 'err' : ''));
  if (ok === undefined) chip.appendChild(el('span', 'spin'));
  chip.appendChild(el('span', null, tool));
  $('#timeline').appendChild(chip);
  return chip;
}

/* ---------------- Sessions ---------------- */
async function persistSession(prompt, answer) {
  let session = state.session;
  if (!session) {
    session = await post('/api/sessions', { name: prompt.slice(0, 60), model: state.model, provider: state.provider });
    state.session = session;
  }
  await post(`/api/sessions/${session.id}/messages`, { role: 'user', content: prompt });
  if (answer) await post(`/api/sessions/${session.id}/messages`, { role: 'assistant', content: answer });
}

async function loadSessions() {
  const data = await api('/api/sessions');
  state.sessions = data.sessions || [];
  const list = $('#session-list');
  list.innerHTML = '';
  if (!state.sessions.length) {
    list.appendChild(el('div', 'empty', 'Noch keine Sessions. Frage etwas los.'));
    return;
  }
  let group = null;
  for (const s of state.sessions) {
    const label = fmtGroup(s.updatedAt);
    if (label !== group) { group = label; list.appendChild(el('div', 'group-label', label)); }
    const row = el('div', 'session' + (state.session && state.session.id === s.id ? ' active' : ''));
    row.appendChild(el('span', 'session-title', s.title || 'Ohne Titel'));
    row.appendChild(el('span', 'session-meta', fmtDate(s.updatedAt)));
    row.addEventListener('click', () => openSession(s.id));
    list.appendChild(row);
  }
}

async function openSession(id) {
  const session = await api('/api/sessions/' + id);
  state.session = session;
  const tl = $('#timeline');
  tl.innerHTML = '';
  for (const m of session.messages || []) addMessage(m.role === 'user' ? 'user' : 'agent', m.content);
  await loadSessions();
}

/* ---------------- Freigaben ---------------- */
function showApproval(evt) {
  state.pendingApproval = evt;
  $('#approval-reason').textContent = evt.params?.reason || evt.params?.tool || 'Aktion ausführen';
  $('#approval-bar').hidden = false;
}

async function answerApproval(decision) {
  const evt = state.pendingApproval;
  if (!evt) return;
  state.pendingApproval = null;
  $('#approval-bar').hidden = true;
  await post('/api/approve', { id: evt.id, decision });
}

/* ---------------- Provider und Modelle ---------------- */
async function loadProviders() {
  const data = await api('/api/providers');
  state.providers = data.providers || [];
  const sel = $('#provider-select');
  sel.innerHTML = '';
  for (const p of state.providers) {
    const opt = el('option', null, p.name + (p.ready ? '' : ' (nicht bereit)'));
    opt.value = p.id;
    if (!p.ready) opt.disabled = true;
    sel.appendChild(opt);
  }
  if (!state.providers.find(p => p.id === state.provider && p.ready)) {
    const ready = state.providers.find(p => p.ready);
    if (ready) state.provider = ready.id;
  }
  sel.value = state.provider;
  await loadModels();
  renderProviders();
}

async function loadModels() {
  const data = await api('/api/models?provider=' + encodeURIComponent(state.provider));
  state.models = data.models || [];
  const sel = $('#model-select');
  sel.innerHTML = '';
  sel.appendChild(el('option', null, 'Modell: automatisch'));
  for (const m of state.models) sel.appendChild(el('option', null, m.name || m.id));
  sel.value = state.model || '';
}

function renderProviders() {
  const body = $('#provider-body');
  if (!body) return;
  body.innerHTML = '';
  for (const p of state.providers) {
    const box = el('div', 'box');
    const head = el('div', 'kv');
    head.appendChild(el('strong', null, p.name));
    head.appendChild(el('span', null, p.ready ? 'bereit' : (p.reason || 'nicht bereit')));
    box.appendChild(head);
    if (p.baseUrl) {
      const u = el('div', 'kv');
      u.appendChild(el('span', null, 'Adresse'));
      u.appendChild(el('span', 'mono', p.baseUrl));
      box.appendChild(u);
    }
    if (p.note) box.appendChild(el('div', 'hint', p.note));
    body.appendChild(box);
  }
}

/* ---------------- Wissen ---------------- */
async function searchWissen() {
  const q = $('#wissen-search').value.trim();
  const box = $('#wissen-results');
  if (!box) return;
  if (!q) { box.innerHTML = ''; return; }
  box.innerHTML = '';
  box.appendChild(el('div', 'empty', 'Suche läuft...'));
  const data = await api('/api/wissen?q=' + encodeURIComponent(q) + '&limit=12');
  box.innerHTML = '';
  if (!data.results?.length) { box.appendChild(el('div', 'empty', 'Keine Treffer')); return; }
  for (const r of data.results) {
    const card = el('div', 'result');
    card.appendChild(el('div', 'result-title', r.title));
    card.appendChild(el('div', 'result-snippet', r.snippet || ''));
    const meta = el('div', 'result-meta');
    meta.appendChild(el('span', null, r.author || r.project || ''));
    meta.appendChild(el('span', null, r.category || ''));
    if (r.created) meta.appendChild(el('span', null, r.created));
    if (r.url) {
      const a = el('a', null, 'In Vault öffnen');
      a.href = r.url; a.target = '_blank'; a.rel = 'noreferrer';
      meta.appendChild(a);
    }
    card.appendChild(meta);
    card.addEventListener('click', (e) => {
      if (e.target.tagName === 'A') return;
      card.appendChild(el('div', 'result-snippet', r.text || r.snippet || ''));
    });
    box.appendChild(card);
  }
}

/* ---------------- Rowboat ---------------- */
async function loadRowboat() {
  const cardsBox = $('#rowboat-cards');
  if (!cardsBox) return;
  const data = await api('/api/rowboat/overview');
  $('#st-rowboat').textContent = 'Rowboat: ' + (data.connected ? 'verbunden' : 'offline');
  cardsBox.innerHTML = '';
  const card = (value, label) => {
    const c = el('div', 'card');
    c.appendChild(el('b', null, String(value)));
    c.appendChild(el('span', null, label));
    cardsBox.appendChild(c);
  };
  card(data.mailCount ?? 0, 'Mails');
  card((data.topLevel || []).length, 'Wissensordner');
  card(data.counts?.knowledgeFiles ?? 0, 'Notizen');
  card(data.connected ? 'ok' : '—', 'Verbindung');

  const lists = $('#rowboat-lists');
  lists.innerHTML = '';
  const section = (title, items, render) => {
    lists.appendChild(el('div', 'list-head', title));
    if (!items?.length) { lists.appendChild(el('div', 'hint', 'Keine Einträge')); return; }
    for (const item of items.slice(0, 25)) lists.appendChild(render(item));
  };
  const row = (title, meta) => {
    const d = el('div', 'kv');
    d.appendChild(el('span', null, title));
    d.appendChild(el('span', null, meta || ''));
    return d;
  };
  section('Wissensordner', (data.topLevel || []).map(t => ({ t })), item => row(item.t));
  section('Neueste Mails', data.mails || [], m => row(m.title || m.file, fmtDate(new Date(m.updated).getTime() / 1000)));
  section('Meetings', data.meetings || [], m => row(m.title, fmtDate(new Date(m.updated).getTime() / 1000)));
  section('Personen', data.people || [], p => row(p.title, ''));
  section('Projekte', data.projects || [], p => row(p.title, ''));
}

/* ---------------- Dateien und Prozesse ---------------- */
async function loadFiles(path) {
  const box = $('#fs-list');
  if (!box) return;
  const target = path || 'C:\\Users\\Neu\\codex-web';
  $('#fs-path').textContent = target;
  const data = await api('/api/fs?path=' + encodeURIComponent(target));
  box.innerHTML = '';
  for (const e of (data.entries || []).slice(0, 80)) {
    const d = el('div', 'kv');
    d.appendChild(el('span', null, (e.kind === 'dir' ? '▸ ' : '· ') + e.name));
    d.appendChild(el('span', 'mono', e.kind === 'dir' ? '' : String(e.size ?? '')));
    if (e.kind === 'dir') d.addEventListener('click', () => loadFiles(e.path));
    else d.addEventListener('click', async () => {
      const f = await api('/api/fs/file?path=' + encodeURIComponent(e.path));
      $('#fs-preview').textContent = f.content || f.error || '';
    });
    box.appendChild(d);
  }
}

async function loadProcesses() {
  const box = $('#process-list');
  if (!box) return;
  const data = await api('/api/process');
  box.innerHTML = '';
  const table = el('table');
  const head = el('tr');
  for (const h of ['PID', 'Prozess', 'CPU', 'RAM MB']) head.appendChild(el('th', null, h));
  table.appendChild(head);
  for (const p of data.processes || []) {
    const tr = el('tr');
    tr.appendChild(el('td', 'mono', String(p.pid)));
    tr.appendChild(el('td', null, p.name || ''));
    tr.appendChild(el('td', 'mono', p.cpu != null ? Number(p.cpu).toFixed(1) : ''));
    tr.appendChild(el('td', 'mono', p.mb != null ? String(p.mb) : ''));
    table.appendChild(tr);
  }
  box.appendChild(table);
}

/* ---------------- Terminal-Bloecke ---------------- */
async function createTerminal(shell) {
  const pane = await post('/api/terminals', { shell: shell || 'powershell' });
  return pane;
}

function addTerminalPane(bodyEl, pane) {
  const box = el('div', 'term-pane');
  box.dataset.id = pane.id;
  const head = el('div', 'term-head');
  head.appendChild(el('span', 'name', pane.name || 'Shell'));
  head.appendChild(el('span', 'spacer'));
  const closeBtn = el('button', 'icon-btn', '×');
  closeBtn.title = 'Terminal schliessen';
  closeBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    await post('/api/terminals/' + pane.id + '/close', {});
    box.remove();
  });
  head.appendChild(closeBtn);
  box.appendChild(head);

  const out = el('pre', 'term-out', '');
  box.appendChild(out);

  const line = el('div', 'term-line');
  line.appendChild(el('span', 'prompt', '>'));
  const input = el('input');
  input.type = 'text';
  input.placeholder = 'Befehl eingeben und Enter druecken';
  input.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    const value = input.value;
    input.value = '';
    out.textContent += '> ' + value + '\n';
    await post('/api/terminals/' + pane.id + '/input', { data: value });
  });
  line.appendChild(input);
  box.appendChild(line);
  bodyEl.appendChild(box);
  return box;
}

function appendTerminalOutput(id, data) {
  const box = document.querySelector(`.term-pane[data-id="${id}"] .term-out`);
  if (!box) return;
  box.textContent += data;
  box.scrollTop = box.scrollHeight;
}

/* ---------------- Arbeitsflaeche: Widgets ---------------- */
const ICONS = {
  term: '<path d="M4 17l6-5-6-5M12 19h8"/>',
  files: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  process: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  web: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18"/>',
  wissen: '<path d="M4 5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-2z"/>',
  rowboat: '<path d="M3 15h18l-3 5H6zM6 15V7a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8"/>',
  provider: '<path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>',
  chat: '<path d="M21 12a8 8 0 0 1-8 8H7l-4 3V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8z"/>'
};

function iconSvg(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = ICONS[name] || ICONS.term;
  return svg;
}

async function loadLayout() {
  const data = await api('/api/layout');
  state.layout = data;
  renderCanvas();
  renderDock();
  renderTabs();
}

function renderTabs() {
  const box = $('#layout-tabs');
  box.innerHTML = '';
  const current = el('button', 'lt' + (state.layout.preset === 'uebersicht' ? ' active' : ''), 'Übersicht');
  current.addEventListener('click', () => {
    post('/api/layout/preset', { action: 'load', name: 'uebersicht' }).then(res => {
      if (res.layout) { state.layout = res.layout; renderCanvas(); renderTabs(); }
    });
  });
  box.appendChild(current);
  for (const preset of state.layout.presets || []) {
    if (preset === 'uebersicht') continue;
    const tab = el('button', 'lt' + (state.layout.preset === preset ? ' active' : ''), preset);
    tab.addEventListener('click', async () => {
      const res = await post('/api/layout/preset', { action: 'load', name: preset });
      if (res.layout) { state.layout = res.layout; renderCanvas(); renderTabs(); }
    });
    box.appendChild(tab);
  }
  const add = el('button', 'lt add', '+');
  add.addEventListener('click', async () => {
    const name = prompt('Name für dieses Layout:', 'T' + ((state.layout.presets || []).length + 1));
    if (!name) return;
    const res = await post('/api/layout/preset', { action: 'save', name });
    await loadLayout();
  });
  box.appendChild(add);
}

function renderDock() {
  const box = $('#dock-items');
  box.innerHTML = '';
  for (const t of state.layout.types || []) {
    const btn = el('button', 'dock-btn');
    btn.title = t.title + ' hinzufügen';
    btn.setAttribute('aria-label', t.title + ' hinzufügen');
    btn.appendChild(iconSvg(t.icon || t.id));
    btn.addEventListener('click', () => addWidget(t.id));
    box.appendChild(btn);
  }
}

async function addWidget(type) {
  const count = (state.layout.widgets || []).length;
  const step = count % 6;
  const res = await post('/api/layout', {
    action: 'add', type,
    x: Math.min(64, 4 + step * 11),
    y: Math.min(62, 4 + (step % 3) * 13),
    w: type === 'term' ? 45 : 38,
    h: type === 'term' ? 55 : 45
  });
  state.layout = res;
  renderCanvas();
}

function renderCanvas() {
  const canvas = $('#canvas');
  const scrollY = canvas.scrollTop;
  detachAll();
  canvas.innerHTML = '';
  for (const w of state.layout.widgets || []) {
    const box = buildWidget(w);
    canvas.appendChild(box);          // erst einhaengen, dann Inhalt setzen
    attachWidgetContent(w, box.querySelector('.w-body'));
  }
  canvas.scrollTop = scrollY;
}

/** Panel und Timeline zurueck in die Ablage, bevor der Canvas neu gebaut wird. */
function detachAll() {
  const store = $('#panel-store');
  // alle Panel-Sektionen zurueck, egal wo sie haengen
  document.querySelectorAll('[data-panel]').forEach(p => {
    p.style.display = 'none';
    if (p.parentElement !== store) store.appendChild(p);
  });
  const timeline = $('#timeline');
  if (timeline && timeline.parentElement !== store) {
    timeline.style.display = 'none';
    store.appendChild(timeline);
  }
}

function buildWidget(w) {
  const box = el('div', 'widget' + (w.focus ? ' focused' : ''));
  box.dataset.id = w.id;
  box.dataset.type = w.type;
  box.style.left = w.x + '%';
  box.style.top = w.y + '%';
  box.style.width = w.w + '%';
  box.style.height = w.h + '%';

  const head = el('div', 'w-head');
  head.appendChild(iconSvg(w.type));
  head.appendChild(el('span', 'w-title', w.title || w.type));
  head.appendChild(el('span', 'spacer'));

  const gear = el('button', 'icon-btn');
  gear.title = 'Optionen';
  gear.appendChild(iconSvg('provider'));
  gear.addEventListener('click', (e) => { e.stopPropagation(); widgetMenu(w, box); });

  const max = el('button', 'icon-btn');
  max.title = 'Maximieren';
  max.textContent = '⤢';
  max.addEventListener('click', async (e) => {
    e.stopPropagation();
    const res = await post('/api/layout', { action: 'maximize', id: w.id });
    state.layout = res;
    renderCanvas();
  });

  const close = el('button', 'icon-btn');
  close.title = 'Schließen';
  close.textContent = '×';
  close.addEventListener('click', async (e) => {
    e.stopPropagation();
    await post('/api/layout', { action: 'remove', id: w.id });
    const res = await api('/api/layout');
    state.layout = res;
    renderCanvas();
  });

  head.appendChild(gear); head.appendChild(max); head.appendChild(close);
  box.appendChild(head);

  const body = el('div', 'w-body');
  box.appendChild(body);
  attachWidgetContent(w, body);

  // Zonen zum Skalieren
  for (const dir of ['e', 's', 'se']) {
    const handle = el('div', 'w-resize ' + dir);
    handle.addEventListener('pointerdown', (e) => startResize(e, w, box, dir));
    box.appendChild(handle);
  }

  head.addEventListener('pointerdown', (e) => startDrag(e, w, box));
  box.addEventListener('pointerdown', () => focusWidget(w.id));

  return box;
}

function widgetMenu(w, box) {
  const menu = el('div', 'result');
  menu.style.position = 'absolute';
  menu.style.zIndex = '20';
  menu.style.left = '8px';
  menu.style.top = '34px';
  menu.appendChild(el('div', 'hint', w.type + ' - ' + (w.state?.note || 'Widget')));
  const close = el('button', 'btn small', 'Entfernen');
  close.addEventListener('click', async () => {
    await post('/api/layout', { action: 'remove', id: w.id });
    state.layout = await api('/api/layout');
    renderCanvas();
  });
  menu.appendChild(close);
  box.appendChild(menu);
  setTimeout(() => menu.remove(), 4000);
}

async function attachWidgetContent(w, body) {
  // wenn das Widget schon wieder aus dem Canvas gerissen wurde: nichts anhaengen
  if (!body.isConnected) return;
  if (w.type === 'chat') {
    const timeline = $('#timeline');
    if (!timeline) return;
    timeline.style.display = 'block';
    body.appendChild(timeline);
    return;
  }
  const panel = document.querySelector(`#panel-store [data-panel="${w.type}"]`);
  if (panel) {
    panel.style.display = 'flex';
    body.appendChild(panel);
    if (w.type === 'files') await loadFiles(w.state?.path);
    if (w.type === 'process') await loadProcesses();
    if (w.type === 'rowboat') await loadRowboat();
    if (w.type === 'provider') renderProviders();
    if (w.type === 'wissen') await searchWissen();
    if (w.type === 'web') { const f = $('#web-frame'); if (f && !f.src) f.src = ($('#web-url')?.value) || ''; }
    return;
  }
  if (w.type === 'term') {
    let pane = null;
    if (w.state?.term) {
      const list = await api('/api/terminals');
      pane = (list.terminals || []).find(t => t.id === w.state.term);
    }
    if (!pane) {
      pane = await createTerminal('powershell');
      await post('/api/layout', { action: 'state', id: w.id, state: { term: pane.id } });
    }
    addTerminalPane(body, pane);
    return;
  }
  body.appendChild(el('div', 'empty', 'Widget: ' + w.type));
}

async function focusWidget(id) {
  const res = await post('/api/layout', { action: 'focus', id });
  state.layout = res;
  renderCanvas();
}

/* ---------------- Verschieben und Skalieren (Magnet) ---------------- */
function startDrag(e, w, box) {
  if (e.target.closest('.icon-btn')) return;
  e.preventDefault();
  const canvas = $('#canvas');
  const rect = canvas.getBoundingClientRect();
  const width = rect.width || canvas.parentElement.getBoundingClientRect().width || window.innerWidth || 1;
  const height = rect.height || canvas.parentElement.getBoundingClientRect().height || window.innerHeight || 1;
  const startX = e.clientX, startY = e.clientY;
  const origX = w.x, origY = w.y;
  const ghost = el('div', 'drag-ghost');
  canvas.appendChild(ghost);

  const onMove = (ev) => {
    const dx = ((ev.clientX - startX) / width) * 100;
    const dy = ((ev.clientY - startY) / height) * 100;
    const nx = Math.max(0, Math.min(100 - w.w, origX + dx));
    const ny = Math.max(0, Math.min(100 - w.h, origY + dy));
    w.x = nx; w.y = ny;
    box.style.left = nx + '%';
    box.style.top = ny + '%';
    ghost.style.left = nx + '%';
    ghost.style.top = ny + '%';
    ghost.style.width = w.w + '%';
    ghost.style.height = w.h + '%';
  };
  const onUp = async () => {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    ghost.remove();
    const res = await post('/api/layout', { action: 'move', id: w.id, x: Math.round(w.x), y: Math.round(w.y) });
    state.layout = res;
  };
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
}

function startResize(e, w, box, dir) {
  e.preventDefault();
  e.stopPropagation();
  const canvas = $('#canvas');
  const rect = canvas.getBoundingClientRect();
  const width = rect.width || canvas.parentElement.getBoundingClientRect().width || window.innerWidth || 1;
  const height = rect.height || canvas.parentElement.getBoundingClientRect().height || window.innerHeight || 1;
  const startX = e.clientX, startY = e.clientY;
  const orig = { x: w.x, y: w.y, w: w.w, h: w.h };
  const others = (state.layout.widgets || []).filter(x => x.id !== w.id);

  const onMove = (ev) => {
    const dx = ((ev.clientX - startX) / width) * 100;
    const dy = ((ev.clientY - startY) / height) * 100;
    let nw = orig.w, nh = orig.h;
    if (dir.includes('e')) nw = Math.max(10, Math.min(100 - orig.x, orig.w + dx));
    if (dir.includes('s')) nh = Math.max(8, Math.min(100 - orig.y, orig.h + dy));
    w.w = nw; w.h = nh; w.__dirty = true;
    box.style.width = nw + '%';
    box.style.height = nh + '%';
    // Magnet: Nachbarn, die ueber die Kante ragen, werden mitgeschoben
    for (const o of others) {
      const overlapsV = o.y < orig.y + nh && o.y + o.h > orig.y;
      if (dir.includes('e') && overlapsV && o.x + o.w > orig.x + nw) {
        const right = o.x + o.w;
        const edge = orig.x + nw;
        if (o.x < edge) { o.x = edge; o.w = Math.max(8, right - edge); }
        else o.w = Math.max(8, o.w - (right - edge));
      }
      if (dir.includes('s') && o.x < orig.x + nw && o.x + o.w > orig.x && o.y + o.h > orig.y + nh) {
        const bottom = o.y + o.h;
        const edge = orig.y + nh;
        if (o.y < edge) { o.y = edge; o.h = Math.max(8, bottom - edge); }
        else o.h = Math.max(8, o.h - (bottom - edge));
      }
    }
    for (const o of others) {
      const node = document.querySelector(`.widget[data-id="${o.id}"]`);
      if (node) {
        node.style.left = o.x + '%';
        node.style.top = o.y + '%';
        node.style.width = o.w + '%';
        node.style.height = o.h + '%';
      }
      o.__dirty = true;
    }
  };
  const onUp = async () => {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    // Einzelmeldungen statt Gesamt-Layout: ein SSE-Re-Render waehrend des Ziehens
    // darf die Aenderung nicht verwerfen
    const changed = [w, ...others].filter(o => o.__dirty);
    for (const o of changed) {
      await post('/api/layout', {
        action: 'resize', id: o.id,
        w: Math.round(o.w), h: Math.round(o.h),
        x: Math.round(o.x), y: Math.round(o.y)
      });
    }
    if (!changed.length) await post('/api/layout', { action: 'resize', id: w.id, w: Math.round(w.w), h: Math.round(w.h) });
    state.layout = await api('/api/layout');
    renderCanvas();
  };
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
}

/* ---------------- SSE ---------------- */
function connectSSE() {
  const source = new EventSource('/api/events');
  source.onmessage = (event) => {
    let evt;
    try { evt = JSON.parse(event.data); } catch { return; }
    if (evt.type === 'connected') {
      $('#conn-dot').className = 'dot ok';
    } else if (evt.type === 'approval') {
      showApproval(evt);
    } else if (evt.type === 'error') {
      $('#conn-dot').className = 'dot err';
    } else if (evt.type === 'terminal:output') {
      appendTerminalOutput(evt.id, evt.data);
    } else if (evt.type === 'terminal:exit') {
      const box = document.querySelector(`.term-pane[data-id="${evt.id}"] .term-head .name`);
      if (box) box.textContent += ' (beendet)';
    } else if (evt.type === 'layout') {
      state.layout = evt.layout;
      renderCanvas();
    }
  };
  source.onerror = () => {
    $('#conn-dot').className = 'dot err';
    setTimeout(connectSSE, 3000);
  };
}

/* ---------------- Health ---------------- */
async function pollHealth() {
  const data = await api('/api/health');
  $('#st-memory').textContent = 'Wissen: ' + (data.memory || '–');
  $('#st-version').textContent = 'v' + (state.info?.version || '?') + ' · ' + Math.round(data.uptime / 60) + ' min';
  $('#conn-dot').className = 'dot ' + (data.ok ? 'ok' : 'err');
}

/* ---------------- Ereignisse ---------------- */
function autoGrow() {
  const ta = $('#prompt');
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, window.innerHeight * 0.3) + 'px';
}

function setup() {
  $('#send-btn').addEventListener('click', send);
  $('#prompt').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  $('#prompt').addEventListener('input', autoGrow);

  $('#new-session').addEventListener('click', () => {
    state.session = null;
    $('#timeline').innerHTML = '';
    $('#prompt').focus();
  });

  $('#provider-select').addEventListener('change', async (e) => {
    state.provider = e.target.value;
    state.model = null;
    localStorage.setItem('cx.provider', state.provider);
    await loadModels();
  });
  $('#model-select').addEventListener('change', (e) => {
    state.model = e.target.value || null;
    localStorage.setItem('cx.model', state.model || '');
  });

  $('#agent-toggle').addEventListener('change', (e) => {
    state.agent = e.target.checked;
    localStorage.setItem('cx.agent', state.agent ? '1' : '0');
    $('#agent-pill').hidden = !state.agent;
  });

  $('#approval-accept').addEventListener('click', () => answerApproval('accept'));
  $('#approval-decline').addEventListener('click', () => answerApproval('decline'));

  $('#toggle-left').addEventListener('click', () => $('#app').classList.toggle('left-open'));
  $('#toggle-right').addEventListener('click', () => $('#app').classList.toggle('right-open'));
  $('#theme-toggle').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('cx.theme', next);
  });

  let debounce;
  $('#wissen-search').addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(searchWissen, 400); });
  $('#wissen-search').addEventListener('keydown', (e) => { if (e.key === 'Enter') searchWissen(); });
  $('#rowboat-reload').addEventListener('click', loadRowboat);
  $('#plugins-reload').addEventListener('click', loadWerkzeuge);
  $('#process-reload').addEventListener('click', loadProcesses);
  $('#web-go').addEventListener('click', () => { $('#web-frame').src = $('#web-url').value; });
  $('#briefing-save').addEventListener('click', async () => {
    const out = await post('/api/rowboat/briefing', { title: $('#briefing-title').value, text: $('#briefing-text').value });
    $('#briefing-result').textContent = out.error || ('Gespeichert: ' + (out.path || ''));
  });
  $('#task-start').addEventListener('click', async () => {
    const out = await post('/api/rowboat/task', { agent: $('#task-agent').value, prompt: $('#task-prompt').value });
    $('#task-result').textContent = out.denied ? 'Abgelehnt' : (out.error || 'Task gestartet');
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { $('#app').classList.remove('left-open', 'right-open'); $('#approval-bar').hidden = true; }
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); $('#new-session').click(); }
    if ((e.ctrlKey || e.metaKey) && e.key === '/') { e.preventDefault(); $('#wissen-search')?.focus(); }
    if (!e.ctrlKey && !e.metaKey && !/input|textarea/i.test(e.target.tagName)) {
      if (e.key === 's' || e.key === 'S') $('#app').classList.toggle('left-open');
      if (e.key === 'w' || e.key === 'W') $('#app').classList.toggle('right-open');
    }
  });
}

async function loadWerkzeuge() {
  const plugins = await api('/api/plugins');
  const pl = $('#plugins-list');
  if (!pl) return;
  pl.innerHTML = '';
  pl.appendChild(el('div', 'list-head', 'Plugins'));
  if (!plugins.plugins?.length) pl.appendChild(el('div', 'hint', 'Keine Plugins. Der Agent kann eigene anlegen.'));
  for (const p of plugins.plugins || []) {
    const box = el('div', 'box');
    const head = el('div', 'kv');
    head.appendChild(el('strong', null, p.name + ' ' + p.version));
    head.appendChild(el('span', null, p.tools.length + ' Werkzeuge'));
    box.appendChild(head);
    if (p.description) box.appendChild(el('div', 'hint', p.description));
    pl.appendChild(box);
  }
  const skills = await api('/api/skills');
  const sl = $('#skills-list');
  sl.innerHTML = '';
  sl.appendChild(el('div', 'list-head', `Skills (${skills.count})`));
  for (const s of (skills.skills || []).slice(0, 40)) {
    const d = el('div', 'kv');
    d.appendChild(el('span', null, s.name));
    d.appendChild(el('span', 'mono', s.id));
    sl.appendChild(d);
  }
  const mcp = await api('/api/mcp');
  const ml = $('#mcp-list');
  ml.innerHTML = '';
  ml.appendChild(el('div', 'list-head', `MCP-Server (${mcp.count})`));
  for (const s of mcp.servers || []) {
    const d = el('div', 'kv');
    d.appendChild(el('span', null, s.name));
    d.appendChild(el('span', 'mono', s.transport || ''));
    ml.appendChild(d);
  }
}

async function init() {
  setup();
  state.info = await api('/api/info');
  $('#st-version').textContent = 'v' + state.info.version;
  $('#agent-toggle').checked = state.agent;
  $('#agent-pill').hidden = !state.agent;
  await loadProviders();
  await loadSessions();
  await loadLayout();
  connectSSE();
  pollHealth();
  setInterval(pollHealth, 5000);
  $('#prompt').focus();
}

init();
