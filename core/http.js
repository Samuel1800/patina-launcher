'use strict';
// Netzwerk-Helfer: JSON-Requests mit Retry, verifizierte Downloads, Parallel-Pool.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');

const UA = 'Patina-Launcher/1.2.0';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class HttpError extends Error {
  constructor(status, url, body) {
    super(`HTTP ${status} bei ${url}${body ? `: ${String(body).slice(0, 300)}` : ''}`);
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

function isRetryable(err) {
  if (err && err.insecure) return false;
  if (err instanceof HttpError) return err.status === 429 || err.status >= 500;
  return true; // Netzwerkfehler, Timeouts
}

/** Nur verschlüsselte Verbindungen: http:// wird auf https:// gehoben, alles andere abgelehnt. */
function secureUrl(url) {
  const u = String(url || '');
  if (u.startsWith('https://')) return u;
  if (u.startsWith('http://')) return `https://${u.slice(7)}`;
  throw new Error(`Unsichere Adresse abgelehnt: ${u.slice(0, 120)}`);
}

async function request(url, opts = {}) {
  url = secureUrl(url);
  const {
    method = 'GET',
    headers = {},
    body,
    json,
    form,
    timeout = 30000,
    retries = 3,
    signal,
  } = opts;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new Error(`Timeout nach ${timeout} ms: ${url}`)), timeout);
    const onAbort = () => ctrl.abort(signal.reason);
    if (signal) {
      if (signal.aborted) throw signal.reason || new Error('Abgebrochen');
      signal.addEventListener('abort', onAbort, { once: true });
    }
    try {
      const h = { 'User-Agent': UA, ...headers };
      let payload = body;
      if (json !== undefined) {
        h['Content-Type'] = 'application/json';
        h['Accept'] = h['Accept'] || 'application/json';
        payload = JSON.stringify(json);
      } else if (form !== undefined) {
        h['Content-Type'] = 'application/x-www-form-urlencoded';
        payload = new URLSearchParams(form).toString();
      }
      const res = await fetch(url, { method, headers: h, body: payload, signal: ctrl.signal, redirect: 'follow' });
      if (res.url && !res.url.startsWith('https://')) {
        // Weiterleitung auf eine unverschlüsselte Adresse -> nicht vertrauen
        res.body && res.body.cancel().catch(() => {});
        const e = new HttpError(0, url, 'Weiterleitung auf unverschlüsselte Adresse abgelehnt');
        e.insecure = true;
        throw e;
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        const err = new HttpError(res.status, url, text);
        if (res.status === 429) {
          const ra = Number(res.headers.get('retry-after'));
          if (ra && ra < 60) await sleep(ra * 1000);
        }
        throw err;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (signal && signal.aborted) throw signal.reason || err;
      if (!isRetryable(err) || attempt === retries) throw err;
      await sleep(400 * Math.pow(2, attempt));
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  }
  throw lastErr;
}

async function getJson(url, opts = {}) {
  const res = await request(url, opts);
  const text = await res.text();
  try {
    return JSON.parse(text.replace(/^﻿/, ''));
  } catch (e) {
    throw new Error(`Ungültiges JSON von ${url}: ${e.message}`);
  }
}

async function getText(url, opts = {}) {
  const res = await request(url, opts);
  return res.text();
}

async function hashFile(file, algo = 'sha1') {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash(algo);
    const s = fs.createReadStream(file);
    s.on('error', reject);
    s.on('data', (d) => h.update(d));
    s.on('end', () => resolve(h.digest('hex')));
  });
}

function hashBuffer(buf, algo = 'sha1') {
  return crypto.createHash(algo).update(buf).digest('hex');
}

