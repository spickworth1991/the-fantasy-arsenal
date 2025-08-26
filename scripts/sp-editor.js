#!/usr/bin/env node
/**
 * StickyPicky Local Editor
 * ---------------------------------------
 * Run:   node sp-editor.js
 * Open:  http://localhost:4321
 *
 * What it does:
 * - Serves a small UI to view/edit stickypicky_cache.json
 * - Supports: section switcher, search, inline edit, add/remove, import/export
 * - Saves back to file with a timestamped .bak backup
 */

const fs = require("fs");
const path = require("path");
const express = require("express");

// ----- CONFIG -----
const PORT = 4321;
// Point this to wherever your file is. In your app you fetch("/stickypicky_cache.json"),
// which typically means it lives at `public/stickypicky_cache.json`.
const JSON_PATH = path.resolve(__dirname, "public", "stickypicky_cache.json");

// Ensure file exists
if (!fs.existsSync(JSON_PATH)) {
  console.error(`❌ Could not find ${JSON_PATH}
Create it (or update JSON_PATH in sp-editor.js) and run again.`);
  process.exit(1);
}

const app = express();
app.use(express.json({ limit: "10mb" }));

// ------- helpers -------
function readData() {
  const raw = fs.readFileSync(JSON_PATH, "utf8");
  const data = JSON.parse(raw);
  // Harden structure to expected shape
  const slots = ["Dynasty_SF", "Dynasty_1QB", "Redraft_SF", "Redraft_1QB"];
  for (const s of slots) data[s] = Array.isArray(data[s]) ? data[s] : [];
  return data;
}

function validateItem(x) {
  if (typeof x !== "object" || !x) return "Item is not an object";
  if (typeof x.name !== "string" || x.name.trim() === "") return "Missing name";
  if (typeof x.position !== "string") return "Missing position";
  if (typeof x.team !== "string") return "Missing team";
  if (typeof x.value !== "number" || !Number.isFinite(x.value)) return "Value must be a number";
  return null;
}

function validatePayload(payload) {
  const sections = ["Dynasty_SF", "Dynasty_1QB", "Redraft_SF", "Redraft_1QB"];
  for (const sec of sections) {
    if (!Array.isArray(payload[sec])) return `Section ${sec} is not an array`;
    for (const item of payload[sec]) {
      const err = validateItem(item);
      if (err) return `${sec}: ${err}`;
    }
  }
  return null;
}

function backupFile() {
  const dir = path.dirname(JSON_PATH);
  const base = path.basename(JSON_PATH, ".json");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const bak = path.join(dir, `${base}.${stamp}.bak.json`);
  fs.copyFileSync(JSON_PATH, bak);
  return bak;
}

