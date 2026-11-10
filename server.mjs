import { spawn } from 'child_process';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { extname, join, resolve } from 'path';
import { hostname } from 'os';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { ProviderRegistry, PROVIDERS } from './providers.mjs';
import { listSkills, listMcpServers } from './local-inventory.mjs';
import { Harness } from './harness.mjs';

// Native fetch (Node >= 18)
const fetch = globalThis.fetch.bind(globalThis);

const __dirname = resolve(fileURLToPath(import.meta.url), '..');
const PORT = process.env.PORT || 8080;
const PUBLIC_DIR = join(__dirname, 'public');
const MEMORY_HOST = process.env.MEMORY_HOST || '100.71.9.93';
const MEMORY_PORT = process.env.MEMORY_PORT || '8798';
/* Web-Zugriff auf den Vault (Second-Brain) auf dem VPS ueber Filebrowser */
const VAULT_WEB_BASE = process.env.VAULT_WEB_BASE || 'https://files.sascha-kruss.de/files/srv/root/Second-Brain';
const STATION_URL = process.env.STATION_URL || 'https://central.sascha-kruss.de/main/';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.webp': 'image/webp'
};

/* --------------------------------------------------------------
   MCP-Client für agent-memory (Homeserver 100.71.9.93:8798)
   -------------------------------------------------------------- */
class MemoryMCP {
  constructor() {
    this.sessionId = null;
    this.initialized = false;
    this.initPromise = null;
    this.lastError = null;
    this.lastOkAt = null;
  }

  resetSession() {
    this.sessionId = null;
    this.initialized = false;
    this.initPromise = null;
  }

  async ensureInit() {
    if (this.initialized && this.sessionId) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      const res = await fetch(`http://${MEMORY_HOST}:${MEMORY_PORT}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream'
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'codex-web-ui', version: '1.0.0' }
          }
        })
      });
      const sid = res.headers.get('mcp-session-id');
      if (!sid) throw new Error('Keine MCP-Session-ID erhalten');
      this.sessionId = sid;
      this.initialized = true;
    })();

    return this.initPromise;
  }

  async recall(query, project = 'central-station', limit = 8) {
    let lastErr = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const items = await this.recallOnce(query, project, limit);
        this.lastError = null;
        this.lastOkAt = Date.now();
        return items;
      } catch (err) {
        lastErr = err;
        this.lastError = err.message;
        // Session kann auf der MCP-Seite abgelaufen sein -> neu aufbauen und einmal wiederholen
        this.resetSession();
        if (attempt === 0) {
          console.error('[memory-mcp] Abruf fehlgeschlagen, neue Session: ' + err.message);
          continue;
        }
      }
    }
    throw lastErr;
  }

  async recallOnce(query, project, limit) {
    await this.ensureInit();
    const res = await fetch(`http://${MEMORY_HOST}:${MEMORY_PORT}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'MCP-Session-Id': this.sessionId
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'tools/call',
        params: {
          name: 'memory_recall',
          arguments: { query, project, limit, auch_vault: true }
        }
      })
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`MCP HTTP ${res.status}: ${text.slice(0, 200)}`);
    const parsed = parseSseJson(text);
    if (!parsed) throw new Error('Keine MCP-Daten (unerwartetes Antwortformat): ' + text.slice(0, 200));
    if (parsed.error) throw new Error(parsed.error.message || 'MCP-Fehler');
    if (parsed.result && parsed.result.isError) {
      const c = parsed.result.content && parsed.result.content[0];
      throw new Error('MCP-Tool-Fehler: ' + (c && c.text ? String(c.text).slice(0, 200) : 'unbekannt'));
    }
    return extractItems(parsed);
  }
}

