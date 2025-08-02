import React, { useMemo } from "react";

export default function BackgroundParticles() {
  const particles = useMemo(() => {
    return Array.from({ length: 12 }).map(() => ({
      size: Math.random() * 75 + 90, // 90–165px
      left: Math.random() * 100, // Random horizontal position
      top: Math.random() * 100, // Random vertical position
      duration: Math.random() * 7 + 2, // 2–9s
      delay: Math.random() * 7, // 0–7s
    }));
  }, []); // ✅ Memoize so this runs only once

  return (
    <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
      {particles.map((p, i) => (
        <svg
          key={i}
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 512 512"
          fill="none"
          stroke="white"
          strokeWidth="12"
          className="absolute opacity-10 animate-float"
          style={{
            width: `${p.size}px`,
            height: `${p.size}px`,
            top: `${p.top}%`,
            left: `${p.left}%`,
            animationDuration: `${p.duration}s`,
            animationDelay: `${p.delay}s`,
          }}
        >
          <path
            d="M100 256c50-90 260-90 312 0-50 90-260 90-312 0z"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* Football shape */}
          <line x1="180" y1="256" x2="332" y2="256" />
          <line x1="210" y1="236" x2="210" y2="276" />
          <line x1="240" y1="236" x2="240" y2="276" />
          <line x1="270" y1="236" x2="270" y2="276" />
          <line x1="300" y1="236" x2="300" y2="276" />
        </svg>
      ))}
    </div>
  );
}
