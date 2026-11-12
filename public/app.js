// Codex Web UI - Frontend (OpenCode-Look, ohne Build, ohne Anbieterbindung)

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
  busy: false
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
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
}

function fmtGroup(seconds) {
  const d = new Date(seconds * 1000);
  const now = new Date();
  const days = Math.floor((now - d) / 86400000);
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
  return api(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
}

/* ---------------- Chat ---------------- */
function addMessage(role, text, extra) {
  const wrap = el('div', 'msg ' + role);
  wrap.appendChild(el('div', 'msg-role', role === 'user' ? 'Du' : role === 'error' ? 'Fehler' : 'Agent'));
  const body = el('div', 'msg-body', text || '');
  wrap.appendChild(body);
  if (extra) wrap.appendChild(extra);
  $('#timeline').appendChild(wrap);
  $('#timeline').scrollTop = $('#timeline').scrollHeight;
  return wrap;
}

function addToolChip(tool, ok) {
  const chip = el('div', 'tool-chip ' + (ok === true ? 'ok' : ok === false ? 'err' : ''));
  if (ok === undefined) chip.appendChild(el('span', 'spin'));
  chip.appendChild(el('span', null, tool));
  $('#timeline').appendChild(chip);
  $('#timeline').scrollTop = $('#timeline').scrollHeight;
  return chip;
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

  const body = {
    provider: state.provider,
    model: state.model,
    prompt,
    agent: state.agent,
    stream: true
  };

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
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
          if (evt.answer) answer = evt.answer;
        } else if (evt.type === 'error' || evt.type === 'providerError') {
          if (evt.type === 'error') addMessage('error', evt.error);
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
    if (label !== group) {
      group = label;
      list.appendChild(el('div', 'group-label', label));
    }
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
  $('#timeline').innerHTML = '';
  for (const m of session.messages || []) {
    addMessage(m.role === 'user' ? 'user' : 'agent', m.content);
  }
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
  const auto = el('option', null, 'Modell: automatisch');
  auto.value = '';
  sel.appendChild(auto);
  for (const m of state.models) sel.appendChild(el('option', null, m.name || m.id));
  sel.value = state.model || '';
}

function renderProviders() {
  const body = $('#provider-body');
  body.innerHTML = '';
  for (const p of state.providers) {
    const box = el('div', 'box');
    const head = el('div', 'kv');
    head.appendChild(el('strong', null, p.name));
    head.appendChild(el('span', null, p.ready ? 'bereit' : (p.reason || 'nicht bereit')));
    box.appendChild(head);
    const info = el('div', 'kv');
    info.appendChild(el('span', null, 'Stufe'));
    info.appendChild(el('span', null, String(p.tier)));
    box.appendChild(info);
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
  if (!q) { box.innerHTML = ''; return; }
  box.innerHTML = '';
  box.appendChild(el('div', 'empty', 'Suche läuft...'));
  const data = await api('/api/wissen?q=' + encodeURIComponent(q) + '&limit=12');
  box.innerHTML = '';
  if (!data.results?.length) {
    box.appendChild(el('div', 'empty', 'Keine Treffer'));
    return;
  }
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
      const full = el('div', 'result-snippet', r.text || r.snippet || '');
      card.appendChild(full);
    });
    box.appendChild(card);
  }
}