async function exists(p) {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Prüft, ob eine Datei bereits passt (Hash bzw. Größe). */
async function isValidFile(dest, { sha1, sha256, size } = {}) {
  let st;
  try {
    st = await fsp.stat(dest);
  } catch {
    return false;
  }
  if (!st.isFile()) return false;
  if (size && st.size !== size) return false;
  if (sha1) return (await hashFile(dest, 'sha1')) === sha1.toLowerCase();
  if (sha256) return (await hashFile(dest, 'sha256')) === sha256.toLowerCase();
  return st.size > 0;
}

/**
 * Lädt eine Datei herunter (atomar über .part-Datei), prüft Hash/Größe.
 * urls: string oder Array (Fallback-Mirrors).
 */
async function download(urls, dest, opts = {}) {
  const { sha1, sha256, size, onProgress, signal, retries = 3, skipIfValid = true, timeout = 60000, headers } = opts;
  const list = Array.isArray(urls) ? urls.filter(Boolean) : [urls];
  if (skipIfValid && (await isValidFile(dest, { sha1, sha256, size }))) return { skipped: true };
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  let lastErr;
  for (const url of list) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      const tmp = `${dest}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.part`;
      try {
        const res = await request(url, { timeout, retries: 0, signal, headers });
        const total = Number(res.headers.get('content-length')) || size || 0;
        const h1 = sha1 ? crypto.createHash('sha1') : null;
        const h256 = sha256 ? crypto.createHash('sha256') : null;
        let received = 0;
        await new Promise((resolve, reject) => {
          const out = fs.createWriteStream(tmp);
          const src = Readable.fromWeb(res.body);
          let lastEmit = 0;
          src.on('data', (chunk) => {
            received += chunk.length;
            if (h1) h1.update(chunk);
            if (h256) h256.update(chunk);
            const now = Date.now();
            if (onProgress && (now - lastEmit > 120 || received === total)) {
              lastEmit = now;
              onProgress(received, total);
            }
          });
          src.on('error', reject);
          out.on('error', reject);
          out.on('finish', resolve);
          src.pipe(out);
        });
        if (size && received !== size) throw new Error(`Größe stimmt nicht (${received} statt ${size}): ${url}`);
        if (h1) {
          const got = h1.digest('hex');
          if (got !== sha1.toLowerCase()) throw new Error(`SHA1 stimmt nicht für ${path.basename(dest)} (${got} statt ${sha1})`);
        }
        if (h256) {
          const got = h256.digest('hex');
          if (got !== sha256.toLowerCase()) throw new Error(`SHA256 stimmt nicht für ${path.basename(dest)}`);
        }
        await fsp.rename(tmp, dest).catch(async (e) => {
          // Windows: Ziel evtl. gesperrt -> kopieren
          if (e.code === 'EPERM' || e.code === 'EEXIST') {
            await fsp.copyFile(tmp, dest);
            await fsp.rm(tmp, { force: true });
          } else throw e;
        });
        if (onProgress) onProgress(received, received);
        return { skipped: false, bytes: received };
      } catch (err) {
        lastErr = err;
        await fsp.rm(tmp, { force: true }).catch(() => {});
        if (signal && signal.aborted) throw signal.reason || err;
        if (err instanceof HttpError && err.status === 404) break; // nächster Mirror
        if (attempt < retries) await sleep(500 * Math.pow(2, attempt));
      }
    }
  }
  throw lastErr || new Error(`Download fehlgeschlagen: ${list[0]}`);
}

/** Führt fn für alle items mit begrenzter Parallelität aus. */
async function pool(items, concurrency, fn) {
  const results = new Array(items.length);
  let idx = 0;
  let firstErr = null;
  const workers = new Array(Math.min(concurrency, items.length || 1)).fill(0).map(async () => {
    while (idx < items.length && !firstErr) {
      const i = idx++;
      try {
        results[i] = await fn(items[i], i);
      } catch (e) {
        firstErr = firstErr || e;
      }
    }
  });
  await Promise.all(workers);
  if (firstErr) throw firstErr;
  return results;
}

module.exports = { UA, HttpError, request, getJson, getText, download, pool, hashFile, hashBuffer, exists, isValidFile, sleep };
