'use strict';
// Aufgaben mit Fortschritt (Downloads, Installationen, Upgrades) – werden live an die UI gemeldet.
const { EventEmitter } = require('events');
const crypto = require('crypto');

class Tasks extends EventEmitter {
  constructor() {
    super();
    this.tasks = new Map();
    this._timer = null;
  }

  list() {
    return [...this.tasks.values()].map((t) => this._public(t));
  }

  _public(t) {
    return {
      id: t.id,
      title: t.title,
      instanceId: t.instanceId,
      label: t.label,
      done: t.done,
      total: t.total,
      state: t.state,
      error: t.error,
      startedAt: t.startedAt,
      cancellable: t.cancellable,
    };
  }

  _schedule() {
    if (this._timer) return;
    this._timer = setTimeout(() => {
      this._timer = null;
      this.emit('update', this.list());
    }, 120);
  }

  /**
   * Führt fn als Aufgabe aus.
   * fn({progress, signal, task})
   */
  async run(title, fn, { instanceId = null, cancellable = true, quiet = false } = {}) {
    const ctrl = new AbortController();
    const t = {
      id: crypto.randomUUID(),
      title,
      instanceId,
      label: 'Starte …',
      done: 0,
      total: 0,
      state: 'running',
      error: null,
      startedAt: Date.now(),
      cancellable,
      ctrl,
      quiet,
    };
    this.tasks.set(t.id, t);
    this._schedule();
    const progress = (p) => {
      if (!p) return;
      if (p.label) t.label = p.label;
      if (typeof p.done === 'number') t.done = p.done;
      if (typeof p.total === 'number') t.total = p.total;
      this._schedule();
    };
    try {
      const res = await fn({ progress, signal: ctrl.signal, task: t });
      t.state = 'done';
      t.label = 'Fertig';
      return res;
    } catch (e) {
      t.state = ctrl.signal.aborted ? 'cancelled' : 'error';
      t.error = ctrl.signal.aborted ? 'Abgebrochen' : e.message;
      throw e;
    } finally {
      this._schedule();
      setTimeout(() => {
        this.tasks.delete(t.id);
        this._schedule();
      }, t.state === 'error' ? 15000 : 2500);
    }
  }

  cancel(id) {
    const t = this.tasks.get(id);
    if (t && t.cancellable) t.ctrl.abort(new Error('Abgebrochen'));
  }
}

module.exports = { Tasks };
