'use strict';
// Kontenverwaltung: speichert Tokens verschlüsselt (Windows: DPAPI über Electron safeStorage).
const path = require('path');
const { readJson, writeJson } = require('./fsutil');
const auth = require('./auth');

class Accounts {
  /**
   * @param {object} o
   * @param {string} o.file Pfad zur accounts.json
   * @param {{encrypt:(s:string)=>string, decrypt:(s:string)=>string}} o.crypt
   * @param {() => string} o.customClientId liefert evtl. eigene Azure-Client-ID
   */
  constructor({ file, crypt, customClientId = () => '', log = () => {} }) {
    this.file = file;
    this.crypt = crypt;
    this.customClientId = customClientId;
    this.log = log;
    this._data = null;
    this._refreshing = new Map();
  }

  async load() {
    if (this._data) return this._data;
    const d = (await readJson(this.file)) || { active: null, accounts: [] };
    this._data = d;
    return d;
  }

  async save() {
    await writeJson(this.file, this._data);
  }

  _secret(acc) {
    try {
      return JSON.parse(this.crypt.decrypt(acc.secret));
    } catch {
      return null;
    }
  }

  /** Öffentliche Sicht (ohne Tokens). */
  async list() {
    const d = await this.load();
    return d.accounts.map((a) => ({
      id: a.id,
      name: a.name,
      uuid: a.uuid,
      type: a.type,
      skinUrl: a.skinUrl,
      skinVariant: a.skinVariant,
      active: a.id === d.active,
      addedAt: a.addedAt,
    }));
  }

  async active() {
    const d = await this.load();
    return d.accounts.find((a) => a.id === d.active) || d.accounts[0] || null;
  }

  async setActive(id) {
    const d = await this.load();
    if (d.accounts.some((a) => a.id === id)) {
      d.active = id;
      await this.save();
    }
  }

  async remove(id) {
    const d = await this.load();
    d.accounts = d.accounts.filter((a) => a.id !== id);
    if (d.active === id) d.active = d.accounts[0] ? d.accounts[0].id : null;
    await this.save();
  }

  async upsert(full, { activate = false } = {}) {
    const d = await this.load();
    const secret = this.crypt.encrypt(
      JSON.stringify({
        accessToken: full.accessToken,
        expiresAt: full.expiresAt,
        msRefreshToken: full.msRefreshToken,
        xuid: full.xuid,
        clientMode: full.clientMode,
        clientId: full.clientId,
      })
    );
    const entry = {
      id: full.id,
      name: full.name,
      uuid: full.uuid,
      type: full.type,
      skinUrl: full.skinUrl,
      skinVariant: full.skinVariant,
      secret,
      addedAt: (d.accounts.find((a) => a.id === full.id) || {}).addedAt || new Date().toISOString(),
    };
    const i = d.accounts.findIndex((a) => a.id === full.id);
    if (i >= 0) d.accounts[i] = entry;
    else d.accounts.push(entry);
    if (activate || !d.active) d.active = full.id;
    await this.save();
    return entry;
  }

  /** Nach Login-Fenster: Code -> Account. */
  async completeLogin(code) {
    const cfg = auth.configFor(this.customClientId());
    const ms = await auth.exchangeCode(cfg, code);
    const full = await auth.loginWithMs(cfg, ms);
    await this.upsert(full, { activate: true });
    return full;
  }

  /** Liefert ein Konto mit gültigem Minecraft-Token (erneuert bei Bedarf still). */
  async ensureValid(id) {
    const d = await this.load();
    const acc = id ? d.accounts.find((a) => a.id === id) : await this.active();
    if (!acc) throw new auth.AuthError('Kein Konto angemeldet.', 'NO_ACCOUNT');
    if (acc.type === 'offline') return { ...acc, accessToken: '0', xuid: null };
    const s = this._secret(acc);
    if (!s) throw new auth.AuthError('Gespeicherte Anmeldung ist unlesbar. Bitte neu anmelden.', 'MS_EXPIRED');
    if (s.accessToken && s.expiresAt - Date.now() > 10 * 60 * 1000) {
      return { ...acc, accessToken: s.accessToken, xuid: s.xuid };
    }
    if (this._refreshing.has(acc.id)) return this._refreshing.get(acc.id);
    const job = (async () => {
      this.log('info', `Erneuere Anmeldung für ${acc.name}`);
      const cfg = s.clientMode === 'azure' && s.clientId ? auth.azureConfig(s.clientId) : auth.configFor(this.customClientId());
      const ms = await auth.refreshMs(cfg, s.msRefreshToken);
      const full = await auth.loginWithMs(cfg, ms);
      if (!full.msRefreshToken) full.msRefreshToken = s.msRefreshToken;
      await this.upsert(full);
      return { ...full };
    })();
    this._refreshing.set(acc.id, job);
    try {
      return await job;
    } finally {
      this._refreshing.delete(acc.id);
    }
  }
}

module.exports = { Accounts };
