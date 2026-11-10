/**
 * Provider-Schicht fuer die Codex Web UI.
 *
 * Reihenfolge laut Vorgabe:
 *   1. FreeLLMAPI  (kostenlos, lokal auf dem Homeserver)
 *   2. OpenRouter  (günstig, viele Modelle)
 *   3. Codex-Abo   (schwere Aufgaben, laeuft ueber den App-Server)
 *
 * API-Schluessel kommen aus dem Vault auf dem VPS und werden nur im Speicher
 * gehalten - nie auf Platte, nie in Logs, nie in der Antwort.
 */
import { execFile } from 'node:child_process';

const SSH_HOST = process.env.KEYS_SSH_HOST || 'sascha-kruss-1';
const KEYS_SCRIPT = process.env.KEYS_SSH_SCRIPT || '/usr/local/bin/codex-web-keys.sh';
const CACHE_TTL = 15 * 60 * 1000;

export const PROVIDERS = [
  {
    id: 'free',
    name: 'FreeLLMAPI',
    tier: 1,
    baseUrl: 'http://100.87.246.36:11434/v1',
    keyEntries: ['CUSTOM_1_KEY'],
    needsAuth: false,
    note: 'Lokal auf dem Homeserver, ohne Kosten'
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    tier: 2,
    baseUrl: 'https://openrouter.ai/api/v1',
    keyEntries: ['OPENROUTER_KEY_2', 'OPENROUTER_KEY'],
    needsAuth: true,
    note: 'Günstig, 400+ Modelle'
  },
  {
    id: 'codex',
    name: 'Codex (Abo)',
    tier: 3,
    baseUrl: null,
    keyEntries: [],
    needsAuth: false,
    note: 'ChatGPT-/Codex-Abo, voller Funktionsumfang (Threads, Freigaben, Dateien)'
  }
];

/** Keys eines Providers in Reihenfolge (der erste funktionierende gewinnt). */
function keysFor(provider, keys) {
  const list = (provider.keyEntries || [])
    .map(entry => keys[entry])
    .filter(Boolean)
    .filter(k => k !== 'no-key');
  return list;
}

export class ProviderRegistry {
  constructor() {
    this.keys = {};
    this.loadedAt = 0;
    this.loading = null;
    this.modelCache = new Map();
  }

  /** Holt die Keys aus dem Vault (einmal, dann 15 Minuten Cache). */
  async ensureKeys(force = false) {
    if (!force && this.keys && Date.now() - this.loadedAt < CACHE_TTL) return this.keys;
    if (this.loading) return this.loading;

    this.loading = new Promise((resolve) => {
      execFile('ssh',
        ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', SSH_HOST, `bash ${KEYS_SCRIPT}`],
        { timeout: 60000, maxBuffer: 1024 * 1024 },
        (err, stdout) => {
          this.loading = null;
          if (err) {
            console.error('[providers] Key-Abruf fehlgeschlagen:', err.message);
            this.loadedAt = Date.now();
            return resolve(this.keys || {});
          }
          try {
            this.keys = JSON.parse(stdout);
            this.loadedAt = Date.now();
            console.log('[providers] Keys geladen:', Object.keys(this.keys).join(', '));
          } catch (e) {
            console.error('[providers] Key-Antwort unlesbar:', e.message);
            this.loadedAt = Date.now();
          }
          resolve(this.keys || {});
        });
    });

    return this.loading;
  }

  providerById(id) {
    return PROVIDERS.find(p => p.id === id) || null;
  }

  /** Status je Provider: erreichbar? Key da? */
  async status() {
    const keys = await this.ensureKeys();
    const out = [];
    for (const p of PROVIDERS) {
      if (p.id === 'codex') {
        out.push({ id: p.id, name: p.name, tier: p.tier, note: p.note, engine: 'codex-app-server', needsAuth: false, ready: true, models: null });
        continue;
      }
      const usable = keysFor(p, keys);
      out.push({
        id: p.id,
        name: p.name,
        tier: p.tier,
        note: p.note,
        engine: 'openai-compatible',
        baseUrl: p.baseUrl,
        needsAuth: p.needsAuth,
        ready: p.needsAuth ? usable.length > 0 : true,
        hasKey: usable.length > 0,
        keyCount: usable.length,
        models: null
      });
    }
    return out;
  }

