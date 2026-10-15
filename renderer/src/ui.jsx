import React, { useEffect, useRef, useState } from 'react';
import { X, Box } from 'lucide-react';

export const cls = (...a) => a.filter(Boolean).join(' ');

// ---------- Block-Icons (isometrische Würfel aus Materialien) ----------
const MATERIALS = {
  grass: { top: '#6dbb4a', left: '#8a5a3a', right: '#74492e', band: ['#5ea63f', '#4f8e35'] },
  stone: { top: '#a3a3a3', left: '#858585', right: '#6d6d6d' },
  copper: { top: '#e3905f', left: '#bd6a40', right: '#9c5532', speck: '#5fc3a6' },
  deepslate: { top: '#61646d', left: '#4a4d55', right: '#3b3d44' },
  gold: { top: '#f5d763', left: '#d6ae2e', right: '#b6911f' },
  amethyst: { top: '#bd9cf3', left: '#9271d4', right: '#7759bb' },
  sand: { top: '#ebdcaa', left: '#cfbf89', right: '#b9a974' },
  snow: { top: '#f5f8fc', left: '#d7dee7', right: '#c1c9d4' },
  nether: { top: '#a64141', left: '#7f2d2d', right: '#682424' },
  oak: { top: '#c29159', left: '#9a7041', right: '#835f36', planks: true },
  ice: { top: '#b1dbf8', left: '#8bbde4', right: '#74a6cf' },
  obsidian: { top: '#45335f', left: '#2f2345', right: '#251b37', speck: '#8a6bc4' },
};

export function BlockFaces({ kind = 'grass' }) {
  const m = MATERIALS[kind] || MATERIALS.grass;
  return (
    <>
      <polygon points="16,2 30,9 16,16 2,9" fill={m.top} />
      <polygon points="2,9 16,16 16,30 2,23" fill={m.left} />
      <polygon points="30,9 16,16 16,30 30,23" fill={m.right} />
      {m.band && (
        <>
          <polygon points="2,9 16,16 16,19.5 2,12.5" fill={m.band[0]} />
          <polygon points="30,9 16,16 16,19.5 30,12.5" fill={m.band[1]} />
        </>
      )}
      {m.planks && (
        <>
          <line x1="2" y1="16" x2="16" y2="23" stroke="rgba(0,0,0,.18)" strokeWidth="0.8" />
          <line x1="30" y1="16" x2="16" y2="23" stroke="rgba(0,0,0,.18)" strokeWidth="0.8" />
        </>
      )}
      {m.speck && (
        <>
          <rect x="7" y="16" width="2.2" height="2.2" fill={m.speck} opacity=".85" />
          <rect x="22" y="20" width="2.2" height="2.2" fill={m.speck} opacity=".7" />
          <rect x="15" y="7" width="2.2" height="1.6" fill={m.speck} opacity=".7" />
        </>
      )}
      <polyline points="2,9 16,2 30,9" fill="none" stroke="rgba(255,255,255,.28)" strokeWidth="0.9" />
      <line x1="16" y1="16" x2="16" y2="30" stroke="rgba(0,0,0,.18)" strokeWidth="0.8" />
    </>
  );
}

export function BlockIcon({ kind = 'grass', size = 40 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" style={{ flex: 'none', display: 'block' }}>
      <BlockFaces kind={kind} />
    </svg>
  );
}
export const ICON_KINDS = Object.keys(MATERIALS);

/** Kräftiger Hintergrund-Verlauf je Material (für Kacheln ohne Screenshot). */
const BANDS = {
  grass: ['#2f5226', '#1a2c18'],
  stone: ['#40444a', '#24272b'],
  copper: ['#6a3a22', '#2f1d14'],
  deepslate: ['#353a44', '#1d2026'],
  gold: ['#6a5418', '#2f2812'],
  amethyst: ['#46336d', '#241c38'],
  sand: ['#5f5530', '#2c2818'],
  snow: ['#3f4a58', '#222831'],
  nether: ['#5c2121', '#2a1414'],
  oak: ['#5a3f22', '#2a2016'],
  ice: ['#264a66', '#152536'],
  obsidian: ['#33244d', '#18122a'],
};
// Dezentes Würfelmuster über dem Verlauf, damit Flächen ohne Screenshot nicht leer wirken
const CUBES =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='56' height='64'%3E%3Cpolygon points='28,0 56,16 28,32 0,16' fill='%23fff' fill-opacity='.07'/%3E%3Cpolygon points='56,16 28,32 28,64 56,48' fill='%23000' fill-opacity='.14'/%3E%3C/svg%3E\") 0 0 / 42px 48px";
export function bandFor(kind) {
  const b = BANDS[kind] || BANDS.grass;
  return `${CUBES}, linear-gradient(135deg, ${b[0]} 0%, ${b[1]} 100%)`;
}

