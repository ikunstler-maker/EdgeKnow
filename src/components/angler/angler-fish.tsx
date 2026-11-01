// A small, friendly deep-sea angler fish facing right, with the glowing lure on
// its head. Drawn here; animated by the ek-angler-* classes in globals.css.
export function AnglerFish({ swimming = false, className = "" }: { swimming?: boolean; className?: string }) {
  return (
    <svg
      viewBox="-2 -5 46 38"
      aria-hidden="true"
      className={`ek-angler ${swimming ? "ek-angler-swimming" : ""} ${className}`}
    >
      <defs>
        <linearGradient id="ek-angler-body" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8b7cf6" />
          <stop offset="1" stopColor="#3aa0e8" />
        </linearGradient>
        <radialGradient id="ek-angler-lure" cx="0.4" cy="0.4" r="0.7">
          <stop offset="0" stopColor="#fffbe6" />
          <stop offset="0.45" stopColor="#ffd36e" />
          <stop offset="1" stopColor="#ff8db4" />
        </radialGradient>
      </defs>
      <g className="ek-angler-bob">
        {/* Tail */}
        <path className="ek-angler-tail" d="M11 18 C 6 12, 2 11, 1 13 C 3 16, 3 20, 1 23 C 2 25, 6 24, 11 18 Z" fill="#6f6ae8" />
        {/* Body */}
        <ellipse cx="21" cy="18" rx="11.5" ry="10" fill="url(#ek-angler-body)" />
        <ellipse cx="23" cy="22.5" rx="7" ry="4" fill="#bfeeff" opacity="0.55" />
        {/* Side fin */}
        <path d="M17 20 C 14 23, 14 26, 17 26 C 19 25, 19 22, 17 20 Z" fill="#6f6ae8" opacity="0.9" />
        {/* Rod and lure */}
        <path d="M21 8.5 C 21 2, 29 -1.5, 34 2.5" fill="none" stroke="#5b4fd0" strokeWidth="1.3" strokeLinecap="round" />
        <circle className="ek-angler-glow" cx="34.5" cy="3.5" r="5" fill="#ffd36e" opacity="0.35" />
        <circle cx="34.5" cy="3.5" r="2.7" fill="url(#ek-angler-lure)" />
        {/* Eye */}
        <g className="ek-angler-eye">
          <circle cx="25" cy="15" r="3.8" fill="#ffffff" />
          <circle cx="26" cy="15.4" r="2" fill="#1f1b3a" />
          <circle cx="26.7" cy="14.6" r="0.7" fill="#ffffff" />
        </g>
        {/* Cheek and smile with two tiny teeth */}
        <circle cx="27.5" cy="20.5" r="1.4" fill="#ff9fc4" opacity="0.7" />
        <path d="M28.5 22.5 C 30 23.6, 31.5 23.2, 32.4 21.6" fill="none" stroke="#1f1b3a" strokeWidth="1" strokeLinecap="round" />
        <path d="M29.6 23 L 30.1 24.3 L 30.6 23.1 Z M31.2 22.8 L 31.6 23.9 L 32 22.6 Z" fill="#ffffff" />
      </g>
    </svg>
  );
}
