"use client";

const STYLES = {
  bestball: "border-amber-400/30 bg-amber-500/10 text-amber-200",
  dynasty: "border-purple-400/30 bg-purple-500/10 text-purple-200",
  keeper: "border-cyan-400/30 bg-cyan-500/10 text-cyan-200",
  redraft: "border-white/15 bg-white/5 text-gray-200",
  unknown: "border-white/15 bg-white/5 text-gray-200",
};

export default function LeagueFormatBadge({ format, compact = false, title = "" }) {
  const key = String(format?.key || "unknown").toLowerCase();
  const label = compact ? format?.shortLabel || format?.label || "—" : format?.label || "Unknown";
  const cls = STYLES[key] || STYLES.unknown;

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}
      title={title || label}
    >
      {label}
    </span>
  );
}
