// src/app/draft-pick-tracker/tracker.client.js
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSleeper } from "../../context/SleeperContext";
import Navbar from "../../components/Navbar";
import BackgroundParticles from "../../components/BackgroundParticles";
import PushAlerts from "./PushAlerts.client.jsx";

const nf0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

function safeNum(v) {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

function msToClock(ms) {
  const s = Math.max(0, Math.floor(safeNum(ms) / 1000));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n) => String(n).padStart(2, "0");
  if (hh > 0) return `${hh}:${pad(mm)}:${pad(ss)}`;
  return `${mm}:${pad(ss)}`;
}

function safeJsonParse(s) {
  try {
    if (!s) return null;
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function sortByUpdated(a, b) {
  const au = safeNum(a?.updatedAt);
  const bu = safeNum(b?.updatedAt);
  if (bu !== au) return bu - au;
  return String(a?.draftId || "").localeCompare(String(b?.draftId || ""));
}

function withinFairRange(delta) {
  // Example: hide recs if |delta| <= 2
  return Math.abs(safeNum(delta)) <= 2;
}

export default function DraftPickTrackerClient() {
  const { username, leagues } = useSleeper();

  const [draftRows, setDraftRows] = useState([]);
  const [selectedDraftIds, setSelectedDraftIds] = useState([]);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const pingTimer = useRef(null);
  const refreshTimer = useRef(null);
  const mountedRef = useRef(false);

  // ---- derive from leagues
  const allDraftIds = useMemo(() => {
    const out = [];
    for (const lg of leagues || []) {
      if (lg?.draft_id) out.push(String(lg.draft_id));
    }
    return out;
  }, [leagues]);

  // default selected = all
  useEffect(() => {
    if (!mountedRef.current) return;
    setSelectedDraftIds((prev) => (prev?.length ? prev : allDraftIds));
  }, [allDraftIds]);

  // initial selected set
  useEffect(() => {
    mountedRef.current = true;
    setSelectedDraftIds(allDraftIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pingDiscover() {
    try {
      await fetch("/api/draft-pick-tracker/discover", { method: "POST" });
    } catch {
      // ignore
    }
  }

  async function refreshRegistry(ids) {
    if (!ids?.length) return [];

    // "lite=1" avoids returning massive JSON blobs for every draft.
    const res = await fetch(
      `/api/draft-pick-tracker/registry?lite=1&ids=${encodeURIComponent(ids.join(","))}`
    );
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) {
      throw new Error(json?.error || "Registry fetch failed");
    }

    const drafts = json?.drafts || {};
    const rows = [];

    for (const id of ids) {
      const reg = drafts?.[id];
      if (!reg) continue;

      // `draft` can be null in lite mode (we rely on computed columns instead)
      const draft = reg?.draft || safeJsonParse(reg?.draft_json);

      const storedStatus = String(reg?.status || "").toLowerCase().trim();
      const draftStatus = String(draft?.status || "").toLowerCase().trim();
      const status = storedStatus && storedStatus !== "unknown" ? storedStatus : draftStatus || null;

      const lg = (leagues || []).find((x) => String(x?.draft_id) === String(id));
      const seasonStr = String(lg?.season || lg?.settings?.season || "");

      const teams = safeNum(reg?.teams || draft?.settings?.teams || 0);
      const rounds = safeNum(reg?.rounds || draft?.settings?.rounds || 0);
      const timerSec = safeNum(
        reg?.timerSec ||
          reg?.timer_sec ||
          draft?.settings?.pick_timer ||
          draft?.settings?.pick_timer_seconds ||
          0
      );
      const reversalRound = safeNum(
        reg?.reversalRound || reg?.reversal_round || draft?.settings?.reversal_round || 0
      );

      rows.push({
        draftId: String(id),
        leagueId: reg?.leagueId || lg?.league_id || null,
        leagueName: reg?.leagueName || lg?.name || null,
        leagueAvatar: reg?.leagueAvatar || lg?.avatar || null,
        season: seasonStr || null,
        status,
        active: !!reg?.active,
        lastPicked: reg?.lastPicked ?? reg?.last_picked ?? null,
        pickCount: safeNum(reg?.pickCount ?? reg?.pick_count ?? 0),
        teams,
        rounds,
        timerSec,
        reversalRound,
        bestBall: !!reg?.bestBall,
        currentPick: reg?.currentPick ?? null,
        currentOwnerName: reg?.currentOwnerName ?? null,
        nextOwnerName: reg?.nextOwnerName ?? null,
        clockEndsAt: reg?.clockEndsAt ?? null,
        completedAt: reg?.completedAt ?? null,
        updatedAt: reg?.updatedAt ?? null,
        slotToRoster: reg?.slotToRoster || {},
        rosterNames: reg?.rosterNames || {},
        rosterByUsername: reg?.rosterByUsername || {},
        tradedPickOwner: reg?.tradedPickOwner || {},
      });
    }

    return rows;
  }

  async function refreshAll() {
    try {
      setErr("");
      setLoading(true);

      // ping discover in the background (do not await)
      pingDiscover();

      const ids = selectedDraftIds?.length ? selectedDraftIds : allDraftIds;
      const rows = await refreshRegistry(ids);

      rows.sort(sortByUpdated);

      setDraftRows(rows);
    } catch (e) {
      console.error(e);
      setErr(e?.message || "Failed to load registry");
    } finally {
      setLoading(false);
    }
  }

  // periodic discover ping (keeps registry warm for everyone)
  useEffect(() => {
    if (pingTimer.current) clearInterval(pingTimer.current);
    pingTimer.current = setInterval(pingDiscover, 60_000);
    return () => {
      if (pingTimer.current) clearInterval(pingTimer.current);
    };
  }, []);

  // periodic refresh (only if any drafts are active)
  const anyDrafting = useMemo(
    () => (draftRows || []).some((r) => String(r?.status || "") === "drafting"),
    [draftRows]
  );

  useEffect(() => {
    if (refreshTimer.current) clearInterval(refreshTimer.current);
    if (!anyDrafting) return;

    refreshTimer.current = setInterval(refreshAll, 60_000);
    return () => {
      if (refreshTimer.current) clearInterval(refreshTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anyDrafting, selectedDraftIds.join("|"), allDraftIds.join("|")]);

  // load on mount / selection change
  useEffect(() => {
    refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDraftIds.join("|"), allDraftIds.join("|")]);

  const filteredDraftRows = useMemo(() => {
    const rows = [...(draftRows || [])];

    if (filter === "drafting") {
      return rows.filter((r) => String(r?.status || "") === "drafting");
    }
    if (filter === "pre") {
      return rows.filter((r) => String(r?.status || "") === "pre_draft");
    }
    if (filter === "complete") {
      return rows.filter((r) => String(r?.status || "") === "complete");
    }
    return rows;
  }, [draftRows, filter]);

  return (
    <div className="min-h-screen">
      <BackgroundParticles />
      <Navbar />

      <main className="mx-auto max-w-6xl px-4 pb-16 pt-24">
        <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Draft Pick Tracker</h1>
            <p className="mt-1 text-sm text-white/70">
              Live pick + clock tracking from a shared registry (fast UI, shared notifications).
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:items-end">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setFilter("all")}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                  filter === "all" ? "bg-white/15" : "bg-white/5 hover:bg-white/10"
                }`}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setFilter("drafting")}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                  filter === "drafting" ? "bg-white/15" : "bg-white/5 hover:bg-white/10"
                }`}
              >
                Drafting
              </button>
              <button
                type="button"
                onClick={() => setFilter("pre")}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                  filter === "pre" ? "bg-white/15" : "bg-white/5 hover:bg-white/10"
                }`}
              >
                Pre-draft
              </button>
              <button
                type="button"
                onClick={() => setFilter("complete")}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                  filter === "complete" ? "bg-white/15" : "bg-white/5 hover:bg-white/10"
                }`}
              >
                Complete
              </button>

              <button
                type="button"
                onClick={refreshAll}
                className="rounded-lg bg-white/5 px-3 py-1.5 text-xs font-semibold hover:bg-white/10"
              >
                Refresh
              </button>
            </div>

            <PushAlerts username={username} draftIds={allDraftIds} selectedDraftIds={selectedDraftIds} />
          </div>
        </div>

        {err ? (
          <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
            {err}
          </div>
        ) : null}

        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          {loading ? (
            <div className="text-sm text-white/70">Loading registry…</div>
          ) : (
            <div className="space-y-3">
              {filteredDraftRows.length === 0 ? (
                <div className="text-sm text-white/70">No drafts found for your selection.</div>
              ) : (
                filteredDraftRows.map((r) => (
                  <div
                    key={r.draftId}
                    className="flex flex-col gap-1 rounded-xl border border-white/10 bg-black/20 p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{r.leagueName || r.draftId}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/70">
                        <span>Status: {r.status || "unknown"}</span>
                        <span>Picks: {nf0.format(safeNum(r.pickCount))}</span>
                        {r.clockEndsAt ? <span>Clock: {msToClock(r.clockEndsAt - Date.now())}</span> : null}
                        {r.currentOwnerName ? <span>On deck: {r.currentOwnerName}</span> : null}
                        {r.nextOwnerName ? <span>Next: {r.nextOwnerName}</span> : null}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <a
                        href={`https://sleeper.com/draft/nfl/${r.draftId}`}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-lg bg-cyan-500/90 px-3 py-1.5 text-xs font-semibold text-black hover:bg-cyan-400"
                      >
                        Open Draft
                      </a>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}