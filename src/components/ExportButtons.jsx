"use client";

import { useState } from "react";
import { copyTableForGoogleSheets, downloadTable } from "../utils/tabularExport";

export default function ExportButtons({ rows, columns, filename, className = "" }) {
  const [sheetsStatus, setSheetsStatus] = useState("");
  const disabled = !rows?.length;
  const buttonClass =
    "rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs font-medium text-white/80 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40";

  const openGoogleSheets = async () => {
    // Open synchronously so popup blockers recognize the user gesture.
    const sheet = window.open(
      "https://docs.google.com/spreadsheets/u/0/create",
      "_blank",
      "noopener,noreferrer"
    );
    try {
      await copyTableForGoogleSheets({ rows, columns });
      setSheetsStatus("Copied — paste with Ctrl+V");
    } catch {
      setSheetsStatus("Clipboard blocked — use CSV");
      if (!sheet) window.open("https://docs.google.com/spreadsheets/u/0/create", "_blank", "noopener,noreferrer");
    }
    window.setTimeout(() => setSheetsStatus(""), 5000);
  };

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <button
        type="button"
        className={buttonClass}
        disabled={disabled}
        onClick={() => downloadTable({ rows, columns, filename, format: "csv" })}
      >
        Download CSV
      </button>
      <button
        type="button"
        className={buttonClass}
        disabled={disabled}
        title="Copies the table and opens a new Google Sheet; paste with Ctrl+V"
        onClick={openGoogleSheets}
      >
        Open Google Sheets
      </button>
      {sheetsStatus ? <span className="text-xs text-cyan-200">{sheetsStatus}</span> : null}
    </div>
  );
}
