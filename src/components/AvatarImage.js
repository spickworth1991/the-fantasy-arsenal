"use client";
import { toSlug } from "../utils/slugify";
import { useState } from "react";

export default function AvatarImage({ name, width = 24, height = 24, className = "" }) {
  const [src, setSrc] = useState(`/avatars/${toSlug(name)}.webp`);

  const handleError = () => {
    setSrc("/avatars/default.webp");
  };

  return (
    <img
      src={src}
      alt={name}
      width={width}
      height={height}
      className={className}
      onError={handleError}
      loading="lazy"
      decoding="async"
    />
  );
}
