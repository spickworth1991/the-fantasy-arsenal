// src/components/FormatQBToggles.jsx
"use client";
import { useEffect, useMemo, useState } from "react";

/** Auto-detect helpers (best-effort; always user-overridable) */
function parseQBType(league) {
  const rp = (league?.roster_positions || []).map((x) => String(x || "").toUpperCase());
  const hasSF = rp.some((t) => t === "SUPER_FLEX" || t === "SUPERFLEX" || t === "Q/W/R/T");
  return hasSF ? "sf" : "1qb";
}
function defaultFormat(league, fallback = "dynasty") {
  // Sleeper doesn't expose "dynasty" vs "redraft" cleanly; keep simple
  return fallback || "dynasty";
}

/** Props:
 *  - league (optional, for autodetect)
 *  - initialFormat, initialQB (fallbacks when autodetect unavailable)
 *  - format, setFormat (controlled)
 *  - qbType, setQbType (controlled)
 */
export default function FormatQBToggles({
  league,
  initialFormat = "dynasty",
  initialQB = "sf",
  format,
  setFormat,
  qbType,
  setQbType,
}) {
  const [autoFmt, setAutoFmt] = useState(initialFormat);
  const [autoQB, setAutoQB] = useState(initialQB);

  // Recompute auto defaults when league changes
  useEffect(() => {
    if (!league) return;
    setAutoFmt(defaultFormat(league, initialFormat));
    setAutoQB(parseQBType(league));
  }, [league, initialFormat]);

  const onReset = () => {
    setFormat(autoFmt);
    setQbType(autoQB);
  };

  const Btn = ({ active, onClick, children }) => (
    <button
      onClick={onClick}
      className={`px-3 py-1 rounded border ${
        active ? "bg-white/10 border-white/20" : "border-white/10 hover:bg-white/5"
      }`}
    >
      {children}
    </button>
  );

  return (
    <div className="flex items-center gap-2">
      <span className="font-semibold">Format:</span>
      <Btn active={format === "dynasty"} onClick={() => setFormat("dynasty")}>Dynasty</Btn>
      <Btn active={format === "redraft"} onClick={() => setFormat("redraft")}>Redraft</Btn>

      <span className="font-semibold ml-3">QB:</span>
      <Btn active={qbType === "1qb"} onClick={() => setQbType("1qb")}>1QB</Btn>
      <Btn active={qbType === "sf"} onClick={() => setQbType("sf")}>Superflex</Btn>

     
    </div>
  );
}
