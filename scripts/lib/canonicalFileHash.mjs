import fs from "fs";
import crypto from "crypto";

const hash = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");

export const canonicalText = (value) =>
  String(value ?? "").replace(/\r\n?/g, "\n");

export const canonicalFileSha256 = (file) =>
  hash(canonicalText(fs.readFileSync(file, "utf8")));

export const equivalentTextFileHashes = (file) => {
  const normalized = canonicalText(fs.readFileSync(file, "utf8"));
  return new Set([
    hash(normalized),
    hash(normalized.replace(/\n/g, "\r\n")),
  ]);
};

export const frozenTextHashMatches = (file, expected) =>
  Boolean(expected) && equivalentTextFileHashes(file).has(String(expected));
