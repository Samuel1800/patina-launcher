import React, { useEffect, useState } from 'react';
import { call } from '../store.jsx';
import { Modal, Spinner } from '../ui.jsx';

const ALLOWED = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'UL', 'OL', 'LI', 'B', 'STRONG', 'I', 'EM', 'A', 'BR', 'CODE', 'IMG', 'BLOCKQUOTE', 'HR']);

/** Erlaubt nur einfache Textauszeichnung; alles andere wird entfernt. */
function sanitize(html) {
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  const walk = (node) => {
    for (const el of [...node.children]) {
      if (!ALLOWED.has(el.tagName)) {
        if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'FORM'].includes(el.tagName)) {
          el.remove();
          continue;
        }
        walk(el);
        el.replaceWith(...el.childNodes);
        continue;
      }
      for (const a of [...el.attributes]) {
        const keep = (el.tagName === 'A' && a.name === 'href' && /^https:\/\//.test(a.value)) || (el.tagName === 'IMG' && a.name === 'src' && /^https:\/\//.test(a.value));
        if (!keep) el.removeAttribute(a.name);
      }
      if (el.tagName === 'A') {
        el.setAttribute('target', '_blank');
        el.setAttribute('rel', 'noreferrer');
      }
      walk(el);
    }
  };
  walk(doc.body);
  return doc.body.innerHTML;
}

export default function PatchNotesModal({ entry, onClose }) {
  const [body, setBody] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    call('patchNote', entry.contentPath)
      .then((d) => setBody(sanitize(d.body)))
      .catch((e) => setErr(e.message));
  }, [entry.contentPath]);
  return (
    <Modal wide title={entry.title.replace('Minecraft: ', '')} sub={new Date(entry.date).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' })} onClose={onClose}>
      {entry.image && <img src={entry.image} alt="" style={{ width: '100%', maxHeight: 260, objectFit: 'cover', borderRadius: 12, marginBottom: 14 }} />}
      {err && <div className="hint-box">Patchnotes konnten nicht geladen werden: {err}</div>}
      {!body && !err && (
        <div className="row muted">
          <Spinner /> Lade Patchnotes …
        </div>
      )}
      {body && <div className="prose patch" dangerouslySetInnerHTML={{ __html: body }} />}
    </Modal>
  );
}
