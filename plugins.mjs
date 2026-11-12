/**
 * Plugin-System fuer die Codex Web UI.
 *
 * Ein Plugin ist ein Ordner unter ./plugins mit einer plugin.json:
 *   {
 *     "id": "wetter",
 *     "name": "Wetter",
 *     "description": "Wetterabfrage",
 *     "version": "1.0.0",
 *     "tools": [
 *       { "name": "wetter_aktuell",
 *         "description": "Aktuelles Wetter fuer einen Ort",
 *         "command": "curl -s 'https://wttr.in/{ort}?format=3'",
 *         "parameters": { "ort": "Ort" },
 *         "approval": true }
 *     ]
 *   }
 *
 * Plugins koennen von jedem Modell geschrieben werden (Harness schreibt
 * plugin.json + Befehl), der Server laedt sie beim Start neu.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { exec } from 'node:child_process';

export class PluginRegistry {
  constructor(dir) {
    this.dir = dir;
    this.plugins = [];
    this.reload();
  }

  reload() {
    this.plugins = [];
    if (!existsSync(this.dir)) return this.plugins;
    let entries = [];
    try { entries = readdirSync(this.dir, { withFileTypes: true }); } catch { return this.plugins; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const manifest = join(this.dir, entry.name, 'plugin.json');
      if (!existsSync(manifest)) continue;
      try {
        const data = JSON.parse(readFileSync(manifest, 'utf8'));
        this.plugins.push({
          id: data.id || entry.name,
          name: data.name || entry.name,
          description: data.description || '',
          version: data.version || '0.0.0',
          author: data.author || null,
          dir: join(this.dir, entry.name),
          tools: Array.isArray(data.tools) ? data.tools : []
        });
      } catch (e) {
        this.plugins.push({
          id: entry.name, name: entry.name, description: 'Fehlerhaftes Plugin: ' + e.message,
          version: '0.0.0', dir: join(this.dir, entry.name), tools: [], broken: true
        });
      }
    }
    return this.plugins;
  }

  list() {
    return this.plugins.map(p => ({
      id: p.id,
      name: p.name,
      description: p.description,
      version: p.version,
      author: p.author,
      broken: Boolean(p.broken),
      tools: p.tools.map(t => ({
        name: t.name,
        description: t.description || '',
        parameters: t.parameters || {},
        approval: t.approval !== false
      }))
    }));
  }

  /** Werkzeug-Schemata fuer das Modell (OpenAI function-calling). */
  toolSchemas() {
    const schemas = [];
    for (const plugin of this.plugins) {
      for (const tool of plugin.tools) {
        const properties = {};
        const required = [];
        for (const [key, desc] of Object.entries(tool.parameters || {})) {
          properties[key] = { type: 'string', description: String(desc) };
          required.push(key);
        }
        schemas.push({
          type: 'function',
          function: {
            name: tool.name,
            description: `[${plugin.name}] ${tool.description || tool.name}`,
            parameters: { type: 'object', properties, required }
          }
        });
      }
    }
    return schemas;
  }

  findTool(name) {
    for (const plugin of this.plugins) {
      for (const tool of plugin.tools) {
        if (tool.name === name) return { plugin, tool };
      }
    }
    return null;
  }

  /** Fuehrt ein Plugin-Werkzeug aus. Platzhalter {name} werden ersetzt. */
  run(tool, args, cwd) {
    const command = String(tool.command || '');
    let cmd = command;
    for (const [key, value] of Object.entries(args || {})) {
      cmd = cmd.split('{' + key + '}').join(String(value));
    }
    return new Promise(resolve => {
      exec(cmd, { cwd: cwd || this.dir, timeout: 60000, maxBuffer: 100000, windowsHide: true },
        (err, stdout, stderr) => resolve({
          ok: !err,
          command: cmd,
          stdout: String(stdout || '').slice(0, 20000),
          stderr: String(stderr || '').slice(0, 4000),
          error: err ? err.message : null
        }));
    });
  }
}
