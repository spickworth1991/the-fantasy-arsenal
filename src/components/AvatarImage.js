"use client";

import { useEffect, useMemo, useState } from "react";
import { toSlug } from "../utils/slugify";

/**
 * AvatarImage
 * Supports TWO usage styles:
 *
 * 1) Name-based (Player Stock style):
 *    <AvatarImage name="Josh Allen" />
 *    -> tries:
 *       /avatars/josh-allen.webp
 *       /avatars/josh-allen.jpg
 *       fallbackSrc
 *
 * 2) Explicit src (Trade Calc / API route style):
 *    <AvatarImage src="/api/avatar/josh-allen" fallbackSrc="/avatars/default.webp" alt="Josh Allen" />
 */
export default function AvatarImage({
  name,
  playerId,
  src: srcProp,
  fallbackSrc = "/avatars/default.webp",
  alt,
  width = 24,
  height = 24,
  className = "",
  loading = "lazy",
  decoding = "async",
  ...rest
}) {
  const numericPlayerId =
    playerId != null && /^\d+$/.test(String(playerId).trim())
      ? String(playerId).trim()
      : "";

  const derived = useMemo(() => {
    if (srcProp) return { primary: srcProp, secondary: null };
    if (numericPlayerId) {
      const slug = name ? toSlug(name) : "";
      return {
        primary: `https://sleepercdn.com/content/nfl/players/thumb/${numericPlayerId}.jpg`,
        secondary: slug ? `/avatars/${slug}.webp` : fallbackSrc,
        tertiary: slug ? `/avatars/${slug}.jpg` : fallbackSrc,
      };
    }
    if (name) {
      const slug = toSlug(name);
      return {
        primary: `/avatars/${slug}.webp`,
        secondary: `/avatars/${slug}.jpg`, // <-- Sleeper download script writes these
        tertiary: fallbackSrc,
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

  return (
    <img
      src={src}
      alt={derivedAlt}
      width={width}
      height={height}
      className={className}
      onError={handleError}
      loading={loading}
      decoding={decoding}
      {...rest}
    />
  );
}
