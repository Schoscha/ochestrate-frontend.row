/**
 * Terminal-Bloecke (nach dem Muster von Wave Terminal): benannte, persistente
 * Shell-Fenster, die weiterlaufen, wenn man die Leiste wechselt.
 *
 * Ohne native pty (kein npm, kein Build) laeuft die Shell ueber Pipes:
 * Ausgabe wird zeilenweise gesammelt und per SSE an den Browser gegeben.
 */
import { spawn } from 'child_process';

let seq = 0;

export class TerminalManager {
  constructor({ broadcast, cwd } = {}) {
    this.panes = new Map();
    this.broadcast = broadcast || (() => {});
    this.cwd = cwd || process.cwd();
  }

  list() {
    return [...this.panes.values()].map(p => ({
      id: p.id,
      name: p.name,
      shell: p.shell,
      cwd: p.cwd,
      running: !p.exited,
      lines: p.lines.length
    }));
  }

  get(id) {
    return this.panes.get(id) || null;
  }

  create({ shell = 'powershell', cwd, name } = {}) {
    const id = 't' + (++seq);
    const isPwsh = String(shell).toLowerCase().startsWith('power');
    const cmd = isPwsh ? 'powershell.exe' : 'cmd.exe';
    const args = isPwsh ? ['-NoLogo', '-NoProfile', '-Command', '-'] : ['/Q'];
    const child = spawn(cmd, args, {
      cwd: cwd && this.pathOk(cwd) ? cwd : this.cwd,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const pane = {
      id,
      name: name || (isPwsh ? 'PowerShell' : 'CMD'),
      shell: isPwsh ? 'powershell' : 'cmd',
      cwd: cwd || this.cwd,
      child,
      lines: [],
      exited: false
    };
    this.panes.set(id, pane);

    const push = (data) => {
      const text = String(data).replace(/\r\n/g, '\n');
      pane.lines.push(text);
      if (pane.lines.length > 2000) pane.lines.splice(0, pane.lines.length - 2000);
      this.broadcast({ type: 'terminal:output', id, data: text });
    };
    child.stdout.on('data', push);
    child.stderr.on('data', push);
    child.on('exit', (code) => {
      pane.exited = true;
      this.broadcast({ type: 'terminal:exit', id, code });
    });

    push(isPwsh ? 'PowerShell bereit. Befehle eingeben und Enter druecken.\r\n' : 'CMD bereit.\r\n');
    return { id, name: pane.name, shell: pane.shell, cwd: pane.cwd, running: true, lines: 0 };
  }

  input(id, data) {
    const pane = this.panes.get(id);
    if (!pane || pane.exited) return { ok: false, error: 'Terminal nicht gefunden' };
    try {
      pane.child.stdin.write(String(data).replace(/\n/g, '\r\n') + '\r\n');
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  close(id) {
    const pane = this.panes.get(id);
    if (!pane) return { ok: false, error: 'Terminal nicht gefunden' };
    try { pane.child.kill(); } catch {}
    this.panes.delete(id);
    return { ok: true };
  }

  clear(id) {
    const pane = this.panes.get(id);
    if (!pane) return { ok: false, error: 'Terminal nicht gefunden' };
    pane.lines = [];
    this.broadcast({ type: 'terminal:clear', id });
    return { ok: true };
  }

  pathOk(target) {
    return typeof target === 'string' && target.length > 1 && !target.includes('\0');
  }

  closeAll() {
    for (const pane of this.panes.values()) {
      try { pane.child.kill(); } catch {}
    }
    this.panes.clear();
  }
}
