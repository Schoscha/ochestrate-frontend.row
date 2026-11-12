import { spawn, exec } from 'child_process';
import { createServer } from 'http';
import { readFileSync, existsSync, statSync, readdirSync } from 'fs';
import { extname, join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir, hostname } from 'os';
import { ProviderRegistry } from './providers.mjs';
import { Harness, TOOLS as HARNESS_TOOLS } from './harness.mjs';
import { SessionStore } from './sessions.mjs';
import { PluginRegistry } from './plugins.mjs';
import { Rowboat } from './rowboat.mjs';
import { TerminalManager } from './terminals.mjs';
import { Layout } from './layout.mjs';
import { listSkills, listMcpServers } from './local-inventory.mjs';

const fetch = globalThis.fetch.bind(globalThis);

const __dirname = resolve(fileURLToPath(import.meta.url), '..');
const PORT = process.env.PORT || 8080;
const PUBLIC_DIR = join(__dirname, 'public');
const DATA_DIR = join(__dirname, 'data');
const PLUGINS_DIR = join(__dirname, 'plugins');
const MEMORY_HOST = process.env.MEMORY_HOST || '100.71.9.93';
const MEMORY_PORT = process.env.MEMORY_PORT || '8798';
const VAULT_WEB_BASE = process.env.VAULT_WEB_BASE || 'https://files.sascha-kruss.de/files/srv/root/Second-Brain';
const STATION_URL = process.env.STATION_URL || 'https://central.sascha-kruss.de/main/';
const TAILSCALE_IP = process.env.TAILSCALE_IP || '100.68.210.112';
const FS_ROOTS = (process.env.FS_ROOTS || [homedir(), 'C:\\Users\\Neu\\codex-web'].join(';')).split(';').filter(Boolean)
  .map(p => resolve(p).toLowerCase());

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.webmanifest': 'application/manifest+json'
};

