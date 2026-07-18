import React from 'react';

// Compact vector crest plus an original, generated bestiary-art cycle. The
// large paintings live in public/art so they stay crisp without bloating JSX.

export function Sigil({ className }) {
  return (
    <svg className={className} viewBox="0 0 64 64" width="30" height="30" aria-hidden="true">
      {/* d20 silhouette */}
      <polygon
        points="32,2 58,17 58,47 32,62 6,47 6,17"
        fill="#1d1a15" stroke="#c9a86a" strokeWidth="2.5" strokeLinejoin="round"
      />
      <polygon points="32,10 50,20 50,42 32,54 14,42 14,20" fill="none" stroke="#8a7549" strokeWidth="1" opacity="0.6" />
      {/* skull */}
      <ellipse cx="32" cy="30" rx="11" ry="10" fill="#c9a86a" />
      <rect x="27" y="37" width="10" height="6" rx="2" fill="#c9a86a" />
      <circle cx="27.5" cy="29" r="3.1" fill="#1d1a15" />
      <circle cx="36.5" cy="29" r="3.1" fill="#1d1a15" />
      <circle cx="27.5" cy="29" r="1.1" fill="#d34c4c" />
      <circle cx="36.5" cy="29" r="1.1" fill="#d34c4c" />
      <polygon points="32,32 34,36 30,36" fill="#1d1a15" />
      <g stroke="#1d1a15" strokeWidth="1.1">
        <line x1="29" y1="39" x2="29" y2="43" /><line x1="32" y1="39" x2="32" y2="43" /><line x1="35" y1="39" x2="35" y2="43" />
      </g>
    </svg>
  );
}

export function LichWatermark() {
  return (
    <div className="bestiary-art" aria-hidden="true">
      <img className="bestiary-artwork lich-art" src="/art/lich.jpg" alt="" />
      <img className="bestiary-artwork dragon-art" src="/art/dragon.jpg" alt="" />
      <img className="bestiary-artwork knight-art" src="/art/death-knight.jpg" alt="" />
      <span className="bestiary-rule" />
    </div>
  );
}

export default Sigil;
