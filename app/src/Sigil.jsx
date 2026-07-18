import React from 'react';

// Original artwork, drawn as SVG for this app: a small skull-die crest for the
// header, and a large lich watermark that haunts the page corner. No external
// assets; everything is ours.

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
    <svg className="lich-watermark" viewBox="0 0 400 620" aria-hidden="true">
      <defs>
        <radialGradient id="lichGlow" cx="50%" cy="30%" r="60%">
          <stop offset="0%" stopColor="#d34c4c" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#d34c4c" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="robe" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#26211c" />
          <stop offset="100%" stopColor="#0e0c0a" />
        </linearGradient>
      </defs>

      {/* staff */}
      <rect x="316" y="120" width="9" height="440" rx="4" fill="#1c1712" />
      <circle cx="320" cy="104" r="22" fill="none" stroke="#6b5a34" strokeWidth="5" />
      <circle cx="320" cy="104" r="9" fill="#d34c4c" opacity="0.85" />
      <circle cx="320" cy="104" r="30" fill="url(#lichGlow)" />

      {/* crown */}
      <g fill="#6b5a34">
        <polygon points="150,86 162,44 176,86" />
        <polygon points="178,84 192,36 206,84" />
        <polygon points="208,86 222,44 234,86" />
        <rect x="146" y="82" width="92" height="12" rx="3" />
      </g>

      {/* hood + skull */}
      <path d="M120 210 Q118 96 192 88 Q266 96 264 210 L242 196 Q240 130 192 124 Q144 130 142 196 Z" fill="url(#robe)" />
      <ellipse cx="192" cy="168" rx="46" ry="50" fill="#b9a67c" />
      <path d="M154 196 h76 v18 q-38 14 -76 0 Z" fill="#b9a67c" />
      {/* eye sockets with glow */}
      <ellipse cx="174" cy="164" rx="12" ry="13" fill="#151109" />
      <ellipse cx="210" cy="164" rx="12" ry="13" fill="#151109" />
      <circle cx="174" cy="166" r="4.5" fill="#d34c4c" />
      <circle cx="210" cy="166" r="4.5" fill="#d34c4c" />
      <circle cx="174" cy="166" r="11" fill="url(#lichGlow)" />
      <circle cx="210" cy="166" r="11" fill="url(#lichGlow)" />
      <polygon points="192,176 198,190 186,190" fill="#151109" />
      <g stroke="#151109" strokeWidth="2.6">
        <line x1="176" y1="202" x2="176" y2="212" />
        <line x1="186" y1="203" x2="186" y2="214" />
        <line x1="197" y1="203" x2="197" y2="214" />
        <line x1="207" y1="202" x2="207" y2="212" />
      </g>
      {/* cheek shading */}
      <path d="M150 158 q6 22 20 30 q-16 2 -24 -12 Z" fill="#8f7d57" opacity="0.7" />
      <path d="M234 158 q-6 22 -20 30 q16 2 24 -12 Z" fill="#8f7d57" opacity="0.7" />

      {/* shoulders and robe */}
      <path d="M90 620 Q84 300 150 236 Q170 220 192 220 Q214 220 234 236 Q300 300 296 620 Z" fill="url(#robe)" />
      {/* robe folds */}
      <g stroke="#332b22" strokeWidth="4" fill="none" opacity="0.8">
        <path d="M150 268 Q140 420 148 612" />
        <path d="M192 252 Q192 430 192 616" />
        <path d="M234 268 Q246 420 238 612" />
      </g>
      {/* tattered hem */}
      <path d="M90 620 l18 -26 14 24 16 -30 16 28 18 -24 16 26 18 -30 16 28 14 -24 18 26 16 -28 16 30 V 620 Z" fill="#0b0a08" />

      {/* skeletal hand on staff */}
      <g fill="#b9a67c">
        <rect x="296" y="286" width="34" height="9" rx="4" transform="rotate(-12 296 286)" />
        <rect x="298" y="300" width="36" height="9" rx="4" transform="rotate(-4 298 300)" />
        <rect x="298" y="314" width="34" height="9" rx="4" transform="rotate(4 298 314)" />
        <rect x="296" y="328" width="30" height="9" rx="4" transform="rotate(12 296 328)" />
      </g>
    </svg>
  );
}

export default Sigil;