/* Antwort des MCP-Servers auswerten: SSE ("data: {...}") oder reines JSON */
function parseSseJson(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{')) {
    try { return JSON.parse(trimmed); } catch { /* weiter mit SSE */ }
  }
  let parsed = null;
  for (const line of trimmed.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    const payload = line.substring(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try { parsed = JSON.parse(payload); } catch { /* unparsbare Zeile ueberspringen */ }
  }
  return parsed;
}

/* Notizen aus der MCP-Antwort ziehen (content-Array, structuredContent oder Direktliste) */
function extractItems(parsed) {
  const result = parsed.result || parsed;
  if (!result) return [];

  if (Array.isArray(result.content)) {
    const items = [];
    for (const c of result.content) {
      if (!c || c.type !== 'text' || !c.text) continue;
      try {
        const parsedText = JSON.parse(c.text);
        if (Array.isArray(parsedText)) items.push(...parsedText);
        else if (parsedText && typeof parsedText === 'object') items.push(parsedText);
      } catch {
        items.push({ titel: String(c.text).slice(0, 120), text: String(c.text) });
      }
    }
    return items;
  }

  const sc = result.structuredContent;
  if (sc) {
    if (Array.isArray(sc)) return sc;
    if (Array.isArray(sc.items)) return sc.items;
    if (Array.isArray(sc.results)) return sc.results;
    if (typeof sc === 'object') return [sc];
  }

  if (Array.isArray(result)) return result;
  if (Array.isArray(result.items)) return result.items;
  return [];
}

const memory = new MemoryMCP();

/* --------------------------------------------------------------
   Codex App-Server
   -------------------------------------------------------------- */
const SLOW_METHODS = new Set(['skills/list', 'mcpServerStatus/list', 'review/start', 'config/read']);

class CodexServer {
  constructor() {
    this.codex = null;
    this.requestId = 1;
    this.pending = new Map();
    this.serverRequests = new Map();
    this.sseClients = new Set();
    this.ready = false;
    this.authenticated = false;
    this.authCheckedAt = 0;
    this.authReason = null;
    this.startCodex();
  }

  startCodex() {
    const codexPath = join(process.env.APPDATA || '', 'npm', 'codex.cmd');
    this.codex = spawn(codexPath, ['app-server'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: true
    });

    this.codex.stdout.on('data', (data) => {
      const lines = data.toString().trim().split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        try { this.handleCodexMessage(JSON.parse(line)); } catch (e) {}
      }
    });

    this.codex.stderr.on('data', (data) => {
      console.error('[codex stderr]', data.toString().slice(0, 300));
    });

    this.codex.on('exit', (code) => {
      console.log('[codex] exited with code', code);
      this.ready = false;
      setTimeout(() => this.startCodex(), 3000);
    });

    this.codex.on('error', (err) => {
      console.error('[codex] spawn error:', err.message);
      this.ready = false;
    });

    // Sende initialize-Handshake an den Codex App-Server
    this.initializeCodex().then(() => {
      this.ready = true;
      console.log('[codex] app-server initialisiert und bereit');
    }).catch(e => {
      console.error('[codex] initialize fehlgeschlagen, versuche Neustart:', e);
      setTimeout(() => this.startCodex(), 5000);
    });
  }

    async initializeCodex() {
    if (!this.codex || !this.codex.stdin || !this.codex.stdin.writable) {
      throw new Error('Codex nicht bereit für initialize');
    }
    const id = this.requestId++;
    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('initialize RPC timeout'));
      }, 20000);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); this.pending.delete(id); reject(e); }
      });
      this.codex.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'codex-web-ui', version: '1.0.0' } } }) + '\n');
    });
    return result;
  }

  async send(method, params = {}, retries = 3) {
    // Manche Methoden brauchen laenger (Skills-Scan, MCP-Status)
    const timeoutMs = SLOW_METHODS.has(method) ? 60000 : 15000;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const canWrite = this.codex && this.codex.stdin && this.codex.stdin.writable;
      const waitForReady = attempt < retries && !this.ready;
      if (!canWrite || waitForReady) {
        if (attempt === retries) throw new Error('Codex nicht bereit');
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }
      try {
        const result = await new Promise((resolve, reject) => {
          const id = this.requestId++;
          const timer = setTimeout(() => {
            this.pending.delete(id);
            reject(new Error('Codex RPC timeout: ' + method));
          }, timeoutMs);
          this.pending.set(id, {
            resolve: (v) => { clearTimeout(timer); resolve(v); },
            reject: (e) => { clearTimeout(timer); this.pending.delete(id); reject(e); }
          });
          this.codex.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
        });
        return result;
      } catch (e) {
        // Deterministische RPC-Fehler (z. B. fehlende Anmeldung) nicht wiederholen
        if (e && e.rpc) throw e;
        if (attempt === retries) throw e;
        console.error(`[codex] RPC '${method}' fehlgeschlagen (Versuch ${attempt + 1}):`, e.message);
        await new Promise(r => setTimeout(r, 2000));
      }
    }
    throw new Error('Codex RPC fehlgeschlagen: ' + method);
  }

  handleCodexMessage(msg) {
    // Antwort auf unsere eigene Anfrage
    if (msg.id !== undefined && msg.id !== null && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) {
        const err = new Error(msg.error.message || 'Codex-Fehler');
        err.rpc = true;
        reject(err);
      }
      else resolve(msg.result);
      return;
    }

    // Server->Client-Request (Freigaben fuer Befehle, Dateiaenderungen, Eingaben)
    if (msg.id !== undefined && msg.id !== null && msg.method) {
      this.handleServerRequest(msg);
      return;
    }

    // Notification: alles an die SSE-Clients weitergeben (v1 "events/..." und v2-Namen)
    if (msg.method) {
      this.broadcastSSE(msg);
    }
  }

  handleServerRequest(msg) {
    const entry = {
      id: msg.id,
      method: msg.method,
      params: msg.params || {},
      at: Date.now()
    };
    this.serverRequests.set(msg.id, entry);
    console.log('[codex] Freigabe angefordert:', msg.method);
    this.broadcastSSE({
      type: 'approval',
      id: msg.id,
      method: msg.method,
      params: msg.params || {}
    });
  }

  /** Antwortet eine Freigabe-Anfrage des Codex-Servers. */
  async answerServerRequest(id, result) {
    const entry = this.serverRequests.get(id);
    if (!entry) throw new Error('Freigabe-Anfrage nicht mehr offen (id ' + id + ')');
    this.serverRequests.delete(id);
    if (!this.codex || !this.codex.stdin || !this.codex.stdin.writable) {
      throw new Error('Codex nicht erreichbar');
    }
    this.codex.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
    console.log('[codex] Freigabe beantwortet:', entry.method);
    return { ok: true, method: entry.method };
  }

  openApprovals() {
    return [...this.serverRequests.values()].map(a => ({
      id: a.id,
      method: a.method,
      at: a.at,
      summary: a.params.reason || a.params.command || a.params.title || a.method
    }));
  }

  /**
   * Ist der Codex-Server ueberhaupt nutzbar? Ohne Anmeldung kommt von api.openai.com
   * ein 401 - dann wird auf die Provider-Kette ausgewichen.
   */
  async isAuthenticated() {
    if (this.authCheckedAt && Date.now() - this.authCheckedAt < 60000) {
      return this.authenticated;
    }
    this.authCheckedAt = Date.now();
    try {
      const result = await this.send('account/read', {}, 1);
      this.authenticated = !(result && result.requiresOpenaiAuth);
      this.authReason = this.authenticated ? null : 'Nicht angemeldet - codex login auf dem Lenovo noetig';
    } catch (e) {
      this.authenticated = false;
      this.authReason = e.message;
    }
    return this.authenticated;
  }

  broadcastSSE(msg) {
    const data = `data: ${JSON.stringify(msg)}\n\n`;
    for (const client of this.sseClients) {
      try { client.write(data); } catch {}
    }
  }

  addSSEClient(res) {
    this.sseClients.add(res);
    res.write('data: {"type":"connected"}\n\n');
    // Heartbeat: haelt die Verbindung ueber Mobilfunk und lastwagen Proxys offen
    const hb = setInterval(() => {
      try { res.write(': ping\n\n'); } catch {}
    }, 15000);
    res.on('close', () => {
      clearInterval(hb);
      this.sseClients.delete(res);
    });
  }
}

