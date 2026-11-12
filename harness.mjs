/**
 * Agent-Harness: fuehrt ein Modell mit Werkzeugen aus.
 *
 * Zweck: die Faehigkeiten des Codex-App-Servers (Dateien lesen/schreiben,
 * Befehle ausfuehren, Wissen durchsuchen) auch ohne ChatGPT-/Codex-Abo
 * bereitstellen - mit FreeLLMAPI, OpenRouter (z. B. DeepSeek) oder jedem
 * anderen OpenAI-kompatiblen Modell, das Tool-Calling kann.
 *
 * Sicherheit:
 *   - alle Dateizugriffe bleiben innerhalb der erlaubten Wurzeln
 *   - Schreibbefehle und Kommandos brauchen eine Freigabe (approvalGate)
 *   - gefaehrliche Kommandos werden abgewiesen
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, statSync } from 'node:fs';
import { dirname, resolve, sep, isAbsolute } from 'node:path';
import { exec } from 'node:child_process';
import { homedir } from 'node:os';

const MAX_FILE_CHARS = 20000;
const MAX_CMD_OUTPUT = 200000;
const DEFAULT_ROOTS = (process.env.HARNESS_ROOTS || [
  joinSafe(homedir()),
  'C:\\Users\\Neu\\Documents',
  'C:\\Users\\Neu\\codex-web'
].join(';')).split(';').filter(Boolean);

function joinSafe(...parts) {
  return parts.join(sep);
}

/** Werkzeug-Beschreibungen im OpenAI-Format. */
export const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Liest eine Datei vom Rechner und gibt ihren Inhalt zurueck.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absoluter Pfad zur Datei' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_dir',
      description: 'Listet die Dateien und Ordner eines Verzeichnisses.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absoluter Pfad zum Verzeichnis' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Schreibt Text in eine Datei (erstellt Ordner bei Bedarf). Braucht eine Freigabe.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absoluter Pfad zur Datei' },
          content: { type: 'string', description: 'Neuer Inhalt der Datei' }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: 'Fuehrt einen Shell-Befehl aus (PowerShell/cmd). Braucht eine Freigabe.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Befehl, z. B. "dir" oder "git status"' }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_wissen',
      description: 'Sucht im gemeinsamen Agenten-Gedaechtnis (Central Station) nach Wissen.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Suchbegriff' },
          limit: { type: 'integer', description: 'Maximalzahl Treffer (Standard 5)' }
        },
        required: ['query']
      }
    }
  }
];

const FORBIDDEN_COMMAND_PATTERNS = [
  /\brm\s+-rf\b/i,
  /\bformat\s+[a-z]:/i,
  /\bdel\s+\/f\b/i,
  /remove-item\b[^\n]*-recurse[^\n]*-force/i,
  /\bdiskpart\b/i,
  /\breg\s+delete\b/i,
  /\bshutdown\b/i,
  /\bcipher\s+\/w\b/i
];

export class Harness {
  /**
   * @param {object} opts
   * @param {object} opts.providers  ProviderRegistry
   * @param {object} opts.memory     MemoryMCP-Instanz (fuer search_wissen)
   * @param {Function} opts.approvalGate  async (request) => decision
   * @param {Function} opts.emit     async (event) => void
   * @param {string[]} opts.roots    erlaubte Wurzeln
   */
  constructor({ providers, memory, approvalGate, emit, roots, extraTools, pluginRegistry } = {}) {
    this.providers = providers;
    this.memory = memory;
    this.approvalGate = approvalGate;
    this.emit = emit || (() => {});
    this.roots = (roots || DEFAULT_ROOTS).map(r => resolve(r).toLowerCase());
    this.extraTools = extraTools || (() => []);
    this.pluginRegistry = pluginRegistry || null;
    this.customTools = new Map();
  }

  /** Eigenes Werkzeug registrieren (z. B. Rowboat). */
  registerTool(name, handler) {
    this.customTools.set(name, handler);
    return this;
  }

  /** Alle Werkzeug-Schemata: Basis + eigene + Plugins. */
  toolSchemas() {
    const schemas = [...TOOLS, ...this.extraTools()];
    if (this.pluginRegistry) schemas.push(...this.pluginRegistry.toolSchemas());
    return schemas;
  }

  pathAllowed(target) {
    const p = resolve(target).toLowerCase();
    return this.roots.some(root => p === root || p.startsWith(root + sep));
  }

  checkPath(target) {
    if (!target) throw new Error('Kein Pfad angegeben');
    const p = isAbsolute(target) ? resolve(target) : resolve(this.roots[0], target);
    if (!this.pathAllowed(p)) {
      throw new Error(`Pfad ausserhalb der erlaubten Bereiche: ${p}`);
    }
    return p;
  }

