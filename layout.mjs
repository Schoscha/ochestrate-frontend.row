/**
 * Layout der Arbeitsflaeche: welche Leisten sichtbar sind und wie die
 * Terminal-Flaeche aufgeteilt ist (1x1, 2x2, 2x1, 1x2).
 *
 * Das Layout liegt in data/layout.json und kann per Script gesetzt werden
 * (scripts/layout.cmd, scripts/layout.sh) - so wie bei Wave Terminal die
 * Bloecke per CLI erzeugt werden.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'path';

export const PANELS = ['wissen', 'rowboat', 'werkzeuge', 'provider', 'terminal'];
export const GRIDS = ['1x1', '2x2', '2x1', '1x2'];

const DEFAULT_LAYOUT = {
  panels: ['wissen', 'rowboat', 'werkzeuge', 'provider', 'terminal'],
  active: 'wissen',
  grid: '2x2',
  rightOpen: true,
  leftOpen: true
};

export class Layout {
  constructor(file) {
    this.file = file;
    this.state = { ...DEFAULT_LAYOUT };
    this.load();
  }

  load() {
    try {
      if (existsSync(this.file)) {
        const data = JSON.parse(readFileSync(this.file, 'utf8'));
        this.state = { ...DEFAULT_LAYOUT, ...data };
      }
    } catch { this.state = { ...DEFAULT_LAYOUT }; }
    // Sanity
    this.state.panels = (this.state.panels || []).filter(p => PANELS.includes(p));
    if (!GRIDS.includes(this.state.grid)) this.state.grid = '2x2';
    if (!PANELS.includes(this.state.active)) this.state.active = 'wissen';
    return this.state;
  }

  save() {
    const dir = dirname(this.file);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.state, null, 2), 'utf8');
    return this.state;
  }

  get() {
    return { ...this.state, available: PANELS, grids: GRIDS };
  }

  set(patch) {
    if (patch.panels) {
      const panels = Array.isArray(patch.panels) ? patch.panels : [];
      this.state.panels = panels.filter(p => PANELS.includes(p));
    }
    if (patch.active && PANELS.includes(patch.active)) this.state.active = patch.active;
    if (patch.grid && GRIDS.includes(patch.grid)) this.state.grid = patch.grid;
    if (typeof patch.rightOpen === 'boolean') this.state.rightOpen = patch.rightOpen;
    if (typeof patch.leftOpen === 'boolean') this.state.leftOpen = patch.leftOpen;
    return this.save();
  }

  toggle(panel) {
    if (!PANELS.includes(panel)) return this.get();
    const list = new Set(this.state.panels);
    if (list.has(panel)) list.delete(panel);
    else list.add(panel);
    this.state.panels = PANELS.filter(p => list.has(p));
    if (this.state.active === panel && !this.state.panels.includes(panel)) {
      this.state.active = this.state.panels[0] || 'wissen';
    }
    return this.save();
  }
}
