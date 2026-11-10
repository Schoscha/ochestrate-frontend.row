/**
 * Lokales Inventar: Skills und MCP-Server direkt aus dem Dateisystem.
 *
 * Grund: Der Codex-App-Server (Alpha) beantwortet "skills/list" und
 * "mcpServerStatus/list" nicht. Der Server liest deshalb selbst:
 *   - Skills aus dem Verzeichnis ~/.agents/skills (je Unterordner eine SKILL.md, Frontmatter: name, description)
 *   - MCP-Server aus ~/.codex/config.toml (Abschnitt [mcp_servers.NAME])
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const AGENTS_SKILLS_DIR = process.env.SKILLS_DIR || join(homedir(), '.agents', 'skills');
const CODEX_CONFIG = process.env.CODEX_CONFIG || join(homedir(), '.codex', 'config.toml');

function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const mm = line.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
    if (mm) out[mm[1]] = mm[2].replace(/^["']|["']$/g, '').trim();
  }
  return out;
}

/** Skills aus ~/.agents/skills sammeln (max. Tiefe 2, max. 300 Eintraege). */
export function listSkills(dir = AGENTS_SKILLS_DIR) {
  const skills = [];
  if (!existsSync(dir)) return skills;

  const walk = (current, depth) => {
    if (depth > 2 || skills.length >= 300) return;
    let entries = [];
    try { entries = readdirSync(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (skills.length >= 300) return;
      if (!entry.isDirectory()) continue;
      const full = join(current, entry.name);
      const skillFile = join(full, 'SKILL.md');
      if (existsSync(skillFile)) {
        try {
          const text = readFileSync(skillFile, 'utf8');
          const fm = parseFrontmatter(text);
          skills.push({
            id: entry.name,
            name: fm.name || entry.name,
            description: fm.description || null,
            path: full,
            file: skillFile,
            source: 'agents-skills'
          });
        } catch { /* Datei nicht lesbar - ueberspringen */ }
      }
      walk(full, depth + 1);
    }
  };

  walk(dir, 0);
  return skills;
}

/** MCP-Server aus der Codex-Konfiguration lesen. */
export function listMcpServers(configPath = CODEX_CONFIG) {
  const servers = [];
  if (!existsSync(configPath)) return servers;

  let text = '';
  try { text = readFileSync(configPath, 'utf8'); } catch { return servers; }

  let current = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    const section = line.match(/^\[mcp_servers\.([^\.\]]+)\]$/);
    if (section) {
      current = { name: section[1], url: null, command: null, args: [], enabled: true };
      servers.push(current);
      continue;
    }
    if (/^\[/.test(line)) { current = null; continue; }
    if (!current) continue;

    const kv = line.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*=\s*(.+)$/);
    if (!kv) continue;
    const key = kv[1];
    const value = kv[2].replace(/^["']|["']$/g, '').trim();
    if (key === 'url') current.url = value;
    else if (key === 'command') current.command = value;
    else if (key === 'args') {
      try { current.args = JSON.parse(kv[2]); } catch { current.args = []; }
    } else if (key === 'enabled') current.enabled = value !== 'false';
  }

  return servers.map(s => ({
    name: s.name,
    url: s.url,
    command: s.command,
    args: s.args,
    enabled: s.enabled,
    status: s.enabled ? 'configured' : 'disabled',
    transport: s.url ? 'http' : (s.command ? 'stdio' : null)
  }));
}

/** Groesse des Skill-Verzeichnisses (fuer die Statusanzeige). */
export function skillsDirSize(dir = AGENTS_SKILLS_DIR) {
  try { return statSync(dir).isDirectory(); } catch { return false; }
}
