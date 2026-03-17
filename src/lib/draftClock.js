function safeNum(value) {
  const next = typeof value === "number" ? value : Number(value);
  return Number.isFinite(next) ? next : 0;
}

function safeText(value) {
  return String(value || "").trim().toLowerCase();
}

function readNum(row, ...keys) {
  for (const key of keys) {
    if (!row || row[key] == null) continue;
    const next = Number(row[key]);
    if (Number.isFinite(next)) return next;
  }
  return 0;
}

function readText(row, ...keys) {
  for (const key of keys) {
    if (!row || row[key] == null) continue;
    return String(row[key] || "");
  }
  return "";
}

export function getDraftClockState(row, now = Date.now()) {
  const status = safeText(readText(row, "status"));
  const timerSec = readNum(row, "timerSec", "timer_sec");
  const totalMs = timerSec > 0 ? timerSec * 1000 : 0;
  const lastPickedMs = readNum(row, "lastPicked", "last_picked");
  const anchorAtMs = readNum(row, "clockAnchorAt", "clock_anchor_at");
  const anchorRemainingMs = readNum(row, "clockRemainingMs", "clock_remaining_ms");
  const fallbackEndsAt = readNum(row, "clockEndsAt", "clock_ends_at");

  const isPaused =
    status === "paused" || status === "draft_paused" || status === "on_hold";
  const isComplete = status === "complete";

  if (isComplete) {
    return {
      status,
      isPaused: false,
      isComplete: true,
      hasRunningClock: false,
      remainingMs: 0,
      totalMs,
      anchorAtMs: 0,
      endsAtMs: 0,
      source: "complete",
    };
  }

  if (isPaused) {
    let remainingMs = anchorRemainingMs;
    if (!(remainingMs > 0) && fallbackEndsAt > 0) {
      remainingMs = Math.max(0, fallbackEndsAt - now);
    }
    if (!(remainingMs > 0) && lastPickedMs > 0 && totalMs > 0) {
      remainingMs = Math.max(0, lastPickedMs + totalMs - now);
    }

    return {
      status,
      isPaused: true,
      isComplete: false,
      hasRunningClock: false,
      remainingMs: Math.max(0, safeNum(remainingMs)),
      totalMs,
      anchorAtMs,
      endsAtMs: 0,
      source: anchorRemainingMs > 0 ? "anchor" : fallbackEndsAt > 0 ? "ends_at" : "last_picked",
    };
  }

  let remainingMs = 0;
  let source = "none";

  if (anchorRemainingMs > 0 && anchorAtMs > 0) {
    remainingMs = Math.max(0, anchorRemainingMs - Math.max(0, now - anchorAtMs));
    source = "anchor";
  } else if (fallbackEndsAt > 0) {
    remainingMs = Math.max(0, fallbackEndsAt - now);
    source = "ends_at";
  } else if (lastPickedMs > 0 && totalMs > 0) {
    remainingMs = Math.max(0, lastPickedMs + totalMs - now);
    source = "last_picked";
  }

  return {
    status,
    isPaused: false,
    isComplete: false,
    hasRunningClock: remainingMs > 0,
    remainingMs,
    totalMs,
    anchorAtMs,
    endsAtMs: remainingMs > 0 ? now + remainingMs : 0,
    source,
  };
}

