"use client";

import { useEffect, useMemo, useState } from "react";
import { parsePickLabel } from "../lib/picks";

/**
 * AvatarImage
 * Real players load from Sleeper's CDN by numeric player ID. Synthetic exact
 * draft picks use reusable, year-independent local artwork (pick-1-01.webp).
 */
export default function AvatarImage({
  name,
  playerId,
  src: srcProp,
  fallbackSrc = "/avatars/default.webp",
  alt,
  size,
  width = 24,
  height = 24,
  className = "",
  loading = "lazy",
  decoding = "async",
  inspectable = true,
  onClick,
  title,
  ...rest
}) {
  const numericPlayerId =
    playerId != null && /^\d+$/.test(String(playerId).trim())
      ? String(playerId).trim()
      : "";

  const derived = useMemo(() => {
    if (srcProp) return { primary: srcProp, secondary: null };
    if (numericPlayerId) {
      return {
        primary: `https://sleepercdn.com/content/nfl/players/thumb/${numericPlayerId}.jpg`,
        secondary: fallbackSrc,
        tertiary: null,
      };
    }
    const pick = parsePickLabel(name);
    if (pick?.kind === "exact") {
      const slot = String(pick.slot).padStart(2, "0");
      return {
        primary: `/avatars/pick-${pick.round}-${slot}.webp`,
        secondary: fallbackSrc,
        tertiary: null,
      };
    }
    return { primary: fallbackSrc, secondary: null, tertiary: null };
  }, [srcProp, numericPlayerId, name, fallbackSrc]);

  const derivedAlt = alt ?? name ?? "Avatar";
  const [src, setSrc] = useState(derived.primary);

  useEffect(() => {
    setSrc(derived.primary);
  }, [derived]);

  const handleError = () => {
    setSrc((prev) => {
      if (derived.secondary && prev === derived.primary) return derived.secondary;
      if (derived.tertiary && prev === derived.secondary) return derived.tertiary;
      if (prev !== fallbackSrc) return fallbackSrc;
      return prev;
    });
  };
  const openSourceInspector = (event) => {
    onClick?.(event);
    if (event.defaultPrevented || !inspectable || !numericPlayerId) return;
    event.preventDefault();
    event.stopPropagation();
    window.dispatchEvent(new CustomEvent("tfa:inspect-player", { detail:{ playerId:numericPlayerId } }));
  };
  const handleKeyDown = (event) => {
    if (!inspectable || !numericPlayerId || !["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    window.dispatchEvent(new CustomEvent("tfa:inspect-player", { detail:{ playerId:numericPlayerId } }));
  };

  return (
    <img
      src={src}
      alt={derivedAlt}
      width={size ?? width}
      height={size ?? height}
      className={`${className}${inspectable && numericPlayerId ? " cursor-pointer transition hover:ring-2 hover:ring-cyan-300/40" : ""}`}
      onError={handleError}
      loading={loading}
      decoding={decoding}
      onClick={openSourceInspector}
      onKeyDown={handleKeyDown}
      role={inspectable && numericPlayerId ? "button" : undefined}
      tabIndex={inspectable && numericPlayerId ? 0 : undefined}
      title={inspectable && numericPlayerId ? `View all sources for ${derivedAlt}` : title}
      {...rest}
    />
  );
}
