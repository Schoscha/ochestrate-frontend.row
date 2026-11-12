/**
 * Eigener Session-Speicher (ersetzt die Codex-Threads).
 * Bewusst ohne Anbieterbindung: eine Session ist nur ein Verlauf von
 * Nachrichten, die ein beliebiger Provider beantwortet hat.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export class SessionStore {
  constructor(file) {
    this.file = file;
    this.sessions = [];
    this.load();
  }

  load() {
    try {
      if (existsSync(this.file)) this.sessions = JSON.parse(readFileSync(this.file, 'utf8'));
    } catch { this.sessions = []; }
    if (!Array.isArray(this.sessions)) this.sessions = [];
  }

  save() {
    const dir = join(this.file, '..');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.sessions, null, 2), 'utf8');
  }

  list() {
    return this.sessions
      .slice()
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .map(s => ({
        id: s.id,
        name: s.name || null,
        title: s.name || (s.messages?.[0]?.content || '').slice(0, 60) || 'Ohne Titel',
        preview: (s.messages?.[0]?.content || '').slice(0, 300),
        model: s.model || null,
        provider: s.provider || null,
        createdAt: s.createdAt || 0,
        updatedAt: s.updatedAt || 0,
        archived: Boolean(s.archived)
      }));
  }

  get(id) {
    return this.sessions.find(s => s.id === id) || null;
  }

  create({ name, model, provider } = {}) {
    const now = Math.floor(Date.now() / 1000);
    const session = {
      id: 's-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7),
      name: name || null,
      model: model || null,
      provider: provider || null,
      createdAt: now,
      updatedAt: now,
      archived: false,
      messages: []
    };
    this.sessions.push(session);
    this.save();
    return session;
  }

  addMessage(id, message) {
    const session = this.get(id);
    if (!session) return null;
    session.messages.push({ ...message, at: Math.floor(Date.now() / 1000) });
    session.updatedAt = Math.floor(Date.now() / 1000);
    if (!session.name && message.role === 'user') {
      session.name = String(message.content || '').slice(0, 60);
    }
    this.save();
    return session;
  }

  update(id, patch) {
    const session = this.get(id);
    if (!session) return null;
    Object.assign(session, patch, { updatedAt: Math.floor(Date.now() / 1000) });
    this.save();
    return session;
  }

  remove(id) {
    const before = this.sessions.length;
    this.sessions = this.sessions.filter(s => s.id !== id);
    this.save();
    return this.sessions.length < before;
  }
}
