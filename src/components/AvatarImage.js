"use client";

import { useEffect, useMemo, useState } from "react";
import { toSlug } from "../utils/slugify";

/**
 * AvatarImage
 * Supports TWO usage styles:
 *
 * 1) Name-based (Player Stock style):
 *    <AvatarImage name="Josh Allen" />
 *    -> /avatars/josh-allen.webp
 *
 * 2) Explicit src (Trade Calc / API route style):
 *    <AvatarImage src="/api/avatar/josh-allen" fallbackSrc="/avatars/default.webp" alt="Josh Allen" />
 *
 * Backwards compatible with your existing tools.
 */
export default function AvatarImage({
  name,
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
  const derivedSrc = useMemo(() => {
    if (srcProp) return srcProp;
    if (name) return `/avatars/${toSlug(name)}.webp`;
    return fallbackSrc;
  }, [srcProp, name, fallbackSrc]);

  const derivedAlt = alt ?? name ?? "Avatar";

  const [src, setSrc] = useState(derivedSrc);

  // IMPORTANT: update the img src when name/srcProp changes
  useEffect(() => {
    setSrc(derivedSrc);
  }, [derivedSrc]);

  const handleError = () => {
    // Prevent infinite loops if fallback is missing too
    setSrc((prev) => (prev === fallbackSrc ? prev : fallbackSrc));
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
