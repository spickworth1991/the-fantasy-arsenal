const FORMULA_PREFIX = /^[=+@-]/;

function safeCell(value) {
  if (value == null) return "";
  const text = Array.isArray(value) ? value.join(", ") : String(value);
  return FORMULA_PREFIX.test(text) ? `'${text}` : text;
}

function csvCell(value) {
  const text = safeCell(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function tsvCell(value) {
  return safeCell(value).replace(/[\t\r\n]+/g, " ");
}

function makeFilename(baseName, extension) {
  const base = String(baseName || "export")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const date = new Date().toISOString().slice(0, 10);
  return `${base || "export"}-${date}.${extension}`;
}

export function tableToDelimitedText({ rows, columns, format = "csv" }) {
  if (!Array.isArray(rows) || !rows.length || !Array.isArray(columns) || !columns.length) return "";

  const isTsv = format === "tsv";
  const delimiter = isTsv ? "\t" : ",";
  const encode = isTsv ? tsvCell : csvCell;
  return [
    columns.map((column) => encode(column.label)).join(delimiter),
    ...rows.map((row) =>
      columns
        .map((column) => encode(typeof column.value === "function" ? column.value(row) : row?.[column.key]))
        .join(delimiter)
    ),
  ].join("\r\n");
}

export function downloadTable({ rows, columns, filename, format = "csv" }) {
  const isTsv = format === "tsv";
  const text = tableToDelimitedText({ rows, columns, format });
  if (!text) return;

  const mime = isTsv
    ? "text/tab-separated-values;charset=utf-8"
    : "text/csv;charset=utf-8";
  const blob = new Blob(["\uFEFF", text], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = makeFilename(filename, isTsv ? "tsv" : "csv");
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function copyTableForGoogleSheets({ rows, columns }) {
  const text = tableToDelimitedText({ rows, columns, format: "tsv" });
  if (!text) return false;
  await navigator.clipboard.writeText(text);
  return true;
}