  async models(providerId) {
    const p = this.providerById(providerId);
    if (!p) throw new Error('Unbekannter Provider: ' + providerId);
    if (p.id === 'codex') return { provider: p.id, models: [], engine: 'codex-app-server' };

    const cached = this.modelCache.get(p.id);
    if (cached && Date.now() - cached.at < 5 * 60 * 1000) return cached.value;

    const keys = await this.ensureKeys();
    const usable = keysFor(p, keys);
    const headers = { Accept: 'application/json' };
    if (usable.length) headers.Authorization = 'Bearer ' + usable[0];

    const res = await fetch(p.baseUrl + '/models', { headers, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`${p.name}: HTTP ${res.status}`);
    const json = await res.json();
    const models = (json.data || []).map(m => ({
      id: m.id,
      name: m.name || m.id,
      context: m.context_length || null,
      free: Boolean(m.pricing && Number(m.pricing.prompt) === 0)
    }));
    const value = { provider: p.id, models, count: models.length };
    this.modelCache.set(p.id, { at: Date.now(), value });
    return value;
  }

  /**
   * Chat ueber einen OpenAI-kompatiblen Provider.
   * Liefert { answer, provider, model, usage } oder wirft.
   */
  async chat(providerId, { model, messages, temperature = 0.4, maxTokens = 2000, signal } = {}) {
    const p = this.providerById(providerId);
    if (!p) throw new Error('Unbekannter Provider: ' + providerId);
    if (p.id === 'codex') throw new Error('Codex laeuft ueber den App-Server, nicht ueber die API-Schicht');

    const keys = await this.ensureKeys();
    const usable = keysFor(p, keys);
    if (p.needsAuth && !usable.length) throw new Error(`Kein API-Key fuer ${p.name} im Vault`);

    const chosenModel = model || (await this.models(p.id)).models[0]?.id;
    if (!chosenModel) throw new Error(`${p.name}: keine Modelle verfuegbar`);

    let lastError = null;
    for (const key of usable.length ? usable : [null]) {
      const headers = { 'Content-Type': 'application/json' };
      if (key) headers.Authorization = 'Bearer ' + key;
      try {
        const res = await fetch(p.baseUrl + '/chat/completions', {
          method: 'POST',
          headers,
          signal: signal || AbortSignal.timeout(120000),
          body: JSON.stringify({
            model: chosenModel,
            messages,
            temperature,
            max_tokens: maxTokens,
            stream: false
          })
        });
        const text = await res.text();
        if (!res.ok) {
          lastError = new Error(`${p.name}: HTTP ${res.status} ${text.slice(0, 200)}`);
          continue;
        }
        let json;
        try { json = JSON.parse(text); } catch { throw new Error(`${p.name}: unlesbare Antwort`); }
        const answer = json.choices?.[0]?.message?.content ?? json.choices?.[0]?.text ?? '';
        return {
          answer,
          provider: p.id,
          providerName: p.name,
          model: chosenModel,
          usage: json.usage || null
        };
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError || new Error(`${p.name}: keine Antwort`);
  }

  /**
   * Streaming-Variante: liefert Textbloecke ueber onDelta.
   * Der Aufrufer entscheidet, ob SSE zum Browser oder in den Codex-SSE-Kanal geht.
   */
  async chatStream(providerId, { model, messages, temperature = 0.4, maxTokens = 2000, signal, onDelta } = {}) {
    const p = this.providerById(providerId);
    if (!p) throw new Error('Unbekannter Provider: ' + providerId);
    if (p.id === 'codex') throw new Error('Codex laeuft ueber den App-Server, nicht ueber die API-Schicht');

    const keys = await this.ensureKeys();
    const usable = keysFor(p, keys);
    if (p.needsAuth && !usable.length) throw new Error(`Kein API-Key fuer ${p.name} im Vault`);

    const chosenModel = model || (await this.models(p.id)).models[0]?.id;
    if (!chosenModel) throw new Error(`${p.name}: keine Modelle verfuegbar`);

    let lastError = null;
    for (const key of usable.length ? usable : [null]) {
      const headers = { 'Content-Type': 'application/json', Accept: 'text/event-stream' };
      if (key) headers.Authorization = 'Bearer ' + key;
      try {
        const res = await fetch(p.baseUrl + '/chat/completions', {
          method: 'POST',
          headers,
          signal: signal || AbortSignal.timeout(180000),
          body: JSON.stringify({
            model: chosenModel,
            messages,
            temperature,
            max_tokens: maxTokens,
            stream: true
          })
        });
        if (!res.ok) {
          lastError = new Error(`${p.name}: HTTP ${res.status}`);
          await res.text().catch(() => {});
          continue;
        }

        let answer = '';
        const decoder = new TextDecoder();
        let buffer = '';
        for await (const chunk of res.body) {
          buffer += decoder.decode(chunk, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            const t = line.trim();
            if (!t.startsWith('data:')) continue;
            const payload = t.substring(5).trim();
            if (!payload || payload === '[DONE]') continue;
            try {
              const json = JSON.parse(payload);
              const delta = json.choices?.[0]?.delta?.content
                || json.choices?.[0]?.text
                || '';
              if (delta) {
                answer += delta;
                if (onDelta) onDelta(delta);
              }
            } catch { /* unparsbare Zeile ueberspringen */ }
          }
        }
        return { answer, provider: p.id, providerName: p.name, model: chosenModel };
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError || new Error(`${p.name}: keine Antwort`);
  }
}
