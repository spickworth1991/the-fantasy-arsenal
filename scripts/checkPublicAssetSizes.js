import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = path.join(root, "public");
const cloudflareLimit = 25 * 1024 * 1024;
const oversized = [];

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(file);
    else {
      const bytes = fs.statSync(file).size;
      if (bytes > cloudflareLimit) oversized.push({ file, bytes });
    }
  }
}

if (fs.existsSync(publicRoot)) walk(publicRoot);

if (oversized.length) {
  const details = oversized
    .map(({ file, bytes }) =>
      `- ${path.relative(root, file).replace(/\\/g, "/")} (${(bytes / 1024 / 1024).toFixed(2)} MiB)`,
    )
    .join("\n");
  throw new Error(
    `Cloudflare Pages supports static files up to 25 MiB. Oversized assets:\n${details}`,
  );
}

console.log("Cloudflare asset-size check passed (no public file exceeds 25 MiB).");