/** Isometrisches Würfelmuster als Hintergrund (für Flächen ohne Bild). */
export function IsoPattern({ opacity = 0.16, id = 'iso' }) {
  return (
    <svg aria-hidden="true" width="100%" height="100%" style={{ position: 'absolute', inset: 0, opacity }}>
      <defs>
        <pattern id={id} width="56" height="64" patternUnits="userSpaceOnUse">
          <polygon points="28,0 56,16 28,32 0,16" fill="#6fe0b8" />
          <polygon points="0,16 28,32 28,64 0,48" fill="#1f6b52" />
          <polygon points="56,16 28,32 28,64 56,48" fill="#0e3a2c" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}


export function Logo({ size = 26 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <polygon points="16,2 30,9 16,16 2,9" fill="#6fe0b8" />
      <polygon points="2,9 16,16 16,30 2,23" fill="#2f9a75" />
      <polygon points="30,9 16,16 16,30 30,23" fill="#f0975a" />
      <polygon points="30,9 16,16 16,19.5 30,12.5" fill="#f9c191" />
    </svg>
  );
}

// ---------- Basis ----------
export function Modal({ title, sub, icon, onClose, children, footer, wide, dismissable = true }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && dismissable) onClose && onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, dismissable]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && dismissable && onClose && onClose()}>
      <div className={cls('modal', wide && 'wide')} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
        <div className="modal-head">
          {icon}
          <div className="grow">
            <h2>{title}</h2>
            {sub && <div className="muted small">{sub}</div>}
          </div>
          {dismissable && onClose && (
            <button className="btn ghost icon sm" onClick={onClose} aria-label="Schließen">
              <X size={18} />
            </button>
          )}
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Toggle({ on, onChange, label, disabled }) {
  return <button className={cls('toggle', on && 'on')} role="switch" aria-checked={Boolean(on)} aria-label={label} disabled={disabled} onClick={() => onChange(!on)} />;
}

export function Progress({ value, total, indeterminate }) {
  const pct = total ? Math.max(0, Math.min(100, (value / total) * 100)) : 0;
  const indet = indeterminate || !total;
  return (
    <div className={cls('progress', indet && 'indet')}>
      <div style={{ width: `${indet ? 30 : pct}%` }} />
    </div>
  );
}

export function Ver({ v, title }) {
  return (
    <span className="ver" title={title}>
      {v}
    </span>
  );
}

export function LoaderChip({ loader, name, version }) {
  const label = name || { vanilla: 'Vanilla', fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge' }[loader] || loader;
  return (
    <span className={cls('chip', `loader-${loader}`)} title={version ? `${label} ${version}` : label}>
      {label}
    </span>
  );
}

export function Img({ src, alt = '', className, fallback }) {
  const [err, setErr] = useState(false);
  if (!src || err) return fallback || <div className={cls('noimg', className)} style={{ display: 'grid', placeItems: 'center', color: 'var(--faint)' }}><Box size={18} /></div>;
  return <img src={src} alt={alt} className={className} onError={() => setErr(true)} loading="lazy" draggable={false} />;
}

export function Menu({ anchor, onClose, children, align = 'right' }) {
  const ref = useRef(null);
  useEffect(() => {
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    const onKey = (e) => e.key === 'Escape' && onClose();
    setTimeout(() => window.addEventListener('mousedown', onDown), 0);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);
  if (!anchor) return null;
  const r = anchor.getBoundingClientRect();
  const style = { top: r.bottom + 6 };
  if (align === 'right') style.right = Math.max(8, window.innerWidth - r.right);
  else style.left = r.left;
  return (
    <div className="menu" ref={ref} style={{ position: 'fixed', ...style }} onClick={onClose}>
      {children}
    </div>
  );
}

export function Seg({ value, onChange, options }) {
  return (
    <div className="seg" role="tablist">
      {options.map((o) => (
        <button key={o.value} className={cls(value === o.value && 'on')} onClick={() => onChange(o.value)} disabled={o.disabled} title={o.title} role="tab" aria-selected={value === o.value}>
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Spinner({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ animation: 'spin 0.9s linear infinite' }} aria-hidden="true">
      <style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" fill="none" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" />
    </svg>
  );
}

// ---------- Format ----------
export function fmtBytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / Math.pow(1024, i)).toLocaleString('de-DE', { maximumFractionDigits: i ? 1 : 0 })} ${u[i]}`;
}
export function fmtNum(n) {
  if (n >= 1e6) return `${(n / 1e6).toLocaleString('de-DE', { maximumFractionDigits: 1 })} Mio.`;
  if (n >= 1e3) return `${(n / 1e3).toLocaleString('de-DE', { maximumFractionDigits: 0 })} Tsd.`;
  return String(n || 0);
}
export function fmtPlay(sec) {
  if (!sec) return 'noch nicht gespielt';
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  if (h >= 1) return `${h} Std. ${m ? `${m} Min.` : ''}`.trim();
  return `${Math.max(1, m)} Min.`;
}
export function fmtAgo(iso) {
  if (!iso) return 'nie';
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return 'gerade eben';
  if (d < 3600) return `vor ${Math.round(d / 60)} Min.`;
  if (d < 86400) return `vor ${Math.round(d / 3600)} Std.`;
  if (d < 86400 * 2) return 'gestern';
  if (d < 86400 * 30) return `vor ${Math.round(d / 86400)} Tagen`;
  return new Date(iso).toLocaleDateString('de-DE');
}
export function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}
