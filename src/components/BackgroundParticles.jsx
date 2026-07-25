import React from "react";

const PARTICLES = Array.from({ length:12 }, (_, index) => {
  const wave = (seed) => {
    const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
    return value - Math.floor(value);
  };
  return {
    size:90 + wave(index + 1) * 75,
    left:wave(index + 11) * 100,
    top:wave(index + 23) * 100,
    duration:2 + wave(index + 37) * 7,
    delay:wave(index + 51) * 7,
  };
});

export default function BackgroundParticles() {
  return <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
    {PARTICLES.map((particle, index) => <svg
      key={index}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 512 512"
      fill="none"
      stroke="white"
      strokeWidth="12"
      className={`absolute animate-float opacity-10 ${index >= 6 ? "hidden sm:block" : ""}`}
      style={{
        width:`${particle.size}px`,
        height:`${particle.size}px`,
        top:`${particle.top}%`,
        left:`${particle.left}%`,
        animationDuration:`${particle.duration}s`,
        animationDelay:`${particle.delay}s`,
      }}
    >
      <path d="M100 256c50-90 260-90 312 0-50 90-260 90-312 0z" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="180" y1="256" x2="332" y2="256" />
      <line x1="210" y1="236" x2="210" y2="276" />
      <line x1="240" y1="236" x2="240" y2="276" />
      <line x1="270" y1="236" x2="270" y2="276" />
      <line x1="300" y1="236" x2="300" y2="276" />
    </svg>)}
  </div>;
}