const codexServer = new CodexServer();
const providerRegistry = new ProviderRegistry();
// Keys einmal vorladen, damit der erste Aufruf nicht auf den Vault warten muss
providerRegistry.ensureKeys().catch(() => {});

/* --------------------------------------------------------------
   Agent-Harness (ohne Abo): Freigaben fuer Schreibbefehle
   -------------------------------------------------------------- */
const harnessApprovals = new Map();
let harnessApprovalSeq = 1;

function requestHarnessApproval(request) {
  const id = 'harness-' + (harnessApprovalSeq++);
  return new Promise((resolve) => {
    harnessApprovals.set(id, resolve);
    codexServer.broadcastSSE({ type: 'approval', id, method: 'harness/tool', params: request });
    const timer = setTimeout(() => {
      if (harnessApprovals.has(id)) {
        harnessApprovals.delete(id);
        resolve('decline');
      }
    }, 10 * 60 * 1000);
    harnessApprovals.set(id, (decision) => { clearTimeout(timer); resolve(decision); });
    console.log('[harness] Freigabe angefordert:', id, request.reason);
  });
}

const harness = new Harness({
  providers: providerRegistry,
  memory,
  approvalGate: requestHarnessApproval,
  emit: async (event) => { codexServer.broadcastSSE(event); }
});