// ------- routes -------
app.get("/", (_req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>StickyPicky Editor</title>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <style>
    :root {
      color-scheme: dark;
      --bg: #0b1220;
      --panel: #101a2e;
      --muted: #93a4c7;
      --accent: #74f0ff;
      --ok: #31d0a0;
      --warn: #ffcb6b;
      --danger: #ff6b6b;
      --border: #1e2a46;
    }
    html,body { margin:0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Inter, sans-serif; background: var(--bg); color: #e6f0ff; }
    header { padding: 16px 20px; border-bottom: 1px solid var(--border); background: linear-gradient(180deg, #0d1630, #0b1220); position: sticky; top:0; z-index: 20; }
    h1 { margin: 0; font-weight: 800; letter-spacing: .5px; }
    .accent { color: var(--accent); }
    main { padding: 20px; max-width: 1200px; margin: 0 auto; }
    .panel { background: var(--panel); border:1px solid var(--border); border-radius: 14px; padding: 16px; box-shadow: 0 8px 30px rgba(0,0,0,.25); }
    .row { display:flex; gap:12px; flex-wrap:wrap; align-items:center; }
    select, input[type="text"], input[type="number"] {
      background:#0b1430; border:1px solid var(--border); color:#dfe9ff; border-radius:10px; padding:10px 12px; outline:none;
    }
    .btn {
      border:1px solid var(--border); background:#0d1836; color:#eaf4ff; border-radius:10px; padding:10px 14px; cursor:pointer;
    }
    .btn:hover { background:#11214b; }
    .btn.ok { border-color: #1a4a40; background: #0b2823; color: #bff7e8; }
    .btn.ok:hover { background:#0f322c; }
    .btn.warn { border-color: #5a4a1a; background: #2c250b; color: #ffe7aa; }
    .btn.danger { border-color: #5a1a1a; background: #2c0b0b; color: #ffc2c2; }
    .toolbar { display:flex; gap:10px; flex-wrap:wrap; align-items:center; }
    .spacer { flex:1; }
    table { width:100%; border-collapse: collapse; margin-top: 14px; }
    th, td { border-bottom: 1px solid var(--border); padding: 10px; text-align:left; }
    th { font-weight:700; color:#cfe2ff; }
    tr:hover td { background:#0c1531; }
    td input, td select { width:100%; box-sizing:border-box; }
    .small { font-size: 12px; color: var(--muted); }
    .pill { padding:4px 10px; border-radius: 999px; background:#0b1430; border:1px solid var(--border); color:#cde7ff; }
    .flex { display:flex; gap:8px; align-items:center; }
    .right { text-align:right; }
    .muted { color: var(--muted); }
    .footer { margin-top:12px; display:flex; gap:10px; justify-content:space-between; align-items:center; }
    .sticky { position: sticky; bottom: 0; background: var(--panel); padding-top: 12px; }
  </style>
</head>
<body>
  <header>
    <h1><span class="accent">The Fantasy Arsenal</span> — StickyPicky Editor</h1>
    <div class="small muted">Edit values, add/remove rows, import/export JSON, then Save.</div>
  </header>
  <main>
    <div class="panel">
      <div class="row toolbar">
        <label>Section:
          <select id="section">
            <option>Dynasty_SF</option>
            <option>Dynasty_1QB</option>
            <option>Redraft_SF</option>
            <option>Redraft_1QB</option>
          </select>
        </label>
        <label>Search: <input id="q" type="text" placeholder="Filter by name/team/position..."/></label>
        <button class="btn" id="sortName">Sort Name</button>
        <button class="btn" id="sortValue">Sort Value</button>
        <span class="spacer"></span>
        <button class="btn" id="addRow">+ Add Row</button>
        <button class="btn warn" id="importJson">Import JSON</button>
        <button class="btn" id="exportJson">Export JSON</button>
        <button class="btn ok" id="save">Save</button>
      </div>

      <table id="grid">
        <thead>
          <tr>
            <th style="width:36%;">Name</th>
            <th style="width:12%;">Team</th>
            <th style="width:12%;">Position</th>
            <th class="right" style="width:18%;">Value</th>
            <th style="width:14%;">&nbsp;</th>
          </tr>
        </thead>
        <tbody></tbody>
      </table>

      <div class="footer sticky">
        <div id="status" class="small muted">Ready.</div>
        <div class="small"><span class="pill" id="countPill">0 rows</span></div>
      </div>
    </div>
  </main>

  <script>
    const status = (msg, tone="muted") => {
      const el = document.getElementById("status");
      el.className = "small " + tone;
      el.textContent = msg;
    };

    let data = null;     // full JSON { Dynasty_SF:[], ... }
    let view = [];       // working copy of current section
    let current = "Dynasty_SF";
    let q = "";

    const $ = (id) => document.getElementById(id);
    const tbody = document.querySelector("#grid tbody");

    async function load() {
      status("Loading data…");
      const res = await fetch("/data");
      if (!res.ok) throw new Error("Failed to load data");
      data = await res.json();
      current = $("section").value;
      view = structuredClone(data[current]);
      render();
      status("Loaded.", "muted");
    }

    function render() {
      const query = q.trim().toLowerCase();
      const rows = view.filter(r => {
        if (!query) return true;
        const hay = (r.name + " " + r.team + " " + r.position).toLowerCase();
        return hay.includes(query);
      });

      tbody.innerHTML = "";
      for (let i=0;i<rows.length;i++) {
        const r = rows[i];
        const tr = document.createElement("tr");
        tr.innerHTML = \`
          <td><input data-k="name" value="\${r.name || ""}" /></td>
          <td><input data-k="team" value="\${r.team || ""}" /></td>
          <td>
            <select data-k="position">
              \${["QB","RB","WR","TE","DL","LB","DB","PICK",""].map(p => \`<option \${p===r.position?"selected":""}>\${p}</option>\`).join("")}
            </select>
          </td>
          <td class="right"><input data-k="value" type="number" step="1" value="\${Number(r.value)||0}" /></td>
          <td class="right">
            <button class="btn danger" data-act="del">Delete</button>
          </td>
        \`;
        // input handlers
        tr.querySelectorAll("input,select").forEach(inp => {
          inp.addEventListener("input", (e) => {
            const key = inp.dataset.k;
            if (!key) return;
            const idx = i; // index within filtered list; map back to view
            const srcIndex = view.indexOf(rows[idx]);
            if (srcIndex < 0) return;
            if (key === "value") {
              view[srcIndex][key] = Number(inp.value || 0);
            } else {
              view[srcIndex][key] = inp.value;
            }
          });
        });
        tr.querySelector('[data-act="del"]').addEventListener("click", () => {
          const srcIndex = view.indexOf(rows[i]);
          if (srcIndex >= 0) {
            view.splice(srcIndex,1);
            render();
          }
        });
        tbody.appendChild(tr);
      }
      $("countPill").textContent = \`\${rows.length} rows\`;
    }

    $("section").addEventListener("change", () => {
      // save current working set back to data before switching
      if (data && view) data[current] = view;
      current = $("section").value;
      view = structuredClone(data[current] || []);
      render();
    });

    $("q").addEventListener("input", (e) => {
      q = e.target.value || "";
      render();
    });

    $("sortName").addEventListener("click", () => {
      view.sort((a,b) => (a.name||"").localeCompare(b.name||""));
      render();
    });

    $("sortValue").addEventListener("click", () => {
      view.sort((a,b) => (b.value||0) - (a.value||0));
      render();
    });

    $("addRow").addEventListener("click", () => {
      view.unshift({ name:"", team:"", position:"", value:0 });
      render();
    });

    $("exportJson").addEventListener("click", () => {
      // merge current view back and download
      if (data && view) data[current] = view;
      const blob = new Blob([JSON.stringify(data, null, 2)], {type:"application/json"});
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "stickypicky_cache.edited.json";
      a.click();
      URL.revokeObjectURL(a.href);
    });

    $("importJson").addEventListener("click", async () => {
      const inp = document.createElement("input");
      inp.type = "file";
      inp.accept = "application/json";
      inp.onchange = async () => {
        const file = inp.files?.[0];
        if (!file) return;
        const text = await file.text();
        try {
          const json = JSON.parse(text);
          // basic validation
          if (!json || typeof json !== "object") throw new Error("Invalid JSON");
          if (!Array.isArray(json.Dynasty_SF) || !Array.isArray(json.Dynasty_1QB)) {
            throw new Error("Missing expected sections");
          }
          data = json;
          view = structuredClone(data[current] || []);
          render();
          status("Imported JSON (not yet saved).", "warn");
        } catch(e) {
          alert("Import error: " + e.message);
        }
      };
      inp.click();
    });

    $("save").addEventListener("click", async () => {
      try {
        if (data && view) data[current] = view;
        status("Saving…");
        const res = await fetch("/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        if (!res.ok) throw new Error(await res.text());
        const r = await res.json();
        status("Saved. Backup: " + r.backup, "ok");
      } catch (e) {
        status("Save failed: " + e.message, "danger");
        alert("Save failed: " + e.message);
      }
    });

    load().catch(e => {
      status("Load error: " + e.message, "danger");
      alert("Load error: " + e.message);
    });
  </script>
</body>
</html>`);
});

app.get("/data", (_req, res) => {
  try {
    const data = readData();
    res.json(data);
  } catch (e) {
    res.status(500).send("Failed to read JSON: " + e.message);
  }
});

app.post("/save", (req, res) => {
  try {
    const payload = req.body;
    const err = validatePayload(payload);
    if (err) return res.status(400).send(err);

    const backup = backupFile();
    fs.writeFileSync(JSON_PATH, JSON.stringify(payload, null, 2));
    res.json({ ok: true, backup: path.basename(backup) });
  } catch (e) {
    res.status(500).send("Save failed: " + e.message);
  }
});

app.listen(PORT, () => {
  console.log(`📟 StickyPicky Editor running on http://localhost:${PORT}`);
  console.log(`📄 Editing file: ${JSON_PATH}`);
});