/* ==================================================================
   Gedaechtnis (agent-memory MCP auf dem Homeserver)
   ================================================================== */
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
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1, method: 'initialize',
          params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'codex-web-ui', version: '1.2.0' } }
        })
      });
      const sid = res.headers.get('mcp-session-id');
      if (!sid) throw new Error('Keine MCP-Session-ID erhalten');
      this.sessionId = sid;
      this.initialized = true;
    })();
    return this.initPromise;
  }

  async callTool(name, args = {}, attempt = 0) {
    try {
      await this.ensureInit();
      const res = await fetch(`http://${MEMORY_HOST}:${MEMORY_PORT}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'MCP-Session-Id': this.sessionId
        },
        body: JSON.stringify({
          jsonrpc: '2.0', id: Date.now(), method: 'tools/call',
          params: { name, arguments: args }
        })
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`MCP HTTP ${res.status}: ${text.slice(0, 200)}`);
      const parsed = parseSseJson(text);
      if (!parsed) throw new Error('Keine MCP-Daten: ' + text.slice(0, 200));
      if (parsed.error) throw new Error(parsed.error.message || 'MCP-Fehler');
      if (parsed.result?.isError) {
        const c = parsed.result.content && parsed.result.content[0];
        throw new Error('MCP-Tool-Fehler: ' + (c && c.text ? String(c.text).slice(0, 200) : 'unbekannt'));
      }
      this.lastError = null;
      this.lastOkAt = Date.now();
      return extractItems(parsed);
    } catch (err) {
      this.lastError = err.message;
      if (attempt === 0) {
        this.resetSession();
        return this.callTool(name, args, 1);
      }
      throw err;
    }
  }

  async recall(query, project = '', limit = 8) {
    const items = await this.callTool('memory_recall', { query, project, limit, auch_vault: true });
    return items;
  }

  async readNote(path) {
    const items = await this.callTool('read_note', { path });
    const first = items[0];
    if (first && typeof first === 'object') return first;
    return { path, text: String(first ?? '') };
  }

  async remember({ content, title, category = 'note', project = 'central-station', author = 'codex-web-ui' }) {
    const items = await this.callTool('memory_remember', { content, title, category, project, author });
    return items[0] || { ok: true };
  }

  async stats() {
    const items = await this.callTool('memory_stats', {});
    return items[0] || {};
  }
}

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
    try { parsed = JSON.parse(payload); } catch { /* ueberspringen */ }
  }
  return parsed;
}

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
        items.push({ text: String(c.text) });
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

/* ==================================================================
   SSE-Verteilung (Browser <-> Server)
   ================================================================== */
const sseClients = new Set();
function broadcast(event) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of sseClients) {
    try { client.write(data); } catch {}
  }
}

/* ==================================================================
   Freigaben (Harness-Werkzeuge)
   ================================================================== */
const approvals = new Map();
let approvalSeq = 1;
function requestApproval(request) {
  const id = 'harness-' + (approvalSeq++);
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      if (approvals.has(id)) { approvals.delete(id); resolve('decline'); }
    }, 10 * 60 * 1000);
    approvals.set(id, decision => { clearTimeout(timer); resolve(decision); });
    broadcast({ type: 'approval', id, method: 'harness/tool', params: request });
    console.log('[freigabe] angefordert:', id, request.reason);
  });
}

/* ==================================================================
   Provider, Plugins, Sessions, Rowboat
   ================================================================== */
const providerRegistry = new ProviderRegistry();
providerRegistry.ensureKeys().catch(() => {});
const pluginRegistry = new PluginRegistry(PLUGINS_DIR);
const sessionStore = new SessionStore(join(DATA_DIR, 'sessions.json'));
const rowboat = new Rowboat({ memory });
const layout = new Layout(join(DATA_DIR, 'layout.json'));
const terminals = new TerminalManager({
  broadcast: event => broadcast(event),
  cwd: homedir()
});

const HARNESS_SYSTEM = `Du bist der Codex-Agent auf dem Rechner von Sascha (Windows).
Arbeitsverzeichnis: ${homedir()}
Werkzeuge: read_file, list_dir, write_file, run_command, search_wissen, search_rowboat, write_briefing, start_task sowie Plugins.
Nutze Werkzeuge, um wirklich zu arbeiten, statt zu behaupten, etwas getan zu haben.
Schreibbefehle, Shell-Kommandos, Briefings und Tasks werden vom Benutzer freigegeben.
Antworte auf Deutsch, sachlich und kurz. Zitiere Pfade konkret.`;

/* Werkzeuge fuer Rowboat und Plugins in den Harness einhaengen */
const harness = new Harness({
  providers: providerRegistry,
  memory,
  approvalGate: requestApproval,
  emit: async event => broadcast(event),
  pluginRegistry,
  extraTools: () => [
    {
      type: 'function',
      function: {
        name: 'search_rowboat',
        description: 'Sucht in Rowboats Wissen (Personen, Projekte, Meetings, Mails).',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string', description: 'Suchbegriff' }, limit: { type: 'integer' } },
          required: ['query']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'write_briefing',
        description: 'Schreibt ein Briefing als Markdown ins Vault. Braucht eine Freigabe.',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Titel des Briefings' },
            text: { type: 'string', description: 'Inhalt des Briefings' }
          },
          required: ['title', 'text']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'start_task',
        description: 'Startet einen Code-Agenten (codex, claude, opencode) mit einem Briefing. Braucht eine Freigabe.',
        parameters: {
          type: 'object',
          properties: {
            agent: { type: 'string', description: 'codex | claude | opencode' },
            prompt: { type: 'string', description: 'Auftrag an den Agenten' }
          },
          required: ['prompt']
        }
      }
    }
  ]
});

harness.registerTool('search_rowboat', async (args) => {
  const items = await rowboat.search(args.query, Number(args.limit) || 5);
  return { ok: true, count: items.length, results: items.map(it => ({ title: it.titel, project: it.projekt, path: it.path, snippet: String(it.text || '').slice(0, 240) })) };
});
harness.registerTool('write_briefing', async (args, gate) => {
  const decision = await gate({ tool: 'write_briefing', args: { title: args.title }, reason: `Briefing schreiben: ${args.title}` });
  if (decision !== 'accept' && decision !== 'acceptForSession') return { ok: false, denied: true, error: 'Abgelehnt' };
  const out = await rowboat.writeBriefing({ title: args.title, text: args.text });
  return { ok: true, path: out.path, url: out.url };
});
harness.registerTool('start_task', async (args, gate) => {
  const decision = await gate({ tool: 'start_task', args: { agent: args.agent }, reason: `Task starten: ${args.agent || 'codex'}` });
  if (decision !== 'accept' && decision !== 'acceptForSession') return { ok: false, denied: true, error: 'Abgelehnt' };
  const out = await rowboat.launchTask({ agent: args.agent || 'codex', prompt: args.prompt });
  return { ok: out.ok, agent: out.agent, stdout: out.stdout.slice(-4000), error: out.error };
});

/* ==================================================================
   HTTP-Server
   ================================================================== */
function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try { resolveBody(body ? JSON.parse(body) : {}); } catch (e) { rejectBody(new Error('Ungueltiges JSON')); }
    });
    req.on('error', rejectBody);
  });
}

function pathAllowed(target) {
  const p = resolve(target).toLowerCase();
  return FS_ROOTS.some(root => p === root || p.startsWith(root + '\\'));
}

const httpServer = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  try {
    /* ---------- Info / Health ---------- */
    if (path === '/api/info' && req.method === 'GET') {
      return json(res, 200, {
        name: 'Codex Web UI',
        version: '1.2.0',
        host: hostname(),
        urls: { local: `http://127.0.0.1:${PORT}`, tailscale: `http://${TAILSCALE_IP}:${PORT}` },
        stationUrl: STATION_URL,
        vaultBase: VAULT_WEB_BASE,
        memory: { host: MEMORY_HOST, port: MEMORY_PORT },
        providers: providerRegistry.constructor.name ? undefined : undefined,
        startedAt: Math.round(Date.now() - process.uptime() * 1000)
      });
    }

    if (path === '/api/health' && req.method === 'GET') {
      try { await memory.ensureInit(); } catch (e) { memory.lastError = e.message; }
      return json(res, 200, {
        ok: true,
        memory: memory.sessionId ? (memory.lastError ? 'error' : 'ok') : 'init',
        memoryError: memory.lastError || null,
        memoryLastOk: memory.lastOkAt || null,
        plugins: pluginRegistry.plugins.length,
        sessions: sessionStore.sessions.length,
        uptime: Math.round(process.uptime())
      });
    }

    /* ---------- Provider / Modelle ---------- */
    if (path === '/api/providers' && req.method === 'GET') {
      const providers = await providerRegistry.status();
      return json(res, 200, { providers, primary: 'free', fallback: ['free', 'openrouter'], count: providers.length });
    }

    if (path === '/api/models' && req.method === 'GET') {
      const providerId = url.searchParams.get('provider') || 'free';
      try {
        const out = await providerRegistry.models(providerId);
        return json(res, 200, out);
      } catch (e) {
        return json(res, 200, { provider: providerId, models: [], error: e.message });
      }
    }

    /* ---------- Chat (mit und ohne Agent) ---------- */
    if (path === '/api/chat' && req.method === 'POST') {
      const payload = await readBody(req);
      const provider = payload.provider || 'auto';
      const model = payload.model || null;
      const messages = payload.messages && payload.messages.length
        ? payload.messages
        : [{ role: 'user', content: payload.prompt || '' }];
      if (!messages[0]?.content) return json(res, 400, { error: 'Leere Frage' });

      const order = provider === 'auto' ? ['free', 'openrouter'] : [provider];

      if (payload.agent) {
        const agentProvider = provider === 'auto' ? 'free' : provider;
        if (payload.stream) {
          res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
          const send = obj => {
            try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch {}
            broadcast(obj);
          };
          send({ type: 'chatStart', provider: agentProvider, model, agent: true });
          try {
            const out = await harness.run({ provider: agentProvider, model, messages, system: HARNESS_SYSTEM, temperature: payload.temperature });
            send({ type: 'done', provider: out.provider, model: out.model, answer: out.answer, tools: out.tools, iterations: out.iterations });
          } catch (e) {
            send({ type: 'error', error: e.message });
          }
          return res.end();
        }
        const out = await harness.run({ provider: agentProvider, model, messages, system: HARNESS_SYSTEM, temperature: payload.temperature });
        return json(res, 200, out);
      }

      if (payload.stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        const send = obj => {
          try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch {}
          broadcast(obj);
        };
        send({ type: 'chatStart', provider, model });
        let lastError = null;
        for (const id of order) {
          try {
            const out = await providerRegistry.chatStream(id, {
              model, messages, temperature: payload.temperature, maxTokens: payload.maxTokens,
              onDelta: text => send({ type: 'delta', provider: id, text })
            });
            send({ type: 'done', provider: out.provider, model: out.model, answer: out.answer });
            return res.end();
          } catch (e) {
            lastError = e;
            send({ type: 'providerError', provider: id, error: e.message });
          }
        }
        send({ type: 'error', error: lastError ? lastError.message : 'Kein Provider erreichbar' });
        return res.end();
      }

      let lastError = null;
      for (const id of order) {
        try {
          const out = await providerRegistry.chat(id, { model, messages, temperature: payload.temperature, maxTokens: payload.maxTokens });
          return json(res, 200, out);
        } catch (e) { lastError = e; }
      }
      return json(res, 502, { error: lastError ? lastError.message : 'Kein Provider erreichbar' });
    }

    /* ---------- Sessions (eigener Store) ---------- */
    if (path === '/api/sessions' && req.method === 'GET') {
      const sessions = sessionStore.list();
      return json(res, 200, { sessions, count: sessions.length });
    }
    if (path === '/api/sessions' && req.method === 'POST') {
      const payload = await readBody(req);
      const session = sessionStore.create(payload);
      return json(res, 200, session);
    }
    const sessionRoute = path.match(/^\/api\/sessions\/([A-Za-z0-9\-]+)(?:\/([a-zA-Z]+))?$/);
    if (sessionRoute && req.method === 'GET') {
      const session = sessionStore.get(sessionRoute[1]);
      if (!session) return json(res, 404, { error: 'Session nicht gefunden' });
      return json(res, 200, session);
    }
    if (sessionRoute && req.method === 'POST') {
      const payload = await readBody(req);
      const sub = sessionRoute[2];
      if (sub === 'messages') {
        const session = sessionStore.addMessage(sessionRoute[1], payload);
        if (!session) return json(res, 404, { error: 'Session nicht gefunden' });
        return json(res, 200, session);
      }
      if (sub === 'rename') {
        const session = sessionStore.update(sessionRoute[1], { name: payload.name });
        return session ? json(res, 200, session) : json(res, 404, { error: 'Session nicht gefunden' });
      }
      if (sub === 'archive') {
        const session = sessionStore.update(sessionRoute[1], { archived: true });
        return session ? json(res, 200, session) : json(res, 404, { error: 'Session nicht gefunden' });
      }
      if (sub === 'delete') {
        return json(res, 200, { ok: sessionStore.remove(sessionRoute[1]) });
      }
      return json(res, 404, { error: 'Unbekannte Aktion: ' + sub });
    }

    /* ---------- Wissen (Gedaechtnis) ---------- */
    if (path === '/api/wissen' && req.method === 'GET') {
      const q = url.searchParams.get('q') || '';
      const limit = parseInt(url.searchParams.get('limit') || '8');
      const project = url.searchParams.get('project') || '';
      if (!q) return json(res, 200, { results: [], count: 0, query: q, project });
      let items = [];
      try {
        items = await memory.recall(q, project, limit);
        if (!items.length && project) items = await memory.recall(q, '', limit).catch(() => []);
      } catch (e) {
        console.error('[memory]', e.message);
        return json(res, 200, { results: [], count: 0, query: q, project, error: e.message });
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
      return json(res, 200, { results, count: results.length, query: q, project, stationUrl: STATION_URL });
    }

    if (path === '/api/memory' && req.method === 'POST') {
      const payload = await readBody(req);
      if (!payload.content) return json(res, 400, { error: 'content fehlt' });
      const out = await memory.remember(payload);
      return json(res, 200, out);
    }

    if (path === '/api/memory/stats' && req.method === 'GET') {
      return json(res, 200, await memory.stats());
    }

    /* ---------- Skills und MCP ---------- */
    if (path === '/api/skills' && req.method === 'GET') {
      const skills = listSkills();
      return json(res, 200, { skills, count: skills.length, source: 'agents-skills' });
    }
    if (path === '/api/mcp' && req.method === 'GET') {
      const servers = listMcpServers();
      return json(res, 200, {
        servers,
        memory: { name: 'agent-memory', host: MEMORY_HOST, port: MEMORY_PORT, status: memory.sessionId ? (memory.lastError ? 'error' : 'ok') : 'init', error: memory.lastError || null, lastOk: memory.lastOkAt || null },
        count: servers.length,
        source: 'codex-config'
      });
    }

    /* ---------- Plugins ---------- */
    if (path === '/api/plugins' && req.method === 'GET') {
      const plugins = pluginRegistry.list();
      return json(res, 200, { plugins, count: plugins.length });
    }
    if (path === '/api/tools' && req.method === 'GET') {
      const schemas = harness.toolSchemas();
      return json(res, 200, {
        tools: schemas.map(s => ({
          name: s.function.name,
          description: String(s.function.description || '').slice(0, 110),
          parameters: Object.keys(s.function.parameters?.properties || {})
        })),
        count: schemas.length
      });
    }
    if (path === '/api/plugins/reload' && req.method === 'POST') {
      pluginRegistry.reload();
      return json(res, 200, { ok: true, count: pluginRegistry.plugins.length });
    }

    /* ---------- Dateien ---------- */
    if (path === '/api/fs' && req.method === 'GET') {
      const target = url.searchParams.get('path') || homedir();
      if (!pathAllowed(target)) return json(res, 400, { error: 'Pfad ausserhalb der erlaubten Bereiche' });
      try {
        const entries = readdirSync(target, { withFileTypes: true })
          .filter(e => !e.name.startsWith('.'))
          .slice(0, 300)
          .map(e => {
            const full = join(target, e.name);
            let size = null;
            try { size = statSync(full).size; } catch {}
            return { name: e.name, path: full, kind: e.isDirectory() ? 'dir' : 'file', size };
          });
        return json(res, 200, { path: target, entries, count: entries.length });
      } catch (e) {
        return json(res, 500, { error: e.message, entries: [] });
      }
    }
    if (path === '/api/fs/file' && req.method === 'GET') {
      const target = url.searchParams.get('path') || '';
      if (!pathAllowed(target)) return json(res, 400, { error: 'Pfad ausserhalb der erlaubten Bereiche' });
      try {
        const content = readFileSync(target, 'utf8');
        return json(res, 200, { path: target, content: content.slice(0, 200000), encoding: 'utf-8' });
      } catch (e) {
        return json(res, 500, { error: e.message, content: '' });
      }
    }

    /* ---------- Rowboat ---------- */
    if (path === '/api/rowboat/overview' && req.method === 'GET') {
      const overview = await rowboat.overview();
      return json(res, 200, overview);
    }
    if (path === '/api/rowboat/search' && req.method === 'GET') {
      const q = url.searchParams.get('q') || '';
      const limit = parseInt(url.searchParams.get('limit') || '10');
      const results = await rowboat.search(q, limit);
      return json(res, 200, { results, count: results.length, query: q });
    }
    if (path === '/api/rowboat/note' && req.method === 'GET') {
      const notePath = url.searchParams.get('path') || '';
      const note = await rowboat.readNote(notePath);
      return json(res, 200, note);
    }
    if (path === '/api/rowboat/briefing' && req.method === 'POST') {
      const payload = await readBody(req);
      if (!payload.title || !payload.text) return json(res, 400, { error: 'title und text noetig' });
      const out = await rowboat.writeBriefing(payload);
      return json(res, 200, { ok: true, ...out });
    }
    if (path === '/api/rowboat/task' && req.method === 'POST') {
      const payload = await readBody(req);
      if (!payload.prompt) return json(res, 400, { error: 'prompt fehlt' });
      const decision = await requestApproval({ tool: 'start_task', args: { agent: payload.agent }, reason: `Task starten: ${payload.agent || 'codex'}` });
      if (decision !== 'accept' && decision !== 'acceptForSession') return json(res, 200, { ok: false, denied: true });
      const out = await rowboat.launchTask(payload);
      return json(res, 200, out);
    }

    /* ---------- Terminal-Bloecke ---------- */
    if (path === '/api/terminals' && req.method === 'GET') {
      return json(res, 200, { terminals: terminals.list(), count: terminals.list().length, grid: layout.state.grid });
    }
    if (path === '/api/terminals' && req.method === 'POST') {
      const payload = await readBody(req);
      const pane = terminals.create(payload);
      broadcast({ type: 'terminal:created', id: pane.id, name: pane.name, shell: pane.shell });
      return json(res, 200, pane);
    }
    const terminalRoute = path.match(/^\/api\/terminals\/([A-Za-z0-9\-]+)(?:\/([a-zA-Z]+))?$/);
    if (terminalRoute && req.method === 'POST') {
      const payload = await readBody(req);
      const sub = terminalRoute[2];
      if (sub === 'input') return json(res, 200, terminals.input(terminalRoute[1], payload.data ?? ''));
      if (sub === 'close') return json(res, 200, terminals.close(terminalRoute[1]));
      if (sub === 'clear') return json(res, 200, terminals.clear(terminalRoute[1]));
      return json(res, 404, { error: 'Unbekannte Terminal-Aktion: ' + sub });
    }

    /* ---------- Layout der Arbeitsflaeche ---------- */
    if (path === '/api/layout' && req.method === 'GET') {
      return json(res, 200, layout.get());
    }
    if (path === '/api/layout' && req.method === 'POST') {
      const payload = await readBody(req);
      const state = layout.set(payload);
      broadcast({ type: 'layout', layout: state });
      return json(res, 200, state);
    }
    if (path === '/api/layout/toggle' && req.method === 'POST') {
      const payload = await readBody(req);
      const state = layout.toggle(payload.panel);
      broadcast({ type: 'layout', layout: state });
      return json(res, 200, state);
    }

    /* ---------- Freigaben ---------- */
    if (path === '/api/approve' && req.method === 'POST') {
      const payload = await readBody(req);
      const id = payload.id ?? payload.approval_id;
      if (id === undefined || id === null) return json(res, 400, { error: 'Freigabe-ID fehlt' });
      const pending = approvals.get(id);
      if (!pending) return json(res, 404, { error: 'Freigabe-Anfrage nicht offen: ' + id });
      approvals.delete(id);
      pending(payload.decision || 'decline');
      return json(res, 200, { ok: true, method: 'harness/tool' });
    }

    /* ---------- SSE ---------- */
    if (path === '/api/events' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      sseClients.add(res);
      res.write('data: {"type":"connected"}\n\n');
      const hb = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 15000);
      res.on('close', () => { clearInterval(hb); sseClients.delete(res); });
      return;
    }

    /* ---------- Statische Dateien ---------- */
    const filePath = join(PUBLIC_DIR, path === '/' ? 'index.html' : path);
    if (!filePath.startsWith(PUBLIC_DIR)) return json(res, 403, { error: 'Forbidden' });
    if (!existsSync(filePath) || statSync(filePath).isDirectory()) return json(res, 404, { error: 'Not Found' });
    res.writeHead(200, { 'Content-Type': MIME_TYPES[extname(filePath)] || 'application/octet-stream' });
    res.end(readFileSync(filePath));
  } catch (e) {
    console.error('[server]', e.message);
    if (!res.headersSent) json(res, 500, { error: e.message });
    else { try { res.write(`data: ${JSON.stringify({ type: 'error', error: e.message })}\n\n`); } catch {} res.end(); }
  }
});

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Codex Web UI laeuft auf http://0.0.0.0:${PORT}`);
  console.log(`Plugins: ${pluginRegistry.plugins.length} | Sessions: ${sessionStore.sessions.length}`);
});
