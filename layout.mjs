/**
 * Arbeitsflaeche im Wave-Modell: Widgets als Rects, Layouts als Presets.
 *
 * data/layout.json   -> aktuelles Layout
 * data/layouts/*.json -> Presets (Tabs: Uebersicht, T1, ...)
 *
 * Widget: { id, type, title, x, y, w, h, focus, state }
 *   x/y/w/h in Prozent (0..100) der Flaeche
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'path';

export const WIDGET_TYPES = {
  term: { title: 'Terminal', icon: 'term', needs: 'terminal' },
  files: { title: 'Dateien', icon: 'files', needs: 'fs' },
  process: { title: 'Prozesse', icon: 'process', needs: 'process' },
  web: { title: 'Web', icon: 'web', needs: 'web' },
  wissen: { title: 'Wissen', icon: 'wissen', needs: 'wissen' },
  rowboat: { title: 'Rowboat', icon: 'rowboat', needs: 'rowboat' },
  provider: { title: 'Provider', icon: 'provider', needs: 'providers' },
  chat: { title: 'Chat', icon: 'chat', needs: 'chat' }
};

export const TYPE_ORDER = Object.keys(WIDGET_TYPES);

let seq = 0;
function nextId(type) {
  seq += 1;
  return 'w-' + type + '-' + Date.now().toString(36).slice(-4) + seq;
}

/** Erstes freies Rasterfeld (4x4 zu je 25%), das kein bestehendes Widget schneidet. */
function freeSlot(widgets, w, h) {
  const cell = 25;
  const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      const cand = { x: col * cell, y: row * cell, w: Math.min(w, cell * 4 - col * cell), h: Math.min(h, cell * 4 - row * cell) };
      if (cand.w < 10 || cand.h < 8) continue;
      if (!widgets.some(existing => overlaps(cand, existing))) return { x: cand.x, y: cand.y };
    }
  }
  const n = widgets.length;
  return null;
}

/** Wenn kein Platz mehr frei ist: alle Widgets ueberlappungsfrei neu kacheln. */
function tileAll(widgets, extra) {
  const all = [...widgets, extra];
  const cols = all.length <= 4 ? 2 : all.length <= 9 ? 3 : 4;
  const rows = Math.ceil(all.length / cols);
  const cw = 100 / cols, ch = 100 / rows;
  all.forEach((w, i) => {
    w.x = Math.round((i % cols) * cw);
    w.y = Math.round(Math.floor(i / cols) * ch);
    w.w = Math.round(cw);
    w.h = Math.round(ch);
  });
}

export class Layout {
  constructor(file, dir) {
    this.file = file;
    this.dir = dir;
    this.state = { widgets: [], preset: 'uebersicht' };
    this.load();
  }

  load() {
    try {
      if (existsSync(this.file)) {
        const data = JSON.parse(readFileSync(this.file, 'utf8'));
        this.state = { widgets: [], preset: 'uebersicht', ...data };
      }
    } catch { /* defekte Datei -> leer */ }
    if (!Array.isArray(this.state.widgets)) this.state.widgets = [];
    if (!this.state.widgets.length) {
      this.state.widgets = [
        { ...this.makeWidget('chat', 0, 0, 38, 100), id: 'w-chat' },
        { ...this.makeWidget('term', 38, 0, 62, 100), id: 'w-term' }
      ];
    }
    this.state.widgets.forEach(w => { w.id = w.id || nextId(w.type); });
    return this.state;
  }