  async runTool(name, rawArgs, gate) {
    const args = rawArgs && typeof rawArgs === 'string' ? safeParse(rawArgs) : (rawArgs || {});

    // eigene Werkzeuge (Rowboat, Plugins, ...)
    if (this.customTools.has(name)) {
      return this.customTools.get(name)(args, gate);
    }

    // Plugin-Werkzeuge
    if (this.pluginRegistry) {
      const found = this.pluginRegistry.findTool(name);
      if (found) {
        const tool = found.tool;
        if (tool.approval !== false) {
          const decision = await gate({
            tool: name,
            args,
            reason: `Plugin ${found.plugin.name}: ${name}`
          });
          if (decision !== 'accept' && decision !== 'acceptForSession') {
            return { ok: false, denied: true, error: 'Plugin-Aktion abgelehnt' };
          }
        }
        return this.pluginRegistry.run(tool, args, this.roots[0]);
      }
    }

    switch (name) {
      case 'read_file': {
        const p = this.checkPath(args.path);
        if (!existsSync(p)) return { ok: false, error: 'Datei nicht gefunden: ' + p };
        const stat = statSync(p);
        if (stat.isDirectory()) return { ok: false, error: 'Ist ein Ordner, keine Datei: ' + p };
        const content = readFileSync(p, 'utf8');
        return {
          ok: true,
          path: p,
          chars: content.length,
          content: content.slice(0, MAX_FILE_CHARS),
          truncated: content.length > MAX_FILE_CHARS
        };
      }
      case 'list_dir': {
        const p = this.checkPath(args.path);
        if (!existsSync(p)) return { ok: false, error: 'Ordner nicht gefunden: ' + p };
        const entries = readdirSync(p, { withFileTypes: true }).slice(0, 300).map(e => ({
          name: e.name,
          kind: e.isDirectory() ? 'dir' : 'file'
        }));
        return { ok: true, path: p, count: entries.length, entries };
      }
      case 'write_file': {
        const p = this.checkPath(args.path);
        const decision = await this.approvalGate({
          tool: 'write_file',
          args: { path: p, bytes: String(args.content || '').length },
          reason: `Datei schreiben: ${p}`
        });
        if (decision !== 'accept' && decision !== 'acceptForSession') {
          return { ok: false, denied: true, error: 'Schreiben wurde abgelehnt' };
        }
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, String(args.content ?? ''), 'utf8');
        return { ok: true, path: p, bytes: String(args.content ?? '').length };
      }
      case 'run_command': {
        const command = String(args.command || '').trim();
        if (!command) return { ok: false, error: 'Kein Befehl angegeben' };
        if (FORBIDDEN_COMMAND_PATTERNS.some(re => re.test(command))) {
          return { ok: false, error: 'Befehl ist gesperrt (potenziell destruktiv)' };
        }
        const decision = await this.approvalGate({
          tool: 'run_command',
          args: { command },
          reason: `Befehl: ${command}`
        });
        if (decision !== 'accept' && decision !== 'acceptForSession') {
          return { ok: false, denied: true, error: 'Befehl wurde abgelehnt' };
        }
        return await this.exec(command);
      }
      case 'search_wissen': {
        if (!this.memory) return { ok: false, error: 'Kein Wissensspeicher verbunden' };
        const query = String(args.query || '');
        const limit = Number(args.limit) || 5;
        const items = await this.memory.recall(query, args.project || '', limit).catch(() => []);
        return {
          ok: true,
          count: items.length,
          results: items.map(it => ({
            title: it.titel || it.title || 'Ohne Titel',
            project: it.projekt || it.project || null,
            path: it.path || null,
            snippet: String(it.text || '').slice(0, 300)
          }))
        };
      }
      default:
        return { ok: false, error: 'Unbekanntes Werkzeug: ' + name };
    }
  }

  exec(command) {
    return new Promise(resolve => {
      exec(command, {
        cwd: this.roots[0],
        timeout: 30000,
        maxBuffer: MAX_CMD_OUTPUT,
        windowsHide: true,
        env: { ...process.env, NO_COLOR: '1' }
      }, (err, stdout, stderr) => {
        resolve({
          ok: !err,
          command,
          stdout: String(stdout || '').slice(0, MAX_CMD_OUTPUT),
          stderr: String(stderr || '').slice(0, 10000),
          error: err ? err.message : null
        });
      });
    });
  }

  /**
   * Agent-Schleife: Modell -> Werkzeugaufruf -> Ergebnis -> Modell ...
   * @returns {Promise<{answer, provider, model, iterations, tools}>}
   */
  async run({ provider = 'free', model = null, messages, system, maxIterations = 8, temperature = 0.2 } = {}) {
    const history = [];
    if (system) history.push({ role: 'system', content: system });
    history.push(...messages);

    let answer = '';
    let usedProvider = provider;
    let usedModel = model;
    const toolsUsed = [];

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      const out = await this.providers.chatWithTools(usedProvider, {
        model: usedModel,
        messages: history,
        tools: this.toolSchemas(),
        temperature
      });
      usedProvider = out.provider;
      usedModel = out.model;

      if (out.content) {
        answer += out.content;
        await this.emit({ type: 'delta', provider: usedProvider, text: out.content });
      }

      if (!out.toolCalls || !out.toolCalls.length) {
        return { answer, provider: usedProvider, model: usedModel, iterations: iteration + 1, tools: toolsUsed };
      }

      history.push({ role: 'assistant', content: out.content || null, tool_calls: out.toolCalls });

      for (const call of out.toolCalls) {
        const name = call.function?.name;
        const args = safeParse(call.function?.arguments);
        await this.emit({ type: 'toolStart', tool: name, args });
        const result = await this.runTool(name, args, this.approvalGate);
        toolsUsed.push({ tool: name, ok: result.ok !== false });
        await this.emit({ type: 'toolEnd', tool: name, ok: result.ok !== false, result });
        history.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(result).slice(0, MAX_FILE_CHARS)
        });
      }
    }

    return { answer, provider: usedProvider, model: usedModel, iterations: maxIterations, tools: toolsUsed };
  }
}

function safeParse(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return {}; }
}
