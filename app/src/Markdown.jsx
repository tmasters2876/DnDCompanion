import React from 'react';

// Tiny renderer for the compendium's markdown subset: **bold**, *italic*,
// bullet lists, ### headings, and pipe tables. No dependency, no HTML injection.

function inline(text, key) {
  const parts = [];
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let last = 0, m, i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(m[1] != null
      ? <strong key={`${key}-${i++}`}>{m[1]}</strong>
      : <em key={`${key}-${i++}`}>{m[2]}</em>);
    last = re.lastIndex;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export default function Markdown({ text }) {
  if (!text) return null;
  const blocks = String(text).split(/\n{2,}/);
  return blocks.map((block, bi) => {
    const lines = block.split('\n').filter((l) => l.trim() !== '');
    if (!lines.length) return null;

    if (lines.every((l) => l.trim().startsWith('|'))) {
      const rows = lines.map((l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
      const sepIdx = rows.findIndex((r) => r.every((c) => /^:?-+:?$/.test(c)));
      const head = sepIdx > 0 ? rows[0] : null;
      const body = rows.filter((_, i) => i !== sepIdx && (head ? i !== 0 : true));
      return (
        <table className="mdtable" key={bi}>
          {head && <thead><tr>{head.map((h, i) => <th key={i}>{inline(h, `${bi}h${i}`)}</th>)}</tr></thead>}
          <tbody>
            {body.map((r, ri) => <tr key={ri}>{r.map((c, ci) => <td key={ci}>{inline(c, `${bi}r${ri}c${ci}`)}</td>)}</tr>)}
          </tbody>
        </table>
      );
    }

    if (lines.every((l) => /^\s*-\s+/.test(l))) {
      return (
        <ul key={bi}>
          {lines.map((l, i) => <li key={i}>{inline(l.replace(/^\s*-\s+/, ''), `${bi}l${i}`)}</li>)}
        </ul>
      );
    }

    const h = /^(#{1,4})\s+(.*)$/.exec(lines[0]);
    if (h && lines.length === 1) {
      const Tag = `h${Math.min(h[1].length + 2, 6)}`;
      return <Tag key={bi}>{inline(h[2], `${bi}h`)}</Tag>;
    }

    return <p key={bi}>{lines.map((l, i) => (
      <React.Fragment key={i}>{i > 0 && <br />}{inline(l, `${bi}p${i}`)}</React.Fragment>
    ))}</p>;
  });
}