  save() {
    const dir = dirname(this.file);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.state, null, 2), 'utf8');
    return this.get();
  }

  makeWidget(type, x, y, w, h, extra = {}) {
    const def = WIDGET_TYPES[type] || { title: type };
    return {
      id: nextId(type),
      type,
      title: def.title,
      x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h),
      focus: false,
      state: {},
      ...extra
    };
  }

  get() {
    return {
      widgets: this.state.widgets,
      types: TYPE_ORDER.map(t => ({ id: t, ...WIDGET_TYPES[t] })),
      preset: this.state.preset,
      presets: this.presets()
    };
  }

  presets() {
    if (!existsSync(this.dir)) return [];
    try {
      return readdirSync(this.dir)
        .filter(f => f.endsWith('.json'))
        .map(f => f.replace(/\.json$/, ''));
    } catch { return []; }
  }

  /** Aktionen: add, remove, move, resize, focus, set, maximize */
  apply(action = {}) {
    const widgets = this.state.widgets;
    switch (action.action) {
      case 'add': {
        const w = this.makeWidget(
          action.type || 'term',
          action.x ?? 10, action.y ?? 10,
          action.w ?? 40, action.h ?? 50,
          action.title ? { title: action.title } : {},
          action.state ? { state: action.state } : {}
        );
        // Freien Platz suchen, damit sich Widgets nicht ueberlagern
        const slot = freeSlot(widgets, w.w, w.h);
        if (slot) { w.x = slot.x; w.y = slot.y; }
        else tileAll(widgets, w);
        widgets.push(w);
        this.focus(w.id);
        break;
      }
      case 'clear': {
        this.state.widgets = [
          { ...this.makeWidget('chat', 0, 0, 38, 100), id: 'w-chat' },
          { ...this.makeWidget('term', 38, 0, 62, 100), id: 'w-term' }
        ];
        this.state.preset = 'uebersicht';
        break;
      }
      case 'remove': {
        const i = widgets.findIndex(w => w.id === action.id);
        if (i >= 0) widgets.splice(i, 1);
        if (!widgets.length) widgets.push(this.makeWidget('term', 0, 0, 50, 100));
        break;
      }
      case 'move': {
        const w = widgets.find(x => x.id === action.id);
        if (w) { w.x = action.x; w.y = action.y; }
        break;
      }
      case 'resize': {
        const w = widgets.find(x => x.id === action.id);
        if (w) {
          if (typeof action.w === 'number') w.w = action.w;
          if (typeof action.h === 'number') w.h = action.h;
          if (typeof action.x === 'number') w.x = action.x;
          if (typeof action.y === 'number') w.y = action.y;
        }
        break;
      }
      case 'focus': {
        this.focus(action.id);
        break;
      }
      case 'maximize': {
        const w = widgets.find(x => x.id === action.id);
        if (w) {
          if (w.state?.maximized) {
            const prev = w.state.prev || { x: 0, y: 0, w: 40, h: 50 };
            Object.assign(w, prev);
            w.state.maximized = false;
          } else {
            w.state = { ...(w.state || {}), prev: { x: w.x, y: w.y, w: w.w, h: w.h }, maximized: true };
            w.x = 0; w.y = 0; w.w = 100; w.h = 100;
          }
        }
        break;
      }
      case 'state': {
        const w = widgets.find(x => x.id === action.id);
        if (w) w.state = { ...(w.state || {}), ...(action.state || {}) };
        break;
      }
      case 'set': {
        if (Array.isArray(action.widgets)) {
          this.state.widgets = action.widgets.map(w => ({
            ...this.makeWidget(w.type || 'term', w.x ?? 0, w.y ?? 0, w.w ?? 40, w.h ?? 50),
            ...w,
            id: w.id || nextId(w.type || 'term')
          }));
        }
        if (action.preset) this.state.preset = action.preset;
        break;
      }
      default: break;
    }
    return this.save();
  }

  focus(id) {
    for (const w of this.state.widgets) w.focus = w.id === id;
    this.state.active = id;
  }

  /* --- Presets (Tabs) --- */
  savePreset(name) {
    if (!this.dir) return { ok: false, error: 'Kein Preset-Ordner' };
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
    writeFileSync(join(this.dir, name + '.json'), JSON.stringify({ widgets: this.state.widgets }, null, 2), 'utf8');
    return { ok: true, name, presets: this.presets() };
  }

  loadPreset(name) {
    const file = join(this.dir, name + '.json');
    if (!existsSync(file)) return { ok: false, error: 'Preset nicht gefunden: ' + name };
    try {
      const data = JSON.parse(readFileSync(file, 'utf8'));
      this.state.widgets = (data.widgets || []).map(w => ({
        ...this.makeWidget(w.type || 'term', w.x ?? 0, w.y ?? 0, w.w ?? 40, w.h ?? 50),
        ...w
      }));
      this.state.preset = name;
      this.save();
      return { ok: true, name, layout: this.get() };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  deletePreset(name) {
    const file = join(this.dir, name + '.json');
    if (existsSync(file)) {
      try { writeFileSync(file + '.bak', readFileSync(file)); } catch {}
    }
    return { ok: true, presets: this.presets() };
  }
}
