/**
 * Rowboat-Anbindung fuer die Codex Web UI.
 *
 * Rowboat laeuft headless auf dem VPS (Port 3220, Bearer-Token in
 * /root/.rowboat/server-key) und haelt Wissen als Markdown unter
 * ~/.rowboat/knowledge (People, Projects, Meetings, ...) und Mails unter
 * ~/.rowboat/gmail_sync.
 *
 * Diese Anbindung liest Rowboat (read-only) und liefert die Funktionen:
 *   1. Wissen sammeln   -> Uebersicht Knowledge + Mails
 *   2. Kontext liefern   -> ueber den agent-memory MCP
 *   3. Gespraeche sichern-> ueber memory_remember
 *   4. Briefings schreiben -> Briefing-Markdown im Vault
 *   5. Orchestrieren    -> Task an einen Code-Agenten starten
 *   6. Ueberblick        -> Mails, Meetings, Personen, Projekte
 */
import { execFile } from 'node:child_process';

const SSH_HOST = process.env.KEYS_SSH_HOST || 'sascha-kruss-1';
const EXPORT_SCRIPT = '/usr/local/bin/codex-web-rowboat.sh';

function ssh(command, timeout = 120000) {
  return new Promise((resolve, reject) => {
    execFile('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', SSH_HOST, command],
      { timeout, maxBuffer: 32 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) return reject(new Error((stderr || err.message).toString().slice(0, 300)));
        resolve(stdout.toString());
      });
  });
}

export class Rowboat {
  constructor({ memory } = {}) {
    this.memory = memory;
    this.cache = null;
    this.cacheAt = 0;
  }

  /** Health des Rowboat-Servers (VPS-seitig, Token bleibt auf dem VPS). */
  async health() {
    try {
      const out = await ssh(
        "T=$(cat /root/.rowboat/server-key 2>/dev/null); " +
        "curl -s -m 10 -H \"Authorization: Bearer $T\" http://127.0.0.1:3220/health",
        30000
      );
      const data = JSON.parse(out);
      return { ok: Boolean(data.ok), name: data.name, apiVersion: data.apiVersion, serverVersion: data.serverVersion };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  /** Wissen + Mails (read-only aus dem Vault-Server). */
  async exportData(force = false) {
    if (!force && this.cache && Date.now() - this.cacheAt < 60000) return this.cache;
    const out = await ssh(`bash ${EXPORT_SCRIPT} >/dev/null && cat /tmp/rowboat-export.json`);
    this.cache = JSON.parse(out);
    this.cacheAt = Date.now();
    return this.cache;
  }

  /** Uebersicht: Ordnerstruktur, Mails, Meetings, Personen, Projekte. */
  async overview() {
    const [data, health] = await Promise.all([this.exportData(), this.health()]);
    const files = data.knowledge.filter(k => k.kind === 'file');
    const dirs = data.knowledge.filter(k => k.kind === 'dir').map(d => d.path);
    const topLevel = [...new Set(dirs.map(d => d.split('/')[0]))];
    const meetings = files.filter(f => f.path.toLowerCase().includes('meeting'));
    const people = files.filter(f => f.path.toLowerCase().includes('people'));
    const projects = files.filter(f => f.path.toLowerCase().includes('project'));
    return {
      connected: health.ok,
      health,
      counts: data.counts,
      topLevel,
      files,
      meetings,
      people,
      projects,
      mails: data.mails,
      mailCount: data.mails.length
    };
  }

  /** Rowboat-Wissen im gemeinsamen Index suchen (MCP). */
  async search(query, limit = 10) {
    if (!this.memory) return [];
    const items = await this.memory.recall(query, '', limit).catch(() => []);
    return items.filter(it => String(it.path || '').startsWith('rowboat/'));
  }

  /** Eine Notiz lesen (Pfad aus dem Index). */
  async readNote(path) {
    if (!this.memory) throw new Error('Kein Gedächtnis verbunden');
    return this.memory.readNote(path);
  }

  /**
   * Briefing schreiben: Markdown ins Vault legen und im Gedächtnis vermerken.
   * Gibt den Pfad zurück.
   */
  async writeBriefing({ title, text, project = 'central-station' }) {
    const safeTitle = String(title || 'Briefing').replace(/[^\w \-ÄÖÜäöüß]/g, '').slice(0, 60).trim() || 'Briefing';
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
    const rel = `20-projekte/briefings/${stamp}-${safeTitle.replace(/\s+/g, '-').toLowerCase()}.md`;
    const content = `# ${safeTitle}\n\n${String(text || '').trim()}\n`;
    await ssh(`mkdir -p /root/Second-Brain/20-projekte/briefings && cat > "/root/Second-Brain/${rel}" <<'BRIEFING_EOF'\n${content}\nBRIEFING_EOF`);
    if (this.memory && this.memory.remember) {
      await this.memory.remember({
        content: `Briefing "${safeTitle}" geschrieben: ${rel}\n\n${String(text || '').slice(0, 800)}`,
        title: safeTitle,
        category: 'note',
        project,
        author: 'codex-web-ui'
      }).catch(() => {});
    }
    return { path: rel, url: 'https://files.sascha-kruss.de/files/srv/root/Second-Brain/' + rel };
  }

  /**
   * Task an einen Code-Agenten starten (Orchestrierung).
   * Laeuft lokal auf dem Lenovo, Ergebnis landet im Log.
   */
  launchTask({ agent = 'codex', prompt, cwd }) {
    const commands = {
      codex: 'codex.cmd exec --skip-git-repo-check',
      claude: 'claude.cmd -p',
      opencode: 'opencode.cmd run'
    };
    const base = commands[agent];
    if (!base) return Promise.resolve({ ok: false, error: 'Unbekannter Agent: ' + agent });
    const shell = process.env.SHELL || 'C:\\Windows\\System32\\cmd.exe';
    const command = `${base} ${JSON.stringify(String(prompt || ''))}`;
    return new Promise(resolve => {
      execFile(shell, ['/c', command], {
        cwd: cwd || process.cwd(),
        timeout: 15 * 60 * 1000,
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true
      }, (err, stdout, stderr) => resolve({
        ok: !err,
        agent,
        command,
        stdout: String(stdout || '').slice(-8000),
        stderr: String(stderr || '').slice(-2000),
        error: err ? err.message : null
      }));
    });
  }
}