const HARNESS_SYSTEM_PROMPT = `Du bist der Codex-Agent auf dem Rechner von Sascha (Windows).
Arbeitsverzeichnis: ${join(homedir(), '')}
Du hast Werkzeuge: read_file, list_dir, write_file, run_command, search_wissen.
Nutze Werkzeuge, um wirklich zu arbeiten, statt zu behaupten, etwas getan zu haben.
Schreibbefehle und Shell-Kommandos werden vom Benutzer freigegeben - warte auf die Freigabe, wenn sie verlangt wird.
Antworte auf Deutsch, sachlich und kurz. Zitiere Pfade konkret.`;

/* --------------------------------------------------------------
   HTTP Server
   -------------------------------------------------------------- */
const httpServer = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  /* --- Health --- */
  if (path === '/api/health') {
    try {
      await memory.ensureInit();
    } catch (e) {
      memory.lastError = e.message;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      ok: true,
      codex: !!codexServer.codex,
      memory: memory.sessionId ? (memory.lastError ? 'error' : 'ok') : 'init',
      memoryError: memory.lastError || null,
      memoryLastOk: memory.lastOkAt || null,
      uptime: Math.round(process.uptime())
    }));
  }

  /* --- SSE Events --- */
  if (path === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });
    codexServer.addSSEClient(res);
    return;
  }

  /* --- Modelle (Codex-Liste; mit ?provider= kommt die Provider-Liste) --- */
  if (path === '/api/models' && req.method === 'GET' && !url.searchParams.get('provider')) {
    try {
      const result = await codexServer.send('model/list');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(result));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: e.message, items: [] }));
    }
  }

  /* --- Threads liste --- */
  if (path === '/api/threads' && req.method === 'GET') {
    try {
      const result = await codexServer.send('thread/list');
      const raw = (result && (result.data || result.threads)) || [];
      const list = Array.isArray(raw) ? raw : [];
      const threads = list.map(t => ({
        id: t.id,
        name: t.name || null,
        title: t.name || (t.preview ? String(t.preview).split('\n')[0].slice(0, 90) : 'Ohne Titel'),
        preview: t.preview ? String(t.preview).slice(0, 400) : '',
        model: t.model || null,
        provider: t.modelProvider || null,
        createdAt: t.createdAt || null,
        updatedAt: t.updatedAt || null,
        path: t.path || null,
        cwd: t.cwd || null
      }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ threads, count: threads.length, data: threads }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: e.message, threads: [], count: 0 }));
    }
  }

  /* --- Thread lesen (Verlauf mit Turns und Items) --- */
  const threadRoute = path.match(/^\/api\/threads\/([A-Za-z0-9\-]+)(?:\/([a-zA-Z]+))?$/);
  if (threadRoute && req.method === 'GET') {
    const threadId = threadRoute[1];
    const sub = threadRoute[2] || 'turns';
    try {
      if (sub === 'turns') {
        const result = await codexServer.send('thread/turns/list', { threadId, limit: 50 });
        const turns = (result && result.data) || [];
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ turns, count: turns.length, nextCursor: result?.nextCursor || null }));
      }
      if (sub === 'items') {
        const result = await codexServer.send('thread/items/list', { threadId, limit: 100 });
        const items = (result && result.data) || [];
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ items, count: items.length, nextCursor: result?.nextCursor || null }));
      }
      if (sub === 'goal') {
        const result = await codexServer.send('thread/goal/get', { threadId });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(result || {}));
      }
      if (sub === 'approvals') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ approvals: codexServer.openApprovals() }));
      }
      if (sub === 'read') {
        const result = await codexServer.send('thread/read', { threadId });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(result || {}));
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Unbekannte Thread-Aktion: ' + sub }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: e.message, turns: [], items: [] }));
    }
  }

  /* --- Thread-Aktionen (Steer, Name, Archiv, Löschen, Fork, Goal) --- */
  if (threadRoute && req.method === 'POST') {
    const threadId = threadRoute[1];
    const sub = threadRoute[2];
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        let result = null;
        if (sub === 'steer') {
          result = await codexServer.send('turn/steer', {
            threadId,
            input: [{ type: 'text', text: payload.text || payload.input || '' }],
            expectedTurnId: payload.expectedTurnId
          });
        } else if (sub === 'name') {
          result = await codexServer.send('thread/name/set', { threadId, name: payload.name || '' });
        } else if (sub === 'archive') {
          result = await codexServer.send('thread/archive', { threadId });
        } else if (sub === 'delete') {
          result = await codexServer.send('thread/delete', { threadId });
        } else if (sub === 'fork') {
          result = await codexServer.send('thread/fork', { threadId });
        } else if (sub === 'goal') {
          result = await codexServer.send('thread/goal/set', {
            threadId,
            objective: payload.objective || payload.text || '',
            tokenBudget: payload.tokenBudget
          });
        } else if (sub === 'resume') {
          result = await codexServer.send('thread/resume', { threadId });
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Unbekannte Thread-Aktion: ' + sub }));
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: true, result }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  /* --- Thread erstellen + Turn starten --- */
  if (path === '/api/threads' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { model, approvalPolicy, cwd, prompt, provider } = JSON.parse(body || '{}');

        // Ohne angemeldetes Codex-Konto (oder auf Wunsch) ueber die Provider-Kette laufen
        const codexUsable = await codexServer.isAuthenticated();
        const useProvider = provider && provider !== 'codex' ? true : !codexUsable;
        if (!useProvider) {
          try {
            const started = await codexServer.send('thread/start', {
              model: model || undefined,
              cwd: cwd || undefined,
              approvalPolicy: approvalPolicy || undefined
            });
            const thread = (started && started.thread) || started;
            if (prompt && thread && thread.id) {
              await codexServer.send('turn/start', {
                threadId: thread.id,
                input: [{ type: 'text', text: prompt }]
              });
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ ...thread, id: thread?.id || null }));
          } catch (e) {
            console.error('[threads] Codex-Pfad nicht verfuegbar, weiche auf Provider um:', e.message);
          }
        }

        // Provider-Kette: Antwort streamen und als turnCompleted melden
        const order = provider && provider !== 'auto' ? [provider] : ['free', 'openrouter'];
        let answer = '';
        let usedProvider = null;
        let usedModel = null;
        let lastError = null;
        for (const id of order) {
          try {
            const out = await providerRegistry.chatStream(id, {
              model,
              messages: [{ role: 'user', content: prompt || '' }],
              onDelta: (text) => {
                answer += text;
                codexServer.broadcastSSE({ type: 'delta', provider: id, text });
              }
            });
            usedProvider = out.provider;
            usedModel = out.model;
            break;
          } catch (e) {
            lastError = e;
            console.error('[provider:' + id + ']', e.message);
          }
        }
        if (!usedProvider) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: lastError ? lastError.message : 'Kein Provider erreichbar' }));
        }
        codexServer.broadcastSSE({ type: 'turnCompleted', params: { turn: { text: answer } } });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          id: 'local-' + Date.now(),
          title: (prompt || '').slice(0, 60),
          name: (prompt || '').slice(0, 60),
          model: usedModel,
          provider: usedProvider,
          local: true,
          answer
        }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  /* --- Freigaben (Codex fragt den Server, der Server fragt die UI) --- */
  if (path === '/api/approve' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { id, approval_id, decision, answers } = JSON.parse(body || '{}');
        const requestId = id ?? approval_id;
        if (requestId === undefined || requestId === null) {
          throw new Error('Freigabe-ID fehlt');
        }
        // Harness-Freigaben (id: "harness-1") laufen ueber den eigenen Mechanismus
        if (typeof requestId === 'string' && requestId.startsWith('harness-')) {
          const pending = harnessApprovals.get(requestId);
          if (!pending) throw new Error('Freigabe-Anfrage nicht mehr offen: ' + requestId);
          harnessApprovals.delete(requestId);
          pending(decision || 'decline');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: true, method: 'harness/tool' }));
        }
        const result = answers
          ? { answers }
          : { decision: decision || 'decline' };
        const out = await codexServer.answerServerRequest(requestId, result);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(out));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  /* --- Interrupt --- */
  if (path === '/api/interrupt' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { thread_id, threadId } = JSON.parse(body || '{}');
        await codexServer.send('turn/interrupt', { threadId: thread_id || threadId });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  /* --- Info (fuer Kopfzeile und Handy-Ansicht) --- */
  if (path === '/api/info' && req.method === 'GET') {
    const info = {
      name: 'Codex Web UI',
      version: '1.1.0',
      host: hostname(),
      urls: {
        local: `http://127.0.0.1:${PORT}`,
        tailscale: `http://${process.env.TAILSCALE_IP || '100.68.210.112'}:${PORT}`
      },
      stationUrl: STATION_URL,
      vaultBase: VAULT_WEB_BASE,
      memory: { host: MEMORY_HOST, port: MEMORY_PORT },
      providerOrder: PROVIDERS.map(p => ({ id: p.id, name: p.name, tier: p.tier })),
      primary: 'free',
      startedAt: Math.round(Date.now() - process.uptime() * 1000)
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(info));
  }

  /* --- Provider (FreeLLMAPI -> OpenRouter -> Codex-Abo) --- */
  if (path === '/api/providers' && req.method === 'GET') {
    try {
      const providers = await providerRegistry.status();
      const account = await codexServer.send('account/read', {}).catch(() => null);
      const codexProvider = providers.find(p => p.id === 'codex');
      if (codexProvider) {
        const needsAuth = account && account.requiresOpenaiAuth;
        codexProvider.ready = !needsAuth;
        codexProvider.needsAuth = Boolean(needsAuth);
        codexProvider.reason = needsAuth
          ? 'Nicht angemeldet - codex login auf dem Lenovo noetig'
          : null;
        codexProvider.account = (account && account.account) || null;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        providers,
        primary: 'free',
        fallback: ['free', 'openrouter', 'codex'],
        count: providers.length
      }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: e.message, providers: [] }));
    }
  }

  if (path === '/api/models' && req.method === 'GET' && url.searchParams.get('provider')) {
    const providerId = url.searchParams.get('provider') || 'codex';
    try {
      if (providerId === 'codex') {
        const result = await codexServer.send('model/list', {});
        const list = (result && result.data) || [];
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          provider: 'codex',
          models: list.map(m => ({
            id: m.id || m.model,
            name: m.displayName || m.name || m.id || m.model,
            description: m.description || null,
            free: false
          })),
          count: list.length
        }));
      }
      const out = await providerRegistry.models(providerId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(out));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: e.message, models: [] }));
    }
  }

  /* --- Direkte Frage an einen Provider (ohne Codex-Thread), optional gestreamt --- */
  if (path === '/api/chat' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      let payload = {};
      try {
        payload = JSON.parse(body || '{}');
        const { provider, model, prompt, messages, temperature, maxTokens, stream } = payload;
        const msgList = messages && messages.length
          ? messages
          : [{ role: 'user', content: prompt || '' }];
        if (!msgList.length || !msgList[0].content) throw new Error('Leere Frage');

        const wanted = provider || 'auto';
        const order = wanted === 'auto' ? ['free', 'openrouter'] : [wanted];

        // Agent-Modus: Modell darf Werkzeuge benutzen (ohne Abo moeglich)
        if (payload.agent) {
          const agentProvider = wanted === 'auto' ? 'free' : wanted;
          const agentModel = model || null;
          if (stream) {
            res.writeHead(200, {
              'Content-Type': 'text/event-stream; charset=utf-8',
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive'
            });
            const send = (obj) => {
              try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch {}
              codexServer.broadcastSSE(obj);
            };
            send({ type: 'chatStart', provider: agentProvider, model: agentModel, agent: true });
            try {
              const out = await harness.run({
                provider: agentProvider,
                model: agentModel,
                messages: msgList,
                system: HARNESS_SYSTEM_PROMPT,
                temperature
              });
              send({
                type: 'done',
                provider: out.provider,
                model: out.model,
                answer: out.answer,
                tools: out.tools,
                iterations: out.iterations
              });
            } catch (e) {
              console.error('[harness]', e.message);
              send({ type: 'error', error: e.message });
            }
            return res.end();
          }
          const out = await harness.run({
            provider: agentProvider,
            model: agentModel,
            messages: msgList,
            system: HARNESS_SYSTEM_PROMPT,
            temperature
          });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify(out));
        }

        if (stream) {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
          });
          const send = (obj) => {
            const line = `data: ${JSON.stringify(obj)}\n\n`;
            try { res.write(line); } catch {}
            codexServer.broadcastSSE(obj);
          };
          send({ type: 'chatStart', provider: wanted, model: model || null });

          let lastError = null;
          let done = false;
          for (const id of order) {
            if (done) break;
            try {
              const out = await providerRegistry.chatStream(id, {
                model,
                messages: msgList,
                temperature,
                maxTokens,
                onDelta: (text) => send({ type: 'delta', provider: id, text })
              });
              send({ type: 'done', provider: out.provider, model: out.model, answer: out.answer });
              done = true;
            } catch (e) {
              lastError = e;
              console.error('[provider:' + id + ']', e.message);
              send({ type: 'providerError', provider: id, error: e.message });
            }
          }
          if (!done) send({ type: 'error', error: lastError ? lastError.message : 'Kein Provider erreichbar' });
          return res.end();
        }

        let lastError = null;
        for (const id of order) {
          try {
            const out = await providerRegistry.chat(id, { model, messages: msgList, temperature, maxTokens });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify(out));
          } catch (e) {
            lastError = e;
            console.error('[provider:' + id + ']', e.message);
          }
        }
        res.writeHead(502, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: lastError ? lastError.message : 'Kein Provider erreichbar' }));
      } catch (e) {
        if (!res.headersSent) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: e.message }));
        }
        try { res.write(`data: ${JSON.stringify({ type: 'error', error: e.message })}\n\n`); } catch {}
        return res.end();
      }
    });
    return;
  }

  /* --- Werkzeuge: MCP-Server + agent-memory --- */
  if (path === '/api/mcp' && req.method === 'GET') {
    const servers = listMcpServers();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      servers,
      memory: {
        name: 'agent-memory',
        host: MEMORY_HOST,
        port: MEMORY_PORT,
        status: memory.lastError ? 'error' : (memory.sessionId ? 'ok' : 'init'),
        error: memory.lastError || null,
        lastOk: memory.lastOkAt || null
      },
      count: servers.length,
      source: 'codex-config'
    }));
  }

  /* --- Skills (lokal aus ~/.agents/skills) --- */
  if (path === '/api/skills' && req.method === 'GET') {
    const skills = listSkills();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      skills,
      count: skills.length,
      source: 'agents-skills'
    }));
  }

  /* --- Konto und Limits --- */
  if (path === '/api/account' && req.method === 'GET') {
    const account = await codexServer.send('account/read', {}).catch(e => ({ error: e.message }));
    const limits = await codexServer.send('account/rateLimits/read', {}).catch(e => ({ error: e.message }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      account: account.account || null,
      requiresOpenaiAuth: account.requiresOpenaiAuth ?? null,
      rateLimits: limits || null,
      accountError: account.error || null
    }));
  }

  /* --- Dateibaum im Arbeitsverzeichnis --- */
  if (path === '/api/fs' && req.method === 'GET') {
    const target = url.searchParams.get('path') || '';
    try {
      const result = await codexServer.send('fs/readDirectory', { path: target });
      const entries = (result && (result.entries || result.data)) || [];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        path: target,
        entries: entries.map(e => ({
          name: e.name,
          path: e.path || (target ? target + '/' + e.name : e.name),
          kind: e.kind || (e.isDirectory ? 'dir' : 'file'),
          size: e.size ?? null
        })),
        count: entries.length
      }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: e.message, entries: [] }));
    }
  }

  if (path === '/api/fs/file' && req.method === 'GET') {
    const target = url.searchParams.get('path') || '';
    try {
      const result = await codexServer.send('fs/readFile', { path: target });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        path: target,
        content: result?.content ?? result?.text ?? '',
        encoding: result?.encoding || 'utf-8'
      }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: e.message, content: '' }));
    }
  }

  /* --- Wissen (Memory-MCP über Homeserver) --- */
  if (path === '/api/wissen' && req.method === 'GET') {
    try {
      const q = url.searchParams.get('q') || '';
      const limit = parseInt(url.searchParams.get('limit') || '8');
      const project = url.searchParams.get('project') || 'central-station';

      if (!q) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ results: [], info: 'Keine Abfrage' }));
      }

      let items = [];
      try {
        items = await memory.recall(q, project, limit);
        // Projektfilter kann alles ausschliessen -> ohne Filter erneut versuchen
        if (!items.length && project) {
          const withoutProject = await memory.recall(q, '', limit).catch(() => []);
          if (withoutProject.length) items = withoutProject;
        }
      } catch (mcpErr) {
        console.error('[memory-mcp] ' + mcpErr.message);
        items = [];
      }

      const results = items.map(it => ({
        path: it.path || it.pfad || null,
        url: it.path ? `${VAULT_WEB_BASE}/${String(it.path).replace(/^\/+/, '')}` : null,
        title: it.titel || it.title || it.name || 'Ohne Titel',
        snippet: String(it.text || it.description || it.content || '').slice(0, 280),
        text: it.text || it.description || it.content || '',
        project: it.projekt || it.project || project || 'global',
        category: it.kategorie || it.category || null,
        author: it.autor || it.author || null,
        tags: it.tags || [],
        created: it.erstellt || it.created || null,
        score: it.score || 0
      }));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ results, count: results.length, query: q, project, stationUrl: STATION_URL }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: e.message, results: [] }));
    }
  }

  /* --- Statische Dateien --- */
  let filePath = join(PUBLIC_DIR, path === '/' ? 'index.html' : path);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  if (!existsSync(filePath)) {
    res.writeHead(404);
    return res.end('Not Found');
  }

  const ext = extname(filePath);
  res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
  res.end(readFileSync(filePath));
});

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Codex Web UI running at http://0.0.0.0:${PORT}`);
});