/* ---------------- Rowboat ---------------- */
async function loadRowboat() {
  const body = $('#rowboat-body');
  const data = await api('/api/rowboat/overview');
  $('#st-rowboat').textContent = 'Rowboat: ' + (data.connected ? 'verbunden' : 'offline');
  const cards = $('#rowboat-cards');
  cards.innerHTML = '';
  const card = (value, label) => {
    const c = el('div', 'card');
    c.appendChild(el('b', null, String(value)));
    c.appendChild(el('span', null, label));
    cards.appendChild(c);
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

/* ---------------- Werkzeuge ---------------- */
async function loadWerkzeuge() {
  const plugins = await api('/api/plugins');
  const pl = $('#plugins-list');
  pl.innerHTML = '';
  pl.appendChild(el('div', 'list-head', 'Plugins'));
  if (!plugins.plugins?.length) {
    pl.appendChild(el('div', 'hint', 'Keine Plugins. Der Agent kann eigene anlegen (Ordner plugins/<name>/plugin.json).'));
  }
  for (const p of plugins.plugins || []) {
    const box = el('div', 'box');
    box.appendChild(el('div', 'kv', ''));
    box.lastChild.appendChild(el('strong', null, p.name + ' ' + p.version));
    box.lastChild.appendChild(el('span', null, p.tools.length + ' Werkzeuge'));
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
  const mem = el('div', 'kv');
  mem.appendChild(el('span', null, 'agent-memory'));
  mem.appendChild(el('span', null, mcp.memory?.status || ''));
  ml.appendChild(mem);

  await loadFiles();
}

async function loadFiles(path) {
  const target = path || 'C:\\Users\\Neu\\codex-web';
  $('#fs-path').textContent = target;
  const data = await api('/api/fs?path=' + encodeURIComponent(target));
  const box = $('#fs-list');
  box.innerHTML = '';
  for (const e of (data.entries || []).slice(0, 40)) {
    const d = el('div', 'kv');
    d.appendChild(el('span', null, (e.kind === 'dir' ? '📁 ' : '📄 ') + e.name));
    d.appendChild(el('span', 'mono', e.kind === 'dir' ? '' : String(e.size ?? '')));
    if (e.kind === 'dir') d.addEventListener('click', () => loadFiles(e.path));
    box.appendChild(d);
  }
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
      applyLayout(evt.layout);
      renderLeisten(evt.layout);
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

/* ---------------- Terminal-Bloecke und Leisten ---------------- */
const PANELS = ['wissen', 'rowboat', 'werkzeuge', 'provider', 'terminal'];

async function loadLayout() {
  const data = await api('/api/layout');
  state.layout = data;
  applyLayout(data);
  renderLeisten(data);
}

function applyLayout(data) {
  $('#grid-select').value = data.grid || '2x2';
  $('#term-grid').dataset.grid = data.grid || '2x2';
  // nur aktive Leisten als Tabs zeigen
  const tabs = $$('.tab');
  tabs.forEach(t => t.classList.toggle('hidden', !(data.panels || []).includes(t.dataset.tab)));
  if (!(data.panels || []).includes($('.tab.active')?.dataset.tab)) {
    const first = tabs.find(t => !(data.panels || []).includes(t.dataset.tab) === false);
    if (first) first.click();
  }
}

function renderLeisten(data) {
  const box = $('#leisten');
  box.innerHTML = '';
  for (const panel of PANELS) {
    const on = (data.panels || []).includes(panel);
    const btn = el('button', 'leiste' + (on ? ' on' : ''), panel.charAt(0).toUpperCase() + panel.slice(1));
    btn.addEventListener('click', async () => {
      const next = await post('/api/layout/toggle', { panel });
      state.layout = next;
      applyLayout(next);
      renderLeisten(next);
    });
    box.appendChild(btn);
  }
}

async function createTerminal(shell) {
  const pane = await post('/api/terminals', { shell: shell || 'powershell' });
  addTerminalPane(pane);
  return pane;
}

function addTerminalPane(pane) {
  const grid = $('#term-grid');
  const box = el('div', 'term-pane');
  box.dataset.id = pane.id;
  const head = el('div', 'term-head');
  head.appendChild(el('span', 'name', pane.name || 'Shell'));
  head.appendChild(el('span', 'spacer'));
  const clearBtn = el('button', 'icon-btn', '×');
  clearBtn.title = 'Terminal schliessen';
  clearBtn.addEventListener('click', async () => {
    await post('/api/terminals/' + pane.id + '/close', {});
    box.remove();
  });
  head.appendChild(clearBtn);
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

  grid.appendChild(box);
  return box;
}

function appendTerminalOutput(id, data) {
  const box = document.querySelector(`.term-pane[data-id="${id}"] .term-out`);
  if (!box) return;
  box.textContent += data;
  box.scrollTop = box.scrollHeight;
}

async function initTerminals() {
  const data = await api('/api/terminals');
  for (const pane of data.terminals || []) addTerminalPane(pane);
  if (!(data.terminals || []).length) await createTerminal('powershell');
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

  $('#new-session').addEventListener('click', async () => {
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

  $$('.tab').forEach(tab => tab.addEventListener('click', () => {
    $$('.tab').forEach(t => t.classList.remove('active'));
    $$('.tabpanel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    $(`[data-panel="${tab.dataset.tab}"]`).classList.add('active');
    if (tab.dataset.tab === 'rowboat') loadRowboat();
    if (tab.dataset.tab === 'werkzeuge') loadWerkzeuge();
  }));

  let debounce;
  $('#wissen-search').addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(searchWissen, 400);
  });
  $('#wissen-search').addEventListener('keydown', (e) => { if (e.key === 'Enter') searchWissen(); });

  $('#rowboat-reload').addEventListener('click', loadRowboat);
  $('#plugins-reload').addEventListener('click', loadWerkzeuge);

  $('#grid-select').addEventListener('change', async (e) => {
    const next = await post('/api/layout', { grid: e.target.value });
    state.layout = next;
    applyLayout(next);
  });
  $('#term-new').addEventListener('click', () => createTerminal('powershell'));

  $('#briefing-save').addEventListener('click', async () => {
    const out = await post('/api/rowboat/briefing', {
      title: $('#briefing-title').value,
      text: $('#briefing-text').value
    });
    $('#briefing-result').textContent = out.error || ('Gespeichert: ' + (out.path || ''));
  });

  $('#task-start').addEventListener('click', async () => {
    const out = await post('/api/rowboat/task', {
      agent: $('#task-agent').value,
      prompt: $('#task-prompt').value
    });
    $('#task-result').textContent = out.denied ? 'Abgelehnt' : (out.error || 'Task gestartet');
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { $('#app').classList.remove('left-open', 'right-open'); $('#approval-bar').hidden = true; }
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); $('#new-session').click(); }
    if ((e.ctrlKey || e.metaKey) && e.key === '/') { e.preventDefault(); $('#wissen-search').focus(); }
    if (!e.ctrlKey && !e.metaKey && !/input|textarea/i.test(e.target.tagName)) {
      if (e.key === 's' || e.key === 'S') $('#app').classList.toggle('left-open');
      if (e.key === 'w' || e.key === 'W') $('#app').classList.toggle('right-open');
    }
  });
}

async function init() {
  setup();
  state.info = await api('/api/info');
  $('#st-version').textContent = 'v' + state.info.version;
  $('#agent-toggle').checked = state.agent;
  $('#agent-pill').hidden = !state.agent;
  await loadProviders();
  await loadSessions();
  await loadWerkzeuge();
  await loadLayout();
  await initTerminals();
  connectSSE();
  pollHealth();
  setInterval(pollHealth, 5000);
  $('#prompt').focus();
}

init();
