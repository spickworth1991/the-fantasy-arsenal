"use client";
import { useEffect, useState } from "react";

const facts = [
  "Jerry Rice holds the record for most career touchdowns.",
  "Tom Brady has won 7 Super Bowl titles.",
  "The NFL was founded in 1920 as the APFA.",
  "The 1972 Dolphins had the only perfect season.",
  "The Chiefs have appeared in 6 Super Bowls.",
  "The longest NFL field goal is 66 yards (Justin Tucker).",
  "The NFL draft was first held in 1936.",
  "The Steelers and Patriots both have 6 Super Bowl wins.",
  "Emmitt Smith is the NFL's all-time rushing leader.",
  "Peyton Manning has 5 NFL MVP awards, the most ever.",
  "Super Bowl is the most-watched annual sporting event in the U.S.",
  "Green Bay Packers have the most NFL championships (13).",
  "Patrick Mahomes signed the biggest NFL contract in history.",
  "The first televised NFL game aired in 1939.",
  "Lamar Jackson was the youngest unanimous MVP at 22.",
  "The Dallas Cowboys are the most valuable NFL franchise.",
  "The first overtime playoff game was in 1958.",
  "There are 32 teams in the NFL, split into two conferences.",
  "Super Bowl rings can cost over $30,000 each.",
  "The Vince Lombardi Trophy is made of sterling silver.",
];

export default function LoadingScreen({ progress = 0, text = "Loading..." }) {
  const [currentFact, setCurrentFact] = useState(facts[0]);

  useEffect(() => {
    const factInterval = setInterval(() => {
      setCurrentFact(facts[Math.floor(Math.random() * facts.length)]);
    }, 3000);
    return () => clearInterval(factInterval);
  }, []);

  const runnerPosition = `${progress}%`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-3 backdrop-blur-lg sm:px-4">
      {/* Popup Card */}
      <div className="relative max-h-[92dvh] w-full max-w-xl overflow-y-auto rounded-2xl border border-gray-700 bg-gray-900 p-4 shadow-2xl sm:p-6">
        {/* NFL Image as background inside popup */}
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: "url('/nfl-loading-bg.webp')",
            backgroundSize: "cover",
            backgroundPosition: "center",
            opacity: 0.25,
          }}
        ></div>

        {/* Overlay for text clarity */}
        <div className="relative z-10 text-center">
          <h1 className="mb-5 text-2xl font-bold text-blue-400 sm:mb-6 sm:text-3xl">{text}</h1>

          {/* Progress Bar */}
          <div className="relative mb-5 h-10 w-full overflow-hidden rounded-full border-4 border-white bg-green-900 shadow-lg sm:mb-6 sm:h-12">
            {/* Yard markers */}
            {[...Array(11)].map((_, i) => (
              <div
                key={i}
                className="absolute top-0 bottom-0 w-px bg-white opacity-40"
                style={{ left: `${(i / 10) * 100}%` }}
              ></div>
            ))}

            {/* Progress fill */}
            <div
              className="absolute top-0 left-0 h-full bg-green-600 transition-all duration-300 ease-out"
              style={{ width: `${progress}%` }}
            ></div>

            {/* Runner */}
            <img
              src="/runner.webp"
              alt="Football Runner"
              className="absolute top-1/2 w-11 -translate-y-1/2 transition-all duration-300 ease-out sm:w-14"
              style={{ left: `calc(${runnerPosition} - 28px)` }}
            />
          </div>

          {/* Progress Text */}
          <p className="text-gray-200 text-lg font-semibold mb-2">{Math.floor(progress)}%</p>

          {/* NFL Fact */}
          <p className="text-gray-400 italic">{currentFact}</p>
        </div>
      </div>
    </div>
  );
}
