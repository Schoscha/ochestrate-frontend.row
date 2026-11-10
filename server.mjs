import { spawn } from 'child_process';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { extname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

// Native fetch (Node >= 18)
const fetch = globalThis.fetch.bind(globalThis);

const __dirname = resolve(fileURLToPath(import.meta.url), '..');
const PORT = process.env.PORT || 8080;
const PUBLIC_DIR = join(__dirname, 'public');
const MEMORY_HOST = process.env.MEMORY_HOST || '100.71.9.93';
const MEMORY_PORT = process.env.MEMORY_PORT || '8798';

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
    const lines = text.trim().split('\n');
    let parsed = null;
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        parsed = JSON.parse(line.substring(6));
      }
    }
    if (!parsed) throw new Error('Keine MCP-Daten');
    if (parsed.error) throw new Error(parsed.error.message);
    let result = parsed.result || parsed;
    let items = [];
    if (typeof result === 'object' && result !== null) {
      if (Array.isArray(result)) {
        items = result;
      } else if (result.content && Array.isArray(result.content)) {
        // parse inner text if needed
        const inner = result.content.map(c => {
          if (c.type === 'text' && c.text) {
            try { return JSON.parse(c.text); } catch { return null; }
          }
          return c;
        }).filter(r => r);
        items = Array.isArray(inner) ? inner : [inner];
      } else if (result.content && result.content.length === 1 && result.content[0].type === 'text') {
        try { items = [JSON.parse(result.content[0].text)]; } catch { items = [result]; }
      } else if ('items' in result && Array.isArray(result.items)) {
        items = result.items;
      } else if ('items' in result && typeof result.items === 'object') {
        // treat single object result as array item
        items = [result];
      } else {
        // treat direct result as the item(s)
        items = Array.isArray(result) ? result : [result];
      }
    }
    return items;
  }
}

const memory = new MemoryMCP();

/* --------------------------------------------------------------
   Codex App-Server
   -------------------------------------------------------------- */
class CodexServer {
  constructor() {
    this.codex = null;
    this.requestId = 1;
    this.pending = new Map();
    this.sseClients = new Set();
    this.ready = false;
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
          }, 15000);
          this.pending.set(id, {
            resolve: (v) => { clearTimeout(timer); resolve(v); },
            reject: (e) => { clearTimeout(timer); this.pending.delete(id); reject(e); }
          });
          this.codex.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
        });
        return result;
      } catch (e) {
        if (attempt === retries) throw e;
        console.error(`[codex] RPC '${method}' fehlgeschlagen (Versuch ${attempt + 1}):`, e.message);
        await new Promise(r => setTimeout(r, 2000));
      }
    }
    throw new Error('Codex RPC fehlgeschlagen: ' + method);
  }

  handleCodexMessage(msg) {
    if (msg.id && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) reject(msg.error);
      else resolve(msg.result);
    }

    if (msg.method && msg.method.startsWith('events/')) {
      this.broadcastSSE(msg);
    }
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
    res.on('close', () => this.sseClients.delete(res));
  }
}

const codexServer = new CodexServer();

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
    await memory.ensureInit();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, codex: !!codexServer.codex, memory: memory.sessionId ? 'ok' : 'init' }));
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

  /* --- Modelle --- */
  if (path === '/api/models' && req.method === 'GET') {
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
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(result));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: e.message, threads: [] }));
    }
  }

  /* --- Thread lesen --- */
  if (path.startsWith('/api/threads/') && path.endsWith('/turns') && req.method === 'GET') {
    const threadId = path.split('/')[3];
    try {
      const result = await codexServer.send('thread/read', { thread_id: threadId });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(result));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: e.message, turns: [] }));
    }
  }

  /* --- Thread erstellen + Turn starten --- */
  if (path === '/api/threads' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { model, approvalPolicy, prompt } = JSON.parse(body || '{}');
        const thread = await codexServer.send('thread/start', { model, approval_policy: approvalPolicy });
        if (prompt) await codexServer.send('turn/start', { thread_id: thread.id, prompt });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(thread));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  /* --- Approve --- */
  if (path === '/api/approve' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { thread_id, approval_id, decision } = JSON.parse(body || '{}');
        await codexServer.send('turn/approve', { thread_id, approval_id, decision });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: true }));
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
        const { thread_id } = JSON.parse(body || '{}');
        await codexServer.send('turn/interrupt', { thread_id });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
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
        const result = await memory.recall(q, project, limit);
        items = result.items || result || [];
      } catch (mcpErr) {
        console.error('[memory-mcp] ' + mcpErr.message);
        items = [];
      }

      const results = items.map(it => ({
        title: it.titel || it.title || it.name || 'Ohne Titel',
        description: it.text || it.description || it.content || '',
        project: it.projekt || it.project || project,
        score: it.score || 0
      }));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ results, count: results.length }));
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